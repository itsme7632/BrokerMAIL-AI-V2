import { useState, useRef, useEffect } from "react";
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Link2, Image as ImageIcon,
  Code2, Eye, EyeOff, Save, Send, Trash2,
  Paperclip, X, ChevronDown, Monitor, Smartphone,
  FileCode, Palette, Type, Mail, Minus,
  Loader2, Clock, FileText, PenLine, CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── API helpers ───────────────────────────────────────────────────────────────

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
const apiUrl = (p: string) => `${BASE}/api/${p}`;

const apiFetch = (p: string, init?: RequestInit) =>
  fetch(apiUrl(p), { credentials: "include", ...init });

const apiPost = (p: string, body: unknown) =>
  apiFetch(p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const apiPut = (p: string, body: unknown) =>
  apiFetch(p, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HTTP-Method-Override": "PUT" },
    body: JSON.stringify(body),
  });

const apiDel = (p: string) =>
  apiFetch(p, { method: "POST", headers: { "X-HTTP-Method-Override": "DELETE" } });

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES: Record<string, { label: string; subject: string; body: string }> = {
  blank: { label: "Blank", subject: "", body: "<p></p>" },
  vehicleQuote: {
    label: "Vehicle Quote",
    subject: "Your Auto Transport Quote",
    body: `<p>Hello,</p>
<p>Thank you for requesting an auto transport quote. We're pleased to offer you our competitive pricing.</p>
<p><strong>Transport Details:</strong></p>
<ul>
  <li>Origin: <em>[Pickup City, State]</em></li>
  <li>Destination: <em>[Delivery City, State]</em></li>
  <li>Vehicle: <em>[Year Make Model]</em></li>
  <li>Estimated Price: <strong>$[Amount]</strong></li>
  <li>Transit Time: <em>[X–Y business days]</em></li>
</ul>
<p>This quote is valid for 7 days. To book, simply reply to this email or call us.</p>
<p>Best regards,</p>`,
  },
  followUp: {
    label: "Follow-Up",
    subject: "Following Up on Your Auto Transport Quote",
    body: `<p>Hello,</p>
<p>I wanted to follow up on the auto transport quote we sent recently. We understand this is an important decision and we're happy to answer any questions.</p>
<p>We're still offering the same competitive rate and would love to earn your business.</p>
<p>Feel free to reply or call us anytime.</p>
<p>Best regards,</p>`,
  },
  thankYou: {
    label: "Thank You",
    subject: "Thank You for Booking with Us",
    body: `<p>Hello,</p>
<p>Thank you for choosing us for your vehicle transport! We're thrilled to be handling your shipment.</p>
<p><strong>What happens next:</strong></p>
<ol>
  <li>Pickup confirmation 24–48 hours before your scheduled date</li>
  <li>Driver contact on pickup day with their ETA</li>
  <li>Delivery notification when your vehicle arrives</li>
</ol>
<p>Questions? Reply to this email or call our dispatch team anytime.</p>
<p>Thank you for your trust!</p>`,
  },
  deliveryConfirm: {
    label: "Delivery Confirmation",
    subject: "Your Vehicle Has Been Delivered",
    body: `<p>Hello,</p>
<p>Great news — your vehicle has been successfully delivered!</p>
<p><strong>Delivery Summary:</strong></p>
<ul>
  <li>Vehicle: <em>[Year Make Model]</em></li>
  <li>Delivered to: <em>[Delivery Address]</em></li>
  <li>Delivered on: <em>[Date]</em></li>
</ul>
<p>We hope you're satisfied with our service. A review or referral would mean the world to us!</p>
<p>Thank you for trusting us with your vehicle.</p>`,
  },
  invoice: {
    label: "Invoice",
    subject: "Invoice for Auto Transport Services",
    body: `<p>Hello,</p>
<p>Please find your invoice for auto transport services rendered.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr style="background:#f1f5f9;">
    <th style="padding:10px;text-align:left;border:1px solid #e2e8f0;">Description</th>
    <th style="padding:10px;text-align:right;border:1px solid #e2e8f0;">Amount</th>
  </tr>
  <tr>
    <td style="padding:10px;border:1px solid #e2e8f0;">Auto Transport Service — [Route]</td>
    <td style="padding:10px;text-align:right;border:1px solid #e2e8f0;">$[Amount]</td>
  </tr>
  <tr style="font-weight:700;background:#f8fafc;">
    <td style="padding:10px;border:1px solid #e2e8f0;">Total Due</td>
    <td style="padding:10px;text-align:right;border:1px solid #e2e8f0;">$[Amount]</td>
  </tr>
</table>
<p>Payment is due within 30 days. Please reply with any questions.</p>
<p>Thank you for your business!</p>`,
  },
  custom: {
    label: "Custom",
    subject: "Your Subject Here",
    body: "<p>Type your message here...</p>",
  },
};

