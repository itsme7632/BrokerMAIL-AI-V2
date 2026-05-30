/**
 * HTML email builder — fully white-label, zero platform branding.
 *
 * Architecture:
 *  - `row`     — lead-specific CSV vars: {name}, {vehicle}, {pickup}, {delivery}, {price}, {route}
 *  - `branding`— user's company settings, applied automatically to header/signature
 *  - Templates NEVER contain company name or contact info as row variables
 *  - Signature is NEVER injected unless useSignatureBuilder === true
 *  - Zero hardcoded company names, taglines, or platform text anywhere
 *  - Table layout, inline CSS + media queries — Gmail mobile / Outlook / Apple Mail safe
 */

export type EmailStyle =
  | "clean" | "modern" | "minimal" | "luxury"
  | "corporate" | "urgent" | "dispatch" | "friendly" | "mobile" | "dark";

/** User's company settings — drives header and optional signature automatically */
export interface BrandingSettings {
  agentName?:      string | null;
  companyName?:    string | null;
  companyTagline?: string | null;
  companyPhone?:   string | null;
  companyWebsite?: string | null;
  usdot?:          string | null;
  mcNumber?:       string | null;
  accentColor?:    string | null;
  logoUrl?:        string | null;
}

export interface CtaButton {
  id:          string;
  text:        string;
  color:       string;
  size:        "sm" | "md" | "lg";
  urlVariable: string;
  directUrl?:  string;
}

export interface EmailBuildOptions {
  style?:               EmailStyle;
  useSignatureBuilder?: boolean;
  ctaButtons?:          CtaButton[];
  trackingId?:          string;
  publicBase?:          string;
}

// ─── Utils ────────────────────────────────────────────────────────────────────

export function formatPrice(val: string): string {
  const trimmed = (val ?? "").trim();
  if (!trimmed) return trimmed;
  if (/^\$/.test(trimmed)) return trimmed;
  const cleaned = trimmed.replace(/[,\s]/g, "");
  const num = parseFloat(cleaned);
  if (!isNaN(num) && cleaned !== "") {
    return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return trimmed;
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeColor(color?: string | null): string {
  if (!color) return "";
  const c = color.trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : "";
}

export function replaceVarsText(text: string, row: Record<string, string>): string {
  return text.replace(/\{([^}]+)\}/g, (match, key) => {
    const k = key.trim();
    const val = row[k];
    if (val == null) return match;
    return k === "price" ? formatPrice(val) : val;
  });
}

function replaceVarsHtml(text: string, row: Record<string, string>): string {
  return text.replace(/\{([^}]+)\}/g, (match, key) => {
    const k = key.trim();
    const raw = row[k];
    if (raw == null) {
      return `<span style="color:#ef4444;font-style:italic;">${match}</span>`;
    }
    const val = k === "price" ? formatPrice(raw) : raw;
    const esc = escapeHtml(val);
    if (k === "price")    return `<strong style="color:#059669;font-size:16px;">${esc}</strong>`;
    if (["vehicle", "pickup", "delivery", "route"].includes(k)) return `<strong>${esc}</strong>`;
    if (k === "name")     return `<strong>${esc}</strong>`;
    if (k === "quote_id") return `<strong style="color:#7c3aed;">${esc}</strong>`;
    return esc;
  });
}

function textToHtmlParagraphs(text: string, fontFamily: string, color: string, fontSize = "15px"): string {
  return text
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(para =>
      `<p class="em-p" style="margin:0 0 16px;font-family:${fontFamily};color:${color};font-size:${fontSize};line-height:1.75;">${
        para.trim().replace(/\n/g, "<br>")
      }</p>`
    )
    .join("");
}

function sharedHead(extraCss = ""): string {
  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title></title>
<style type="text/css">
body,table,td,p,a,li{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;}
img{-ms-interpolation-mode:bicubic;border:0;height:auto;outline:none;text-decoration:none;}
body{margin:0!important;padding:0!important;width:100%!important;}
@media only screen and (max-width:600px){
  .em-wrapper{padding:0!important;}
  .em-wrapper-td{padding:12px 0!important;}
  .em-card{width:100%!important;max-width:100%!important;}
  .em-hdr{padding:20px 20px!important;}
  .em-body{padding:28px 20px 28px!important;}
  .em-co{font-size:18px!important;line-height:1.3!important;}
  .em-tag{font-size:11px!important;}
  .em-p{font-size:14px!important;line-height:1.7!important;}
  .em-sig{padding:16px 20px!important;}
}
${extraCss}
</style>`;
}

function buildLogoHtml(branding: BrandingSettings, maxWidth = 120, maxHeight = 44): string {
  if (!branding.logoUrl) return "";
  const alt = branding.companyName ? escapeHtml(branding.companyName) : "Company Logo";
  return `<img src="${branding.logoUrl}" alt="${alt}" width="${maxWidth}" height="${maxHeight}" style="display:block;width:auto;max-width:${maxWidth}px;max-height:${maxHeight}px;height:auto;border:0;outline:none;text-decoration:none;" />`;
}

function buildSignatureHtml(
  agentNameOverride: string,
  branding: BrandingSettings,
  borderColor: string,
  fontFamily: string,
  textColor = "#64748b"
): string {
  const rawName = agentNameOverride?.trim() || branding.agentName?.trim() || "";
  const name    = rawName                        ? escapeHtml(rawName)                        : "";
  const company = branding.companyName?.trim()   ? escapeHtml(branding.companyName.trim())   : "";
  const tagline = branding.companyTagline?.trim()? escapeHtml(branding.companyTagline.trim()): "";
  const phone   = branding.companyPhone?.trim()  ? escapeHtml(branding.companyPhone.trim())  : "";
  const website = branding.companyWebsite?.trim()? escapeHtml(branding.companyWebsite.trim()): "";
  const usdot   = branding.usdot?.trim()         ? escapeHtml(branding.usdot.trim())         : "";
  const mc      = branding.mcNumber?.trim()      ? escapeHtml(branding.mcNumber.trim())      : "";

  if (!name && !company && !phone && !website && !usdot && !mc) return "";

  const nameColor = textColor === "#c8d3e0" ? "#e2e8f0" : "#1e293b";
  const compColor = textColor === "#c8d3e0" ? "#cbd5e1" : "#374151";
  const linkColor = textColor === "#c8d3e0" ? "#93c5fd" : "#2563eb";

  const lines: string[] = [];
  if (name)    lines.push(`<strong style="color:${nameColor};font-size:14px;">${name}</strong>`);
  if (company) {
    const companyLine = tagline
      ? `<span style="color:${compColor};">${company}</span> <span style="color:${textColor};font-size:12px;">${tagline}</span>`
      : `<span style="color:${compColor};">${company}</span>`;
    lines.push(companyLine);
  }
  if (phone)   lines.push(phone);
  if (website) {
    const href = /^https?:\/\//.test(website) ? website : `https://${website}`;
    lines.push(`<a href="${href}" style="color:${linkColor};text-decoration:none;">${website}</a>`);
  }
  const creds: string[] = [];
  if (usdot) creds.push(`USDOT #${usdot}`);
  if (mc)    creds.push(`MC #${mc}`);
  if (creds.length) lines.push(creds.join(" &nbsp;&middot;&nbsp; "));

  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:24px;">
