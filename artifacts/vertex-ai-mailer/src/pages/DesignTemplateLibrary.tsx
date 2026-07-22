import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  Plus, Pencil, Trash2, Copy, Eye, X, Save, Loader2, Layout,
  ArrowLeft, FileCode, CheckCircle2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
const apiUrl = (p: string) => `${BASE}/api/${p}`;
const apiFetch = (p: string, init?: RequestInit) => fetch(apiUrl(p), { credentials: "include", ...init });
const apiPost = (p: string, body: unknown) => apiFetch(p, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const apiPut = (p: string, body: unknown) => apiFetch(p, {
  method: "POST", headers: { "Content-Type": "application/json", "X-HTTP-Method-Override": "PUT" }, body: JSON.stringify(body),
});
const apiDel = (p: string) => apiFetch(p, { method: "POST", headers: { "X-HTTP-Method-Override": "DELETE" } });

const DEFAULT_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; padding: 0; background: #f1f5f9; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 20px 0; }
    .card { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #2563eb; padding: 24px 32px; }
    .header-title { color: #fff; font-size: 22px; font-weight: 700; margin: 0; }
    .body { padding: 32px; color: #1e293b; line-height: 1.7; font-size: 15px; }
    a { color: #2563eb; }
    p { margin: 0 0 16px; }
    ul, ol { padding-left: 20px; margin: 0 0 16px; }
    .footer { padding: 20px 32px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1 class="header-title">{{company_name}}</h1>
      </div>
      <div class="body">
        {{content}}
      </div>
      <div class="footer">
        {{branding_footer}}
      </div>
    </div>
  </div>
</body>
</html>`;

type DesignTemplate = {
  id: number;
  name: string;
  description: string | null;
  htmlLayout: string;
  createdAt: string;
  updatedAt: string;
};

type ModalMode = "create" | "edit" | "preview" | null;

export default function DesignTemplateLibrary() {
  const { toast } = useToast();
  const [templates, setTemplates]   = useState<DesignTemplate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [modalMode, setModalMode]   = useState<ModalMode>(null);
  const [selected, setSelected]     = useState<DesignTemplate | null>(null);

  const [formName, setFormName]         = useState("");
  const [formDesc, setFormDesc]         = useState("");
  const [formHtml, setFormHtml]         = useState(DEFAULT_HTML);
  const [saving, setSaving]             = useState(false);
  const [previewTab, setPreviewTab]     = useState<"desktop" | "mobile">("desktop");

  const loadTemplates = useCallback(async () => {
    try {
      const r = await apiFetch("composer/design-templates");
      if (r.ok) setTemplates(await r.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const openCreate = () => {
    setFormName(""); setFormDesc(""); setFormHtml(DEFAULT_HTML);
    setSelected(null);
    setModalMode("create");
  };

  const openEdit = (t: DesignTemplate) => {
    setFormName(t.name); setFormDesc(t.description ?? ""); setFormHtml(t.htmlLayout);
    setSelected(t);
    setModalMode("edit");
  };

  const openPreview = (t: DesignTemplate) => {
    setSelected(t);
    setPreviewTab("desktop");
    setModalMode("preview");
  };

  const closeModal = () => { setModalMode(null); setSelected(null); };

  const doSave = async () => {
    if (!formName.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (!formHtml.trim()) { toast({ title: "HTML layout required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = { name: formName.trim(), description: formDesc.trim(), htmlLayout: formHtml };
      const r = selected
        ? await apiPut(`composer/design-templates/${selected.id}`, payload)
        : await apiPost("composer/design-templates", payload);
      if (!r.ok) throw new Error((await r.json()).error || "Failed to save");
      toast({ title: selected ? "Template updated" : "Template created" });
      closeModal();
      await loadTemplates();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const doDuplicate = async (t: DesignTemplate) => {
    try {
      const r = await apiPost(`composer/design-templates/${t.id}/duplicate`, {});
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast({ title: "Template duplicated" });
      await loadTemplates();
    } catch (e: any) {
      toast({ title: "Duplicate failed", description: e.message, variant: "destructive" });
    }
  };

  const doDelete = async (t: DesignTemplate) => {
    if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    try {
      await apiDel(`composer/design-templates/${t.id}`);
      toast({ title: "Template deleted" });
      await loadTemplates();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const samplePreviewHtml = (htmlLayout: string) => {
    const sampleContent = `<p>Hello Sarah,</p>
<p>Thank you for requesting an auto transport quote. We're pleased to offer you our competitive pricing for your 2022 Tesla Model 3.</p>
<ul>
  <li><strong>Pickup:</strong> Los Angeles, CA</li>
  <li><strong>Delivery:</strong> New York, NY</li>
  <li><strong>Estimated Price:</strong> $1,250</li>
  <li><strong>Transit Time:</strong> 7–10 business days</li>
</ul>
<p>This quote is valid for 7 days. Please reply to book!</p>`;
    const sampleBranding = `<div style="font-size:13px;color:#64748b;line-height:1.8;">
      <strong style="color:#1e293b;">Jane Smith</strong><br>
      BrokerMAIL Auto Transport<br>
      📞 (555) 123-4567<br>
      <a href="https://getbrokermail.com" style="color:#2563eb;">getbrokermail.com</a>
    </div>`;
    return htmlLayout
      .replace("{{content}}", sampleContent)
      .replace("{{branding_footer}}", sampleBranding)
      .replace("{{company_name}}", "BrokerMAIL Auto Transport");
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/compose">
            <button className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Layout className="h-5 w-5 text-violet-500" />
              Design Template Library
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              HTML layout wrappers that style your email content — separate from campaign message templates.
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800 rounded-xl text-sm text-violet-700 dark:text-violet-300">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <strong>Design templates</strong> control the HTML structure and visual styling of your emails (headers, colors, layout).
          Use <code className="bg-violet-100 dark:bg-violet-800/50 px-1 rounded text-xs">{"{{content}}"}</code> where the email body goes,
          <code className="bg-violet-100 dark:bg-violet-800/50 px-1 rounded text-xs ml-1">{"{{branding_footer}}"}</code> for your signature, and
          <code className="bg-violet-100 dark:bg-violet-800/50 px-1 rounded text-xs ml-1">{"{{company_name}}"}</code> for your company name.
        </div>
      </div>

      {/* Template Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
            <Layout className="h-8 w-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">No design templates yet</h3>
          <p className="text-sm text-slate-400 mb-4">Create your first HTML email layout template.</p>
          <Button onClick={openCreate} className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
            <Plus className="h-4 w-4" /> Create Template
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(t => (
            <div
              key={t.id}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm hover:shadow-md transition-shadow group"
            >
              {/* Mini preview */}
              <div
                className="h-36 bg-slate-50 dark:bg-slate-900 overflow-hidden cursor-pointer relative"
                onClick={() => openPreview(t)}
              >
                <iframe
                  srcDoc={samplePreviewHtml(t.htmlLayout)}
                  sandbox="allow-same-origin"
                  title={t.name}
                  style={{ width: "200%", height: "200%", border: "none", transformOrigin: "top left", transform: "scale(0.5)", pointerEvents: "none" }}
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                  <span className="bg-white/90 text-slate-800 text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" /> Preview
                  </span>
                </div>
              </div>
              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm truncate">{t.name}</h3>
                    {t.description && (
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{t.description}</p>
                    )}
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                </div>
                <div className="flex items-center gap-1 mt-3">
                  <button
                    onClick={() => openEdit(t)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => doDuplicate(t)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" /> Duplicate
                  </button>
                  <button
                    onClick={() => doDelete(t)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-auto"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {(modalMode === "create" || modalMode === "edit") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {modalMode === "create" ? "Create Design Template" : "Edit Design Template"}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Template Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. Corporate Blue"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Description <span className="normal-case font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    placeholder="Brief description of this layout"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">HTML Layout</label>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <FileCode className="h-3.5 w-3.5" />
                    Use <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">{"{{content}}"}</code>
                    <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">{"{{branding_footer}}"}</code>
                    <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">{"{{company_name}}"}</code>
                  </div>
                </div>
                <textarea
                  value={formHtml}
                  onChange={e => setFormHtml(e.target.value)}
                  className="w-full font-mono text-xs bg-slate-950 text-emerald-400 border border-slate-700 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none"
                  style={{ minHeight: 320 }}
                  placeholder="Paste your full HTML email layout here…"
                />
              </div>
              {formHtml && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Live Preview</p>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 p-2">
                    <iframe
                      srcDoc={samplePreviewHtml(formHtml)}
                      sandbox="allow-same-origin"
                      title="Preview"
                      style={{ width: "100%", minHeight: 280, border: "none", borderRadius: 8, background: "white", display: "block" }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <Button variant="outline" onClick={closeModal}>Cancel</Button>
              <Button onClick={doSave} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {modalMode === "create" ? "Create Template" : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {modalMode === "preview" && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{selected.name}</h2>
                {selected.description && <p className="text-sm text-slate-400">{selected.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                  {(["desktop", "mobile"] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setPreviewTab(m)}
                      className={cn(
                        "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                        previewTab === m ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500"
                      )}
                    >
                      {m === "desktop" ? "Desktop" : "Mobile"}
                    </button>
                  ))}
                </div>
                <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-2">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className={cn("flex-1 overflow-auto bg-slate-100 dark:bg-slate-900 p-4", previewTab === "mobile" && "flex justify-center")}>
              <iframe
                srcDoc={samplePreviewHtml(selected.htmlLayout)}
                sandbox="allow-same-origin"
                title="Preview"
                style={{
                  width:         previewTab === "mobile" ? 375 : "100%",
                  minHeight:     480,
                  border:        "none",
                  borderRadius:  8,
                  background:    "white",
                  display:       "block",
                  boxShadow:     "0 2px 16px rgba(0,0,0,0.1)",
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <Button variant="outline" onClick={() => openEdit(selected)}>
                <Pencil className="h-4 w-4 mr-1.5" /> Edit Template
              </Button>
              <Button variant="outline" onClick={closeModal}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
