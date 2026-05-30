import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetTemplate,
  useUpdateTemplate,
  getGetTemplateQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Loader2, Eye, Code2, Plus, Trash2, MousePointerClick } from "lucide-react";

// Lead variables only — branding is applied automatically from Settings
const CHIPS = [
  "{name}", "{email}", "{vehicle}", "{pickup}", "{delivery}",
  "{price}", "{route}", "{quote_id}", "{agent_name}", "{notes}",
];

const CTA_URL_VARS = [
  { value: "booking_link", label: "Booking URL" },
  { value: "quote_link",   label: "Quote URL"   },
  { value: "website_link", label: "Website URL"  },
  { value: "phone_link",   label: "Phone"        },
] as const;

const CTA_COLORS = [
  { value: "#1d4ed8", label: "Blue"   },
  { value: "#16a34a", label: "Green"  },
  { value: "#dc2626", label: "Red"    },
  { value: "#7c3aed", label: "Purple" },
  { value: "#0f172a", label: "Black"  },
  { value: "#d97706", label: "Amber"  },
] as const;

interface CtaButton {
  id:          string;
  text:        string;
  color:       string;
  size:        "sm" | "md" | "lg";
  urlVariable: string;
  directUrl?:  string;
}

// Generic sample data — NO hardcoded company names
const SAMPLE_ROW: Record<string, string> = {
  name:         "Alex Johnson",
  email:        "alex@example.com",
  vehicle:      "2023 Tesla Model Y",
  pickup:       "Miami, FL",
  delivery:     "Seattle, WA",
  price:        "$1,250",
  route:        "FL → WA",
  quote_id:     "QT-10042",
  agent_name:   "Your Name",
  notes:        "Enclosed transport preferred",
  booking_link: "https://book.example.com/reserve",
  quote_link:   "https://quote.example.com/view",
  website_link: "https://example.com",
  phone_link:   "tel:+15555555555",
};

function replaceVariables(text: string, data: Record<string, string>): string {
  return text.replace(/\{([^}]+)\}/g, (match, key) => data[key.trim()] ?? match);
}