<tr><td class="em-sig" style="padding-top:20px;border-top:1px solid ${borderColor};">
<p style="margin:0;font-family:${fontFamily};color:${textColor};font-size:13px;line-height:2.0;">
Best regards,<br>${lines.join("<br>")}
</p>
</td></tr>
</table>`;
}

// ─── CTA Button builder ───────────────────────────────────────────────────────

function buildCtaButtonsHtml(
  buttons: CtaButton[],
  row: Record<string, string>,
  trackingId: string | undefined,
  publicBase: string | undefined,
  fontFamily: string,
): string {
  if (!buttons.length) return "";

  const items = buttons.map(btn => {
    const rawUrl = btn.directUrl?.trim() || row[btn.urlVariable] || "";
    if (!rawUrl) return "";

    let href = rawUrl;
    if (trackingId && publicBase) {
      href = `${publicBase}/api/track/click/${trackingId}?url=${encodeURIComponent(rawUrl)}&label=${encodeURIComponent(btn.text)}`;
    }

    const color   = safeColor(btn.color) || "#1d4ed8";
    const padding = btn.size === "sm" ? "10px 22px" : btn.size === "lg" ? "18px 44px" : "14px 32px";
    const fontSize = btn.size === "sm" ? "13px" : btn.size === "lg" ? "17px" : "15px";

    return `<tr>
      <td align="center" style="padding:6px 0;">
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${escapeHtml(href)}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="8%" stroke="f" fillcolor="${color}"><w:anchorlock/><center style="color:#ffffff;font-family:${fontFamily};font-size:${fontSize};font-weight:700;">${escapeHtml(btn.text)}</center></v:roundrect><![endif]-->
        <a href="${escapeHtml(href)}" target="_blank" style="background-color:${color};border-radius:6px;color:#ffffff;display:inline-block;font-family:${fontFamily};font-size:${fontSize};font-weight:700;line-height:1.4;padding:${padding};text-align:center;text-decoration:none;-webkit-text-size-adjust:none;mso-hide:all;">${escapeHtml(btn.text)}</a>
      </td>
    </tr>`;
  }).filter(Boolean);

  if (!items.length) return "";

  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:20px;">
${items.join("\n")}
</table>`;
}

// ─── Master builder ───────────────────────────────────────────────────────────

export function buildHtmlEmail(
  body: string,
  row: Record<string, string>,
  branding: BrandingSettings = {},
  options: EmailBuildOptions = {}
): string {
  const style  = options.style ?? "clean";
  const useSig = options.useSignatureBuilder ?? false;

  switch (style) {
    case "luxury":    return luxuryTemplate(body, row, branding, useSig, options);
    case "modern":    return modernTemplate(body, row, branding, useSig, options);
    case "minimal":   return minimalTemplate(body, row, branding, useSig, options);
    case "corporate": return corporateTemplate(body, row, branding, useSig, options);
    case "urgent":    return urgentTemplate(body, row, branding, useSig, options);
    case "dispatch":  return dispatchTemplate(body, row, branding, useSig, options);
    case "friendly":  return friendlyTemplate(body, row, branding, useSig, options);
    case "mobile":    return mobileTemplate(body, row, branding, useSig, options);
    case "dark":      return darkTemplate(body, row, branding, useSig, options);
    default:          return cleanTemplate(body, row, branding, useSig, options);
  }
}

// ─── Style: Clean ─────────────────────────────────────────────────────────────

function cleanTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const FONT    = "Arial, Helvetica, sans-serif";
  const accent  = safeColor(branding.accentColor) || "#1d4ed8";
  const company = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const tagline = branding.companyTagline?.trim() ? escapeHtml(branding.companyTagline.trim()) : "";
  const logoHtml = buildLogoHtml(branding, 120, 44);

  const headerRow = (company || logoHtml)
    ? `<tr>
        <td class="em-hdr" bgcolor="${accent}" style="background-color:${accent};padding:24px 40px;">
          ${logoHtml ? `<div style="margin-bottom:${company ? "10px" : "0"};">${logoHtml}</div>` : ""}
          ${company ? `<p class="em-co" style="margin:0${tagline ? " 0 5px" : ""};font-family:${FONT};color:#ffffff;font-size:20px;font-weight:700;line-height:1.3;">${company}</p>` : ""}
          ${tagline ? `<p class="em-tag" style="margin:0;font-family:${FONT};color:rgba(255,255,255,0.78);font-size:12px;font-weight:400;letter-spacing:0.3px;line-height:1.4;">${tagline}</p>` : ""}
        </td>
      </tr>`
    : "";

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), FONT, "#374151");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#e2e8f0", FONT) : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead()}</head>
<body style="margin:0;padding:0;background-color:#f8fafc;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8fafc" style="background-color:#f8fafc;width:100%;">
<tr><td class="em-wrapper-td" align="center" style="padding:40px 16px;">
<!--[if (gte mso 9)|(IE)]><table width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;">
${headerRow}
<tr><td class="em-body" style="padding:36px 40px 40px;font-family:${FONT};">${bodyHtml}${ctaHtml}${sigHtml}</td></tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ─── Style: Modern ────────────────────────────────────────────────────────────
// Two-band header, rounded card, quote highlight box, CTA button footer

function modernTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const FONT    = "Arial, Helvetica, sans-serif";
  const accent  = safeColor(branding.accentColor) || "#4f46e5";
  const company = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const tagline = branding.companyTagline?.trim() ? escapeHtml(branding.companyTagline.trim()) : "";
  const logoHtml = buildLogoHtml(branding, 120, 44);

  const vehicle  = row.vehicle  ? escapeHtml(row.vehicle)               : "";
  const pickup   = row.pickup   ? escapeHtml(row.pickup)                : "";
  const delivery = row.delivery ? escapeHtml(row.delivery)              : "";
  const price    = row.price    ? escapeHtml(formatPrice(row.price))    : "";
  const quoteId  = row.quote_id ? escapeHtml(row.quote_id)              : "";

  const quotePanel = (vehicle || price)
    ? `<tr>
        <td style="padding:0 40px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#eef2ff;border-left:4px solid ${accent};border-radius:0 6px 6px 0;">
            <tr>
              <td style="padding:18px 22px;">
                <p style="margin:0 0 4px;font-family:${FONT};color:#6366f1;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Your Quote Summary</p>
                ${price    ? `<p style="margin:0 0 6px;font-family:${FONT};color:#1e293b;font-size:26px;font-weight:800;line-height:1;">${price}</p>` : ""}
                ${vehicle  ? `<p style="margin:0 0 4px;font-family:${FONT};color:#374151;font-size:13px;font-weight:600;">${vehicle}</p>` : ""}
                ${(pickup && delivery) ? `<p style="margin:0;font-family:${FONT};color:#6b7280;font-size:12px;">${pickup} &rarr; ${delivery}</p>` : ""}
                ${quoteId  ? `<p style="margin:6px 0 0;font-family:${FONT};color:#9ca3af;font-size:11px;">Ref: ${quoteId}</p>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), FONT, "#374151");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#e0e7ff", FONT) : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead(`
