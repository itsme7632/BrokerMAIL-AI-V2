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
import { MD_RULES } from "@workspace/markdown";

// ── Types ──────────────────────────────────────────────────────────────────────

type AttachmentMeta  = { id: string; name: string; size: number; type: string };
type EmailTemplate   = { id: number; name: string; subject: string; body: string; designId: string; includeBranding: boolean; createdAt: string; updatedAt: string; };

// ── API helpers ────────────────────────────────────────────────────────────────

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
const apiUrl = (p: string) => `${BASE}/api/${p}`;
// Auth is JWT Bearer token stored in localStorage (NOT session cookies)
const getToken = () => localStorage.getItem("auth_token") ?? "";
const authHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  "Authorization": `Bearer ${getToken()}`,
  ...extra,
});
const apiFetch = (p: string, init?: RequestInit) =>
  fetch(apiUrl(p), {
    ...init,
    headers: authHeaders(init?.headers as Record<string, string> ?? {}),
  });
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

// ── Image compression ──────────────────────────────────────────────────────────
// Resizes inline images to ≤620 px wide and compresses to JPEG.
// White fill ensures transparent PNGs look clean in email clients.
async function compressImage(dataUrl: string, maxPx = 620, quality = 0.82): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;
      const needsResize = w > maxPx;
      if (!needsResize && dataUrl.length < 150_000) { resolve(dataUrl); return; }
      if (needsResize) { h = Math.round((h * maxPx) / w); w = maxPx; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const out = c.toDataURL("image/jpeg", quality);
      resolve(out.length < dataUrl.length ? out : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── Logo compression (used by Settings page, defined here for reuse) ───────────
export async function compressLogo(dataUrl: string): Promise<string> {
  if (dataUrl.startsWith("data:image/svg")) return dataUrl;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const maxW = 400;
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxW && dataUrl.length < 300_000) { resolve(dataUrl); return; }
      if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const out = c.toDataURL("image/png");
      resolve(out.length < dataUrl.length ? out : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── Smart Markdown inline formatting ───────────────────────────────────────────
// Patterns (bold/italic/strikethrough/underline/code) live in the shared
// @workspace/markdown package — see that package's MD_RULES for the canonical
// definitions, also reused by TemplateEditor's previews and the backend's
// final email HTML builder so all three stay in sync.

/**
 * Scans the text node at the current cursor position.
 * If the text before the cursor ends with a complete Markdown pattern,
 * replaces it with an inline HTML element using execCommand (preserves undo).
 * Backslash-escaping: \**text** keeps the literal characters.
 */
function applyMarkdownInline(editor: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  if (!editor.contains(node)) return;

  const text = (node as Text).textContent ?? "";
  const cursor = range.startOffset;
  const before = text.slice(0, cursor);

  for (const rule of MD_RULES) {
    const m = before.match(rule.re);
    if (!m) continue;

    const full  = m[0];   // e.g. **bold**
    const inner = m[1];   // e.g. bold
    const start = cursor - full.length;

    // Backslash escape: \**text** → literal **text**
    if (start > 0 && text[start - 1] === "\\") {
      const escRange = document.createRange();
      escRange.setStart(node, start - 1);   // include the backslash
      escRange.setEnd(node, cursor);
      sel.removeAllRanges();
      sel.addRange(escRange);
      document.execCommand("insertText", false, full);
      return;
    }

    // Select exactly the pattern and replace with formatted HTML
    const replaceRange = document.createRange();
    replaceRange.setStart(node, start);
    replaceRange.setEnd(node, cursor);
    sel.removeAllRanges();
    sel.addRange(replaceRange);

    const styleAttr = rule.style ? ` style="${rule.style}"` : "";
    // Escape HTML entities in the inner text so injected HTML is safe
    const safeInner = inner
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    document.execCommand("insertHTML", false, `<${rule.tag}${styleAttr}>${safeInner}</${rule.tag}>`);
    return;
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SingleEmailComposer() {
  const { toast } = useToast();

  const [mailboxes, setMailboxes]     = useState<any[]>([]);
  const [gmailConnected, setGmail]    = useState(false);
  const [userEmail, setUserEmail]     = useState("");
  const [gmailEmail, setGmailEmail]   = useState(""); // actual connected Gmail address
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

  const [attachments,          setAttachments]          = useState<AttachmentMeta[]>([]);
  const [uploadingAttachment,  setUploadingAttachment]  = useState(false);
  const fileInputRef                  = useRef<HTMLInputElement>(null);
  const imageInputRef                 = useRef<HTMLInputElement>(null);
  const imgReplaceRef                 = useRef<HTMLInputElement>(null);
  const savedRangeRef                 = useRef<Range | null>(null);
  const [selectedImg,   setSelectedImg]   = useState<HTMLImageElement | null>(null);
  const [imgToolbarPos, setImgToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const linkDialogRef                 = useRef<HTMLDivElement>(null);
  const linkInputRef                  = useRef<HTMLInputElement>(null);

  const [drafts,     setDrafts]     = useState<any[]>([]);
  const [draftId,    setDraftId]    = useState<number | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

  const [activeTab,   setActiveTab]   = useState<"editor" | "desktop" | "mobile">("editor");
  const [previewHtml, setPreviewHtml] = useState("");

  const [selectedDesign,      setSelectedDesign]      = useState("professional");
  const [userDesignTemplates, setUserDesignTemplates] = useState<any[]>([]);

  const [showColorPicker,  setShowColorPicker]  = useState(false);
  const [showFontSize,     setShowFontSize]     = useState(false);
  const [showMoreToolbar,  setShowMoreToolbar]  = useState(false);

  const [showLinkDialog, setShowLinkDialog]   = useState(false);
  const [linkUrl,        setLinkUrl]          = useState("https://");
  const [linkNewTab,     setLinkNewTab]       = useState(false);
  const [linkIsEdit,     setLinkIsEdit]       = useState(false);

  const [loading,     setLoading]     = useState(true);
  const [sending,     setSending]     = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [emailTemplates,        setEmailTemplates]        = useState<EmailTemplate[]>([]);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateName,          setTemplateName]          = useState("");
  const [savingTemplate,        setSavingTemplate]        = useState(false);
  const [showPreviewModal,      setShowPreviewModal]      = useState(false);
  const [renamingTemplateId,    setRenamingTemplateId]    = useState<number | null>(null);
  const [renameValue,           setRenameValue]           = useState("");

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
    Promise.all([loadMailboxes(), loadDrafts(), loadBranding(), loadUserDesignTemplates(), loadEmailTemplates()])
      .finally(() => setLoading(false));
  }, []);

  // Always rebuild preview (live), triggered by subject/template/branding changes
  // rebuildPreview reads editorContentRef (a ref) so omitting it from deps is intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { rebuildPreview(); }, [subject, selectedDesign, branding, includeBranding]);

  // Restore editor innerHTML from cache when switching back to editor tab
  // (editor div is conditionally rendered so it remounts empty on tab return)
  useEffect(() => {
    if (activeTab === "editor" && editorRef.current) {
      editorRef.current.innerHTML = editorContentRef.current;
    }
  }, [activeTab]);

  const loadMailboxes = async () => {
    try {
      const r = await apiFetch("composer/mailboxes");
      if (!r.ok) return;
      const d = await r.json();
      setMailboxes(d.mailboxes ?? []);
      setGmail(d.gmailConnected ?? false);
      setUserEmail(d.userEmail ?? "");
      // gmailEmail is the actual connected Gmail address (e.g. frank@gmail.com).
      // userEmail may be the SMTP/registration address — never use it for the Gmail option.
      if (d.gmailEmail) setGmailEmail(d.gmailEmail);
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

  const loadEmailTemplates = async () => {
    try {
      const r = await apiFetch("composer/email-templates");
      if (r.ok) setEmailTemplates(await r.json());
    } catch {}
  };

  const doSaveAsTemplate = async () => {
    if (!templateName.trim()) { toast({ title: "Template name required", variant: "destructive" }); return; }
    setSavingTemplate(true);
    try {
      const r = await apiPost("composer/email-templates", {
        name: templateName.trim(), subject, body: getHtml(), designId: selectedDesign, includeBranding,
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      await loadEmailTemplates();
      setShowSaveTemplateModal(false);
      setTemplateName("");
      toast({ title: "Template saved!", description: `"${templateName.trim()}" added to your library.` });
    } catch (e: any) {
      toast({ title: "Error saving template", description: e.message, variant: "destructive" });
    } finally { setSavingTemplate(false); }
  };

  const doUseEmailTemplate = (t: EmailTemplate) => {
    setSubject(t.subject);
    setHtml(t.body);
    setSelectedDesign(t.designId || "professional");
    setIncludeBranding(t.includeBranding);
    setTimeout(() => rebuildPreview(), 0);
    toast({ title: "Template loaded" });
  };

  const doDeleteEmailTemplate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiDel(`composer/email-templates/${id}`);
      await loadEmailTemplates();
    } catch {}
  };

  const doDuplicateEmailTemplate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await apiPost(`composer/email-templates/${id}/duplicate`, {});
      if (!r.ok) throw new Error("Failed");
      await loadEmailTemplates();
      toast({ title: "Template duplicated" });
    } catch {}
  };

  const doRenameEmailTemplate = async (id: number) => {
    if (!renameValue.trim()) return;
    try {
      await apiPut(`composer/email-templates/${id}`, { name: renameValue.trim() });
      await loadEmailTemplates();
      setRenamingTemplateId(null);
      setRenameValue("");
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

  const openLinkDialog = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setLinkUrl("https://");
      setLinkNewTab(false);
      setLinkIsEdit(false);
      savedRangeRef.current = null;
      setShowLinkDialog(true);
      setTimeout(() => linkInputRef.current?.focus(), 50);
      return;
    }
    savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node) as Element | null;
    const anchor = el?.closest?.("a") as HTMLAnchorElement | null;
    if (anchor) {
      setLinkUrl(anchor.getAttribute("href") || "https://");
      setLinkNewTab(anchor.target === "_blank");
      setLinkIsEdit(true);
    } else {
      setLinkUrl("https://");
      setLinkNewTab(false);
      setLinkIsEdit(false);
    }
    setShowLinkDialog(true);
    setTimeout(() => { linkInputRef.current?.focus(); linkInputRef.current?.select(); }, 50);
  };

  const insertLink = openLinkDialog;

  const applyLink = () => {
    const clean = linkUrl.trim();
    const finalUrl = clean && clean !== "https://" ? clean : "";
    if (!finalUrl) { setShowLinkDialog(false); return; }
    editorRef.current?.focus();
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current); }
    }
    const sel = window.getSelection();
    const hasSelection = sel && !sel.isCollapsed;
    const range = savedRangeRef.current;
    if (hasSelection && range) {
      const frag = range.cloneContents();
      const tmp = document.createElement("div");
      tmp.appendChild(frag);
      const inner = tmp.innerHTML || range.toString() || finalUrl;
      const target = linkNewTab ? ` target="_blank" rel="noopener noreferrer"` : "";
      document.execCommand("insertHTML", false, `<a href="${finalUrl}"${target}>${inner}</a>`);
    } else {
      const target = linkNewTab ? ` target="_blank" rel="noopener noreferrer"` : "";
      document.execCommand("insertHTML", false, `<a href="${finalUrl}"${target}>${finalUrl}</a>`);
    }
    setShowLinkDialog(false);
    setTimeout(() => {
      editorContentRef.current = editorRef.current?.innerHTML ?? editorContentRef.current;
      rebuildPreview();
    }, 0);
  };

  const removeLink = () => {
    editorRef.current?.focus();
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current); }
    }
    document.execCommand("unlink", false);
    setShowLinkDialog(false);
    setTimeout(() => {
      editorContentRef.current = editorRef.current?.innerHTML ?? editorContentRef.current;
      rebuildPreview();
    }, 0);
  };

  const insertImage = () => {
    // Save cursor position then open file picker — no prompt()
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    imageInputRef.current?.click();
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target?.result as string;
      if (!raw) return;

      // Compress: resize to ≤620 px wide, JPEG 0.82 quality
      const dataUrl = await compressImage(raw);
      const IMG_STYLE = "display:block;max-width:100%;width:100%;height:auto;margin:16px auto;border-radius:4px;";

      // ── HTML source mode ────────────────────────────────────────────────────
      if (htmlSourceMode) {
        const tag = `<img src="${dataUrl}" style="${IMG_STYLE}" alt="" />`;
        const updated = htmlSource + "\n" + tag;
        setHtmlSource(updated);
        editorContentRef.current = updated;
        setTimeout(() => rebuildPreview(), 0);
        return;
      }

      // ── Rich-text editor mode ───────────────────────────────────────────────
      const editor = editorRef.current;
      if (!editor) {
        editorContentRef.current += `<img src="${dataUrl}" style="${IMG_STYLE}" alt="" />`;
        setTimeout(() => rebuildPreview(), 0);
        return;
      }

      const img = document.createElement("img");
      img.src = dataUrl;
      img.style.cssText = IMG_STYLE;
      img.alt = "";

      editor.focus();
      const sel = window.getSelection();
      if (sel) {
        let insertRange: Range | null = null;
        if (savedRangeRef.current) {
          try {
            sel.removeAllRanges();
            sel.addRange(savedRangeRef.current);
            insertRange = sel.getRangeAt(0);
          } catch { /* stale */ }
        }
        if (!insertRange) {
          insertRange = document.createRange();
          insertRange.selectNodeContents(editor);
          insertRange.collapse(false);
          sel.removeAllRanges();
          sel.addRange(insertRange);
        }
        insertRange.deleteContents();
        insertRange.insertNode(img);
        const after = document.createRange();
        after.setStartAfter(img);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
      } else {
        editor.appendChild(img);
      }

      setTimeout(() => {
        editorContentRef.current = editor.innerHTML;
        rebuildPreview();
      }, 0);
    };
    reader.readAsDataURL(file);
  };

  const handleAttachmentFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingAttachment(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch(apiUrl("composer/upload-attachment"), {
          method: "POST",
          headers: authHeaders(),
          body: fd,
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          toast({ title: "Upload failed", description: (err as any).error || file.name, variant: "destructive" });
          continue;
        }
        const meta: AttachmentMeta = await r.json();
        setAttachments(prev => [...prev, meta]);
      }
    } finally {
      setUploadingAttachment(false);
    }
  };

  const insertButton = () => {
    const text = window.prompt("Button label:", "Book Now");
    if (!text) return;
    const url = window.prompt("Button URL:", "https://");
    if (!url) return;
    const accent = branding?.accentColor || "#2563eb";
    exec("insertHTML", `<a href="${url}" style="display:inline-block;padding:10px 24px;background:${accent};color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-family:sans-serif;font-size:14px;">${text}</a>&nbsp;`);
  };

  // ── Image click handling & controls ───────────────────────────────────────

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      setSelectedImg(img);
      const r = img.getBoundingClientRect();
      setImgToolbarPos({ top: Math.max(8, r.top - 48), left: Math.max(8, r.left) });
    } else {
      setSelectedImg(null);
      setImgToolbarPos(null);
    }
  };

  const resizeImg = (pct: number) => {
    if (!selectedImg || !editorRef.current) return;
    const natW = selectedImg.naturalWidth || 620;
    const maxW = Math.min(natW, 620);
    const newW = Math.round(maxW * (pct / 100));
    selectedImg.style.width    = `${newW}px`;
    selectedImg.style.maxWidth = "100%";
    selectedImg.style.height   = "auto";
    editorContentRef.current = editorRef.current.innerHTML;
    rebuildPreview();
  };

  const alignImg = (align: "left" | "center" | "right") => {
    if (!selectedImg || !editorRef.current) return;
    selectedImg.style.display     = "block";
    selectedImg.style.marginLeft  = align === "left"   ? "0"    : "auto";
    selectedImg.style.marginRight = align === "right"  ? "0"    : "auto";
    editorContentRef.current = editorRef.current.innerHTML;
    rebuildPreview();
  };

  const removeImg = () => {
    if (!selectedImg || !editorRef.current) return;
    selectedImg.remove();
    setSelectedImg(null);
    setImgToolbarPos(null);
    editorContentRef.current = editorRef.current.innerHTML;
    rebuildPreview();
  };

  const editImgAlt = () => {
    if (!selectedImg) return;
    const alt = window.prompt("Alt text (improves email deliverability):", selectedImg.alt ?? "");
    if (alt !== null) {
      selectedImg.alt = alt;
      if (editorRef.current) editorContentRef.current = editorRef.current.innerHTML;
      rebuildPreview();
    }
  };

  const replaceImgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedImg) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const raw = ev.target?.result as string;
      if (!raw) return;
      const dataUrl = await compressImage(raw);
      selectedImg.src = dataUrl;
      if (editorRef.current) editorContentRef.current = editorRef.current.innerHTML;
      rebuildPreview();
    };
    reader.readAsDataURL(file);
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

  // Called on every editor keystroke — apply markdown, update cache, rebuild preview
  const onEditorInput = useCallback(() => {
    const editor = editorRef.current;
    if (editor) applyMarkdownInline(editor);
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
        attachmentsMeta: JSON.stringify(attachments),
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
    try { setAttachments(JSON.parse(d.attachmentsMeta ?? "[]")); } catch { setAttachments([]); }
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
    fd.append("bodyHtml",      bodyHtml);
    fd.append("trackOpen",     String(trackOpen));
    fd.append("trackClick",    String(trackClick));
    fd.append("attachmentIds", JSON.stringify(attachments.map(a => a.id)));
    return fd;
  };

  const doSendTest = async () => {
    if (!mailboxId) { toast({ title: "No mailbox", description: "Select a sending mailbox.", variant: "destructive" }); return; }
    setSendingTest(true);
    try {
      const r = await fetch(apiUrl("composer/test"), { method: "POST", headers: authHeaders(), body: buildFormData(true) });
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
      const r = await fetch(apiUrl("composer/send"), { method: "POST", headers: authHeaders(), body: buildFormData() });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to send");
      toast({ title: "Email sent!", description: `Sent to ${to}` });
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
      <div className="flex items-center justify-center h-screen text-slate-400 dark:text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading composer…</span>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    <div className="composer-no-ring flex h-full min-h-0" style={{ height: "calc(100vh - 64px)" }}>

      {/* ════════════ LEFT SIDEBAR ════════════ */}
      <aside
        className={cn(
          "flex flex-col bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 transition-all duration-200 shrink-0 overflow-hidden",
          sidebarCollapsed ? "w-0" : "w-[232px]"
        )}
      >
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">

          {/* ── Templates ─────────────────────── */}
          <section>
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1 mb-2">Templates</p>
            <div className="space-y-0.5">
              {BUILT_IN_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => applyDesignTemplate(t.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-all",
                    selectedDesign === t.id
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                  )}
                >
                  <span className="w-2 h-2 rounded-full shrink-0 ring-1 ring-current opacity-70" style={{ background: t.accentColor }} />
                  <span className="text-xs font-medium truncate">{t.name}</span>
                  {selectedDesign === t.id && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                </button>
              ))}
              {userDesignTemplates.map(t => (
                <button
                  key={`user:${t.id}`}
                  onClick={() => applyDesignTemplate(`user:${t.id}`)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-all",
                    selectedDesign === `user:${t.id}`
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                  )}
                >
                  <Layout className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="text-xs font-medium truncate">{t.name}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Start with ──────────────────────── */}
          <section>
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1 mb-2">Start with</p>
            <div className="space-y-0.5">
              {Object.entries(CONTENT_TEMPLATES).map(([key, t]) => (
                <button
                  key={key}
                  onClick={() => applyContentTemplate(key)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-all group"
                >
                  <t.icon className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-blue-500 transition-colors" />
                  <span className="text-xs truncate">{t.label}</span>
                </button>
              ))}
              <button
                onClick={() => { setHtml("<p></p>"); setTimeout(() => rebuildPreview(), 0); }}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-all group"
              >
                <FileCode className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-blue-500 transition-colors" />
                <span className="text-xs">Blank</span>
              </button>
            </div>
          </section>

          {/* ── Drafts ──────────────────────────── */}
          {drafts.length > 0 && (
            <section>
              <button
                onClick={() => setShowDrafts(!showDrafts)}
                className="w-full flex items-center justify-between px-1 mb-2 group"
              >
                <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
                  Drafts ({drafts.length})
                </p>
                <ChevronDown className={cn("h-3 w-3 text-slate-400 transition-transform", showDrafts && "rotate-180")} />
              </button>
              {showDrafts && (
                <div className="space-y-0.5">
                  {drafts.map(d => (
                    <div
                      key={d.id}
                      onClick={() => doLoadDraft(d)}
                      className={cn(
                        "flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer group transition-colors",
                        draftId === d.id
                          ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                      )}
                    >
                      <Clock className="h-3 w-3 shrink-0 mt-0.5 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{d.subject || "(No subject)"}</p>
                        <p className="text-[10px] text-slate-400 truncate">{d.toEmail || "No recipient"}</p>
                      </div>
                      <button onClick={e => doDeleteDraft(d.id, e)} className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500 transition-all shrink-0">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── My Templates ──────────────────────── */}
          {emailTemplates.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1 mb-2">My Templates</p>
              <div className="space-y-0.5">
                {emailTemplates.map(t => (
                  <div key={t.id} className="group rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors px-2 py-2">
                    {renamingTemplateId === t.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text" value={renameValue} onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") doRenameEmailTemplate(t.id); if (e.key === "Escape") setRenamingTemplateId(null); }}
                          autoFocus
                          className="flex-1 text-xs px-1.5 py-0.5 rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                        />
                        <button onClick={() => doRenameEmailTemplate(t.id)} className="p-0.5 text-blue-500 hover:text-blue-700 shrink-0">
                          <Save className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => doUseEmailTemplate(t)} className="flex items-center gap-2 text-left w-full">
                          <BookMarked className="h-3 w-3 shrink-0 text-blue-400" />
                          <span className="text-xs font-medium truncate text-slate-700 dark:text-slate-300">{t.name}</span>
                        </button>
                        {t.subject && <p className="text-[10px] text-slate-400 truncate pl-5 mt-0.5">{t.subject}</p>}
                        <p className="text-[10px] text-slate-300 dark:text-slate-600 pl-5 mt-0.5">
                          {new Date(t.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                        <div className="hidden group-hover:flex items-center gap-1 mt-1 pl-5 flex-wrap">
                          <button onClick={() => doUseEmailTemplate(t)} className="text-[10px] text-blue-500 hover:text-blue-700 font-medium transition-colors">Use</button>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <button onClick={() => { setRenamingTemplateId(t.id); setRenameValue(t.name); }} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">Rename</button>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <button onClick={e => doDuplicateEmailTemplate(t.id, e)} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">Duplicate</button>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <button onClick={e => doDeleteEmailTemplate(t.id, e)} className="text-[10px] text-red-400 hover:text-red-600 transition-colors">Delete</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      </aside>

      {/* ════════════ MAIN COMPOSE AREA ════════════ */}
      <div className="flex-1 min-w-0 flex flex-col bg-slate-50 dark:bg-[#0c0e12] overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shrink-0">
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform duration-200", sidebarCollapsed && "rotate-180")} />
          </button>

          <Link href="/">
            <button className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
          </Link>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />

          <div className="flex items-center gap-2">
            <PenLine className="h-3.5 w-3.5 text-slate-400" />
            <h1 className="text-sm font-semibold text-slate-800 dark:text-white">Compose</h1>
          </div>

          {draftId && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium border border-amber-200 dark:border-amber-800">
              Draft saved
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={() => { rebuildPreview(); setShowPreviewModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <button
            onClick={doSendTest}
            disabled={sendingTest}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
          >
            {sendingTest ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
            Send Test
          </button>
          <button
            onClick={doSaveDraft}
            disabled={savingDraft}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
          >
            {savingDraft ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
          <button
            onClick={() => { setTemplateName(subject ? `${subject.substring(0, 30)}` : ""); setShowSaveTemplateModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <BookMarked className="h-3 w-3" />
            Save as Template
          </button>
          <button
            onClick={doSend}
            disabled={sending}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white transition-colors disabled:opacity-40 shadow-sm"
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send Email
          </button>
        </div>

        {/* Scrollable compose area */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[1120px] mx-auto px-6 py-6">

            {/* ── Compose card ── */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200/70 dark:border-slate-700/60 overflow-visible">

              {/* From row */}
              <div className="flex items-center px-8 py-4 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-xs text-slate-400 w-16 shrink-0 font-medium tracking-wide">From</span>
                <div className="relative flex-1">
                  <select
                    value={mailboxId}
                    onChange={e => { const v = e.target.value; setMailboxId(v); setMailboxType(v === "gmail" ? "gmail" : "smtp"); }}
                    className="w-full text-sm bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none appearance-none pr-6 cursor-pointer"
                  >
                    {mailboxes.map(mb => (
                      <option key={mb.id} value={String(mb.id)}>
                        {mb.fromName ? `${mb.fromName} <${mb.smtpUser}>` : mb.smtpUser}
                      </option>
                    ))}
                    {gmailConnected && (
                      <option value="gmail">
                        {gmailEmail
                          ? `Gmail — ${gmailEmail}`
                          : "Gmail — (reconnect to refresh address)"}
                      </option>
                    )}
                    {mailboxes.length === 0 && !gmailConnected && <option value="">No mailboxes configured</option>}
                  </select>
                  <ChevronDown className="h-3 w-3 text-slate-400 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                {mailboxes.length === 0 && !gmailConnected && (
                  <Link href="/mailbox" className="text-[11px] text-blue-500 hover:text-blue-700 shrink-0 ml-2 transition-colors">
                    Configure →
                  </Link>
                )}
              </div>

              {/* To row */}
              <div className="flex items-center px-8 py-4 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-xs text-slate-400 w-16 shrink-0 font-medium tracking-wide">To</span>
                <input
                  type="email" value={to} onChange={e => setTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="flex-1 text-sm bg-transparent text-slate-800 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none"
                />
                <div className="flex items-center gap-1 shrink-0">
                  {!showCc  && <button onClick={() => setShowCc(true)}  className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors">Cc</button>}
                  {!showBcc && <button onClick={() => setShowBcc(true)} className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors">Bcc</button>}
                </div>
              </div>

              {showCc && (
                <div className="flex items-center px-8 py-4 border-b border-slate-100 dark:border-slate-800/60">
                  <span className="text-xs text-slate-400 w-16 shrink-0 font-medium tracking-wide">Cc</span>
                  <input type="text" value={cc} onChange={e => setCc(e.target.value)} placeholder="cc@example.com"
                    className="flex-1 text-sm bg-transparent text-slate-800 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none" />
                  <button onClick={() => { setShowCc(false); setCc(""); }} className="text-slate-300 hover:text-slate-500 transition-colors shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {showBcc && (
                <div className="flex items-center px-8 py-4 border-b border-slate-100 dark:border-slate-800/60">
                  <span className="text-xs text-slate-400 w-16 shrink-0 font-medium tracking-wide">Bcc</span>
                  <input type="text" value={bcc} onChange={e => setBcc(e.target.value)} placeholder="bcc@example.com"
                    className="flex-1 text-sm bg-transparent text-slate-800 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none" />
                  <button onClick={() => { setShowBcc(false); setBcc(""); }} className="text-slate-300 hover:text-slate-500 transition-colors shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Subject row */}
              <div className="flex items-center px-8 py-4 border-b border-slate-100 dark:border-slate-800">
                <span className="text-xs text-slate-400 w-16 shrink-0 font-medium tracking-wide">Subject</span>
                <input
                  type="text" value={subject} onChange={e => setSubject(e.target.value)}
                  placeholder="Email subject…"
                  className="flex-1 text-sm font-semibold bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none"
                />
              </div>

              {/* Minimal toolbar */}
              <div className="flex items-center gap-0.5 px-5 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 flex-wrap">
                <TBtn onClick={() => exec("bold")}      title="Bold"><Bold className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("italic")}    title="Italic"><Italic className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("underline")} title="Underline"><Underline className="h-3.5 w-3.5" /></TBtn>

                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

                <TBtn onClick={() => exec("insertUnorderedList")} title="Bullet list"><List className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("insertOrderedList")}   title="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></TBtn>

                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

                <TBtn onClick={() => exec("justifyLeft")}   title="Align left"><AlignLeft className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("justifyCenter")} title="Center"><AlignCenter className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("justifyRight")}  title="Align right"><AlignRight className="h-3.5 w-3.5" /></TBtn>

                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

                {/* Link button with popover */}
                <div className="relative">
                  <TBtn onClick={insertLink} title="Insert link"><Link2 className="h-3.5 w-3.5" /></TBtn>
                  {showLinkDialog && (
                    <>
                      <div className="fixed inset-0 z-40" onMouseDown={() => setShowLinkDialog(false)} />
                      <div
                        ref={linkDialogRef}
                        className="absolute top-full left-0 mt-1.5 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl p-4 w-72"
                        onMouseDown={e => e.stopPropagation()}
                      >
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                          {linkIsEdit ? "Edit Link" : "Insert Link"}
                        </p>
                        <input
                          ref={linkInputRef}
                          type="url"
                          value={linkUrl}
                          onChange={e => setLinkUrl(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") setShowLinkDialog(false); }}
                          placeholder="https://example.com"
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                        />
                        <label className="flex items-center gap-2 mb-4 cursor-pointer select-none group">
                          <input type="checkbox" checked={linkNewTab} onChange={e => setLinkNewTab(e.target.checked)} className="w-3.5 h-3.5 rounded accent-blue-600" />
                          <span className="text-xs text-slate-600 dark:text-slate-300">Open in new tab</span>
                        </label>
                        <div className="flex items-center justify-between gap-2">
                          {linkIsEdit && (
                            <button type="button" onMouseDown={e => { e.preventDefault(); removeLink(); }}
                              className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors px-1">
                              Remove link
                            </button>
                          )}
                          <div className={cn("flex items-center gap-2", !linkIsEdit && "ml-auto")}>
                            <button type="button" onMouseDown={e => { e.preventDefault(); setShowLinkDialog(false); }}
                              className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 rounded-lg border border-transparent hover:border-slate-200 transition-all">
                              Cancel
                            </button>
                            <button type="button" onMouseDown={e => { e.preventDefault(); applyLink(); }}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <TBtn onClick={insertImage} title="Insert image"><ImageIcon className="h-3.5 w-3.5" /></TBtn>
                <TBtn onClick={() => exec("removeFormat")} title="Clear formatting"><Minus className="h-3.5 w-3.5" /></TBtn>

                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

                {/* More dropdown */}
                <div className="relative">
                  <TBtn onClick={() => setShowMoreToolbar(!showMoreToolbar)} title="More formatting" active={showMoreToolbar}>
                    <span className="text-[10px] font-semibold leading-none">More</span>
                    <ChevronDown className={cn("h-3 w-3 ml-0.5 transition-transform", showMoreToolbar && "rotate-180")} />
                  </TBtn>
                  {showMoreToolbar && (
                    <>
                      <div className="fixed inset-0 z-20" onMouseDown={() => setShowMoreToolbar(false)} />
                      <div className="absolute top-full left-0 mt-1 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-xl p-2 w-44"
                        onMouseDown={e => e.stopPropagation()}>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-2 mb-1">Size</p>
                        {FONT_SIZES.map(s => (
                          <button key={s.value} onMouseDown={e => { e.preventDefault(); exec("fontSize", s.value); setShowMoreToolbar(false); }}
                            className="w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                            <Type className="h-3 w-3 text-slate-400" />{s.label}
                          </button>
                        ))}
                        <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                        <button onMouseDown={e => { e.preventDefault(); exec("strikeThrough"); setShowMoreToolbar(false); }}
                          className="w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                          <Strikethrough className="h-3 w-3 text-slate-400" />Strikethrough
                        </button>
                        <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-2 mb-1">Color</p>
                        <div className="grid grid-cols-6 gap-1 px-2 pb-1">
                          {COLORS.map(c => (
                            <button key={c} onMouseDown={e => { e.preventDefault(); exec("foreColor", c); setShowMoreToolbar(false); }}
                              className="w-4 h-4 rounded border border-slate-300 dark:border-slate-600 hover:scale-110 transition-transform"
                              style={{ background: c }} />
                          ))}
                        </div>
                        <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                        <button onMouseDown={e => { e.preventDefault(); insertButton(); setShowMoreToolbar(false); }}
                          className="w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                          <Mail className="h-3 w-3 text-slate-400" />Insert Button
                        </button>
                        <button onMouseDown={e => { e.preventDefault(); exec("insertHorizontalRule"); setShowMoreToolbar(false); }}
                          className="w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                          <Minus className="h-3 w-3 text-slate-400" />Divider Line
                        </button>
                        <button onMouseDown={e => { e.preventDefault(); toggleHtmlMode(); setShowMoreToolbar(false); }}
                          className="w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                          <Code2 className="h-3 w-3 text-slate-400" />HTML Source
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Editor body */}
              {htmlSourceMode ? (
                <textarea
                  value={htmlSource}
                  onChange={e => { setHtmlSource(e.target.value); setTimeout(() => rebuildPreview(), 0); }}
                  className="w-full px-8 py-6 min-h-[480px] font-mono text-xs bg-slate-900 text-green-400 focus:outline-none resize-none"
                  placeholder="<p>Your HTML here...</p>"
                />
              ) : (
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={onEditorInput}
                  onClick={handleEditorClick}
                  className="w-full px-8 py-6 min-h-[480px] text-[15px] text-slate-800 dark:text-slate-200 focus:outline-none"
                  style={{ lineHeight: "1.85" }}
                />
              )}

              {/* Attachment chips */}
              {attachments.length > 0 && (
                <div className="px-8 py-3.5 border-t border-slate-100 dark:border-slate-800/60 flex flex-wrap gap-2">
                  {attachments.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 pl-3 pr-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-xs text-slate-700 dark:text-slate-300 max-w-[200px]">
                      {fileIcon(f.name)}
                      <span className="truncate font-medium">{f.name}</span>
                      <span className="text-slate-400 shrink-0 text-[10px]">{fmtSize(f.size)}</span>
                      <button
                        onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                        className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Bottom bar */}
              <div className="flex items-center justify-between px-8 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 rounded-b-xl">
                <div className="flex items-center gap-1">
                  {/* Attachment file picker */}
                  <input
                    type="file" multiple ref={fileInputRef} className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.zip,.png,.jpg,.jpeg,.gif,.webp"
                    onChange={e => { handleAttachmentFiles(e.target.files); e.target.value = ""; }}
                  />
                  {/* Image file picker (for inline insertion) */}
                  <input
                    type="file" ref={imageInputRef} className="hidden"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/jpg"
                    onChange={handleImageFile}
                  />
                  {/* Image replace picker (for image toolbar Replace action) */}
                  <input
                    type="file" ref={imgReplaceRef} className="hidden"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/jpg"
                    onChange={replaceImgFile}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAttachment}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors font-medium disabled:opacity-50"
                  >
                    {uploadingAttachment
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Paperclip className="h-3.5 w-3.5" />}
                    {uploadingAttachment ? "Uploading…" : "Attach"}
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    <input type="checkbox" checked={includeBranding} onChange={e => setIncludeBranding(e.target.checked)} className="w-3 h-3 rounded accent-blue-600" />
                    Branding
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    <input type="checkbox" checked={trackOpen} onChange={e => setTrackOpen(e.target.checked)} className="w-3 h-3 rounded accent-blue-600" />
                    Track opens
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    <input type="checkbox" checked={trackClick} onChange={e => setTrackClick(e.target.checked)} className="w-3 h-3 rounded accent-blue-600" />
                    Track clicks
                  </label>
                </div>
              </div>

            </div>

          </div>
        </div>

      </div>
    </div>

    {/* ════ PREVIEW MODAL ════ */}
    {showPreviewModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={() => setShowPreviewModal(false)}>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Email Preview</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium">Exact rendering</span>
            </div>
            <button onClick={() => setShowPreviewModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 shrink-0 space-y-1.5">
            <div className="flex items-baseline gap-3">
              <span className="text-[11px] font-medium text-slate-400 w-16 shrink-0">Subject</span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{subject || "(No subject)"}</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[11px] font-medium text-slate-400 w-16 shrink-0">To</span>
              <span className="text-sm text-slate-600 dark:text-slate-300 truncate">{to || "(No recipient)"}</span>
            </div>
            {attachments.length > 0 && (
              <div className="flex items-start gap-3">
                <span className="text-[11px] font-medium text-slate-400 w-16 shrink-0 pt-0.5">Attached</span>
                <div className="flex flex-wrap gap-1">
                  {attachments.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded-full text-slate-600 dark:text-slate-300">
                      <Paperclip className="h-2.5 w-2.5" />{a.name} · {fmtSize(a.size)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden bg-slate-100 dark:bg-slate-950">
            <iframe
              srcDoc={previewHtml}
              className="w-full border-0"
              title="Email Preview"
              sandbox="allow-same-origin"
              style={{ minHeight: "420px", height: "100%" }}
            />
          </div>
        </div>
      </div>
    )}

    {/* ════ SAVE AS TEMPLATE MODAL ════ */}
    {showSaveTemplateModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={() => setShowSaveTemplateModal(false)}>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <BookMarked className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Save as Template</h3>
            </div>
            <button onClick={() => setShowSaveTemplateModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Template Name</label>
              <input
                type="text" value={templateName} onChange={e => setTemplateName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") doSaveAsTemplate(); if (e.key === "Escape") setShowSaveTemplateModal(false); }}
                placeholder="e.g. Vehicle Quote — Standard"
                autoFocus
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">Saves the current <strong>subject, body, design theme,</strong> and <strong>branding setting.</strong> Does not save recipient, CC/BCC, attachments, or tracking.</p>
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20">
            <button onClick={() => setShowSaveTemplateModal(false)} className="px-4 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-all">
              Cancel
            </button>
            <button onClick={doSaveAsTemplate} disabled={savingTemplate || !templateName.trim()} className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40">
              {savingTemplate ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save Template
            </button>
          </div>
        </div>
      </div>
    )}
    {/* ════ FLOATING IMAGE TOOLBAR ════ */}
    {selectedImg && imgToolbarPos && (
      <div
        className="fixed z-[9999] flex items-center gap-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl px-2 py-1.5"
        style={{ top: imgToolbarPos.top, left: imgToolbarPos.left }}
        onMouseDown={e => e.preventDefault()}
      >
        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider px-1 hidden sm:inline">Size</span>
        {([25, 50, 75, 100] as const).map(pct => (
          <button key={pct} onMouseDown={e => { e.preventDefault(); resizeImg(pct); }}
            className="px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors">
            {pct}%
          </button>
        ))}

        <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-1" />

        <button onMouseDown={e => { e.preventDefault(); alignImg("left"); }} title="Align left"
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors">
          <AlignLeft className="h-3.5 w-3.5" />
        </button>
        <button onMouseDown={e => { e.preventDefault(); alignImg("center"); }} title="Align center"
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors">
          <AlignCenter className="h-3.5 w-3.5" />
        </button>
        <button onMouseDown={e => { e.preventDefault(); alignImg("right"); }} title="Align right"
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors">
          <AlignRight className="h-3.5 w-3.5" />
        </button>

        <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-1" />

        <button onMouseDown={e => { e.preventDefault(); imgReplaceRef.current?.click(); }} title="Replace image"
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors">
          <ImageIcon className="h-3.5 w-3.5" />
        </button>
        <button onMouseDown={e => { e.preventDefault(); editImgAlt(); }} title="Edit alt text"
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors">
          <Type className="h-3.5 w-3.5" />
        </button>
        <button onMouseDown={e => { e.preventDefault(); removeImg(); }} title="Remove image"
          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 hover:text-red-600 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    )}
    </>
  );
}

