import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Link2, Image as ImageIcon,
  Code2, Save, Send, Trash2,
  Paperclip, X, ChevronDown, Monitor, Smartphone,
  FileCode, Palette, Type, Mail, Minus,
  Loader2, Clock, FileText, PenLine, CheckCircle2,
  Sparkles, Layout, BookMarked, Building2, Phone,
  Globe, User, Copy, ChevronRight, Wand2, Eye,
  FileImage, FilePlus,
} from "lucide-react";
import { Link } from "wouter";
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
  apiFetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const apiPut = (p: string, body: unknown) =>
  apiFetch(p, { method: "POST", headers: { "Content-Type": "application/json", "X-HTTP-Method-Override": "PUT" }, body: JSON.stringify(body) });
const apiDel = (p: string) =>
  apiFetch(p, { method: "POST", headers: { "X-HTTP-Method-Override": "DELETE" } });

// ── Content templates (quick-start fills for the editor body) ─────────────────

const CONTENT_TEMPLATES: Record<string, { label: string; icon: any; subject: string; body: string; color: string }> = {
  vehicleQuote: {
    label: "Quote Email", icon: FileText, color: "text-blue-500 bg-blue-50 dark:bg-blue-900/20",
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
    label: "Follow Up", icon: ChevronRight, color: "text-amber-500 bg-amber-50 dark:bg-amber-900/20",
    subject: "Following Up on Your Auto Transport Quote",
    body: `<p>Hello,</p>
<p>I wanted to follow up on the auto transport quote we sent recently. We understand this is an important decision and we're happy to answer any questions.</p>
<p>We're still offering the same competitive rate and would love to earn your business.</p>
<p>Feel free to reply or call us anytime.</p>
<p>Best regards,</p>`,
  },
  thankYou: {
    label: "Thank You", icon: CheckCircle2, color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20",
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
    label: "Newsletter", icon: BookMarked, color: "text-violet-500 bg-violet-50 dark:bg-violet-900/20",
    subject: "Auto Transport News & Updates",
    body: `<p>Hello,</p>
<p>Welcome to our monthly newsletter! Here's what's new at [Company Name]:</p>
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

// ── Built-in design templates ─────────────────────────────────────────────────

type BuiltInTemplate = {
  id: string; name: string; desc: string; accentColor: string; category: string;
};

const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  { id: "professional",  name: "Professional Quote", desc: "Clean header with brand colors — ideal for quotes",            accentColor: "#2563eb", category: "Quote"       },
  { id: "modern-blue",   name: "Modern Blue",         desc: "Indigo gradient header with structured layout",                accentColor: "#4f46e5", category: "Featured"    },
  { id: "corporate",     name: "Corporate",           desc: "Navy with formal table-style structure",                       accentColor: "#1e3a5f", category: "Enterprise"  },
  { id: "minimal",       name: "Minimal",             desc: "White card, thin accent line — high deliverability",           accentColor: "#0f172a", category: "Clean"       },
  { id: "newsletter",    name: "Newsletter",          desc: "Multi-section layout for updates and news",                    accentColor: "#7c3aed", category: "Newsletter"  },
  { id: "custom",        name: "Custom (No Wrapper)", desc: "Your content sent as-is with no outer HTML wrapper",          accentColor: "#6b7280", category: "Plain"       },
];

function buildTemplateHtml(templateId: string, content: string, branding: any, brandingEnabled: boolean): string {
  const accentColor = branding?.accentColor || (BUILT_IN_TEMPLATES.find(t => t.id === templateId)?.accentColor ?? "#2563eb");
  const logoHtml    = branding?.logoUrl
    ? `<img src="${branding.logoUrl}" style="max-height:44px;max-width:160px;object-fit:contain;" alt="logo" />`
    : "";
  const company = branding?.companyName || "";

  const brandingBlock = brandingEnabled && branding ? `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:sans-serif;font-size:13px;color:#64748b;line-height:1.9;">
      ${branding.agentName      ? `<strong style="color:#1e293b;font-size:14px;display:block;">${branding.agentName}</strong>` : ""}
      ${branding.companyName    ? `<span style="display:block;">${branding.companyName}</span>` : ""}
      ${branding.companyTagline ? `<span style="color:#94a3b8;font-style:italic;display:block;">${branding.companyTagline}</span>` : ""}
      ${branding.companyPhone   ? `<span style="display:block;">📞 ${branding.companyPhone}</span>` : ""}
      ${branding.companyWebsite ? `<a href="${branding.companyWebsite}" style="color:${accentColor};display:block;">${branding.companyWebsite}</a>` : ""}
    </div>` : "";

  const baseStyles = `body{margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;}a{color:${accentColor};}p{margin:0 0 14px;}ul,ol{padding-left:20px;margin:0 0 14px;}img{max-width:100%;}`;

  if (templateId === "custom") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}body{max-width:600px;margin:0 auto;padding:24px;color:#1e293b;line-height:1.7;font-size:15px;}</style></head><body>${content}${brandingBlock}</body></html>`;
  }

  if (templateId === "minimal") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      ${baseStyles}
      .wrap{max-width:600px;margin:0 auto;padding:20px 0;background:#f8fafc;}
      .card{background:#fff;border-radius:4px;overflow:hidden;border-top:4px solid ${accentColor};}
      .body{padding:32px;color:#1e293b;line-height:1.7;font-size:15px;}
      .foot{padding:16px 32px;font-size:12px;color:#94a3b8;text-align:center;border-top:1px solid #f1f5f9;}
    </style></head><body><div class="wrap"><div class="card">
      ${logoHtml || company ? `<div style="padding:20px 32px 0;">${logoHtml}${!logoHtml && company ? `<span style="font-weight:700;color:${accentColor};font-size:16px;">${company}</span>` : ""}</div>` : ""}
      <div class="body">${content}${brandingBlock}</div>
      <div class="foot">This email was sent by ${company || "BrokerMAIL"}.</div>
    </div></div></body></html>`;
  }

  if (templateId === "corporate") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      ${baseStyles}
      .wrap{max-width:600px;margin:0 auto;background:#f1f5f9;padding:20px 0;}
      .header{background:#1e3a5f;padding:0;}
      .header-top{padding:20px 32px;display:flex;align-items:center;gap:16px;}
      .header-company{color:rgba(255,255,255,0.85);font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;}
      .header-divider{height:4px;background:${accentColor};}
      .body{background:#fff;padding:32px;color:#1e293b;line-height:1.7;font-size:15px;}
      .foot{padding:16px 32px;background:#fff;border-top:2px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center;}
    </style></head><body><div class="wrap">
      <div class="header">
        <div class="header-top">${logoHtml}<span class="header-company">${company}</span></div>
        <div class="header-divider"></div>
      </div>
      <div class="body">${content}${brandingBlock}</div>
      <div class="foot">Confidential • Auto Transport Services</div>
    </div></body></html>`;
  }

  if (templateId === "modern-blue") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      ${baseStyles}
      .wrap{max-width:600px;margin:0 auto;background:#eef2ff;padding:20px 0;}
      .header{background:linear-gradient(135deg,${accentColor} 0%,#7c3aed 100%);padding:32px;text-align:center;}
      .header-logo{display:flex;justify-content:center;margin-bottom:12px;}
      .header-title{color:#fff;font-size:22px;font-weight:700;margin:0;letter-spacing:-0.3px;}
      .header-sub{color:rgba(255,255,255,0.8);font-size:13px;margin:6px 0 0;}
      .body{background:#fff;padding:32px;color:#1e293b;line-height:1.7;font-size:15px;border-radius:0 0 8px 8px;}
    </style></head><body><div class="wrap">
      <div class="header">
        ${logoHtml ? `<div class="header-logo">${logoHtml}</div>` : ""}
        ${company ? `<h1 class="header-title">${company}</h1>` : ""}
        <p class="header-sub">Professional Auto Transport Services</p>
      </div>
      <div class="body">${content}${brandingBlock}</div>
    </div></body></html>`;
  }

  if (templateId === "newsletter") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      ${baseStyles}
      .wrap{max-width:600px;margin:0 auto;background:#f8f9fc;padding:20px 0;}
      .header{background:${accentColor};padding:24px 32px;display:flex;align-items:center;gap:16px;}
      .header-company{color:#fff;font-size:18px;font-weight:700;}
      .header-tag{color:rgba(255,255,255,0.7);font-size:12px;font-weight:400;margin-top:2px;}
      .body{background:#fff;padding:32px;color:#1e293b;line-height:1.7;font-size:15px;}
      .divider{height:1px;background:#e2e8f0;margin:20px 0;}
      .foot{padding:20px 32px;font-size:12px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;}
    </style></head><body><div class="wrap">
      <div class="header">
        ${logoHtml}
        <div>
          ${company ? `<div class="header-company">${company}</div>` : ""}
          <div class="header-tag">Newsletter</div>
        </div>
      </div>
      <div class="body">${content}${brandingBlock}</div>
      <div class="foot">You received this because you're a valued customer. © ${new Date().getFullYear()} ${company || "BrokerMAIL"}.</div>
    </div></body></html>`;
  }

  // Default: professional
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${baseStyles}
    .wrap{max-width:600px;margin:0 auto;background:#f1f5f9;padding:20px 0;}
    .card{background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);}
    .header{background:${accentColor};padding:22px 32px;display:flex;align-items:center;gap:16px;}
    .header-company{color:rgba(255,255,255,0.92);font-size:16px;font-weight:600;}
    .body{padding:32px;color:#1e293b;line-height:1.7;font-size:15px;}
    .foot{padding:16px 32px;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9;text-align:center;}
  </style></head><body><div class="wrap"><div class="card">
    <div class="header">${logoHtml}<span class="header-company">${company}</span></div>
    <div class="body">${content}${brandingBlock}</div>
    <div class="foot">Sent via BrokerMAIL AI</div>
  </div></div></body></html>`;
}

// ── Design template mini-preview ──────────────────────────────────────────────

function DesignMiniPreview({ template }: { template: BuiltInTemplate }) {
  const { accentColor } = template;
  if (template.id === "custom") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 gap-1 p-3">
        <div className="h-1.5 rounded-full bg-slate-300" style={{ width: "75%" }} />
        <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
        <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "50%" }} />
        <div className="h-4 rounded mt-1 bg-slate-300" style={{ width: "40%" }} />
      </div>
    );
  }
  if (template.id === "minimal") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-50">
        <div className="w-24 bg-white shadow-sm overflow-hidden" style={{ borderTop: `3px solid ${accentColor}` }}>
          <div className="p-1.5 space-y-1">
            <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
            <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "65%" }} />
            <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "55%" }} />
          </div>
        </div>
      </div>
    );
  }
  if (template.id === "modern-blue") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-indigo-50">
        <div className="w-24 bg-white overflow-hidden shadow-sm rounded-sm">
          <div style={{ background: `linear-gradient(135deg,${accentColor},#7c3aed)`, height: 22, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="h-1 w-10 rounded-full bg-white/60" />
          </div>
          <div className="p-1.5 space-y-1">
            <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
            <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
          </div>
        </div>
      </div>
    );
  }
  if (template.id === "corporate") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100">
        <div className="w-24 bg-white overflow-hidden shadow-sm">
          <div style={{ background: "#1e3a5f", height: 18 }} />
          <div style={{ background: accentColor, height: 3 }} />
          <div className="p-1.5 space-y-1">
            <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
            <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
            <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "70%" }} />
          </div>
        </div>
      </div>
    );
  }
  if (template.id === "newsletter") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-50">
        <div className="w-24 bg-white overflow-hidden shadow-sm">
          <div style={{ background: accentColor, height: 18 }} />
          <div className="p-1.5 space-y-1">
            <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
            <div className="h-1 rounded-full bg-slate-100 my-1" style={{ width: "100%" }} />
            <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
            <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "70%" }} />
          </div>
        </div>
      </div>
    );
  }
  // professional (default)
  return (
    <div className="w-full h-full flex items-center justify-center bg-slate-50">
      <div className="w-24 bg-white overflow-hidden rounded shadow-sm">
        <div style={{ background: accentColor, height: 18, display: "flex", alignItems: "center", padding: "0 6px", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(255,255,255,0.4)" }} />
          <div className="h-1 w-8 rounded-full bg-white/50" />
        </div>
        <div className="p-1.5 space-y-1">
          <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
          <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
          <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "70%" }} />
        </div>
      </div>
    </div>
  );
}