@media only screen and (max-width:600px){
  .em-mod-top{padding:0 20px 20px!important;}
  .em-mod-body{padding:28px 20px 28px!important;}
  .em-mod-foot{padding:16px 20px!important;}
}`)}</head>
<body style="margin:0;padding:0;background-color:#eef2ff;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef2ff" style="background-color:#eef2ff;width:100%;">
<tr><td class="em-wrapper-td" align="center" style="padding:40px 16px;">
<!--[if (gte mso 9)|(IE)]><table width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #c7d2fe;">
<!-- Top accent band -->
<tr><td bgcolor="#312e81" style="background-color:#312e81;padding:5px 40px;"></td></tr>
<!-- Main header -->
<tr>
  <td class="em-hdr" bgcolor="${accent}" style="background-color:${accent};padding:24px 40px 28px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td>
          ${logoHtml ? `<div style="margin-bottom:${company ? "10px" : "0"};">${logoHtml}</div>` : ""}
          ${company ? `<p class="em-co" style="margin:0${tagline ? " 0 5px" : ""};font-family:${FONT};color:#ffffff;font-size:21px;font-weight:700;letter-spacing:0.2px;">${company}</p>` : ""}
          ${tagline ? `<p class="em-tag" style="margin:0;font-family:${FONT};color:rgba(199,210,254,0.9);font-size:12px;letter-spacing:0.3px;">${tagline}</p>` : ""}
        </td>
        <td align="right" style="vertical-align:bottom;">
          <p style="margin:0;font-family:${FONT};color:rgba(255,255,255,0.45);font-size:10px;letter-spacing:2px;text-transform:uppercase;">AUTO&nbsp;TRANSPORT</p>
        </td>
      </tr>
    </table>
  </td>
</tr>
<!-- Quote panel -->
${quotePanel}
<!-- Body -->
<tr><td class="em-mod-body" style="padding:${quotePanel ? "4px" : "36px"} 40px 36px;font-family:${FONT};">${bodyHtml}${ctaHtml}${sigHtml}</td></tr>
<!-- CTA footer -->
<tr>
  <td class="em-mod-foot" style="padding:20px 40px 28px;background-color:#f8fafc;border-top:1px solid #e0e7ff;text-align:center;">
    <p style="margin:0 0 12px;font-family:${FONT};color:#6b7280;font-size:12px;">Ready to book your transport?</p>
    <a href="mailto:" style="display:inline-block;padding:11px 32px;background-color:${accent};color:#ffffff;font-family:${FONT};font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;letter-spacing:0.3px;">Reply to Confirm &rarr;</a>
  </td>
</tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ─── Style: Minimal ───────────────────────────────────────────────────────────

function minimalTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const FONT    = "Arial, Helvetica, sans-serif";
  const accent  = safeColor(branding.accentColor) || "#2563eb";
  const company = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const tagline = branding.companyTagline?.trim() ? escapeHtml(branding.companyTagline.trim()) : "";
  const logoHtml = buildLogoHtml(branding, 100, 36);

  const companyRow = (company || logoHtml)
    ? `<tr>
        <td class="em-hdr" style="padding:28px 0 18px;border-bottom:1px solid #e2e8f0;">
          ${logoHtml ? `<div style="margin-bottom:${company ? "8px" : "0"};">${logoHtml}</div>` : ""}
          ${company ? `<p class="em-co" style="margin:0${tagline ? " 0 4px" : ""};font-family:${FONT};color:${accent};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${company}</p>` : ""}
          ${tagline ? `<p class="em-tag" style="margin:0;font-family:${FONT};color:#64748b;font-size:11px;font-weight:400;letter-spacing:0.5px;text-transform:uppercase;">${tagline}</p>` : ""}
        </td>
      </tr>
      <tr><td style="padding:4px 0;"></td></tr>`
    : `<tr><td style="padding:24px 0 0;"></td></tr>`;

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), FONT, "#374151");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#f1f5f9", FONT) : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead(`@media only screen and (max-width:600px){.em-minimal-card{width:100%!important;padding:0 16px!important;}}`)}</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;width:100%;">
<tr><td class="em-wrapper-td" align="center" style="padding:40px 24px;">
<!--[if (gte mso 9)|(IE)]><table width="560" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:560px;max-width:560px;border-top:3px solid ${accent};">
${companyRow}
<tr><td class="em-body" style="padding:12px 0 40px;font-family:${FONT};">${bodyHtml}${ctaHtml}${sigHtml}</td></tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ─── Style: Luxury ────────────────────────────────────────────────────────────

function luxuryTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const HEADING_FONT = "Arial, Helvetica, sans-serif";
  const BODY_FONT    = "Georgia, 'Times New Roman', serif";
  const company      = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const tagline      = branding.companyTagline?.trim() ? escapeHtml(branding.companyTagline.trim()) : "";
  const logoHtml     = buildLogoHtml(branding, 120, 44);

  const hasHeader    = company || logoHtml;
  const headerPad    = hasHeader ? "30px 40px" : "14px 40px";
  const headerInner  = hasHeader
    ? `${logoHtml ? `<div style="margin-bottom:${company ? "10px" : "0"};">${logoHtml}</div>` : ""}
       ${company ? `<p class="em-co" style="margin:0${tagline ? " 0 6px" : ""};font-family:${HEADING_FONT};color:#f8fafc;font-size:22px;font-weight:700;letter-spacing:0.5px;line-height:1.3;">${company}</p>` : ""}
       ${tagline ? `<p class="em-tag" style="margin:0;font-family:${HEADING_FONT};color:rgba(212,175,55,0.85);font-size:11px;font-weight:400;letter-spacing:1.5px;text-transform:uppercase;">${tagline}</p>` : ""}`
    : "";

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), BODY_FONT, "#1e293b");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#d97706", HEADING_FONT) : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, HEADING_FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead(`
@media only screen and (max-width:600px){
  .em-lux-hdr{padding:22px 24px!important;}
  .em-lux-body{padding:32px 24px 28px!important;}
  .em-lux-foot{padding:14px 24px!important;}
  .em-co{font-size:19px!important;}
}`)}</head>
<body style="margin:0;padding:0;background-color:#0f172a;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0f172a" style="background-color:#0f172a;width:100%;">
<tr><td class="em-wrapper-td" align="center" style="padding:40px 16px;">
<!--[if (gte mso 9)|(IE)]><table width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:600px;max-width:600px;">
<tr>
  <td class="em-lux-hdr em-hdr" bgcolor="#0f172a" style="background-color:#0f172a;padding:${headerPad};border-top:2px solid #d97706;border-left:1px solid #1e293b;border-right:1px solid #1e293b;">
    ${headerInner}
  </td>
</tr>
<tr>
  <td class="em-lux-body em-body" bgcolor="#ffffff" style="background-color:#ffffff;padding:44px 48px 40px;border-left:1px solid #1e293b;border-right:1px solid #1e293b;font-family:${BODY_FONT};">
    ${bodyHtml}${ctaHtml}${sigHtml}
  </td>
</tr>
<tr>
  <td class="em-lux-foot" bgcolor="#0f172a" style="background-color:#0f172a;padding:14px 48px;border-bottom:2px solid #d97706;border-left:1px solid #1e293b;border-right:1px solid #1e293b;">
    <p style="margin:0;font-size:1px;line-height:1px;">&#160;</p>
  </td>
</tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ─── Style: Corporate ─────────────────────────────────────────────────────────
// Enterprise look with structured quote details table + two-column footer

function corporateTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const FONT    = "Arial, Helvetica, sans-serif";
  const accent  = safeColor(branding.accentColor) || "#0a2558";
  const company = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const tagline = branding.companyTagline?.trim() ? escapeHtml(branding.companyTagline.trim()) : "";
  const logoHtml = buildLogoHtml(branding, 130, 46);

  const vehicle  = row.vehicle  ? escapeHtml(row.vehicle)            : "";
  const pickup   = row.pickup   ? escapeHtml(row.pickup)             : "";
  const delivery = row.delivery ? escapeHtml(row.delivery)           : "";
  const price    = row.price    ? escapeHtml(formatPrice(row.price)) : "";
  const quoteId  = row.quote_id ? escapeHtml(row.quote_id)           : "";

  const quoteBox = (vehicle || price || pickup || delivery)
    ? `<tr>
        <td style="padding:0 40px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid #cbd5e1;border-top:3px solid ${accent};">
            <tr>
              <td colspan="2" style="padding:10px 20px 8px;background-color:#f1f5f9;border-bottom:1px solid #e2e8f0;">
                <p style="margin:0;font-family:${FONT};color:${accent};font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">&#9632; Quote Details</p>
              </td>
            </tr>
            ${vehicle ? `<tr>
              <td style="padding:10px 20px 4px;font-family:${FONT};color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;width:38%;">Vehicle</td>
              <td style="padding:10px 20px 4px;font-family:${FONT};color:#1e293b;font-size:13px;font-weight:600;">${vehicle}</td>
            </tr>` : ""}
            ${(pickup && delivery) ? `<tr>
              <td style="padding:4px 20px;font-family:${FONT};color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Route</td>
              <td style="padding:4px 20px;font-family:${FONT};color:#1e293b;font-size:13px;font-weight:600;">${pickup} &rarr; ${delivery}</td>
            </tr>` : ""}
            ${price ? `<tr>
              <td style="padding:4px 20px;font-family:${FONT};color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Quoted Price</td>
              <td style="padding:4px 20px;font-family:${FONT};color:#059669;font-size:16px;font-weight:800;">${price}</td>
            </tr>` : ""}
            ${quoteId ? `<tr>
              <td style="padding:4px 20px 12px;font-family:${FONT};color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Reference #</td>
              <td style="padding:4px 20px 12px;font-family:${FONT};color:#7c3aed;font-size:13px;font-weight:600;">${quoteId}</td>
            </tr>` : ""}
          </table>
        </td>
      </tr>`
    : "";

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), FONT, "#1e293b");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#cbd5e1", FONT) : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead(`
@media only screen and (max-width:600px){
  .em-corp-top{padding:20px 20px!important;}
  .em-corp-body{padding:28px 20px 28px!important;}
  .em-corp-foot{padding:12px 20px!important;}
}`)}</head>
<body style="margin:0;padding:0;background-color:#eef2f7;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef2f7" style="background-color:#eef2f7;width:100%;">
<tr><td align="center" style="padding:40px 16px;">
<!--[if (gte mso 9)|(IE)]><table width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#ffffff;border-top:4px solid ${accent};">
<tr>
  <td class="em-corp-top" bgcolor="${accent}" style="background-color:${accent};padding:28px 40px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="vertical-align:middle;">
          ${logoHtml ? `<div style="margin-bottom:${company ? "10px" : "0"};">${logoHtml}</div>` : ""}
          ${company ? `<p class="em-co" style="margin:0;font-family:${FONT};color:#ffffff;font-size:19px;font-weight:700;letter-spacing:0.3px;line-height:1.3;">${company}</p>` : ""}
          ${tagline ? `<p style="margin:3px 0 0;font-family:${FONT};color:rgba(255,255,255,0.65);font-size:11px;letter-spacing:0.8px;text-transform:uppercase;">${tagline}</p>` : ""}
        </td>
        <td align="right" style="vertical-align:middle;">
          <p style="margin:0;font-family:${FONT};color:rgba(255,255,255,0.5);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;">AUTO TRANSPORT</p>
          <p style="margin:2px 0 0;font-family:${FONT};color:rgba(255,255,255,0.35);font-size:10px;letter-spacing:1px;text-transform:uppercase;">QUOTE</p>
        </td>
      </tr>
    </table>
  </td>
</tr>
${quoteBox}
<tr>
  <td class="em-corp-body" style="padding:${quoteBox ? "8px" : "36px"} 40px 40px;font-family:${FONT};">${bodyHtml}${ctaHtml}${sigHtml}</td>
</tr>
<tr>
  <td class="em-corp-foot" style="padding:14px 40px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td><p style="margin:0;font-family:${FONT};color:#94a3b8;font-size:11px;letter-spacing:0.5px;">CONFIDENTIAL AUTO TRANSPORT QUOTE</p></td>
        <td align="right"><p style="margin:0;font-family:${FONT};color:#cbd5e1;font-size:11px;">${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p></td>
      </tr>
    </table>
  </td>
</tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ─── Style: Urgent ────────────────────────────────────────────────────────────
// Follow-up style with urgency alert panel and availability warning

function urgentTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const FONT    = "Arial, Helvetica, sans-serif";
  const company = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const logoHtml = buildLogoHtml(branding, 120, 40);

  const price    = row.price    ? escapeHtml(formatPrice(row.price)) : "";
  const vehicle  = row.vehicle  ? escapeHtml(row.vehicle)            : "";
  const quoteId  = row.quote_id ? escapeHtml(row.quote_id)           : "";

  const urgencyPanel = `<tr>
    <td style="padding:0 40px 28px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #ea580c;">
        <tr>
          <td style="padding:16px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td style="vertical-align:top;padding-right:12px;">
                  <p style="margin:0 0 4px;font-family:${FONT};color:#9a3412;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">&#9888; Availability Alert</p>
                  <p style="margin:0;font-family:${FONT};color:#7c2d12;font-size:13px;line-height:1.5;">Limited transport slots remain this week. Please reply within <strong>24 hours</strong> to secure your booking at this rate.</p>
                </td>
                ${price ? `<td align="right" style="vertical-align:middle;white-space:nowrap;">
                  <p style="margin:0 0 2px;font-family:${FONT};color:#9a3412;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Your Rate</p>
                  <p style="margin:0;font-family:${FONT};color:#059669;font-size:22px;font-weight:800;">${price}</p>
                  ${vehicle ? `<p style="margin:2px 0 0;font-family:${FONT};color:#9a3412;font-size:11px;">${vehicle}</p>` : ""}
                </td>` : ""}
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), FONT, "#1e293b");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#fecaca", FONT) : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead(`
@media only screen and (max-width:600px){
  .em-urg-banner{padding:14px 20px!important;}
  .em-urg-body{padding:28px 20px!important;}
}`)}</head>
<body style="margin:0;padding:0;background-color:#fff5f5;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#fff5f5" style="background-color:#fff5f5;width:100%;">
<tr><td align="center" style="padding:40px 16px;">
<!--[if (gte mso 9)|(IE)]><table width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #fecaca;border-top:4px solid #dc2626;">
<tr>
  <td class="em-urg-banner" bgcolor="#dc2626" style="background-color:#dc2626;padding:18px 40px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td>
          ${logoHtml ? `<div style="margin-bottom:8px;">${logoHtml}</div>` : ""}
          ${company ? `<p style="margin:0 0 2px;font-family:${FONT};color:#ffffff;font-size:16px;font-weight:700;">${company}</p>` : ""}
        </td>
        <td align="right">
          <span style="display:inline-block;padding:4px 10px;background-color:rgba(255,255,255,0.18);font-family:${FONT};color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border:1px solid rgba(255,255,255,0.35);">&#9889; TIME-SENSITIVE</span>
        </td>
      </tr>
    </table>
  </td>
</tr>
${urgencyPanel}
<tr>
  <td class="em-urg-body" style="padding:8px 40px 36px;font-family:${FONT};">${bodyHtml}${ctaHtml}${sigHtml}</td>
</tr>
<tr>
  <td style="padding:16px 40px 20px;background-color:#fff5f5;border-top:1px solid #fecaca;text-align:center;">
    <p style="margin:0 0 10px;font-family:${FONT};color:#ef4444;font-size:11px;">This quote expires soon. Please respond promptly to lock in your rate.</p>
    <a href="mailto:" style="display:inline-block;padding:10px 28px;background-color:#dc2626;color:#ffffff;font-family:${FONT};font-size:13px;font-weight:700;text-decoration:none;border-radius:4px;letter-spacing:0.3px;">Reply Now to Confirm &rarr;</a>
    ${quoteId ? `<p style="margin:10px 0 0;font-family:${FONT};color:#f87171;font-size:11px;">Quote Ref: ${quoteId}</p>` : ""}
  </td>
</tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ─── Style: Dispatch ──────────────────────────────────────────────────────────
// Logistics dispatch board feel with route visualization panel

function dispatchTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const FONT    = "Arial, Helvetica, sans-serif";
  const MONO    = "Courier New, Courier, monospace";
  const accent  = safeColor(branding.accentColor) || "#065f46";
  const company = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const tagline = branding.companyTagline?.trim() ? escapeHtml(branding.companyTagline.trim()) : "";
  const logoHtml = buildLogoHtml(branding, 120, 44);

  const vehicle  = row.vehicle  ? escapeHtml(row.vehicle)            : "";
  const pickup   = row.pickup   ? escapeHtml(row.pickup)             : "";
  const delivery = row.delivery ? escapeHtml(row.delivery)           : "";
  const price    = row.price    ? escapeHtml(formatPrice(row.price)) : "";
  const quoteId  = row.quote_id ? escapeHtml(row.quote_id)           : "";

  const routePanel = (pickup || delivery || vehicle)
    ? `<tr>
        <td style="padding:0 40px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f0fdf4;border:1px solid #bbf7d0;">
            <tr>
              <td colspan="3" style="padding:10px 20px 8px;border-bottom:1px solid #bbf7d0;">
                <p style="margin:0;font-family:${FONT};color:#065f46;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">&#9654; Transport Route</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;vertical-align:top;width:40%;">
                <p style="margin:0 0 3px;font-family:${FONT};color:#6b7280;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">ORIGIN</p>
                <p style="margin:0;font-family:${FONT};color:#065f46;font-size:14px;font-weight:700;">${pickup || "—"}</p>
              </td>
              <td align="center" style="padding:16px 8px;vertical-align:middle;color:#059669;font-size:18px;">&#8594;</td>
              <td style="padding:16px 20px;vertical-align:top;width:40%;">
                <p style="margin:0 0 3px;font-family:${FONT};color:#6b7280;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">DESTINATION</p>
                <p style="margin:0;font-family:${FONT};color:#065f46;font-size:14px;font-weight:700;">${delivery || "—"}</p>
              </td>
            </tr>
            ${(vehicle || price || quoteId) ? `<tr>
              <td colspan="3" style="padding:8px 20px 14px;border-top:1px solid #bbf7d0;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    ${vehicle ? `<td><p style="margin:0;font-family:${MONO};color:#047857;font-size:12px;">&#9632; ${vehicle}</p></td>` : ""}
                    ${price   ? `<td align="right"><p style="margin:0;font-family:${FONT};color:#059669;font-size:16px;font-weight:800;">${price}</p></td>` : ""}
                  </tr>
                  ${quoteId ? `<tr><td colspan="2"><p style="margin:4px 0 0;font-family:${MONO};color:#6b7280;font-size:11px;">Order: ${quoteId}</p></td></tr>` : ""}
                </table>
              </td>
            </tr>` : ""}
          </table>
        </td>
      </tr>`
    : "";

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), FONT, "#1e293b");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#a7f3d0", FONT) : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead(`
@media only screen and (max-width:600px){
  .em-disp-hdr{padding:20px 20px!important;}
  .em-disp-body{padding:28px 20px!important;}
}`)}</head>
<body style="margin:0;padding:0;background-color:#f0fdf4;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f0fdf4" style="background-color:#f0fdf4;width:100%;">
<tr><td align="center" style="padding:40px 16px;">
<!--[if (gte mso 9)|(IE)]><table width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #d1fae5;">
<tr>
  <td class="em-disp-hdr em-hdr" bgcolor="${accent}" style="background-color:${accent};padding:24px 40px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td>
          ${logoHtml ? `<div style="margin-bottom:${company ? "8px" : "0"};">${logoHtml}</div>` : ""}
          ${company ? `<p style="margin:0;font-family:${FONT};color:#ffffff;font-size:18px;font-weight:700;">${company}</p>` : ""}
          ${tagline ? `<p style="margin:3px 0 0;font-family:${FONT};color:rgba(255,255,255,0.7);font-size:12px;">${tagline}</p>` : ""}
        </td>
        <td align="right">
          <p style="margin:0;font-family:${FONT};color:rgba(255,255,255,0.6);font-size:10px;letter-spacing:1.2px;text-transform:uppercase;">DISPATCH QUOTE</p>
          <p style="margin:3px 0 0;font-family:${FONT};color:rgba(255,255,255,0.4);font-size:9px;letter-spacing:0.8px;text-transform:uppercase;">AUTO TRANSPORT</p>
        </td>
      </tr>
    </table>
  </td>
</tr>
${routePanel}
<tr>
  <td class="em-disp-body" style="padding:${routePanel ? "4px" : "36px"} 40px 36px;font-family:${FONT};">${bodyHtml}${ctaHtml}${sigHtml}</td>
</tr>
<tr>
  <td style="padding:12px 40px;background-color:#f0fdf4;border-top:1px solid #d1fae5;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td><p style="margin:0;font-family:${FONT};color:#059669;font-size:11px;letter-spacing:0.3px;">&#10003; Dispatch-ready &nbsp;&#10003; Fully Insured &nbsp;&#10003; Licensed Broker</p></td>
      </tr>
    </table>
  </td>
</tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ─── Style: Friendly ──────────────────────────────────────────────────────────
// Warm, approachable — personalized greeting box + trust badges footer

function friendlyTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const FONT    = "Arial, Helvetica, sans-serif";
  const accent  = safeColor(branding.accentColor) || "#0369a1";
  const company = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const tagline = branding.companyTagline?.trim() ? escapeHtml(branding.companyTagline.trim()) : "";
  const logoHtml = buildLogoHtml(branding, 120, 44);

  const name     = row.name    ? escapeHtml(row.name.split(" ")[0])  : "";
  const vehicle  = row.vehicle ? escapeHtml(row.vehicle)             : "";
  const price    = row.price   ? escapeHtml(formatPrice(row.price))  : "";

  const greetingBox = (name || vehicle)
    ? `<tr>
        <td style="padding:0 40px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;">
            <tr>
              <td style="padding:20px 24px;">
                ${name ? `<p style="margin:0 0 6px;font-family:${FONT};color:#0369a1;font-size:16px;font-weight:700;">Great news${name ? `, ${name}` : ""}!</p>` : ""}
                <p style="margin:0${vehicle ? " 0 8px" : ""};font-family:${FONT};color:#0c4a6e;font-size:13px;line-height:1.6;">Your transport quote is ready to review. We've put together our best available rate for you.</p>
                ${(vehicle || price) ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    ${vehicle ? `<td style="padding-right:20px;"><p style="margin:0;font-family:${FONT};color:#075985;font-size:12px;">&#9656; ${vehicle}</p></td>` : ""}
                    ${price   ? `<td><p style="margin:0;font-family:${FONT};color:#059669;font-size:18px;font-weight:800;">${price}</p></td>` : ""}
                  </tr>
                </table>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), FONT, "#374151");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#bae6fd", FONT) : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead(`