// ── Branding footer ───────────────────────────────────────────────────────────

function buildBrandingFooter(b: any): string {
  if (!b) return "";
  const lines = [
    b.agentName      ? `<strong style="color:#1e293b;font-size:14px;">${b.agentName}</strong>` : null,
    b.companyName    ? `<span>${b.companyName}</span>` : null,
    b.companyTagline ? `<span style="color:#94a3b8;font-style:italic;">${b.companyTagline}</span>` : null,
    b.companyPhone   ? `<span>📞 ${b.companyPhone}</span>` : null,
    b.companyWebsite ? `<a href="${b.companyWebsite}" style="color:#3b82f6;">${b.companyWebsite}</a>` : null,
    (b.usdot || b.mcNumber) ? `<span style="font-size:11px;color:#94a3b8;">${[b.usdot ? `USDOT: ${b.usdot}` : null, b.mcNumber ? `MC#: ${b.mcNumber}` : null].filter(Boolean).join(" | ")}</span>` : null,
  ].filter(Boolean);
  if (!lines.length) return "";
  return `<div style="margin-top:32px;padding-top:16px;border-top:2px solid #e2e8f0;font-family:sans-serif;font-size:13px;color:#64748b;line-height:1.8;">${lines.join("<br/>")}</div>`;
}

// ── Color palette ─────────────────────────────────────────────────────────────

const COLORS = [
  { hex: "#000000", label: "Black"      },
  { hex: "#374151", label: "Dark Gray"  },
  { hex: "#6b7280", label: "Gray"       },
  { hex: "#d1d5db", label: "Light Gray" },
  { hex: "#dc2626", label: "Red"        },
  { hex: "#ea580c", label: "Orange"     },
  { hex: "#ca8a04", label: "Yellow"     },
  { hex: "#16a34a", label: "Green"      },
  { hex: "#2563eb", label: "Blue"       },
  { hex: "#7c3aed", label: "Purple"     },
  { hex: "#db2777", label: "Pink"       },
  { hex: "#ffffff", label: "White"      },
];

const FONT_SIZES = [
  { label: "Small",   value: "2" },
  { label: "Normal",  value: "3" },
  { label: "Large",   value: "4" },
  { label: "X-Large", value: "5" },
  { label: "Huge",    value: "6" },
];

// ── Toolbar button ────────────────────────────────────────────────────────────

