import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Link2, Image as ImageIcon,
  Code2, Save, Send, Trash2,
  Paperclip, X, ChevronDown, Monitor, Smartphone,
  FileCode, Type, Mail, Loader2, Clock,
  FileText, PenLine, CheckCircle2,
  Layout, BookMarked, ChevronRight, Eye,
  FileImage, FilePlus, Minus, Building2, Globe, Phone, User,
  ChevronLeft, Palette,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── API helpers ────────────────────────────────────────────────────────────────

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
const apiUrl = (p: string) => `${BASE}/api/${p}`;
const apiFetch = (p: string, init?: RequestInit) =>
  fetch(apiUrl(p), { credentials: "include", ...init });
const apiPost = (p: string, body: unknown) =>
  apiFetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const apiPut = (p: string, body: unknown) =>
  apiFetch(p, { method: "POST", headers: { "Content-Type": "application/json", "X-HTTP-Method-Override": "PUT" }, body: JSON.stringify(body) });
const apiDel = (p: string) =>
  apiFetch(p, { method: "POST", headers: { "X-HTTP-Method-Override": "DELETE" } });

// ── Content templates ──────────────────────────────────────────────────────────

const CONTENT_TEMPLATES: Record<string, { label: string; icon: any; subject: string; body: string }> = {
  vehicleQuote: {
    label: "Quote Email", icon: FileText,
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
    label: "Follow Up", icon: ChevronRight,
    subject: "Following Up on Your Auto Transport Quote",
    body: `<p>Hello,</p>
<p>I wanted to follow up on the auto transport quote we sent recently. We understand this is an important decision and we're happy to answer any questions.</p>
<p>We're still offering the same competitive rate and would love to earn your business.</p>
<p>Feel free to reply or call us anytime.</p>
<p>Best regards,</p>`,
  },
  thankYou: {
    label: "Thank You", icon: CheckCircle2,
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
  newsletter: {
    label: "Newsletter", icon: BookMarked,
    subject: "Auto Transport News & Updates",
    body: `<p>Hello,</p>
<p>Welcome to our monthly newsletter! Here's what's new:</p>
<p><strong>📦 Industry Update</strong></p>
<p>[Brief industry news or company update here]</p>
<p><strong>🚗 Tips for Vehicle Shipping</strong></p>
<ul>
  <li>[Tip 1]</li>
  <li>[Tip 2]</li>
  <li>[Tip 3]</li>
</ul>
<p><strong>🔥 Special Offer</strong></p>
<p>[Describe your current promotion or special pricing]</p>
<p>Thank you for being a valued customer!</p>`,
  },
};

// ── Built-in design templates ──────────────────────────────────────────────────

type BuiltInTemplate = {
  id: string; name: string; accentColor: string; category: string;
};

const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  { id: "professional", name: "Professional",  accentColor: "#2563eb", category: "Quote"      },
  { id: "modern-blue",  name: "Modern Blue",   accentColor: "#4f46e5", category: "Featured"   },
  { id: "corporate",    name: "Corporate",     accentColor: "#1e3a5f", category: "Enterprise" },
  { id: "minimal",      name: "Minimal",       accentColor: "#0f172a", category: "Clean"      },
  { id: "newsletter",   name: "Newsletter",    accentColor: "#7c3aed", category: "Newsletter" },
  { id: "custom",       name: "Plain Text",    accentColor: "#6b7280", category: "Plain"      },
];