@media only screen and (max-width:600px){
  .em-fr-hdr{padding:20px 20px!important;}
  .em-fr-body{padding:28px 20px!important;}
}`)}</head>
<body style="margin:0;padding:0;background-color:#f0f9ff;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f0f9ff" style="background-color:#f0f9ff;width:100%;">
<tr><td align="center" style="padding:40px 16px;">
<!--[if (gte mso 9)|(IE)]><table width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #bae6fd;border-top:0;">
<tr>
  <td class="em-fr-hdr em-hdr" bgcolor="${accent}" style="background-color:${accent};padding:22px 40px 26px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td>
          ${logoHtml ? `<div style="margin-bottom:${company ? "10px" : "0"};">${logoHtml}</div>` : ""}
          ${company ? `<p style="margin:0;font-family:${FONT};color:#ffffff;font-size:20px;font-weight:700;">${company}</p>` : ""}
          ${tagline ? `<p style="margin:4px 0 0;font-family:${FONT};color:rgba(255,255,255,0.75);font-size:13px;">${tagline}</p>` : ""}
        </td>
        <td align="right" style="vertical-align:bottom;">
          <p style="margin:0;font-family:${FONT};color:rgba(255,255,255,0.5);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;">Transport Quote</p>
        </td>
      </tr>
    </table>
  </td>
</tr>
${greetingBox}
<tr>
  <td class="em-fr-body" style="padding:${greetingBox ? "4px" : "36px"} 40px 36px;font-family:${FONT};">${bodyHtml}${ctaHtml}${sigHtml}</td>
</tr>
<tr>
  <td style="padding:16px 40px;background-color:#f0f9ff;border-top:1px solid #bae6fd;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td><p style="margin:0;font-family:${FONT};color:#0ea5e9;font-size:12px;">Questions? We're always here to help. Just reply to this email.</p></td>
        <td align="right">
          <p style="margin:0;font-family:${FONT};color:#7dd3fc;font-size:11px;">&#128274; Insured &nbsp;&#128338; Fast Response</p>
        </td>
      </tr>
    </table>
  </td>
</tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ─── Style: Mobile ────────────────────────────────────────────────────────────
// Ultra-readable: large text, prominent price display, touch-friendly CTA

function mobileTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const FONT    = "Arial, Helvetica, sans-serif";
  const accent  = safeColor(branding.accentColor) || "#1e40af";
  const company = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const logoHtml = buildLogoHtml(branding, 100, 36);

  const vehicle  = row.vehicle  ? escapeHtml(row.vehicle)            : "";
  const pickup   = row.pickup   ? escapeHtml(row.pickup)             : "";
  const delivery = row.delivery ? escapeHtml(row.delivery)           : "";
  const price    = row.price    ? escapeHtml(formatPrice(row.price)) : "";

  const priceDisplay = (price || vehicle)
    ? `<tr>
        <td style="padding:0 0 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
            <tr>
              <td style="padding:20px 24px;">
                ${price    ? `<p style="margin:0 0 4px;font-family:${FONT};color:#059669;font-size:32px;font-weight:900;line-height:1;">${price}</p>` : ""}
                ${vehicle  ? `<p style="margin:0 0 6px;font-family:${FONT};color:#1e40af;font-size:16px;font-weight:700;">${vehicle}</p>` : ""}
                ${(pickup && delivery) ? `<p style="margin:0;font-family:${FONT};color:#6b7280;font-size:14px;">${pickup} &rarr; ${delivery}</p>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), FONT, "#1e293b", "17px");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#e2e8f0", FONT) : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead(`
@media only screen and (max-width:600px){
  .em-mob-card{width:100%!important;max-width:100%!important;}
  .em-mob-body{padding:28px 20px!important;}
  .em-p{font-size:16px!important;line-height:1.8!important;}
}`)}</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;width:100%;">
<tr><td align="center" style="padding:32px 16px;">
<!--[if (gte mso 9)|(IE)]><table width="560" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-mob-card em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:560px;max-width:560px;border-top:4px solid ${accent};">
<tr>
  <td style="padding:28px 0 20px;">
    ${logoHtml ? `<div style="margin-bottom:12px;">${logoHtml}</div>` : ""}
    ${company ? `<p style="margin:0;font-family:${FONT};color:${accent};font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${company}</p>` : ""}
  </td>
</tr>
${priceDisplay}
<tr>
  <td class="em-mob-body" style="padding:0 0 32px;font-family:${FONT};">${bodyHtml}${ctaHtml}${sigHtml}</td>
</tr>
<tr>
  <td style="padding:0 0 32px;text-align:center;">
    <a href="mailto:" style="display:inline-block;padding:16px 40px;background-color:${accent};color:#ffffff;font-family:${FONT};font-size:16px;font-weight:700;text-decoration:none;border-radius:8px;">Reply to Confirm &rarr;</a>
  </td>
</tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ─── Style: Dark ──────────────────────────────────────────────────────────────
// Email-safe dark design — dark card, light text, modern SaaS feel

function darkTemplate(
  body: string, row: Record<string, string>, branding: BrandingSettings, useSig: boolean, options: EmailBuildOptions = {}
): string {
  const FONT    = "Arial, Helvetica, sans-serif";
  const accent  = safeColor(branding.accentColor) || "#3b82f6";
  const company = branding.companyName?.trim() ? escapeHtml(branding.companyName.trim()) : "";
  const tagline = branding.companyTagline?.trim() ? escapeHtml(branding.companyTagline.trim()) : "";
  const logoHtml = buildLogoHtml(branding, 120, 44);

  const vehicle  = row.vehicle  ? escapeHtml(row.vehicle)            : "";
  const pickup   = row.pickup   ? escapeHtml(row.pickup)             : "";
  const delivery = row.delivery ? escapeHtml(row.delivery)           : "";
  const price    = row.price    ? escapeHtml(formatPrice(row.price)) : "";
  const quoteId  = row.quote_id ? escapeHtml(row.quote_id)           : "";

  const quoteRef = (vehicle || price)
    ? `<tr>
        <td style="padding:0 40px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0f172a;border:1px solid #334155;border-left:3px solid ${accent};">
            <tr>
              <td style="padding:16px 20px;">
                <p style="margin:0 0 8px;font-family:${FONT};color:${accent};font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Quote Details</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="padding-right:20px;">
                      ${vehicle ? `<p style="margin:0 0 4px;font-family:${FONT};color:#e2e8f0;font-size:14px;font-weight:600;">${vehicle}</p>` : ""}
                      ${(pickup && delivery) ? `<p style="margin:0;font-family:${FONT};color:#64748b;font-size:12px;">${pickup} &rarr; ${delivery}</p>` : ""}
                      ${quoteId ? `<p style="margin:6px 0 0;font-family:${FONT};color:#475569;font-size:11px;">Ref: ${quoteId}</p>` : ""}
                    </td>
                    ${price ? `<td align="right" style="vertical-align:middle;white-space:nowrap;">
                      <p style="margin:0;font-family:${FONT};color:#34d399;font-size:24px;font-weight:800;">${price}</p>
                    </td>` : ""}
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  const bodyHtml = textToHtmlParagraphs(replaceVarsHtml(body, row), FONT, "#cbd5e1");
  const sigHtml  = useSig ? buildSignatureHtml(row.agent_name ?? "", branding, "#334155", FONT, "#c8d3e0") : "";
  const ctaHtml  = buildCtaButtonsHtml(options.ctaButtons ?? [], row, options.trackingId, options.publicBase, FONT);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>${sharedHead(`
@media only screen and (max-width:600px){
  .em-dark-hdr{padding:22px 20px!important;}
  .em-dark-body{padding:28px 20px!important;}
  .em-p{color:#cbd5e1!important;}
}`)}</head>
<body style="margin:0;padding:0;background-color:#0f172a;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0f172a" style="background-color:#0f172a;width:100%;">
<tr><td align="center" style="padding:40px 16px;">
<!--[if (gte mso 9)|(IE)]><table width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table class="em-card" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#1e293b;border:1px solid #334155;border-top:3px solid ${accent};">
<tr>
  <td class="em-dark-hdr" style="background-color:#1e293b;padding:28px 40px;border-bottom:1px solid #334155;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td>
          ${logoHtml ? `<div style="margin-bottom:${company ? "10px" : "0"};">${logoHtml}</div>` : ""}
          ${company ? `<p class="em-co" style="margin:0;font-family:${FONT};color:#f1f5f9;font-size:20px;font-weight:700;">${company}</p>` : ""}
          ${tagline ? `<p style="margin:4px 0 0;font-family:${FONT};color:#64748b;font-size:12px;">${tagline}</p>` : ""}
        </td>
        <td align="right" style="vertical-align:middle;">
          <p style="margin:0;font-family:${FONT};color:${accent};font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">AUTO TRANSPORT</p>
        </td>
      </tr>
    </table>
  </td>
</tr>
${quoteRef}
<tr>
  <td class="em-dark-body" style="background-color:#1e293b;padding:${quoteRef ? "4px" : "36px"} 40px 40px;font-family:${FONT};">${bodyHtml}${ctaHtml}${sigHtml}</td>
</tr>
<tr>
  <td style="background-color:#0f172a;padding:14px 40px;border-top:1px solid #1e293b;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td><p style="margin:0;font-family:${FONT};color:#475569;font-size:11px;">Auto Transport Quote &mdash; Sent via BrokerMail</p></td>
        <td align="right"><p style="margin:0;font-family:${FONT};color:#334155;font-size:11px;">${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p></td>
      </tr>
    </table>
  </td>
</tr>
</table>
<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