function TBtn({
  onClick, title, active, children, className,
}: {
  onClick: () => void; title: string; active?: boolean;
  children: React.ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={cn(
        "h-7 min-w-7 px-1.5 rounded flex items-center justify-center text-xs font-medium transition-colors",
        "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600",
        active && "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SingleEmailComposer() {
  const { toast } = useToast();

  // Mailboxes
  const [mailboxes, setMailboxes]     = useState<any[]>([]);
  const [gmailConnected, setGmail]    = useState(false);
  const [userEmail, setUserEmail]     = useState("");
  const [mailboxId, setMailboxId]     = useState<string>(""); // "gmail" | numeric string
  const [mailboxType, setMailboxType] = useState<"smtp" | "gmail">("smtp");

  // Email fields
  const [to,      setTo]      = useState("");
  const [cc,      setCc]      = useState("");
  const [bcc,     setBcc]     = useState("");
  const [subject, setSubject] = useState("");
  const [showCc,  setShowCc]  = useState(false);
  const [showBcc, setShowBcc] = useState(false);

  // Editor
  const editorRef                     = useRef<HTMLDivElement>(null);
  const [htmlSourceMode, setHtmlMode] = useState(false);
  const [htmlSource, setHtmlSource]   = useState("");

  // Options
  const [includeBranding, setIncludeBranding] = useState(true);
  const [trackOpen,       setTrackOpen]       = useState(true);
  const [trackClick,      setTrackClick]      = useState(true);
  const [branding, setBranding]               = useState<any>(null);

  // Attachments
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  // Drafts
  const [drafts,          setDrafts]   = useState<any[]>([]);
  const [draftId,         setDraftId]  = useState<number | null>(null);
  const [showDrafts,      setShowDrafts] = useState(false);

  // Preview
  const [showPreview,  setShowPreview]  = useState(false);
  const [previewMode,  setPreviewMode]  = useState<"desktop" | "mobile" | "html">("desktop");
  const [previewHtml,  setPreviewHtml]  = useState("");

  // Toolbar popovers
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontSize,    setShowFontSize]    = useState(false);
  const [showTemplates,   setShowTemplates]   = useState(false);

  // Loading
  const [loading,      setLoading]      = useState(true);
  const [sending,      setSending]      = useState(false);
  const [sendingTest,  setSendingTest]  = useState(false);
  const [savingDraft,  setSavingDraft]  = useState(false);

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([loadMailboxes(), loadDrafts(), loadBranding()]).finally(() => setLoading(false));
  }, []);

  const loadMailboxes = async () => {
    try {
      const r = await apiFetch("composer/mailboxes");
      if (!r.ok) return;
      const d = await r.json();
      setMailboxes(d.mailboxes ?? []);
      setGmail(d.gmailConnected ?? false);
      setUserEmail(d.userEmail ?? "");
      if (d.mailboxes?.length > 0) {
        setMailboxId(String(d.mailboxes[0].id));
        setMailboxType("smtp");
      } else if (d.gmailConnected) {
        setMailboxId("gmail");
        setMailboxType("gmail");
      }
    } catch {}
  };

  const loadDrafts = async () => {
    try {
      const r = await apiFetch("composer/drafts");
      if (r.ok) setDrafts(await r.json());
    } catch {}
  };

  const loadBranding = async () => {
    try {
      const r = await apiFetch("users/branding");
      if (r.ok) setBranding(await r.json());
    } catch {}
  };

  // ── Editor helpers ──────────────────────────────────────────────────────────

  const exec = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value ?? "");
    editorRef.current?.focus();
  };

  const getHtml = () => htmlSourceMode ? htmlSource : (editorRef.current?.innerHTML ?? "");

  const setHtml = (html: string) => {
    if (editorRef.current) editorRef.current.innerHTML = html;
    if (htmlSourceMode) setHtmlSource(html);
  };

  const toggleHtmlMode = () => {
    if (!htmlSourceMode) {
      setHtmlSource(editorRef.current?.innerHTML ?? "");
      setHtmlMode(true);
    } else {
      if (editorRef.current) editorRef.current.innerHTML = htmlSource;
      setHtmlMode(false);
      setTimeout(() => editorRef.current?.focus(), 50);
    }
  };

  const insertLink = () => {
    const url = window.prompt("Enter URL:", "https://");
    if (url) exec("createLink", url);
  };

  const insertImage = () => {
    const url = window.prompt("Enter image URL:", "https://");
    if (url) exec("insertImage", url);
  };

  const insertButton = () => {
    const text = window.prompt("Button label:", "Learn More");
    if (!text) return;
    const url = window.prompt("Button URL:", "https://");
    if (!url) return;
    exec("insertHTML", `<a href="${url}" style="display:inline-block;padding:10px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-family:sans-serif;font-size:14px;">${text}</a>&nbsp;`);
  };

  // ── Template ────────────────────────────────────────────────────────────────

  const applyTemplate = (key: string) => {
    const t = TEMPLATES[key];
    if (!t) return;
    setSubject(t.subject);
    setHtml(t.body);
    setShowTemplates(false);
  };

  // ── Draft CRUD ──────────────────────────────────────────────────────────────

  const doSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const payload = {
        mailboxId: mailboxType === "gmail" ? null : mailboxId,
        mailboxType,
        toEmail: to, ccEmail: cc, bccEmail: bcc,
        subject, body: getHtml(),
        trackOpen, trackClick, includeBranding,
      };
      const r = draftId
        ? await apiPut(`composer/drafts/${draftId}`, payload)
        : await apiPost("composer/drafts", payload);
      if (!r.ok) throw new Error((await r.json()).error || "Failed to save");
      const saved = await r.json();
      setDraftId(saved.id);
      await loadDrafts();
      toast({ title: "Draft saved" });
    } catch (e: any) {
      toast({ title: "Error saving draft", description: e.message, variant: "destructive" });
    } finally {
      setSavingDraft(false);
    }
  };

  const doLoadDraft = (d: any) => {
    setDraftId(d.id);
    if (d.mailboxType === "gmail") {
      setMailboxId("gmail"); setMailboxType("gmail");
    } else {
      setMailboxId(String(d.mailboxId ?? "")); setMailboxType("smtp");
    }
    setTo(d.toEmail ?? ""); setCc(d.ccEmail ?? ""); setBcc(d.bccEmail ?? "");
    if (d.ccEmail)  setShowCc(true);
    if (d.bccEmail) setShowBcc(true);
    setSubject(d.subject ?? "");
    setHtml(d.body ?? "");
    setTrackOpen(d.trackOpen ?? true);
    setTrackClick(d.trackClick ?? true);
    setIncludeBranding(d.includeBranding ?? true);
    setShowDrafts(false);
    toast({ title: "Draft loaded" });
  };

  const doDeleteDraft = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiDel(`composer/drafts/${id}`);
      if (draftId === id) setDraftId(null);
      await loadDrafts();
    } catch {}
  };

  // ── Preview ─────────────────────────────────────────────────────────────────

  const openPreview = () => {
    let html = getHtml();
    if (includeBranding) html += buildBrandingFooter(branding);
    setPreviewHtml(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b;line-height:1.6;}
      img{max-width:100%;}a{color:#2563eb;}
      ul,ol{padding-left:20px;}table{border-collapse:collapse;}
    </style></head><body>${html}</body></html>`);
    setShowPreview(true);
  };

  // ── Send ────────────────────────────────────────────────────────────────────

  const buildFormData = (isTest = false, testRecipient?: string) => {
    const fd = new FormData();
    fd.append("mailboxId",   mailboxType === "gmail" ? "" : mailboxId);
    fd.append("mailboxType", mailboxType);
    fd.append("to",          isTest ? (testRecipient ?? userEmail) : to);
    fd.append("cc",          cc);
    fd.append("bcc",         bcc);
    fd.append("subject",     subject);
    let body = getHtml();
    if (includeBranding) body += buildBrandingFooter(branding);
    fd.append("bodyHtml",    body);
    fd.append("trackOpen",   String(trackOpen));
    fd.append("trackClick",  String(trackClick));
    if (isTest) fd.append("testRecipient", testRecipient ?? userEmail);
    for (const f of attachments) fd.append("attachments", f);
    return fd;
  };

  const doSendTest = async () => {
    const recipient = userEmail || to;
    if (!recipient) {
      toast({ title: "No recipient", description: "Add a To address first.", variant: "destructive" });
      return;
    }
    if (!mailboxId) {
      toast({ title: "No mailbox", description: "Select a sending mailbox.", variant: "destructive" });
      return;
    }
    setSendingTest(true);
    try {
      const r = await fetch(apiUrl("composer/test"), {
        method: "POST", credentials: "include", body: buildFormData(true),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast({ title: "Test email sent!", description: `Sent to ${recipient}` });
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally {
      setSendingTest(false);
    }
  };

  const doSend = async () => {
    if (!to.trim())      { toast({ title: "No recipient",    description: "Enter a To address.",      variant: "destructive" }); return; }
    if (!subject.trim()) { toast({ title: "No subject",      description: "Enter a subject line.",    variant: "destructive" }); return; }
    if (!mailboxId)      { toast({ title: "No mailbox",      description: "Select a sending mailbox.",variant: "destructive" }); return; }
    setSending(true);
    try {
      const r = await fetch(apiUrl("composer/send"), {
        method: "POST", credentials: "include", body: buildFormData(),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to send");
      toast({ title: "Email sent!", description: `Delivered to ${to}` });
      // Clean up draft if this was a saved draft
      if (draftId) { await apiDel(`composer/drafts/${draftId}`); setDraftId(null); await loadDrafts(); }
      // Clear form
      setTo(""); setCc(""); setBcc(""); setSubject(""); setHtml("<p></p>");
      setAttachments([]); setShowCc(false); setShowBcc(false);
    } catch (e: any) {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  // ── Mailbox label ───────────────────────────────────────────────────────────

  const selectedMailboxLabel = (() => {
    if (mailboxType === "gmail") return `Gmail (${userEmail})`;
    const mb = mailboxes.find(m => String(m.id) === mailboxId);
    if (!mb) return "Select mailbox…";
    return mb.fromName ? `${mb.fromName} <${mb.smtpUser}>` : mb.smtpUser;
  })();

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading composer…
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PenLine className="h-5 w-5 text-blue-500" />
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Compose Email</h1>
          {draftId && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-400 dark:border-amber-600">
              Unsaved draft
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Template picker */}
          <div className="relative">
            <button
              onClick={() => { setShowTemplates(!showTemplates); setShowDrafts(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-400 transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              Templates
              <ChevronDown className="h-3 w-3" />
            </button>
            {showTemplates && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                {Object.entries(TEMPLATES).map(([key, t]) => (
                  <button
                    key={key}
                    onClick={() => applyTemplate(key)}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Drafts panel toggle */}
          <button
            onClick={() => { setShowDrafts(!showDrafts); setShowTemplates(false); }}
            className="relative flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-400 transition-colors"
          >
            <Clock className="h-3.5 w-3.5" />
            Drafts
            {drafts.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-blue-500 text-white text-xs rounded-full w-4.5 h-4.5 flex items-center justify-center font-bold" style={{ width: 18, height: 18, fontSize: 10 }}>
                {drafts.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Drafts dropdown panel ── */}
      {showDrafts && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Saved Drafts</span>
            <button onClick={() => setShowDrafts(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>
          {drafts.length === 0 ? (
            <p className="text-sm text-slate-400 px-4 py-6 text-center">No saved drafts</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
              {drafts.map(d => (
                <div
                  key={d.id}
                  onClick={() => doLoadDraft(d)}
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                      {d.subject || "(No subject)"}
                    </p>
                    <p className="text-xs text-slate-400 truncate">To: {d.toEmail || "—"}</p>
                  </div>
                  <button
                    onClick={(e) => doDeleteDraft(d.id, e)}
                    className="ml-3 p-1 text-slate-400 hover:text-red-500 rounded transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Compose card ── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">

        {/* From row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/80">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-14 shrink-0">From</span>
          <div className="relative flex-1">
            <select
              value={mailboxId}
              onChange={e => {
                const v = e.target.value;
                setMailboxId(v);
                setMailboxType(v === "gmail" ? "gmail" : "smtp");
              }}
              className="w-full text-sm bg-transparent text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer pr-6 appearance-none"
            >
              {mailboxes.map(mb => (
                <option key={mb.id} value={String(mb.id)}>
                  {mb.fromName ? `${mb.fromName} <${mb.smtpUser}>` : mb.smtpUser}
                </option>
              ))}
              {gmailConnected && (
                <option value="gmail">Gmail — {userEmail}</option>
              )}
              {mailboxes.length === 0 && !gmailConnected && (
                <option value="">No mailboxes configured</option>
              )}
            </select>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* To row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-14 shrink-0">To</span>
          <input
            type="email"
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="flex-1 text-sm bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none"
          />
          <div className="flex gap-1">
            {!showCc && (
              <button onClick={() => setShowCc(true)} className="text-xs text-blue-500 hover:text-blue-700 px-1 font-medium">Cc</button>
            )}
            {!showBcc && (
              <button onClick={() => setShowBcc(true)} className="text-xs text-blue-500 hover:text-blue-700 px-1 font-medium">Bcc</button>
            )}
          </div>
        </div>

        {/* Cc row */}
        {showCc && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-14 shrink-0">Cc</span>
            <input
              type="text"
              value={cc}
              onChange={e => setCc(e.target.value)}
              placeholder="cc@example.com"
              className="flex-1 text-sm bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none"
            />
            <button onClick={() => { setShowCc(false); setCc(""); }} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Bcc row */}
        {showBcc && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-14 shrink-0">Bcc</span>
            <input
              type="text"
              value={bcc}
              onChange={e => setBcc(e.target.value)}
              placeholder="bcc@example.com"
              className="flex-1 text-sm bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none"
            />
            <button onClick={() => { setShowBcc(false); setBcc(""); }} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Subject row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-14 shrink-0">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Email subject"
            className="flex-1 text-sm font-medium bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none"
          />
        </div>

        {/* ── RTE Toolbar ── */}
        <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
          {/* Text style */}
          <TBtn onClick={() => exec("bold")}          title="Bold"          ><Bold          className="h-3.5 w-3.5" /></TBtn>
          <TBtn onClick={() => exec("italic")}        title="Italic"        ><Italic        className="h-3.5 w-3.5" /></TBtn>
          <TBtn onClick={() => exec("underline")}     title="Underline"     ><Underline     className="h-3.5 w-3.5" /></TBtn>
          <TBtn onClick={() => exec("strikeThrough")} title="Strikethrough" ><Strikethrough className="h-3.5 w-3.5" /></TBtn>

          <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />

          {/* Font size */}
          <div className="relative">
            <TBtn onClick={() => { setShowFontSize(!showFontSize); setShowColorPicker(false); }} title="Font size">
              <Type className="h-3.5 w-3.5" />
              <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
            </TBtn>
            {showFontSize && (
              <div className="absolute left-0 top-full mt-1 w-28 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1 overflow-hidden">
                {FONT_SIZES.map(f => (
                  <button
                    key={f.value}
                    onMouseDown={(e) => { e.preventDefault(); exec("fontSize", f.value); setShowFontSize(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Text color */}
          <div className="relative">
            <TBtn onClick={() => { setShowColorPicker(!showColorPicker); setShowFontSize(false); }} title="Text color">
              <Palette className="h-3.5 w-3.5" />
              <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
            </TBtn>
            {showColorPicker && (
              <div className="absolute left-0 top-full mt-1 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50">
                <div className="grid grid-cols-6 gap-1">
                  {COLORS.map(c => (
                    <button
                      key={c.hex}
                      title={c.label}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        exec("foreColor", c.hex);
                        setShowColorPicker(false);
                      }}
                      style={{ backgroundColor: c.hex }}
                      className="w-5 h-5 rounded border border-slate-200 dark:border-slate-600 hover:scale-110 transition-transform"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />

          {/* Alignment */}
          <TBtn onClick={() => exec("justifyLeft")}   title="Align left"   ><AlignLeft    className="h-3.5 w-3.5" /></TBtn>
          <TBtn onClick={() => exec("justifyCenter")} title="Align center" ><AlignCenter  className="h-3.5 w-3.5" /></TBtn>
          <TBtn onClick={() => exec("justifyRight")}  title="Align right"  ><AlignRight   className="h-3.5 w-3.5" /></TBtn>
          <TBtn onClick={() => exec("justifyFull")}   title="Justify"      ><AlignJustify className="h-3.5 w-3.5" /></TBtn>

          <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />

          {/* Lists */}
          <TBtn onClick={() => exec("insertUnorderedList")} title="Bullet list"   ><List        className="h-3.5 w-3.5" /></TBtn>
          <TBtn onClick={() => exec("insertOrderedList")}   title="Numbered list" ><ListOrdered className="h-3.5 w-3.5" /></TBtn>

          <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />

          {/* Insert */}
          <TBtn onClick={insertLink}   title="Insert link"  ><Link2      className="h-3.5 w-3.5" /></TBtn>
          <TBtn onClick={insertImage}  title="Insert image" ><ImageIcon  className="h-3.5 w-3.5" /></TBtn>
          <TBtn onClick={insertButton} title="Insert CTA button">
            <span className="text-[10px] font-bold px-0.5">BTN</span>
          </TBtn>
          <TBtn onClick={() => exec("insertHorizontalRule")} title="Divider"><Minus className="h-3.5 w-3.5" /></TBtn>

          <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />

          {/* HTML toggle */}
          <TBtn
            onClick={toggleHtmlMode}
            title={htmlSourceMode ? "Switch to visual editor" : "Edit HTML source"}
            active={htmlSourceMode}
          >
            <Code2 className="h-3.5 w-3.5" />
          </TBtn>
        </div>

        {/* ── Rich Text Editor ── */}
        {htmlSourceMode ? (
          <textarea
            value={htmlSource}
            onChange={e => setHtmlSource(e.target.value)}
            className="w-full px-4 py-4 font-mono text-xs bg-slate-950 text-green-400 focus:outline-none resize-none"
            style={{ minHeight: 340 }}
            placeholder="HTML source…"
          />
        ) : (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={() => { /* content lives in DOM */ }}
            onClick={() => { setShowColorPicker(false); setShowFontSize(false); setShowTemplates(false); }}
            className="px-5 py-4 text-slate-800 dark:text-slate-200 focus:outline-none overflow-y-auto"
            style={{ minHeight: 340 }}
            data-placeholder="Start writing your email..."
          />
        )}

        {/* ── Options row ── */}
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-sm">
          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeBranding}
              onChange={e => setIncludeBranding(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Branding footer</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={trackOpen}
              onChange={e => setTrackOpen(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Track opens</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={trackClick}
              onChange={e => setTrackClick(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Track clicks</span>
          </label>
        </div>

        {/* ── Attachments ── */}
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
            >
              <Paperclip className="h-3.5 w-3.5" />
              Add attachment
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
              className="hidden"
              onChange={e => {
                if (e.target.files) {
                  setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
                  e.target.value = "";
                }
              }}
            />
            {attachments.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-xs text-slate-600 dark:text-slate-300">
                <Paperclip className="h-3 w-3 text-slate-400" />
                <span className="max-w-32 truncate">{f.name}</span>
                <span className="text-slate-400">({(f.size / 1024).toFixed(0)}KB)</span>
                <button
                  onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                  className="text-slate-400 hover:text-red-500 ml-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Action bar ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={doSaveDraft}
              disabled={savingDraft}
              className="h-8 text-xs"
            >
              {savingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save Draft
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={doSendTest}
              disabled={sendingTest}
              className="h-8 text-xs"
            >
              {sendingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Mail className="h-3.5 w-3.5 mr-1" />}
              Send Test
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={openPreview}
              className="h-8 text-xs"
            >
              <Eye className="h-3.5 w-3.5 mr-1" />
              Preview
            </Button>
          </div>
          <Button
            size="sm"
            onClick={doSend}
            disabled={sending}
            className="h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs px-5"
          >
            {sending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              : <Send className="h-3.5 w-3.5 mr-1" />}
            Send Now
          </Button>
        </div>
      </div>

      {/* ── Preview panel ── */}
      {showPreview && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-1">
              {(["desktop", "mobile", "html"] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setPreviewMode(mode)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium transition-colors",
                    previewMode === mode
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  )}
                >
                  {mode === "desktop" && <Monitor className="h-3.5 w-3.5" />}
                  {mode === "mobile"  && <Smartphone className="h-3.5 w-3.5" />}
                  {mode === "html"    && <FileCode className="h-3.5 w-3.5" />}
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openPreview}
                className="text-xs text-blue-500 hover:text-blue-700"
              >
                Refresh
              </button>
              <button onClick={() => setShowPreview(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className={cn("p-4 bg-slate-100 dark:bg-slate-900", previewMode === "mobile" && "flex justify-center")}>
            {previewMode === "html" ? (
              <pre className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 p-4 rounded-lg overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                {previewHtml}
              </pre>
            ) : (
              <iframe
                srcDoc={previewHtml}
                sandbox="allow-same-origin"
                title="Email preview"
                style={{
                  width:       previewMode === "mobile" ? 375 : "100%",
                  minHeight:   480,
                  border:      "none",
                  borderRadius: 8,
                  background:  "white",
                  display:     "block",
                  boxShadow:   "0 2px 12px rgba(0,0,0,0.08)",
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