function buildTemplateHtml(templateId: string, content: string, branding: any, brandingEnabled: boolean): string {
  const accentColor = (branding?.accentColor && branding.accentColor !== "#000000")
    ? branding.accentColor
    : (BUILT_IN_TEMPLATES.find(t => t.id === templateId)?.accentColor ?? "#2563eb");
  const logoHtml = branding?.logoUrl
    ? `<img src="${branding.logoUrl}" style="max-height:48px;max-width:180px;object-fit:contain;display:block;" alt="${branding.companyName || ""}" />`
    : "";
  const company = branding?.companyName || "";
  const agent   = branding?.agentName   || "";
  const phone   = branding?.companyPhone   || "";
  const website = branding?.companyWebsite || "";
  const tagline = branding?.companyTagline || "";

  const year = new Date().getFullYear();

  // Signature block — only when brandingEnabled AND branding data exists
  const hasSignatureData = brandingEnabled && branding && (agent || company || phone || website);
  const signatureBlock = hasSignatureData ? `
    <table cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#64748b;line-height:1.8;width:100%;">
      <tr><td>
        ${logoHtml ? `<div style="margin-bottom:10px;">${logoHtml}</div>` : ""}
        ${agent   ? `<div style="font-weight:700;font-size:14px;color:#1e293b;">${agent}</div>` : ""}
        ${company ? `<div style="color:#475569;">${company}</div>` : ""}
        ${tagline ? `<div style="color:#94a3b8;font-style:italic;font-size:12px;">${tagline}</div>` : ""}
        ${phone   ? `<div style="margin-top:4px;">📞 <a href="tel:${phone}" style="color:#64748b;text-decoration:none;">${phone}</a></div>` : ""}
        ${website ? `<div><a href="${website}" style="color:${accentColor};text-decoration:none;">${website}</a></div>` : ""}
      </td></tr>
    </table>` : "";

  const base = `
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;}
      a{color:${accentColor};}
      p{margin:0 0 14px;}
      ul,ol{padding-left:22px;margin:0 0 14px;}
      img{max-width:100%;height:auto;}
      @media only screen and (max-width:600px){
        .wrap{width:100%!important;padding:12px 0!important;}
        .body{padding:24px 20px!important;}
        .header{padding:20px!important;}
      }
    </style>`;

  // ── Plain Text / Custom ─────────────────────────────────────────────────────
  if (templateId === "custom") {
    return `<!DOCTYPE html><html><head>${base}</head><body style="background:#fff;">
      <div style="max-width:600px;margin:0 auto;padding:32px 24px;color:#1e293b;line-height:1.75;font-size:15px;">
        ${content}
        ${signatureBlock}
      </div>
    </body></html>`;
  }

  // ── Minimal ─────────────────────────────────────────────────────────────────
  if (templateId === "minimal") {
    return `<!DOCTYPE html><html><head>${base}
      <style>
        .wrap{max-width:600px;margin:0 auto;padding:20px 0;}
        .card{background:#fff;border-radius:6px;overflow:hidden;border-top:3px solid ${accentColor};}
        .logo-row{padding:24px 32px 0;}
        .body{padding:32px;color:#1e293b;line-height:1.75;font-size:15px;}
        .foot{padding:16px 32px;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;}
      </style>
    </head><body><div class="wrap"><div class="card">
      ${logoHtml || company ? `<div class="logo-row">${logoHtml || `<span style="font-weight:700;color:${accentColor};font-size:15px;">${company}</span>`}</div>` : ""}
      <div class="body">${content}${signatureBlock}</div>
      ${company ? `<div class="foot">© ${year} ${company}</div>` : ""}
    </div></div></body></html>`;
  }

  // ── Corporate ───────────────────────────────────────────────────────────────
  if (templateId === "corporate") {
    return `<!DOCTYPE html><html><head>${base}
      <style>
        .wrap{max-width:600px;margin:0 auto;padding:20px 0;}
        .header{background:#1c2d4a;padding:0;}
        .header-inner{padding:22px 32px;display:table;width:100%;box-sizing:border-box;}
        .header-logo{display:table-cell;vertical-align:middle;}
        .header-name{display:table-cell;vertical-align:middle;padding-left:16px;color:rgba(255,255,255,0.9);font-size:13px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;white-space:nowrap;}
        .accent-bar{height:3px;background:${accentColor};}
        .body{background:#fff;padding:36px 32px;color:#1e293b;line-height:1.75;font-size:15px;}
        .foot{background:#fff;padding:16px 32px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;}
      </style>
    </head><body><div class="wrap">
      <div class="header">
        <div class="header-inner">
          <div class="header-logo">${logoHtml}</div>
          ${company ? `<div class="header-name">${company}</div>` : ""}
        </div>
        <div class="accent-bar"></div>
      </div>
      <div class="body">${content}${signatureBlock}</div>
      ${company ? `<div class="foot">© ${year} ${company} · All rights reserved</div>` : ""}
    </div></body></html>`;
  }

  // ── Modern Blue ─────────────────────────────────────────────────────────────
  if (templateId === "modern-blue") {
    return `<!DOCTYPE html><html><head>${base}
      <style>
        .wrap{max-width:600px;margin:0 auto;padding:20px 0;}
        .header{background:linear-gradient(135deg,${accentColor} 0%,#7c3aed 100%);padding:36px 32px;text-align:center;border-radius:8px 8px 0 0;}
        .header-logo{margin-bottom:14px;}
        .header-title{color:#fff;font-size:24px;font-weight:700;margin:0 0 6px;letter-spacing:-0.5px;}
        .header-tagline{color:rgba(255,255,255,0.8);font-size:13px;margin:0;}
        .body{background:#fff;padding:36px 32px;color:#1e293b;line-height:1.75;font-size:15px;border-radius:0 0 8px 8px;box-shadow:0 4px 16px rgba(0,0,0,0.06);}
      </style>
    </head><body><div class="wrap">
      <div class="header">
        ${logoHtml ? `<div class="header-logo">${logoHtml.replace('style="', 'style="margin:0 auto;')}</div>` : ""}
        ${company ? `<h1 class="header-title">${company}</h1>` : ""}
        ${tagline ? `<p class="header-tagline">${tagline}</p>` : ""}
      </div>
      <div class="body">${content}${signatureBlock}</div>
    </div></body></html>`;
  }

  // ── Newsletter ──────────────────────────────────────────────────────────────
  if (templateId === "newsletter") {
    return `<!DOCTYPE html><html><head>${base}
      <style>
        .wrap{max-width:600px;margin:0 auto;padding:20px 0;background:#f8f9fc;}
        .header{background:${accentColor};padding:22px 32px;}
        .header-inner{display:table;width:100%;}
        .header-logo-cell{display:table-cell;vertical-align:middle;}
        .header-text-cell{display:table-cell;vertical-align:middle;padding-left:14px;}
        .header-company{color:#fff;font-size:17px;font-weight:700;display:block;}
        .header-label{color:rgba(255,255,255,0.7);font-size:11px;text-transform:uppercase;letter-spacing:1px;display:block;margin-top:2px;}
        .body{background:#fff;padding:32px;color:#1e293b;line-height:1.75;font-size:15px;}
        .divider{height:1px;background:#e2e8f0;margin:24px 0;}
        .foot{padding:20px 32px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;background:#fff;}
      </style>
    </head><body><div class="wrap">
      <div class="header">
        <div class="header-inner">
          ${logoHtml ? `<div class="header-logo-cell">${logoHtml}</div>` : ""}
          <div class="header-text-cell">
            ${company ? `<span class="header-company">${company}</span>` : ""}
            <span class="header-label">Newsletter</span>
          </div>
        </div>
      </div>
      <div class="body">${content}${signatureBlock}</div>
      ${company ? `<div class="foot">© ${year} ${company} · You received this as a valued contact.</div>` : ""}
    </div></body></html>`;
  }

  // ── Professional (default) ──────────────────────────────────────────────────
  return `<!DOCTYPE html><html><head>${base}
    <style>
      .wrap{max-width:600px;margin:0 auto;padding:20px 0;}
      .card{background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07);}
      .header{background:${accentColor};padding:24px 32px;}
      .header-inner{display:table;width:100%;}
      .header-logo-cell{display:table-cell;vertical-align:middle;}
      .header-name-cell{display:table-cell;vertical-align:middle;padding-left:14px;color:rgba(255,255,255,0.95);font-size:15px;font-weight:600;white-space:nowrap;}
      .body{padding:36px 32px;color:#1e293b;line-height:1.75;font-size:15px;}
      .foot{padding:16px 32px;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;}
    </style>
  </head><body><div class="wrap"><div class="card">
    <div class="header">
      <div class="header-inner">
        ${logoHtml ? `<div class="header-logo-cell">${logoHtml}</div>` : ""}
        ${company ? `<div class="header-name-cell">${company}</div>` : ""}
      </div>
    </div>
    <div class="body">${content}${signatureBlock}</div>
    ${company ? `<div class="foot">© ${year} ${company}</div>` : ""}
  </div></div></body></html>`;
}

// ── Sidebar template mini-thumbnail ───────────────────────────────────────────