export default function TemplateEditor() {
  const [, params] = useRoute("/templates/:id");
  const templateId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: template, isLoading } = useGetTemplate(templateId, {
    query: { enabled: !!templateId, queryKey: getGetTemplateQueryKey(templateId) },
  });

  const [name, setName]             = useState("");
  const [subject, setSubject]       = useState("");
  const [body, setBody]             = useState("");
  const [ctaButtons, setCtaButtons] = useState<CtaButton[]>([]);
  const [previewMode, setPreviewMode] = useState<"text" | "html">("text");

  // HTML preview fetched from server — same pipeline as actual Gmail draft
  const [previewHtml, setPreviewHtml]       = useState<string | null>(null);
  const [previewSubjectLine, setPreviewSubjectLine] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const initializedForId = useRef<number | null>(null);
  useEffect(() => {
    if (template && initializedForId.current !== templateId) {
      initializedForId.current = templateId;
      setName(template.name);
      setSubject(template.subject);
      setBody(template.body);
      try {
        const parsed = template.ctaButtonsJson ? JSON.parse(template.ctaButtonsJson) : [];
        setCtaButtons(Array.isArray(parsed) ? parsed : []);
      } catch { setCtaButtons([]); }
    }
  }, [template, templateId]);

  const updateTemplate = useUpdateTemplate();

  const previewSubject = useMemo(() => replaceVariables(subject, SAMPLE_ROW), [subject]);
  const previewBody    = useMemo(() => replaceVariables(body, SAMPLE_ROW),    [body]);

  // Fetch HTML preview from the server — uses the EXACT same renderer as actual drafts
  const fetchHtmlPreview = useCallback(async (bodyText: string, subjectText: string, buttons: CtaButton[]) => {
    if (!bodyText.trim()) { setPreviewHtml(null); setPreviewSubjectLine(null); return; }
    setIsLoadingPreview(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/drafts/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          body:       bodyText,
          subject:    subjectText,
          row:        SAMPLE_ROW,
          style:      "clean",
          ctaButtons: buttons,
        }),
      });
      if (!res.ok) throw new Error("Preview failed");
      const data = await res.json();
      setPreviewHtml(data.html ?? null);
      setPreviewSubjectLine(data.subject ?? null);
    } catch {
      setPreviewHtml(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }, []);

  // Debounce preview fetching when body/subject/buttons change
  useEffect(() => {
    if (previewMode !== "html") return;
    const timer = setTimeout(() => fetchHtmlPreview(body, subject, ctaButtons), 600);
    return () => clearTimeout(timer);
  }, [body, subject, ctaButtons, previewMode, fetchHtmlPreview]);

  // Fetch preview immediately when switching to HTML tab
  const handleSetPreviewMode = (mode: "text" | "html") => {
    setPreviewMode(mode);
    if (mode === "html") fetchHtmlPreview(body, subject, ctaButtons);
  };

  function addCtaButton() {
    setCtaButtons(prev => [...prev, {
      id: crypto.randomUUID(), text: "Book Now", color: "#1d4ed8", size: "md", urlVariable: "booking_link",
    }]);
  }

  function updateCtaButton(id: string, patch: Partial<CtaButton>) {
    setCtaButtons(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }

  function removeCtaButton(id: string) {
    setCtaButtons(prev => prev.filter(b => b.id !== id));
  }

  const handleSave = () => {
    updateTemplate.mutate(
      { id: templateId, data: { name, subject, body, ctaButtonsJson: ctaButtons.length > 0 ? JSON.stringify(ctaButtons) : null } as any },
      {
        onSuccess: (data) => {
          toast({ title: "Template saved" });
          queryClient.setQueryData(getGetTemplateQueryKey(templateId), data);
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Save failed", description: err.message });
        },
      }
    );
  };

  const insertChip = (chip: string) => setBody(prev => prev + chip);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
        <Link href="/templates" className="hover:text-primary flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back to Templates
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight">Edit Template</h2>
        <Button onClick={handleSave} disabled={updateTemplate.isPending} className="rounded-xl gap-2">
          {updateTemplate.isPending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Save className="h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* ── Left: editor ── */}
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Template Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} className="rounded-xl" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Subject Line</label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} className="rounded-xl" placeholder="e.g. Shipping quote for your {vehicle}" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Body</label>
            <div className="flex gap-1.5 flex-wrap">
              {CHIPS.map(chip => (
                <button
                  key={chip}
                  onClick={() => insertChip(chip)}
                  className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors font-mono"
                >
                  {chip}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              Company name, phone, and logo are applied automatically from your{" "}
              <Link href="/settings" className="text-blue-500 hover:underline">branding settings</Link>.
            </p>
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              className="min-h-[360px] font-mono text-sm rounded-xl resize-none"
              placeholder={"Hi {name},\n\nI can get your {vehicle} shipped from {pickup} to {delivery} for {price}.\n\nLet me know if you'd like to move forward.\n\nBest regards,\n{agent_name}"}
            />
          </div>

          {/* ── CTA Button Builder ── */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <MousePointerClick className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-700">CTA Buttons</span>
                <span className="text-xs text-slate-400">(appear below email body)</span>
              </div>
              <button
                onClick={addCtaButton}
                className="flex items-center gap-1 text-xs bg-blue-600 text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-3 w-3" /> Add Button
              </button>
            </div>
            {ctaButtons.length === 0 ? (
              <div className="px-4 py-5 text-center text-xs text-slate-400">
                No CTA buttons — click <span className="font-medium text-blue-600">Add Button</span> to create one.
                <p className="mt-1 text-slate-300">Buttons link to URLs set when creating the campaign.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {ctaButtons.map((btn, i) => (
                  <div key={btn.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-mono w-4 text-center">{i + 1}</span>
                      <Input
                        value={btn.text}
                        onChange={e => updateCtaButton(btn.id, { text: e.target.value })}
                        placeholder="Button label"
                        className="rounded-xl h-8 text-xs flex-1"
                      />
                      <button onClick={() => removeCtaButton(btn.id)} className="p-1.5 text-red-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="ml-6 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Input
                          value={btn.directUrl ?? ""}
                          onChange={e => updateCtaButton(btn.id, { directUrl: e.target.value || undefined })}
                          placeholder="Fixed URL: https://your-site.com/book"
                          className="rounded-xl h-8 text-xs flex-1"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 whitespace-nowrap">Or use variable:</span>
                        <select
                          value={btn.urlVariable}
                          onChange={e => updateCtaButton(btn.id, { urlVariable: e.target.value })}
                          className="flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          {CTA_URL_VARS.map(v => (
                            <option key={v.value} value={v.value}>{v.label}</option>
                          ))}
                        </select>
                        <select
                          value={btn.color}
                          onChange={e => updateCtaButton(btn.id, { color: e.target.value })}
                          className="w-24 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          {CTA_COLORS.map(c => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                        <select
                          value={btn.size}
                          onChange={e => updateCtaButton(btn.id, { size: e.target.value as "sm" | "md" | "lg" })}
                          className="w-20 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          <option value="sm">Small</option>
                          <option value="md">Medium</option>
                          <option value="lg">Large</option>
                        </select>
                      </div>
                    </div>
                    <div className="ml-6">
                      <span
                        className="inline-block px-4 py-1.5 rounded-lg text-white text-xs font-bold"
                        style={{ backgroundColor: btn.color, fontSize: btn.size === "sm" ? "11px" : btn.size === "lg" ? "15px" : "13px" }}
                      >
                        {btn.text || "Button"}
                      </span>
                      {!btn.directUrl && (
                        <span className="ml-2 text-xs text-slate-400 italic">
                          → links to campaign&apos;s {CTA_URL_VARS.find(v => v.value === btn.urlVariable)?.label ?? btn.urlVariable}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: live preview ── */}
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-sm">
          <div className="h-12 border-b border-slate-100 bg-slate-50/60 px-5 flex items-center gap-2">
            <Eye className="h-4 w-4 text-slate-400" />
            <h3 className="font-semibold text-slate-700 text-sm">Live Preview</h3>
            {isLoadingPreview && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 ml-1" />}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => handleSetPreviewMode("text")}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors ${
                  previewMode === "text"
                    ? "bg-slate-200 text-slate-900 font-medium"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <Code2 className="h-3 w-3" /> Plain
              </button>
              <button
                onClick={() => handleSetPreviewMode("html")}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors ${
                  previewMode === "html"
                    ? "bg-blue-100 text-blue-800 font-medium"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <Eye className="h-3 w-3" /> HTML
              </button>
            </div>
          </div>

          {previewMode === "html" ? (
            <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: "420px" }}>
              {previewSubjectLine && (
                <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
                  <span className="text-xs text-slate-400 font-medium">Subject: </span>
                  <span className="text-xs text-slate-800 font-semibold">{previewSubjectLine}</span>
                </div>
              )}
              {previewHtml ? (
                <iframe
                  srcDoc={previewHtml}
                  title="HTML Email Preview"
                  className="w-full flex-1 border-0"
                  style={{ minHeight: "380px" }}
                  sandbox="allow-same-origin"
                />
              ) : isLoadingPreview ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-sm text-slate-400">Start typing to see a preview</p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 flex-1 space-y-6 bg-white min-h-[300px]">
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
                <span className="font-medium">Sample data:</span>
                <span className="text-blue-600">Alex Johnson · Tesla Model Y · Miami → Seattle · $1,250 · #QT-10042</span>
              </div>

              {subject ? (
                <div>
                  <div className="text-xs text-slate-400 uppercase font-semibold tracking-wider mb-1.5">Subject</div>
                  <div className="font-semibold text-slate-900 text-sm">{previewSubject}</div>
                </div>
              ) : (
                <div className="text-xs text-slate-300 italic">Add a subject line…</div>
              )}

              {body ? (
                <div>
                  <div className="text-xs text-slate-400 uppercase font-semibold tracking-wider mb-1.5">Body</div>
                  <div className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed font-mono bg-slate-50 rounded-xl p-4 border border-slate-100">
                    {previewBody}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-300 italic">Add body text…</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