// ── Toolbar button ────────────────────────────────────────────────────────────

function TBtn({ onClick, title, active, children, className }: {
  onClick: () => void; title: string; active?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      type="button" title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={cn(
        "h-7 min-w-7 px-1.5 rounded flex items-center justify-center text-xs font-medium transition-colors",
        "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600",
        active && "bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── File icon helper ──────────────────────────────────────────────────────────
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

// ── Main component ────────────────────────────────────────────────────────────

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
  const [htmlSourceMode, setHtmlMode] = useState(false);
  const [htmlSource, setHtmlSource]   = useState("");
  const [isEditorEmpty, setIsEditorEmpty] = useState(true);

  const [includeBranding, setIncludeBranding] = useState(true);
  const [trackOpen,       setTrackOpen]       = useState(true);
  const [trackClick,      setTrackClick]      = useState(true);
  const [branding, setBranding]               = useState<any>(null);

  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  const [drafts,     setDrafts]    = useState<any[]>([]);
  const [draftId,    setDraftId]   = useState<number | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

  // Preview tabs
  const [activeTab,   setActiveTab]   = useState<"editor" | "desktop" | "mobile">("editor");
  const [previewHtml, setPreviewHtml] = useState("");

  // Design templates
  const [selectedDesign,      setSelectedDesign]      = useState("professional");
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [userDesignTemplates, setUserDesignTemplates] = useState<any[]>([]);

  // Brand panel
  const [showBrandPanel, setShowBrandPanel] = useState(false);

  // Toolbar popovers
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontSize,    setShowFontSize]    = useState(false);

  // Content template picker
  const [showContentTemplates, setShowContentTemplates] = useState(false);

  // Save as template
  const [showSaveTemplate,  setShowSaveTemplate]  = useState(false);
  const [saveTemplateName,  setSaveTemplateName]  = useState("");
  const [savingTemplate,    setSavingTemplate]    = useState(false);

  // AI generate
  const [showAiPanel,  setShowAiPanel]  = useState(false);
  const [aiPrompt,     setAiPrompt]     = useState("");
  const [aiTone,       setAiTone]       = useState("professional");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Loading states
  const [loading,     setLoading]     = useState(true);
  const [sending,     setSending]     = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const COLORS = [
    "#000000","#374151","#6b7280","#dc2626","#ea580c",
    "#ca8a04","#16a34a","#2563eb","#7c3aed","#db2777","#ffffff",
  ];
  const FONT_SIZES = [
    { label: "Small", value: "2" }, { label: "Normal", value: "3" },
    { label: "Large", value: "4" }, { label: "X-Large", value: "5" },
  ];

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([loadMailboxes(), loadDrafts(), loadBranding(), loadUserDesignTemplates()])
      .finally(() => setLoading(false));
  }, []);

  // Live preview: rebuild when tab switches away from editor
  useEffect(() => {
    if (activeTab !== "editor") buildPreviewHtml();
  }, [activeTab, includeBranding, selectedDesign, branding]);

  const loadMailboxes = async () => {
    try {
      const r = await apiFetch("composer/mailboxes");
      if (!r.ok) return;
      const d = await r.json();
      setMailboxes(d.mailboxes ?? []);
      setGmail(d.gmailConnected ?? false);
      setUserEmail(d.userEmail ?? "");
      if (d.mailboxes?.length > 0)       { setMailboxId(String(d.mailboxes[0].id)); setMailboxType("smtp"); }
      else if (d.gmailConnected)          { setMailboxId("gmail"); setMailboxType("gmail"); }
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

  // ── Editor helpers ────────────────────────────────────────────────────────

  const exec = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value ?? "");
    editorRef.current?.focus();
  };

  const getHtml = () => htmlSourceMode ? htmlSource : (editorRef.current?.innerHTML ?? "");

  const setHtml = (html: string) => {
    if (editorRef.current) editorRef.current.innerHTML = html;
    if (htmlSourceMode) setHtmlSource(html);
    checkEditorEmpty(html);
  };

  const checkEditorEmpty = (html: string) => {
    const stripped = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
    setIsEditorEmpty(stripped === "");
  };

  const onEditorInput = () => {
    const html = editorRef.current?.innerHTML ?? "";
    checkEditorEmpty(html);
  };

  const toggleHtmlMode = () => {
    if (!htmlSourceMode) { setHtmlSource(editorRef.current?.innerHTML ?? ""); setHtmlMode(true); }
    else { if (editorRef.current) editorRef.current.innerHTML = htmlSource; setHtmlMode(false); setTimeout(() => editorRef.current?.focus(), 50); }
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

  // ── Preview builder ───────────────────────────────────────────────────────

  const buildPreviewHtml = useCallback(() => {
    const content = getHtml();
    // Check if this is a user-defined design template
    const userTpl = selectedDesign.startsWith("user:") ? userDesignTemplates.find(t => `user:${t.id}` === selectedDesign) : null;
    let html: string;
    if (userTpl) {
      const accentColor = branding?.accentColor || "#2563eb";
      const brandingBlock = includeBranding && branding ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:sans-serif;font-size:13px;color:#64748b;line-height:1.9;">
        ${branding.agentName ? `<strong style="color:#1e293b;font-size:14px;display:block;">${branding.agentName}</strong>` : ""}
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

  // ── Apply content template ────────────────────────────────────────────────

  const applyContentTemplate = (key: string) => {
    const t = CONTENT_TEMPLATES[key];
    if (!t) return;
    if (subject === "" || subject === t.subject) setSubject(t.subject);
    setHtml(t.body);
    setShowContentTemplates(false);
    setIsEditorEmpty(false);
    if (activeTab !== "editor") setActiveTab("editor");
  };

  // ── Apply design template ─────────────────────────────────────────────────

  const applyDesignTemplate = (id: string) => {
    setSelectedDesign(id);
    setShowTemplateGallery(false);
  };

  // ── Draft CRUD ────────────────────────────────────────────────────────────

  const doSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const payload = {
        mailboxId: mailboxType === "gmail" ? null : mailboxId,
        mailboxType, toEmail: to, ccEmail: cc, bccEmail: bcc,
        subject, body: getHtml(), trackOpen, trackClick, includeBranding,
      };
      const r = draftId ? await apiPut(`composer/drafts/${draftId}`, payload) : await apiPost("composer/drafts", payload);
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

  // ── Save as design template ────────────────────────────────────────────────

  const doSaveAsTemplate = async () => {
    if (!saveTemplateName.trim()) { toast({ title: "Template name required", variant: "destructive" }); return; }
    setSavingTemplate(true);
    try {
      const content = getHtml();
      const htmlLayout = buildTemplateHtml(selectedDesign, "{{content}}", branding, false)
        .replace(content || "{{content}}", "{{content}}");
      const r = await apiPost("composer/design-templates", {
        name:        saveTemplateName.trim(),
        description: `Saved from Composer using ${BUILT_IN_TEMPLATES.find(t => t.id === selectedDesign)?.name ?? selectedDesign} layout`,
        htmlLayout,
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast({ title: "Template saved to Design Library" });
      setShowSaveTemplate(false);
      setSaveTemplateName("");
      await loadUserDesignTemplates();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSavingTemplate(false); }
  };

  // ── AI generate ───────────────────────────────────────────────────────────

  const doAiGenerate = async () => {
    if (!aiPrompt.trim()) { toast({ title: "Please describe what you want", variant: "destructive" }); return; }
    setAiGenerating(true);
    try {
      const r = await apiPost("composer/ai-generate", { prompt: aiPrompt, subject, tone: aiTone });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      const { html } = await r.json();
      setHtml(html);
      setShowAiPanel(false);
      setAiPrompt("");
      setActiveTab("editor");
      toast({ title: "Email content generated!" });
    } catch (e: any) {
      toast({ title: "AI generation failed", description: e.message, variant: "destructive" });
    } finally { setAiGenerating(false); }
  };

  // ── Send ──────────────────────────────────────────────────────────────────

  const buildFormData = (isTest = false) => {
    const fd = new FormData();
    fd.append("mailboxId",   mailboxType === "gmail" ? "" : mailboxId);
    fd.append("mailboxType", mailboxType);
    fd.append("to",          isTest ? (userEmail || to) : to);
    fd.append("cc",          cc); fd.append("bcc", bcc);
    fd.append("subject",     subject);
    const content = getHtml();
    const userTpl = selectedDesign.startsWith("user:") ? userDesignTemplates.find(t => `user:${t.id}` === selectedDesign) : null;
    let bodyHtml: string;
    if (userTpl) {
      const accentColor = branding?.accentColor || "#2563eb";
      const brandingBlock = includeBranding && branding ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:sans-serif;font-size:13px;color:#64748b;line-height:1.9;">
        ${branding.agentName ? `<strong style="color:#1e293b;font-size:14px;display:block;">${branding.agentName}</strong>` : ""}
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
    fd.append("bodyHtml",    bodyHtml);
    fd.append("trackOpen",   String(trackOpen));
    fd.append("trackClick",  String(trackClick));
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
    if (!to.trim())      { toast({ title: "No recipient",  description: "Enter a To address.",        variant: "destructive" }); return; }
    if (!subject.trim()) { toast({ title: "No subject",    description: "Enter a subject line.",      variant: "destructive" }); return; }
    if (!mailboxId)      { toast({ title: "No mailbox",    description: "Select a sending mailbox.",  variant: "destructive" }); return; }
    setSending(true);
    try {
      const r = await fetch(apiUrl("composer/send"), { method: "POST", credentials: "include", body: buildFormData() });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to send");
      toast({ title: "Email sent!", description: `Delivered to ${to}` });
      if (draftId) { await apiDel(`composer/drafts/${draftId}`); setDraftId(null); await loadDrafts(); }
      setTo(""); setCc(""); setBcc(""); setSubject(""); setHtml("<p></p>"); setIsEditorEmpty(true);
      setAttachments([]); setShowCc(false); setShowBcc(false);
      setActiveTab("editor");
    } catch (e: any) {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    } finally { setSending(false); }
  };

  const selectedDesignLabel = (() => {
    if (selectedDesign.startsWith("user:")) {
      const t = userDesignTemplates.find(t => `user:${t.id}` === selectedDesign);
      return t?.name ?? "Custom";
    }
    return BUILT_IN_TEMPLATES.find(t => t.id === selectedDesign)?.name ?? "Professional Quote";
  })();

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading composer…
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-gradient-to-br from-blue-500 to-violet-500 rounded-lg">
            <PenLine className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white leading-none">Compose Email</h1>
            <p className="text-xs text-slate-400 mt-0.5">Professional email marketing composer</p>
          </div>
          {draftId && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:border-amber-600 ml-1">
              Saved draft
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Content Templates */}
          <div className="relative">
            <button
              onClick={() => { setShowContentTemplates(!showContentTemplates); setShowDrafts(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500 transition-colors shadow-sm"
            >
              <FileText className="h-3.5 w-3.5" /> Templates <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
            {showContentTemplates && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden">
                {Object.entries(CONTENT_TEMPLATES).map(([key, t]) => (
                  <button key={key} onClick={() => applyContentTemplate(key)}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 transition-colors"
                  >
                    <span className={cn("p-1 rounded-md", t.color)}><t.icon className="h-3 w-3" /></span>
                    {t.label}
                  </button>
                ))}
                <div className="border-t border-slate-100 dark:border-slate-700 mt-1 pt-1">
                  <button onClick={() => { setHtml("<p></p>"); setIsEditorEmpty(true); setShowContentTemplates(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5"
                  >
                    <span className="p-1 rounded-md bg-slate-50 dark:bg-slate-700"><FileCode className="h-3 w-3 text-slate-400" /></span>
                    Blank Email
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Drafts */}
          <button
            onClick={() => { setShowDrafts(!showDrafts); setShowContentTemplates(false); }}
            className="relative flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500 transition-colors shadow-sm"
          >
            <Clock className="h-3.5 w-3.5" />
            Drafts
            {drafts.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-blue-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold" style={{ width: 17, height: 17 }}>
                {drafts.length}
              </span>
            )}
          </button>

          {/* Design Template Library link */}
          <Link href="/design-templates">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500 transition-colors shadow-sm">
              <Layout className="h-3.5 w-3.5" />
              Library
            </button>
          </Link>
        </div>
      </div>

      {/* ── Drafts panel ── */}
      {showDrafts && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Saved Drafts</span>
            <button onClick={() => setShowDrafts(false)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
          {drafts.length === 0 ? (
            <p className="text-sm text-slate-400 px-4 py-6 text-center">No saved drafts</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-60 overflow-y-auto">
              {drafts.map(d => (
                <div key={d.id} onClick={() => doLoadDraft(d)}
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{d.subject || "(No subject)"}</p>
                    <p className="text-xs text-slate-400 truncate">To: {d.toEmail || "—"}</p>
                  </div>
                  <button onClick={e => doDeleteDraft(d.id, e)} className="ml-3 p-1 text-slate-400 hover:text-red-500 rounded">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Main grid: compose + brand panel ── */}
      <div className="flex gap-4 items-start">

        {/* ── Compose card ── */}
        <div className="flex-1 min-w-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">

          {/* From row */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-14 shrink-0">From</span>
            <div className="relative flex-1">
              <select
                value={mailboxId}
                onChange={e => { const v = e.target.value; setMailboxId(v); setMailboxType(v === "gmail" ? "gmail" : "smtp"); }}
                className="w-full text-sm bg-transparent text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer pr-6 appearance-none"
              >
                {mailboxes.map(mb => (
                  <option key={mb.id} value={String(mb.id)}>
                    {mb.fromName ? `${mb.fromName} <${mb.smtpUser}>` : mb.smtpUser}
                  </option>
                ))}
                {gmailConnected && <option value="gmail">Gmail — {userEmail}</option>}
                {mailboxes.length === 0 && !gmailConnected && <option value="">No mailboxes configured</option>}
              </select>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* To row */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-14 shrink-0">To</span>
            <input type="email" value={to} onChange={e => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1 text-sm bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none"
            />
            <div className="flex gap-1">
              {!showCc  && <button onClick={() => setShowCc(true)}  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 font-medium transition-colors">Cc</button>}
              {!showBcc && <button onClick={() => setShowBcc(true)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 font-medium transition-colors">Bcc</button>}
            </div>
          </div>

          {showCc && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-14 shrink-0">Cc</span>
              <input type="text" value={cc} onChange={e => setCc(e.target.value)} placeholder="cc@example.com"
                className="flex-1 text-sm bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none"
              />
              <button onClick={() => { setShowCc(false); setCc(""); }} className="text-slate-300 hover:text-slate-500"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {showBcc && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-14 shrink-0">Bcc</span>
              <input type="text" value={bcc} onChange={e => setBcc(e.target.value)} placeholder="bcc@example.com"
                className="flex-1 text-sm bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none"
              />
              <button onClick={() => { setShowBcc(false); setBcc(""); }} className="text-slate-300 hover:text-slate-500"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {/* Subject row */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-14 shrink-0">Subject</span>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Email subject"
              className="flex-1 text-sm font-medium bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 focus:outline-none"
            />
          </div>

          {/* Design template + view tabs bar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50">
            {/* Design template selector */}
            <button
              onClick={() => setShowTemplateGallery(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 border border-transparent hover:border-slate-200 dark:hover:border-slate-600 transition-all"
            >
              <Layout className="h-3.5 w-3.5 text-violet-500" />
              <span className="max-w-28 truncate">{selectedDesignLabel}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </button>

            {/* Editor / Preview tabs */}
            <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-700/60 rounded-lg p-0.5">
              <button onClick={() => setActiveTab("editor")}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  activeTab === "editor" ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700")}
              >
                <PenLine className="h-3 w-3" /> Editor
              </button>
              <button onClick={() => { setActiveTab("desktop"); buildPreviewHtml(); }}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  activeTab === "desktop" ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700")}
              >
                <Monitor className="h-3 w-3" /> Desktop
              </button>
              <button onClick={() => { setActiveTab("mobile"); buildPreviewHtml(); }}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  activeTab === "mobile" ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700")}
              >
                <Smartphone className="h-3 w-3" /> Mobile
              </button>
            </div>
          </div>

          {/* ── Editor area ── */}
          {activeTab === "editor" ? (
            <>
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800">
                <TBtn onClick={() => exec("bold")}          title="Bold"         ><Bold          className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("italic")}        title="Italic"       ><Italic        className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("underline")}     title="Underline"    ><Underline     className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("strikeThrough")} title="Strikethrough"><Strikethrough className="h-3.5 w-3.5" /></TBtn>
                <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                <div className="relative">
                  <TBtn onClick={() => { setShowFontSize(!showFontSize); setShowColorPicker(false); }} title="Font size">
                    <Type className="h-3.5 w-3.5" /><ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                  </TBtn>
                  {showFontSize && (
                    <div className="absolute left-0 top-full mt-1 w-28 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1 overflow-hidden">
                      {FONT_SIZES.map(f => (
                        <button key={f.value} onMouseDown={e => { e.preventDefault(); exec("fontSize", f.value); setShowFontSize(false); }}
                          className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >{f.label}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative">
                  <TBtn onClick={() => { setShowColorPicker(!showColorPicker); setShowFontSize(false); }} title="Text color">
                    <Palette className="h-3.5 w-3.5" /><ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                  </TBtn>
                  {showColorPicker && (
                    <div className="absolute left-0 top-full mt-1 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50">
                      <div className="grid grid-cols-6 gap-1">
                        {COLORS.map(c => (
                          <button key={c} title={c} onMouseDown={e => { e.preventDefault(); exec("foreColor", c); setShowColorPicker(false); }}
                            style={{ backgroundColor: c }}
                            className="w-5 h-5 rounded border border-slate-200 dark:border-slate-600 hover:scale-110 transition-transform"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                <TBtn onClick={() => exec("justifyLeft")}   title="Align left"   ><AlignLeft    className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("justifyCenter")} title="Align center" ><AlignCenter  className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("justifyRight")}  title="Align right"  ><AlignRight   className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("justifyFull")}   title="Justify"      ><AlignJustify className="h-3.5 w-3.5" /></TBtn>
                <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                <TBtn onClick={() => exec("insertUnorderedList")} title="Bullet list"  ><List        className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("insertOrderedList")}   title="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></TBtn>
                <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                <TBtn onClick={insertLink}   title="Insert link"  ><Link2     className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={insertImage}  title="Insert image" ><ImageIcon className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={insertButton} title="CTA button"><span className="text-[10px] font-bold px-0.5">BTN</span></TBtn>
                <TBtn onClick={() => exec("insertHorizontalRule")} title="Divider"><Minus className="h-3.5 w-3.5" /></TBtn>
                <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                <TBtn onClick={toggleHtmlMode} title="HTML source" active={htmlSourceMode}><Code2 className="h-3.5 w-3.5" /></TBtn>
              </div>

              {/* Empty state */}
              {isEditorEmpty && !htmlSourceMode && (
                <div className="px-5 py-6 border-b border-slate-100 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/40">
                  <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3 text-center">
                    Start with a template or write from scratch
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <button
                      onClick={() => setShowTemplateGallery(true)}
                      className="flex items-center gap-2.5 p-3 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30 text-left transition-colors group"
                    >
                      <span className="p-1.5 bg-violet-100 dark:bg-violet-800 rounded-lg"><Layout className="h-4 w-4 text-violet-600 dark:text-violet-300" /></span>
                      <div>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-tight">Design Template</p>
                        <p className="text-[10px] text-slate-400 leading-tight">Choose a layout</p>
                      </div>
                    </button>
                    {Object.entries(CONTENT_TEMPLATES).map(([key, t]) => (
                      <button key={key} onClick={() => applyContentTemplate(key)}
                        className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-left transition-colors"
                      >
                        <span className={cn("p-1.5 rounded-lg", t.color)}><t.icon className="h-4 w-4" /></span>
                        <div>
                          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-tight">{t.label}</p>
                          <p className="text-[10px] text-slate-400 leading-tight">Quick start</p>
                        </div>
                      </button>
                    ))}
                    <button
                      onClick={() => { if (editorRef.current) { editorRef.current.innerHTML = "<p></p>"; editorRef.current.focus(); setIsEditorEmpty(false); } }}
                      className="flex items-center gap-2.5 p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-left transition-colors"
                    >
                      <span className="p-1.5 bg-slate-100 dark:bg-slate-700 rounded-lg"><FileCode className="h-4 w-4 text-slate-400" /></span>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-tight">Blank Email</p>
                        <p className="text-[10px] text-slate-400 leading-tight">Write from scratch</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Editor / HTML source */}
              {htmlSourceMode ? (
                <textarea value={htmlSource} onChange={e => setHtmlSource(e.target.value)}
                  className="w-full px-4 py-4 font-mono text-xs bg-slate-950 text-emerald-400 focus:outline-none resize-none"
                  style={{ minHeight: 320 }} placeholder="HTML source…"
                />
              ) : (
                <div ref={editorRef} contentEditable suppressContentEditableWarning
                  onInput={onEditorInput}
                  onClick={() => { setShowColorPicker(false); setShowFontSize(false); setShowContentTemplates(false); }}
                  className="px-5 py-4 text-slate-800 dark:text-slate-200 focus:outline-none overflow-y-auto"
                  style={{ minHeight: isEditorEmpty ? 0 : 320 }}
                />
              )}
            </>
          ) : (
            /* Preview pane */
            <div className={cn("bg-slate-100 dark:bg-slate-900", activeTab === "mobile" ? "flex justify-center p-4" : "p-4")}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-400 flex items-center gap-1.5">
                  {activeTab === "desktop" ? <Monitor className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
                  {activeTab === "desktop" ? "Desktop preview (600px)" : "Mobile preview (375px)"}
                </span>
                <button onClick={buildPreviewHtml} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1">
                  <Eye className="h-3 w-3" /> Refresh
                </button>
              </div>
              <iframe srcDoc={previewHtml} sandbox="allow-same-origin" title="Email preview"
                style={{ width: activeTab === "mobile" ? 375 : "100%", minHeight: 480, border: "none", borderRadius: 8, background: "white", display: "block", boxShadow: "0 2px 16px rgba(0,0,0,0.08)" }}
              />
            </div>
          )}

          {/* ── Options row ── */}
          <div className="flex flex-wrap items-center gap-5 px-4 py-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-sm">
            {[
              { label: "Branding footer",  checked: includeBranding, setter: setIncludeBranding },
              { label: "Track opens",      checked: trackOpen,       setter: setTrackOpen       },
              { label: "Track clicks",     checked: trackClick,      setter: setTrackClick      },
            ].map(({ label, checked, setter }) => (
              <label key={label} className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={checked} onChange={e => setter(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-500 text-slate-700 focus:ring-0 focus:ring-offset-0 accent-slate-700"
                />
                <span className="text-xs">{label}</span>
              </label>
            ))}
            <button
              onClick={() => { setShowBrandPanel(!showBrandPanel); }}
              className={cn(
                "ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors",
                showBrandPanel
                  ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300"
                  : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300"
              )}
            >
              <User className="h-3.5 w-3.5" /> Brand Panel
            </button>
          </div>

          {/* ── Attachments ── */}
          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-400 hover:text-slate-600 dark:hover:border-slate-500 dark:hover:text-slate-300 transition-colors"
              >
                <Paperclip className="h-3.5 w-3.5" /> Add attachment
              </button>
              <input ref={fileInputRef} type="file" multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
                className="hidden"
                onChange={e => { if (e.target.files) { setAttachments(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ""; } }}
              />
            </div>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachments.map((f, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 dark:bg-slate-700/60 rounded-lg border border-slate-200 dark:border-slate-600">
                    {fileIcon(f.name)}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{f.name}</p>
                      <p className="text-[10px] text-slate-400">{fmtSize(f.size)}</p>
                    </div>
                    <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-red-500 transition-colors p-0.5 rounded"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Action bar ── */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={doSaveDraft} disabled={savingDraft} className="h-8 text-xs gap-1.5">
                {savingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Draft
              </Button>
              <Button variant="outline" size="sm" onClick={doSendTest} disabled={sendingTest} className="h-8 text-xs gap-1.5">
                {sendingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                Send Test
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowAiPanel(!showAiPanel); setShowSaveTemplate(false); }}
                className="h-8 text-xs gap-1.5 text-violet-600 dark:text-violet-400 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20"
              >
                <Sparkles className="h-3.5 w-3.5" /> AI Generate
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowSaveTemplate(!showSaveTemplate); setShowAiPanel(false); }}
                className="h-8 text-xs gap-1.5 text-slate-500 hover:text-slate-700"
              >
                <Copy className="h-3.5 w-3.5" /> Save as Template
              </Button>
            </div>
            <Button size="sm" onClick={doSend} disabled={sending}
              className="h-8 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white text-xs px-5 gap-1.5 shadow-sm"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send Now
            </Button>
          </div>

          {/* ── AI Generate panel ── */}
          {showAiPanel && (
            <div className="border-t border-violet-200 dark:border-violet-800 bg-gradient-to-b from-violet-50 to-white dark:from-violet-900/20 dark:to-slate-800 px-5 py-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-violet-100 dark:bg-violet-900/40 rounded-lg"><Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" /></div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">AI Email Generator</p>
                  <p className="text-xs text-slate-400">Describe your email and AI will write it for you</p>
                </div>
                <button onClick={() => setShowAiPanel(false)} className="ml-auto text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
              </div>
              <div className="space-y-3">
                <textarea
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="e.g. Write a follow-up email for a vehicle transport quote for a 2022 Tesla Model 3 from LA to NYC, price $1,250, asking if they're ready to book"
                  className="w-full px-4 py-3 rounded-xl border border-violet-200 dark:border-violet-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 resize-none transition"
                  rows={3}
                />
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-slate-500 shrink-0">Tone:</span>
                    <select value={aiTone} onChange={e => setAiTone(e.target.value)}
                      className="text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-400/30"
                    >
                      {["professional","friendly","urgent","formal","casual"].map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <Button onClick={doAiGenerate} disabled={aiGenerating}
                    className="bg-violet-600 hover:bg-violet-700 text-white text-xs h-8 gap-1.5 px-4"
                  >
                    {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    {aiGenerating ? "Generating…" : "Generate Email"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── Save as Template panel ── */}
          {showSaveTemplate && (
            <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Copy className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Save as Design Template</p>
                <button onClick={() => setShowSaveTemplate(false)} className="ml-auto text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
              </div>
              <div className="flex gap-3">
                <input type="text" value={saveTemplateName} onChange={e => setSaveTemplateName(e.target.value)}
                  placeholder="Template name, e.g. My Corporate Layout"
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300/50 focus:border-slate-400 transition"
                />
                <Button onClick={doSaveAsTemplate} disabled={savingTemplate}
                  className="h-9 text-xs gap-1.5 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white"
                >
                  {savingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </Button>
              </div>
              <p className="text-xs text-slate-400 mt-2">Saves the current layout wrapper to your <Link href="/design-templates"><span className="text-blue-500 hover:underline cursor-pointer">Design Template Library</span></Link>.</p>
            </div>
          )}
        </div>

        {/* ── Brand Preview Panel ── */}
        {showBrandPanel && (
          <div className="w-56 shrink-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Brand Preview</span>
              <button onClick={() => setShowBrandPanel(false)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="p-4 space-y-4">
              {/* Logo */}
              {branding?.logoUrl ? (
                <div className="flex justify-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-600">
                  <img src={branding.logoUrl} alt="Logo" className="max-h-12 max-w-full object-contain" />
                </div>
              ) : (
                <div className="flex justify-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-600">
                  <p className="text-xs text-slate-400">No logo set</p>
                </div>
              )}

              {/* Info */}
              <div className="space-y-2.5">
                {[
                  { icon: User,      label: "Agent",   value: branding?.agentName      },
                  { icon: Building2, label: "Company", value: branding?.companyName     },
                  { icon: Phone,     label: "Phone",   value: branding?.companyPhone    },
                  { icon: Globe,     label: "Website", value: branding?.companyWebsite  },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-start gap-2">
                    <Icon className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">{label}</p>
                      <p className="text-xs text-slate-700 dark:text-slate-300 truncate">{value || <span className="text-slate-300 dark:text-slate-500 italic">Not set</span>}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Signature preview */}
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1.5">Signature Preview</p>
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 border border-slate-100 dark:border-slate-600 text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                  {branding?.agentName   && <p className="font-semibold">{branding.agentName}</p>}
                  {branding?.companyName && <p>{branding.companyName}</p>}
                  {branding?.companyPhone && <p>📞 {branding.companyPhone}</p>}
                  {branding?.companyWebsite && <a href={branding.companyWebsite} className="text-blue-500 truncate block">{branding.companyWebsite}</a>}
                  {!branding?.agentName && !branding?.companyName && (
                    <p className="text-slate-400 italic">Configure in Settings → Branding</p>
                  )}
                </div>
              </div>

              {/* Accent color */}
              {branding?.accentColor && (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full border border-slate-200 shrink-0" style={{ background: branding.accentColor }} />
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Accent Color</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 font-mono">{branding.accentColor}</p>
                  </div>
                </div>
              )}

              <Link href="/settings">
                <button className="w-full text-xs text-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 py-1 border-t border-slate-100 dark:border-slate-700 pt-2 transition-colors">
                  Edit Branding Settings →
                </button>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ── Design Template Gallery Modal ── */}
      {showTemplateGallery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Design Template Gallery</h2>
                <p className="text-sm text-slate-400 mt-0.5">Choose a layout for your email — visual wrapper for your content</p>
              </div>
              <button onClick={() => setShowTemplateGallery(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {/* Built-in templates */}
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Built-in Templates</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                {BUILT_IN_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => applyDesignTemplate(t.id)}
                    className={cn(
                      "group rounded-xl border-2 overflow-hidden text-left transition-all hover:shadow-md",
                      selectedDesign === t.id
                        ? "border-violet-500 shadow-md shadow-violet-100 dark:shadow-violet-900/30"
                        : "border-slate-200 dark:border-slate-700 hover:border-violet-300"
                    )}
                  >
                    <div className="h-24 relative">
                      <DesignMiniPreview template={t} />
                      {selectedDesign === t.id && (
                        <div className="absolute top-2 right-2 bg-violet-500 text-white rounded-full p-0.5">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>
                    <div className="p-3 border-t border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{t.name}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{t.desc}</p>
                      <span className="inline-block mt-1.5 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-[10px] font-medium text-slate-500 dark:text-slate-400 rounded">{t.category}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* User templates */}
              {userDesignTemplates.length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Your Custom Templates</p>
                    <Link href="/design-templates">
                      <button onClick={() => setShowTemplateGallery(false)} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                        Manage <ChevronRight className="h-3 w-3" />
                      </button>
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {userDesignTemplates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => applyDesignTemplate(`user:${t.id}`)}
                        className={cn(
                          "group rounded-xl border-2 overflow-hidden text-left transition-all hover:shadow-md",
                          selectedDesign === `user:${t.id}`
                            ? "border-violet-500 shadow-md"
                            : "border-slate-200 dark:border-slate-700 hover:border-violet-300"
                        )}
                      >
                        <div className="h-24 overflow-hidden relative">
                          <iframe srcDoc={t.htmlLayout.replace("{{content}}", "<p>Sample content</p>").replace("{{branding_footer}}", "").replace("{{company_name}}", "Company")}
                            sandbox="allow-same-origin"
                            style={{ width: "200%", height: "200%", border: "none", transformOrigin: "top left", transform: "scale(0.5)", pointerEvents: "none" }}
                          />
                          {selectedDesign === `user:${t.id}` && (
                            <div className="absolute top-2 right-2 bg-violet-500 text-white rounded-full p-0.5">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </div>
                          )}
                        </div>
                        <div className="p-3 border-t border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{t.name}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{t.description || "Custom layout"}</p>
                          <span className="inline-block mt-1.5 px-1.5 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-[10px] font-medium text-violet-600 dark:text-violet-400 rounded">Custom</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <p className="text-xs text-slate-400">Create custom HTML layouts in the <Link href="/design-templates"><span className="text-blue-500 hover:underline cursor-pointer" onClick={() => setShowTemplateGallery(false)}>Design Template Library</span></Link>.</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <Button onClick={() => setShowTemplateGallery(false)} className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
                <CheckCircle2 className="h-4 w-4" /> Apply Template
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
