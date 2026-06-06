import { Router, type IRouter } from "express";
import multer from "multer";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { requireAuth } from "../lib/auth";
import { validateEmailFast, validateDomainsBatch } from "../lib/email-validator";
import { db, suppressionListTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** Normalize a header for alias matching: lowercase, no spaces/dashes/underscores */
function nh(s: string): string {
  return s.toLowerCase().replace(/[\s_\-\/().]+/g, "");
}

/** Returns true only if the value looks like a real vehicle (has alphabetic content). */
function isValidVehicle(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (/^\$?[\d,]+\.?\d*$/.test(trimmed)) return false;
  return /[a-zA-Z]/.test(trimmed);
}

function looksLikePrice(val: string): boolean {
  return /^\$?[\d,]+\.?\d*$/.test(val.trim());
}

/** Map a normalized header to a standard field name, or null if not recognised.
 *  IMPORTANT: quote_id is checked BEFORE price so that columns named "quote",
 *  "quote number", "id", etc. are never accidentally captured as {price}.
 */
function detectField(header: string): string | null {
  const n = nh(header);

  // ── Email ──────────────────────────────────────────────────────────────────
  if (["email", "customeremail", "clientemail", "emailaddress", "mail",
       "emailid", "contactemail"].includes(n)) return "email";

  // ── Name ───────────────────────────────────────────────────────────────────
  if (["name", "customername", "fullname", "clientname", "contactname",
       "firstname", "customer", "client", "leadname"].includes(n)) return "name";
  if (n.startsWith("custname") || n.endsWith("name")) return "name";

  // ── Quote ID (MUST come before price — "quote" alone maps here, not to price) ──
  if ([
    "quoteid", "quote_id", "quotenumber", "quotenum", "quoten", "quoteno",
    "quote",                      // plain "Quote" column → {quote_id}
    "quoteref", "quotereference",
    "ordernumber", "orderid", "orderno",
    "bookingid", "bookingno", "bookingnumber",
    "referenceid", "refno", "refnumber", "reference",
    "id", "number",               // generic ID/Number column → {quote_id}
    "jobid", "jobnumber", "jobnо",
    "qid", "qno",
  ].includes(n)) return "quote_id";

  // ── Price (note: "quote" and "totalquote" removed — they belong to quote_id above) ──
  if ([
    "totaltariff", "price", "amount", "total",
    "transportcost", "shippingcost", "shippingrate", "rate", "cost",
    "bid", "offer", "fee", "tariff",
    "transportprice", "transportrate", "shippingprice",
    "quoteprice", "quoteamount",   // "quote price" / "quote amount" → still price
    "totalamount", "invoiceamount",
  ].includes(n)) return "price";

  // ── Vehicle ────────────────────────────────────────────────────────────────
  if (["vehicle", "vehicles", "car", "vehicletype", "makemodel", "ymm",
       "yrmakemodel", "automobile", "auto", "cartype",
       "vehicledescription", "transportvehicle"].includes(n)) return "vehicle";
  if (n.includes("vehicle") || n.includes("makemodel")) return "vehicle";

  // ── Pickup ─────────────────────────────────────────────────────────────────
  if (["pickup", "origin", "pickuplocation", "originlocation", "from",
       "fromlocation", "shippingfrom", "shipfrom", "pickupaddress",
       "originaddress", "shipper"].includes(n)) return "pickup";

  // ── Delivery ───────────────────────────────────────────────────────────────
  if (["delivery", "destination", "deliverylocation", "destinationlocation", "to",
       "tolocation", "shippingto", "shipto", "deliveryaddress",
       "destinationaddress", "consignee"].includes(n)) return "delivery";

  // ── Route ──────────────────────────────────────────────────────────────────
  if (["route", "shippingroute", "transportroute", "transitroute"].includes(n)) return "route";

  // ── Company ────────────────────────────────────────────────────────────────
  if (["company", "companyname", "business", "broker", "brokername",
       "organization", "dealership", "dealer"].includes(n)) return "company";

  // ── Phone ──────────────────────────────────────────────────────────────────
  if (["phone", "phonenumber", "telephone", "mobile", "cell",
       "cellphone", "contactphone", "custphone"].includes(n)) return "phone";

  // ── Notes ──────────────────────────────────────────────────────────────────
  if (["notes", "note", "comments", "comment", "remarks", "details",
       "additionalinfo", "extra", "description", "instructions"].includes(n)) return "notes";

  return null;
}

/**
 * Build a compound "City, ST ZIP" location from sub-columns when the main
 * location column was not found.
 */
function buildCompoundLocation(
  row: Record<string, string>,
  headers: string[],
  type: "pickup" | "delivery"
): string | null {
  const cityKeys = type === "pickup"
    ? ["origincity", "pickupcity", "originname", "pickupname", "fromcity"]
    : ["destinationcity", "deliverycity", "destinationname", "deliveryname", "tocity"];

  const stateKeys = type === "pickup"
    ? ["originstate", "pickupstate", "originst", "pickupst", "fromstate"]
    : ["destinationstate", "deliverystate", "destinationst", "deliveryst", "tostate"];

  const zipKeys = type === "pickup"
    ? ["originzip", "pickupzip", "originzipcode", "pickupzipcode", "fromzip"]
    : ["destinationzip", "deliveryzip", "destinationzipcode", "deliveryzipcode", "tozip"];

  let city = ""; let state = ""; let zip = "";

  for (const h of headers) {
    const n = nh(h);
    const val = String(row[h] ?? "").trim();
    if (!val) continue;
    if (!city  && cityKeys.includes(n))  city  = val;
    if (!state && stateKeys.includes(n)) state = val;
    if (!zip   && zipKeys.includes(n))   zip   = val;
  }

  if (!city && !state) return null;
  const parts: string[] = [];
  if (city) parts.push(city);
  const stateZip = [state, zip].filter(Boolean).join(" ");
  if (stateZip) parts.push(stateZip);
  return parts.join(", ") || null;
}

/** Normalize a raw column header to a snake_case template variable name */
function normalizeKey(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function mapRow(
  headers: string[],
  row: Record<string, string>
): Record<string, string | null> {
  const mapped: Record<string, string | null> = {
    name: null, email: null, vehicle: null, route: null,
    pickup: null, delivery: null, price: null, notes: null,
    company: null, phone: null, quote_id: null,
  };

  for (const header of headers) {
    const field = detectField(header);
    if (!field) continue;
    if (mapped[field]) continue; // first match wins

    const val = String(row[header] ?? "").trim();
    if (!val) continue;

    // Strict vehicle validation — numeric values must never become {vehicle}
    if (field === "vehicle" && !isValidVehicle(val)) continue;

    // If a non-price/non-id field gets a numeric value, offer it to price instead.
    // IMPORTANT: quote_id is explicitly excluded — numeric quote IDs must NEVER be
    // silently redirected to {price}.
    if (
      field !== "price" &&
      field !== "quote_id" &&   // ← key fix: protect quote_id from theft
      field !== "email" &&
      field !== "phone" &&
      field !== "name" &&
      looksLikePrice(val)
    ) {
      if (!mapped["price"]) mapped["price"] = val;
      continue;
    }

    mapped[field] = val;
  }

  // Attempt compound location building when single-column detection missed
  if (!mapped.pickup)   mapped.pickup   = buildCompoundLocation(row, headers, "pickup");
  if (!mapped.delivery) mapped.delivery = buildCompoundLocation(row, headers, "delivery");

  return mapped;
}

router.post("/uploads/parse", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const user = req.user!;
  const filename = req.file.originalname.toLowerCase();
  let rows: Record<string, string>[] = [];
  let headers: string[] = [];

  try {
    if (filename.endsWith(".csv")) {
      const text = req.file.buffer.toString("utf-8");
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      });
      headers = result.meta.fields ?? [];
      rows = result.data;
    } else if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
      if (data.length > 0) headers = Object.keys(data[0]);
      rows = data;
    } else {
      res.status(400).json({ error: "Unsupported file format. Please upload CSV or XLSX." });
      return;
    }
  } catch {
    res.status(400).json({ error: "Failed to parse file. Make sure it is a valid CSV or XLSX." });
    return;
  }

  // ── Phase 1: Basic row mapping + fast email validation (syntax/disposable/role) ──

  const seenEmails = new Set<string>();
  type RawRow = Record<string, string | boolean | null> & {
    hasValidEmail: boolean;
    isDuplicate: boolean;
    isDisposable: boolean;
    isFlagged: boolean;
    validationReason: string | null;
    flagReason: string | null;
    _emailLower: string;
    _domain: string | null;
  };

  const rawRows: RawRow[] = rows.map(row => {
    const mapped = mapRow(headers, row);
    const rawEmail = mapped.email ?? "";
    const emailLower = rawEmail.toLowerCase().trim();

    // Fast validation: syntax + disposable + role
    const fastResult = validateEmailFast(emailLower);

    // "structurally valid syntax" = passes all RFC checks.
    // Disposable emails have valid syntax but are blocked by policy — still
    // track them for deduplication so the duplicate count stays accurate.
    const hasValidSyntax = fastResult.valid || fastResult.isDisposable;

    const isDuplicate   = hasValidSyntax && seenEmails.has(emailLower);
    if (hasValidSyntax) seenEmails.add(emailLower);

    // Extract domain for DNS batch validation later
    const domain = hasValidSyntax ? emailLower.split("@")[1] : null;

    // Build raw column fields
    const rawFields: Record<string, string> = {};
    for (const header of headers) {
      const key = normalizeKey(header);
      if (key && row[header] != null) rawFields[key] = String(row[header]).trim();
    }

    return {
      ...rawFields,
      ...mapped,
      hasValidEmail:    hasValidSyntax && fastResult.valid, // will be updated after DNS
      isDuplicate,
      isDisposable:     fastResult.isDisposable,
      isFlagged:        fastResult.flagged,
      validationReason: fastResult.valid ? null : fastResult.reason,
      flagReason:       fastResult.flagReason,
      isSuppressed:     false,  // filled in Phase 3
      isDomainInvalid:  false,  // filled in Phase 2
      _emailLower:      emailLower,
      _domain:          domain,
    } as RawRow;
  });

  // ── Phase 2: DNS validation — batch-resolve unique domains ──

  const domainsToCheck = Array.from(
    new Set(
      rawRows
        .filter(r => r.hasValidEmail && !r.isDuplicate && !r.isDisposable && r._domain)
        .map(r => r._domain as string),
    ),
  );

  const failedDomains = await validateDomainsBatch(domainsToCheck);

  for (const r of rawRows) {
    if (r._domain && failedDomains.has(r._domain)) {
      (r as any).hasValidEmail   = false;
      (r as any).isDomainInvalid = true;
      (r as any).validationReason = "Domain has no mail server (no MX or A record)";
    }
  }

  // ── Phase 3: Suppression list lookup — single batch query ──

  const validEmails = rawRows
    .filter(r => r.hasValidEmail && !r.isDuplicate)
    .map(r => r._emailLower)
    .filter(Boolean);

  const suppressedSet = new Set<string>();
  if (validEmails.length > 0) {
    try {
      const suppressed = await db
        .select({ email: suppressionListTable.email })
        .from(suppressionListTable)
        .where(
          eq(suppressionListTable.userId, user.id)
        )
        .then(rows2 => rows2.filter(r => validEmails.includes(r.email)));
      // Narrow within JS since inArray may not handle empty arrays cleanly
      for (const s of suppressed) suppressedSet.add(s.email);
    } catch {
      // non-fatal — if suppression lookup fails, treat as unsuppressed
    }
  }

  // ── Phase 4: Finalize rows, strip internal fields ──

  const parsedRows = rawRows.map(r => {
    const { _emailLower, _domain, ...rest } = r as any;
    const isSuppressed = suppressedSet.has(_emailLower);
    return { ...rest, isSuppressed };
  });

  // ── Aggregate counts ──

  const invalidRows    = parsedRows.filter(r => !r.hasValidEmail && !r.isDuplicate).length;
  const duplicateRows  = parsedRows.filter(r => r.isDuplicate).length;
  const disposableRows = parsedRows.filter(r => !r.isDuplicate && r.isDisposable).length;
  const suppressedRows = parsedRows.filter(r => !r.isDuplicate && r.isSuppressed).length;
  const flaggedRows    = parsedRows.filter(r => r.hasValidEmail && !r.isDuplicate && !r.isSuppressed && r.isFlagged).length;
  const validRows      = parsedRows.filter(r => r.hasValidEmail && !r.isDuplicate && !r.isSuppressed).length;

  // Report which standard fields were auto-detected
  const STANDARD_FIELDS = ["name","email","vehicle","pickup","delivery","price","route","company","phone","notes","quote_id"];
  const firstRow = (parsedRows[0] ?? {}) as Record<string, unknown>;
  const detectedFields = STANDARD_FIELDS.filter(k => {
    const v = firstRow[k];
    return v != null && v !== false && v !== "";
  });

  // Build column-to-variable mapping for the frontend panel
  const columnMappings: Record<string, string | null> = {};
  for (const header of headers) {
    columnMappings[header] = detectField(header);
  }

  res.json({
    rows: parsedRows,
    totalRows: parsedRows.length,
    validRows,
    invalidRows,
    duplicateRows,
    disposableRows,
    suppressedRows,
    flaggedRows,
    detectedFields,
    headers,
    columnMappings,
  });
});

export default router;