function TemplateThumbnail({ template, selected, onClick }: { template: BuiltInTemplate; selected: boolean; onClick: () => void }) {
  const { accentColor, id } = template;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all group",
        selected
          ? "bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-200 dark:ring-blue-700"
          : "hover:bg-slate-50 dark:hover:bg-slate-700/50"
      )}
    >
      {/* Mini thumbnail */}
      <div className="w-9 h-7 rounded overflow-hidden shrink-0 border border-slate-200 dark:border-slate-600">
        {id === "custom" && (
          <div className="w-full h-full bg-slate-50 dark:bg-slate-700 flex flex-col justify-center gap-0.5 px-1">
            <div className="h-0.5 rounded-full bg-slate-300" style={{ width: "80%" }} />
            <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
            <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "50%" }} />
          </div>
        )}
        {id === "minimal" && (
          <div className="w-full h-full bg-slate-50 flex flex-col">
            <div style={{ height: 3, background: accentColor }} />
            <div className="flex-1 flex flex-col justify-center gap-0.5 px-1">
              <div className="h-0.5 rounded-full bg-slate-300" style={{ width: "80%" }} />
              <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
            </div>
          </div>
        )}
        {id === "modern-blue" && (
          <div className="w-full h-full flex flex-col">
            <div style={{ height: 10, background: `linear-gradient(135deg,${accentColor},#7c3aed)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ height: 2, width: 18, background: "rgba(255,255,255,0.6)", borderRadius: 1 }} />
            </div>
            <div className="flex-1 bg-white flex flex-col justify-center gap-0.5 px-1">
              <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
              <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
            </div>
          </div>
        )}
        {id === "corporate" && (
          <div className="w-full h-full flex flex-col">
            <div style={{ height: 8, background: "#1e3a5f" }} />
            <div style={{ height: 2, background: accentColor }} />
            <div className="flex-1 bg-white flex flex-col justify-center gap-0.5 px-1">
              <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
              <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
            </div>
          </div>
        )}
        {id === "newsletter" && (
          <div className="w-full h-full flex flex-col">
            <div style={{ height: 9, background: accentColor }} />
            <div className="flex-1 bg-white flex flex-col justify-center gap-0.5 px-1">
              <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
              <div style={{ height: 0.5, background: "#e2e8f0", margin: "1px 0" }} />
              <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "65%" }} />
            </div>
          </div>
        )}
        {id === "professional" && (
          <div className="w-full h-full flex flex-col">
            <div style={{ height: 9, background: accentColor, display: "flex", alignItems: "center", padding: "0 3px", gap: 2 }}>
              <div style={{ width: 4, height: 4, borderRadius: 1, background: "rgba(255,255,255,0.4)" }} />
              <div style={{ height: 1.5, width: 12, background: "rgba(255,255,255,0.5)", borderRadius: 1 }} />
            </div>
            <div className="flex-1 bg-white flex flex-col justify-center gap-0.5 px-1">
              <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
              <div className="h-0.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
            </div>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-medium truncate", selected ? "text-blue-700 dark:text-blue-400" : "text-slate-700 dark:text-slate-300")}>
          {template.name}
        </p>
        <p className="text-[10px] text-slate-400 truncate">{template.category}</p>
      </div>
      {selected && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
    </button>
  );
}

// ── Toolbar button ─────────────────────────────────────────────────────────────

function TBtn({ onClick, title, active, children }: {
  onClick: () => void; title: string; active?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button" title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={cn(
        "h-7 min-w-7 px-1.5 rounded flex items-center justify-center transition-colors",
        "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-600",
        active && "bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100",
      )}
    >
      {children}
    </button>
  );
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return <FileImage className="h-3.5 w-3.5 text-blue-400" />;
  if (["pdf"].includes(ext)) return <FileText className="h-3.5 w-3.5 text-red-400" />;
  return <FilePlus className="h-3.5 w-3.5 text-slate-400" />;
}
function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SingleEmailComposer() {
  const { toast } = useToast();

  const [mailboxes, setMailboxes]     = useState<any[]>([]);
  const [gmailConnected, setGmail]    = useState(false);
  const [userEmail, setUserEmail]     = useState("");
  const [mailboxId, setMailboxId]     = useState<string>("");
  const [mailboxType, setMailboxType] = useState<"smtp" | "gmail">("smtp");

  const [to,      setTo]      = useState("");
  const [cc,      setCc]      = useState("");
  const [bcc,     setBcc]     = useState("");
  const [subject, setSubject] = useState("");
  const [showCc,  setShowCc]  = useState(false);
  const [showBcc, setShowBcc] = useState(false);

  const editorRef                     = useRef<HTMLDivElement>(null);
  const editorContentRef              = useRef<string>("");   // persists across tab switches
  const [htmlSourceMode, setHtmlMode] = useState(false);
  const [htmlSource, setHtmlSource]   = useState("");

  const [includeBranding, setIncludeBranding] = useState(true);
  const [trackOpen,       setTrackOpen]       = useState(true);
  const [trackClick,      setTrackClick]      = useState(true);
  const [branding, setBranding]               = useState<any>(null);

  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  const [drafts,     setDrafts]     = useState<any[]>([]);
  const [draftId,    setDraftId]    = useState<number | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

  const [activeTab,   setActiveTab]   = useState<"editor" | "desktop" | "mobile">("editor");
  const [previewHtml, setPreviewHtml] = useState("");

  const [selectedDesign,      setSelectedDesign]      = useState("professional");
  const [userDesignTemplates, setUserDesignTemplates] = useState<any[]>([]);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontSize,    setShowFontSize]    = useState(false);

  const [loading,     setLoading]     = useState(true);
  const [sending,     setSending]     = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const COLORS = [
    "#000000","#374151","#6b7280","#dc2626","#ea580c",
    "#ca8a04","#16a34a","#2563eb","#7c3aed","#db2777","#ffffff",
  ];
  const FONT_SIZES = [
    { label: "Small",   value: "2" },
    { label: "Normal",  value: "3" },
    { label: "Large",   value: "4" },
    { label: "X-Large", value: "5" },
  ];

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([loadMailboxes(), loadDrafts(), loadBranding(), loadUserDesignTemplates()])
      .finally(() => setLoading(false));
  }, []);

  // Always rebuild preview (live), triggered by subject/template/branding changes
  // rebuildPreview reads editorContentRef (a ref) so omitting it from deps is intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { rebuildPreview(); }, [subject, selectedDesign, branding, includeBranding]);

  const loadMailboxes = async () => {
    try {
      const r = await apiFetch("composer/mailboxes");
      if (!r.ok) return;
      const d = await r.json();
      setMailboxes(d.mailboxes ?? []);
      setGmail(d.gmailConnected ?? false);
      setUserEmail(d.userEmail ?? "");
      if (d.mailboxes?.length > 0)  { setMailboxId(String(d.mailboxes[0].id)); setMailboxType("smtp"); }
      else if (d.gmailConnected)    { setMailboxId("gmail"); setMailboxType("gmail"); }
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

  const loadUserDesignTemplates = async () => {
    try {
      const r = await apiFetch("composer/design-templates");
      if (r.ok) setUserDesignTemplates(await r.json());
    } catch {}
  };

  // ── Editor helpers ─────────────────────────────────────────────────────────

  const exec = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value ?? "");
    editorRef.current?.focus();
  };

  // Always read from the cache ref so preview works even when editor tab is unmounted
  const getHtml = () => htmlSourceMode ? htmlSource : editorContentRef.current;

  const setHtml = (html: string) => {
    editorContentRef.current = html;
    if (editorRef.current) editorRef.current.innerHTML = html;
    if (htmlSourceMode) setHtmlSource(html);
  };

  const toggleHtmlMode = () => {
    if (!htmlSourceMode) {
      const cur = editorRef.current?.innerHTML ?? editorContentRef.current;
      setHtmlSource(cur);
      editorContentRef.current = cur;
      setHtmlMode(true);
    } else {
      editorContentRef.current = htmlSource;
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
    const text = window.prompt("Button label:", "Book Now");
    if (!text) return;
    const url = window.prompt("Button URL:", "https://");
    if (!url) return;
    const accent = branding?.accentColor || "#2563eb";
    exec("insertHTML", `<a href="${url}" style="display:inline-block;padding:10px 24px;background:${accent};color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-family:sans-serif;font-size:14px;">${text}</a>&nbsp;`);
  };

  // ── Live preview builder ───────────────────────────────────────────────────

  const rebuildPreview = useCallback(() => {
    // Use cached ref so preview is accurate even when editor tab is unmounted
    const content = htmlSourceMode ? htmlSource : editorContentRef.current;
    const userTpl = selectedDesign.startsWith("user:")
      ? userDesignTemplates.find(t => `user:${t.id}` === selectedDesign)
      : null;
    let html: string;
    if (userTpl) {
      const accentColor = branding?.accentColor || "#2563eb";
      const brandingBlock = includeBranding && branding ? `
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:sans-serif;font-size:13px;color:#64748b;line-height:1.9;">
          ${branding.agentName   ? `<strong style="color:#1e293b;font-size:14px;display:block;">${branding.agentName}</strong>` : ""}
          ${branding.companyName ? `<span style="display:block;">${branding.companyName}</span>` : ""}
          ${branding.companyPhone ? `<span style="display:block;">📞 ${branding.companyPhone}</span>` : ""}
          ${branding.companyWebsite ? `<a href="${branding.companyWebsite}" style="color:${accentColor};display:block;">${branding.companyWebsite}</a>` : ""}
        </div>` : "";
      html = userTpl.htmlLayout
        .replace("{{content}}", content + brandingBlock)
        .replace("{{branding_footer}}", brandingBlock)
        .replace("{{company_name}}", branding?.companyName || "");
    } else {
      html = buildTemplateHtml(selectedDesign, content, branding, includeBranding);
    }
    setPreviewHtml(html);
  }, [selectedDesign, branding, includeBranding, htmlSourceMode, htmlSource, userDesignTemplates]);

  // Called on every editor keystroke — update cache then rebuild
  const onEditorInput = useCallback(() => {
    editorContentRef.current = editorRef.current?.innerHTML ?? "";
    rebuildPreview();
  }, [rebuildPreview]);

  // ── Apply content template ─────────────────────────────────────────────────

  const applyContentTemplate = (key: string) => {
    const t = CONTENT_TEMPLATES[key];
    if (!t) return;
    if (!subject || subject === t.subject) setSubject(t.subject);
    setHtml(t.body);
    setShowDrafts(false);
    setTimeout(() => rebuildPreview(), 0);
  };

  // ── Apply design template ──────────────────────────────────────────────────

  const applyDesignTemplate = (id: string) => {
    setSelectedDesign(id);
    // preview rebuilds via useEffect watching selectedDesign
  };

  // ── Draft CRUD ─────────────────────────────────────────────────────────────

  const doSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const payload = {
        mailboxId: mailboxType === "gmail" ? null : mailboxId,
        mailboxType, toEmail: to, ccEmail: cc, bccEmail: bcc,
        subject, body: getHtml(), trackOpen, trackClick, includeBranding,
      };
      const r = draftId
        ? await apiPut(`composer/drafts/${draftId}`, payload)
        : await apiPost("composer/drafts", payload);
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      const saved = await r.json();
      setDraftId(saved.id);
      await loadDrafts();
      toast({ title: "Draft saved" });
    } catch (e: any) {
      toast({ title: "Error saving draft", description: e.message, variant: "destructive" });
    } finally { setSavingDraft(false); }
  };

  const doLoadDraft = (d: any) => {
    setDraftId(d.id);
    if (d.mailboxType === "gmail") { setMailboxId("gmail"); setMailboxType("gmail"); }
    else { setMailboxId(String(d.mailboxId ?? "")); setMailboxType("smtp"); }
    setTo(d.toEmail ?? ""); setCc(d.ccEmail ?? ""); setBcc(d.bccEmail ?? "");
    if (d.ccEmail) setShowCc(true);
    if (d.bccEmail) setShowBcc(true);
    setSubject(d.subject ?? "");
    setHtml(d.body ?? "");
    setTrackOpen(d.trackOpen ?? true);
    setTrackClick(d.trackClick ?? true);
    setIncludeBranding(d.includeBranding ?? true);
    setShowDrafts(false);
    setActiveTab("editor");
    setTimeout(() => rebuildPreview(), 0);
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

  // ── Send ───────────────────────────────────────────────────────────────────

  const buildFormData = (isTest = false) => {
    const fd = new FormData();
    fd.append("mailboxId",   mailboxType === "gmail" ? "" : mailboxId);
    fd.append("mailboxType", mailboxType);
    fd.append("to",          isTest ? (userEmail || to) : to);
    fd.append("cc",          cc);
    fd.append("bcc",         bcc);
    fd.append("subject",     subject);
    const content = getHtml();
    const userTpl = selectedDesign.startsWith("user:")
      ? userDesignTemplates.find(t => `user:${t.id}` === selectedDesign)
      : null;
    let bodyHtml: string;
    if (userTpl) {
      const accentColor = branding?.accentColor || "#2563eb";
      const brandingBlock = includeBranding && branding ? `
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:sans-serif;font-size:13px;color:#64748b;line-height:1.9;">
          ${branding.agentName   ? `<strong style="color:#1e293b;font-size:14px;display:block;">${branding.agentName}</strong>` : ""}
          ${branding.companyName ? `<span style="display:block;">${branding.companyName}</span>` : ""}
          ${branding.companyPhone ? `<span style="display:block;">📞 ${branding.companyPhone}</span>` : ""}
          ${branding.companyWebsite ? `<a href="${branding.companyWebsite}" style="color:${accentColor};display:block;">${branding.companyWebsite}</a>` : ""}
        </div>` : "";
      bodyHtml = userTpl.htmlLayout
        .replace("{{content}}", content + brandingBlock)
        .replace("{{branding_footer}}", brandingBlock)
        .replace("{{company_name}}", branding?.companyName || "");
    } else {
      bodyHtml = buildTemplateHtml(selectedDesign, content, branding, includeBranding);
    }
    fd.append("bodyHtml",   bodyHtml);
    fd.append("trackOpen",  String(trackOpen));
    fd.append("trackClick", String(trackClick));
    for (const f of attachments) fd.append("attachments", f);
    return fd;
  };

  const doSendTest = async () => {
    if (!mailboxId) { toast({ title: "No mailbox", description: "Select a sending mailbox.", variant: "destructive" }); return; }
    setSendingTest(true);
    try {
      const r = await fetch(apiUrl("composer/test"), { method: "POST", credentials: "include", body: buildFormData(true) });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast({ title: "Test email sent!", description: `Sent to ${userEmail || to}` });
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally { setSendingTest(false); }
  };

  const doSend = async () => {
    if (!to.trim())      { toast({ title: "No recipient",  description: "Enter a To address.",       variant: "destructive" }); return; }
    if (!subject.trim()) { toast({ title: "No subject",    description: "Enter a subject line.",     variant: "destructive" }); return; }
    if (!mailboxId)      { toast({ title: "No mailbox",    description: "Select a sending mailbox.", variant: "destructive" }); return; }
    setSending(true);
    try {
      const r = await fetch(apiUrl("composer/send"), { method: "POST", credentials: "include", body: buildFormData() });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to send");
      toast({ title: "Email sent!", description: `Delivered to ${to}` });
      if (draftId) { await apiDel(`composer/drafts/${draftId}`); setDraftId(null); await loadDrafts(); }
      setTo(""); setCc(""); setBcc(""); setSubject(""); setHtml("<p></p>");
      setAttachments([]); setShowCc(false); setShowBcc(false);
      setActiveTab("editor");
      rebuildPreview();
    } catch (e: any) {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    } finally { setSending(false); }
  };

  const selectedDesignLabel = (() => {
    if (selectedDesign.startsWith("user:")) {
      const t = userDesignTemplates.find(t => `user:${t.id}` === selectedDesign);
      return t?.name ?? "Custom";
    }
    return BUILT_IN_TEMPLATES.find(t => t.id === selectedDesign)?.name ?? "Professional";
  })();

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0" style={{ height: "calc(100vh - 64px)" }}>

      {/* ══════════════ LEFT SIDEBAR ══════════════ */}
      <aside
        className={cn(
          "flex flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 transition-all duration-200 shrink-0 overflow-y-auto",
          sidebarCollapsed ? "w-0 overflow-hidden" : "w-56"
        )}
      >
        <div className="p-3 space-y-1">

          {/* ── DESIGNS ─────────────────────────── */}
          <div className="pt-2">
            <div className="flex items-center gap-1.5 px-2 mb-1.5">
              <Palette className="h-3 w-3 text-slate-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Designs</p>
            </div>
            <div className="space-y-0.5">
              {BUILT_IN_TEMPLATES.map(t => (
                <TemplateThumbnail
                  key={t.id}
                  template={t}
                  selected={selectedDesign === t.id}
                  onClick={() => applyDesignTemplate(t.id)}
                />
              ))}
              {userDesignTemplates.map(t => (
                <TemplateThumbnail
                  key={`user:${t.id}`}
                  template={{ id: `user:${t.id}`, name: t.name, accentColor: "#6b7280", category: "Custom" }}
                  selected={selectedDesign === `user:${t.id}`}
                  onClick={() => applyDesignTemplate(`user:${t.id}`)}
                />
              ))}
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1" />

          {/* ── CONTENT BLOCKS ──────────────────── */}
          <div>
            <div className="flex items-center gap-1.5 px-2 mb-1.5">
              <FileText className="h-3 w-3 text-slate-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Content Blocks</p>
            </div>
            <div className="space-y-0.5">
              {Object.entries(CONTENT_TEMPLATES).map(([key, t]) => (
                <button
                  key={key}
                  onClick={() => applyContentTemplate(key)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                >
                  <t.icon className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 shrink-0 transition-colors" />
                  <span className="text-xs text-slate-600 dark:text-slate-300 truncate group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{t.label}</span>
                </button>
              ))}
              <button
                onClick={() => { setHtml("<p></p>"); setTimeout(() => rebuildPreview(), 0); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
              >
                <FileCode className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 shrink-0 transition-colors" />
                <span className="text-xs text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Blank</span>
              </button>
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1" />

          {/* ── DRAFTS ──────────────────────────── */}
          <div>
            <button
              onClick={() => setShowDrafts(!showDrafts)}
              className="w-full flex items-center justify-between px-2 py-1 mb-0.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
            >
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-slate-400" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Drafts{drafts.length > 0 && ` (${drafts.length})`}
                </p>
              </div>
              <ChevronDown className={cn("h-3 w-3 text-slate-400 transition-transform", showDrafts && "rotate-180")} />
            </button>
            {showDrafts && (
              <div className="space-y-0.5 mt-0.5">
                {drafts.length === 0 ? (
                  <p className="text-xs text-slate-400 px-3 py-2">No saved drafts</p>
                ) : (
                  drafts.map(d => (
                    <div
                      key={d.id}
                      onClick={() => doLoadDraft(d)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer group transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50",
                        draftId === d.id && "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                      )}
                    >
                      <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-700 dark:text-slate-300 truncate font-medium">{d.subject || "(No subject)"}</p>
                        <p className="text-[10px] text-slate-400 truncate">{d.toEmail || "No recipient"}</p>
                      </div>
                      <button
                        onClick={e => doDeleteDraft(d.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500 transition-all"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1" />

          {/* ── LIBRARY ─────────────────────────── */}
          <div>
            <div className="flex items-center gap-1.5 px-2 mb-1.5">
              <Layout className="h-3 w-3 text-slate-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Library</p>
            </div>
            <div className="space-y-0.5">
              <Link href="/design-templates">
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group">
                  <Palette className="h-3.5 w-3.5 text-slate-400 group-hover:text-violet-500 shrink-0 transition-colors" />
                  <span className="text-xs text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Saved Designs</span>
                </button>
              </Link>
              <Link href="/admin?tab=branding">
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group">
                  <Building2 className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-500 shrink-0 transition-colors" />
                  <span className="text-xs text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Branding</span>
                </button>
              </Link>
              <Link href="/admin?tab=mailbox">
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group">
                  <Mail className="h-3.5 w-3.5 text-slate-400 group-hover:text-emerald-500 shrink-0 transition-colors" />
                  <span className="text-xs text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Mailboxes</span>
                </button>
              </Link>
            </div>
          </div>

        </div>
      </aside>

      {/* ══════════════ MAIN COMPOSE AREA ══════════════ */}
      <div className="flex-1 min-w-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            >
              <ChevronLeft className={cn("h-4 w-4 transition-transform", sidebarCollapsed && "rotate-180")} />
            </button>
            <div className="flex items-center gap-2">
              <div className="p-1 bg-gradient-to-br from-blue-500 to-violet-500 rounded-md">
                <PenLine className="h-3.5 w-3.5 text-white" />
              </div>
              <h1 className="text-sm font-semibold text-slate-800 dark:text-white">Compose Email</h1>
            </div>
            {draftId && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium border border-amber-200 dark:border-amber-700">
                Saved draft
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Preview tabs */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5">
              {(["editor", "desktop", "mobile"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); if (tab !== "editor") rebuildPreview(); }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                    activeTab === tab
                      ? "bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  )}
                >
                  {tab === "editor"  && <><FileCode className="h-3 w-3" />Edit</>}
                  {tab === "desktop" && <><Monitor className="h-3 w-3" />Desktop</>}
                  {tab === "mobile"  && <><Smartphone className="h-3 w-3" />Mobile</>}
                </button>
              ))}
            </div>

            {/* Send test */}
            <button
              onClick={doSendTest}
              disabled={sendingTest}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500 transition-colors disabled:opacity-50"
            >
              {sendingTest ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
              Test
            </button>

            {/* Save draft */}
            <button
              onClick={doSaveDraft}
              disabled={savingDraft}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500 transition-colors disabled:opacity-50"
            >
              {savingDraft ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>

            {/* Send */}
            <button
              onClick={doSend}
              disabled={sending}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 shadow-sm"
            >
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 min-h-0 overflow-auto p-4">

          {activeTab === "editor" ? (

            /* ── Editor view ── */
            <div className="max-w-2xl mx-auto">
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">

                {/* From row */}
                <div className="border-b border-slate-100 dark:border-slate-700">
                  <div className="flex items-center">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest w-16 pl-4 shrink-0">From</span>
                    <div className="relative flex-1 pr-4">
                      <select
                        value={mailboxId}
                        onChange={e => { const v = e.target.value; setMailboxId(v); setMailboxType(v === "gmail" ? "gmail" : "smtp"); }}
                        className="w-full py-3 text-sm bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 cursor-pointer appearance-none pr-6"
                      >
                        {mailboxes.map(mb => (
                          <option key={mb.id} value={String(mb.id)}>
                            {mb.fromName ? `${mb.fromName} <${mb.smtpUser}>` : mb.smtpUser}
                          </option>
                        ))}
                        {gmailConnected && <option value="gmail">Gmail — {userEmail}</option>}
                        {mailboxes.length === 0 && !gmailConnected && <option value="">No mailboxes configured</option>}
                      </select>
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                  {/* Connection status badges */}
                  {mailboxes.length === 0 && !gmailConnected ? (
                    <div className="px-4 pb-2 pl-20">
                      <Link href="/admin?tab=mailbox" className="text-[11px] text-blue-500 hover:text-blue-700 transition-colors">
                        + Configure a mailbox in Settings →
                      </Link>
                    </div>
                  ) : mailboxType === "smtp" && mailboxes.find(m => String(m.id) === mailboxId) ? (() => {
                    const mb = mailboxes.find(m => String(m.id) === mailboxId)!;
                    return (
                      <div className="flex items-center gap-2 px-4 pb-2 pl-20">
                        <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                          SMTP Connected
                        </span>
                        {mb.imapHost && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                            IMAP Connected
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 ml-1">{mb.smtpHost}</span>
                      </div>
                    );
                  })() : mailboxType === "gmail" ? (
                    <div className="flex items-center gap-2 px-4 pb-2 pl-20">
                      <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                        Gmail Connected
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* To row */}
                <div className="flex items-center border-b border-slate-100 dark:border-slate-700">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest w-16 pl-4 shrink-0">To</span>
                  <input
                    type="email" value={to} onChange={e => setTo(e.target.value)}
                    placeholder="recipient@example.com"
                    className="flex-1 py-3 text-sm bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <div className="flex gap-1 pr-3">
                    {!showCc  && <button onClick={() => setShowCc(true)}  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 font-medium transition-colors">Cc</button>}
                    {!showBcc && <button onClick={() => setShowBcc(true)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 font-medium transition-colors">Bcc</button>}
                  </div>
                </div>

                {showCc && (
                  <div className="flex items-center border-b border-slate-100 dark:border-slate-700">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest w-16 pl-4 shrink-0">Cc</span>
                    <input
                      type="text" value={cc} onChange={e => setCc(e.target.value)}
                      placeholder="cc@example.com"
                      className="flex-1 py-3 text-sm bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                    <button onClick={() => { setShowCc(false); setCc(""); }} className="pr-3 text-slate-300 hover:text-slate-500 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {showBcc && (
                  <div className="flex items-center border-b border-slate-100 dark:border-slate-700">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest w-16 pl-4 shrink-0">Bcc</span>
                    <input
                      type="text" value={bcc} onChange={e => setBcc(e.target.value)}
                      placeholder="bcc@example.com"
                      className="flex-1 py-3 text-sm bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                    <button onClick={() => { setShowBcc(false); setBcc(""); }} className="pr-3 text-slate-300 hover:text-slate-500 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Subject row */}
                <div className="flex items-center border-b border-slate-100 dark:border-slate-700">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest w-16 pl-4 shrink-0">Subject</span>
                  <input
                    type="text" value={subject} onChange={e => setSubject(e.target.value)}
                    placeholder="Write a compelling subject line…"
                    className="flex-1 py-3 pr-4 text-sm font-semibold bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>

                {/* Formatting toolbar */}
                <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80">
                  {/* Font size */}
                  <div className="relative">
                    <TBtn onClick={() => { setShowFontSize(!showFontSize); setShowColorPicker(false); }} title="Font size">
                      <Type className="h-3.5 w-3.5" />
                    </TBtn>
                    {showFontSize && (
                      <div className="absolute top-full left-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg z-30 py-1 w-28 overflow-hidden">
                        {FONT_SIZES.map(s => (
                          <button key={s.value} onMouseDown={e => { e.preventDefault(); exec("fontSize", s.value); setShowFontSize(false); }}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >{s.label}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-0.5" />

                  <TBtn onClick={() => exec("bold")}          title="Bold"><Bold className="h-3.5 w-3.5" /></TBtn>
                  <TBtn onClick={() => exec("italic")}        title="Italic"><Italic className="h-3.5 w-3.5" /></TBtn>
                  <TBtn onClick={() => exec("underline")}     title="Underline"><Underline className="h-3.5 w-3.5" /></TBtn>
                  <TBtn onClick={() => exec("strikeThrough")} title="Strike"><Strikethrough className="h-3.5 w-3.5" /></TBtn>

                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-0.5" />

                  <TBtn onClick={() => exec("justifyLeft")}   title="Left"><AlignLeft className="h-3.5 w-3.5" /></TBtn>
                  <TBtn onClick={() => exec("justifyCenter")} title="Center"><AlignCenter className="h-3.5 w-3.5" /></TBtn>
                  <TBtn onClick={() => exec("justifyRight")}  title="Right"><AlignRight className="h-3.5 w-3.5" /></TBtn>

                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-0.5" />

                  <TBtn onClick={() => exec("insertUnorderedList")} title="Bullet list"><List className="h-3.5 w-3.5" /></TBtn>
                  <TBtn onClick={() => exec("insertOrderedList")}   title="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></TBtn>

                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-0.5" />

                  <TBtn onClick={insertLink}   title="Insert link"><Link2 className="h-3.5 w-3.5" /></TBtn>
                  <TBtn onClick={insertImage}  title="Insert image"><ImageIcon className="h-3.5 w-3.5" /></TBtn>
                  <TBtn onClick={insertButton} title="Insert button"><Mail className="h-3.5 w-3.5" /></TBtn>

                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-0.5" />

                  {/* Text color */}
                  <div className="relative">
                    <TBtn onClick={() => { setShowColorPicker(!showColorPicker); setShowFontSize(false); }} title="Text color">
                      <span className="text-xs font-bold" style={{ fontFamily: "serif" }}>A</span>
                    </TBtn>
                    {showColorPicker && (
                      <div className="absolute top-full left-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg z-30 p-2">
                        <div className="grid grid-cols-6 gap-1">
                          {COLORS.map(c => (
                            <button key={c} onMouseDown={e => { e.preventDefault(); exec("foreColor", c); setShowColorPicker(false); }}
                              className="w-5 h-5 rounded border border-slate-300 dark:border-slate-600 hover:scale-110 transition-transform"
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <TBtn onClick={() => exec("removeFormat")}         title="Clear formatting"><Minus className="h-3.5 w-3.5" /></TBtn>
                  <TBtn onClick={() => exec("insertHorizontalRule")} title="Divider line"><Minus className="h-3.5 w-3.5 opacity-60" /></TBtn>

                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-0.5" />

                  <TBtn onClick={toggleHtmlMode} active={htmlSourceMode} title="HTML source">
                    <Code2 className="h-3.5 w-3.5" />
                  </TBtn>
                </div>

                {/* Editor body */}
                <div className="relative">
                  {htmlSourceMode ? (
                    <textarea
                      value={htmlSource}
                      onChange={e => { setHtmlSource(e.target.value); setTimeout(() => rebuildPreview(), 0); }}
                      className="w-full px-5 py-4 min-h-64 font-mono text-xs bg-slate-900 text-green-400 focus:outline-none resize-none"
                      placeholder="<p>Your HTML here...</p>"
                    />
                  ) : (
                    <div
                      ref={editorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={onEditorInput}
                      className="w-full px-5 py-4 min-h-64 text-sm text-slate-800 dark:text-slate-200 focus:outline-none leading-relaxed"
                      style={{ lineHeight: "1.75" }}
                    />
                  )}
                </div>

                {/* Attachments list */}
                {attachments.length > 0 && (
                  <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                        {attachments.length} attachment{attachments.length !== 1 ? "s" : ""} · {fmtSize(attachments.reduce((s, f) => s + f.size, 0))} total
                      </p>
                    </div>
                    {attachments.map((f, i) => (
                      <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600">
                        <div className="p-1.5 rounded-md bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shrink-0">
                          {fileIcon(f.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{f.name}</p>
                          <p className="text-[10px] text-slate-400">{fmtSize(f.size)}</p>
                        </div>
                        <button
                          onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                          className="p-1.5 text-slate-400 hover:text-red-500 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                          title="Remove"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Bottom action row */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80">
                  <div className="flex items-center gap-2">
                    {/* Attach */}
                    <input
                      type="file" multiple ref={fileInputRef} className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp,.zip"
                      onChange={e => { if (e.target.files) setAttachments(a => [...a, ...Array.from(e.target.files!)]); e.target.value = ""; }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-transparent hover:border-blue-200 dark:hover:border-blue-700 transition-all font-medium"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      Attach files
                    </button>

                    {/* Template badge */}
                    <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                      <Palette className="h-3 w-3" />
                      {selectedDesignLabel}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Toggles */}
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                      <input type="checkbox" checked={includeBranding} onChange={e => setIncludeBranding(e.target.checked)} className="w-3 h-3 rounded accent-blue-600" />
                      Branding
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                      <input type="checkbox" checked={trackOpen} onChange={e => setTrackOpen(e.target.checked)} className="w-3 h-3 rounded accent-blue-600" />
                      Track opens
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                      <input type="checkbox" checked={trackClick} onChange={e => setTrackClick(e.target.checked)} className="w-3 h-3 rounded accent-blue-600" />
                      Track clicks
                    </label>
                  </div>
                </div>

              </div>
            </div>

          ) : activeTab === "desktop" ? (

            /* ── Desktop Preview ── */
            <div className="flex flex-col items-center gap-3">
              {/* Browser chrome */}
              <div className="w-full max-w-2xl bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-md overflow-hidden">
                {/* Chrome bar */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700/80">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-400" />
                    <div className="w-3 h-3 rounded-full bg-amber-400" />
                    <div className="w-3 h-3 rounded-full bg-emerald-400" />
                  </div>
                  <div className="flex-1 mx-3 bg-white dark:bg-slate-600 rounded-md px-3 py-1 text-[11px] text-slate-400 border border-slate-200 dark:border-slate-500 truncate">
                    {subject || "Email Preview"}
                  </div>
                </div>
                {/* Preview email metadata bar */}
                <div className="border-b border-slate-100 dark:border-slate-700 px-5 py-3 bg-white dark:bg-slate-800">
                  <h2 className="text-base font-semibold text-slate-800 dark:text-white truncate">{subject || "(No subject)"}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {mailboxType === "gmail" ? `Gmail — ${userEmail}` : mailboxes.find(m => String(m.id) === mailboxId)?.smtpUser || "—"}
                    {" → "}
                    {to || "recipient@example.com"}
                  </p>
                </div>
                {/* Email iframe */}
                <div className="bg-slate-100 dark:bg-slate-700 p-4">
                  <iframe
                    key={`desktop-${previewHtml.length}`}
                    srcDoc={previewHtml || "<body style='font-family:sans-serif;color:#94a3b8;padding:40px;text-align:center;'>Start typing to see your preview…</body>"}
                    sandbox="allow-same-origin"
                    className="w-full bg-white rounded-lg border border-slate-200 dark:border-slate-600"
                    style={{ height: 480, display: "block" }}
                    title="Desktop preview"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400">Desktop preview at 600px — actual rendering may vary by email client</p>
            </div>

          ) : (

            /* ── Mobile Preview ── */
            <div className="flex flex-col items-center gap-3">
              <div
                className="relative"
                style={{ width: 320 }}
              >
                {/* Phone shell */}
                <div className="absolute inset-0 rounded-[36px] bg-slate-800 dark:bg-slate-900 border-4 border-slate-700 dark:border-slate-600 shadow-2xl pointer-events-none" style={{ zIndex: 1 }} />
                {/* Screen */}
                <div className="relative overflow-hidden rounded-[30px] mx-2 my-2" style={{ zIndex: 2 }}>
                  {/* Status bar */}
                  <div className="flex items-center justify-between px-5 pt-3 pb-1.5 bg-white dark:bg-slate-800 text-[9px] text-slate-500 dark:text-slate-400">
                    <span>9:41</span>
                    <div className="flex items-center gap-1">
                      <div className="flex gap-0.5 items-end h-2.5">
                        {[1,2,3,4].map(i => <div key={i} className="w-0.5 bg-current rounded-sm" style={{ height: `${i * 25}%` }} />)}
                      </div>
                      <span>WiFi</span>
                      <span>100%</span>
                    </div>
                  </div>
                  {/* Email header in phone */}
                  <div className="px-3 py-2 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                    <p className="text-[11px] font-semibold text-slate-800 dark:text-white truncate">{subject || "(No subject)"}</p>
                    <p className="text-[9px] text-slate-400 truncate">To: {to || "recipient@example.com"}</p>
                  </div>
                  {/* Email iframe */}
                  <iframe
                    key={`mobile-${previewHtml.length}`}
                    srcDoc={previewHtml || "<body style='font-family:sans-serif;color:#94a3b8;padding:24px;text-align:center;font-size:13px;'>Start typing to see your preview…</body>"}
                    sandbox="allow-same-origin"
                    className="w-full bg-white"
                    style={{ height: 480, display: "block" }}
                    title="Mobile preview"
                  />
                  {/* Home indicator */}
                  <div className="flex items-center justify-center py-2 bg-white dark:bg-slate-800">
                    <div className="w-20 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-400">Mobile preview — 375px viewport</p>
            </div>

          )}
        </div>

        {/* ── Branding info bar (at bottom) ── */}
        {branding && (
          <div className="shrink-0 flex items-center gap-4 px-4 py-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-x-auto">
            {branding.logoUrl && (
              <img src={branding.logoUrl} alt="logo" className="h-5 object-contain shrink-0" />
            )}
            {branding.companyName && (
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                <Building2 className="h-3 w-3" />{branding.companyName}
              </span>
            )}
            {branding.agentName && (
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                <User className="h-3 w-3" />{branding.agentName}
              </span>
            )}
            {branding.companyPhone && (
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                <Phone className="h-3 w-3" />{branding.companyPhone}
              </span>
            )}
            {branding.companyWebsite && (
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                <Globe className="h-3 w-3" />{branding.companyWebsite}
              </span>
            )}
            {branding.accentColor && (
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                <div className="w-3 h-3 rounded-full border border-slate-300" style={{ background: branding.accentColor }} />
                {branding.accentColor}
              </span>
            )}
            <Link href="/admin?tab=branding" className="ml-auto text-[11px] text-blue-500 hover:text-blue-700 shrink-0 transition-colors">Edit branding →</Link>
          </div>
        )}

      </div>
    </div>
  );
}

