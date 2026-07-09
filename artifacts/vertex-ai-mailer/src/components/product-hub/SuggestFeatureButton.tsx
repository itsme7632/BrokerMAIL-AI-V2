import { useState } from "react";
import { Lightbulb, X, Loader2, CheckCircle2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

function getAuthHeaders(isJson = false) {
  const t = localStorage.getItem("auth_token");
  const h: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {};
  if (isJson) h["Content-Type"] = "application/json";
  return h;
}

function getBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Edg"))     return "Edge";
  if (ua.includes("Chrome"))  return "Chrome";
  if (ua.includes("Safari"))  return "Safari";
  return ua.slice(0, 60);
}

function getOS() {
  const ua = navigator.userAgent;
  if (ua.includes("Win"))     return "Windows";
  if (ua.includes("Mac"))     return "macOS";
  if (ua.includes("Linux"))   return "Linux";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  return "Unknown";
}

const CATEGORIES = [
  "general", "email-sending", "campaigns", "templates",
  "gmail", "analytics", "ai-features", "automation", "ui-ux", "integrations", "other",
];

const IMPACTS = [
  { key: "low",    label: "Nice to have" },
  { key: "medium", label: "Would help my workflow" },
  { key: "high",   label: "Blocking my work" },
];

export function SuggestFeatureButton() {
  const [open, setOpen]               = useState(false);
  const [title, setTitle]             = useState("");
  const [description, setDesc]        = useState("");
  const [category, setCategory]       = useState("general");
  const [businessImpact, setImpact]   = useState("");
  const [screenshotUrl, setScreenshot] = useState<string | null>(null);
  const [uploading, setUploading]     = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]               = useState(false);
  const [location]                    = useLocation();
  const { toast }                     = useToast();

  function reset() {
    setTitle(""); setDesc(""); setCategory("general"); setImpact(""); setScreenshot(null); setDone(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/product-hub/bug-reports/upload", { method: "POST", headers: getAuthHeaders(), body: fd });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setScreenshot(data.url);
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast({ title: "Title and description are required", variant: "destructive" }); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/product-hub/feature-requests", {
        method: "POST",
        headers: getAuthHeaders(true),
        body: JSON.stringify({
          title: title.trim(), description: description.trim(),
          category, businessImpact,
          screenshotUrl, currentPage: location,
          browser: getBrowser(), os: getOS(),
        }),
      });
      if (!res.ok) throw new Error();
      setDone(true);
    } catch {
      toast({ title: "Failed to submit", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => { setOpen(true); reset(); }}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-semibold shadow-lg hover:shadow-xl hover:from-indigo-700 hover:to-violet-700 transition-all duration-200 group"
        title="Suggest a Feature"
      >
        <Lightbulb className="h-4 w-4 group-hover:rotate-12 transition-transform" />
        <span className="hidden sm:inline">Suggest a Feature</span>
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                  <Lightbulb className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">Suggest a Feature</p>
                  <p className="text-xs text-slate-400">Your idea goes directly to our team</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {done ? (
              <div className="flex flex-col items-center gap-4 py-12 px-6 text-center">
                <div className="h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                </div>
                <div>
                  <p className="font-bold text-slate-900">Thank you!</p>
                  <p className="text-sm text-slate-500 mt-1">Your feature request has been submitted. We'll review it soon.</p>
                </div>
                <Button className="rounded-xl" onClick={() => setOpen(false)}>Done</Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* Title */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-slate-700">Feature Title <span className="text-red-500">*</span></Label>
                    <Input value={title} onChange={e => setTitle(e.target.value)}
                      placeholder="e.g. Bulk schedule campaigns" className="rounded-xl" maxLength={200} />
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-slate-700">Description <span className="text-red-500">*</span></Label>
                    <Textarea value={description} onChange={e => setDesc(e.target.value)}
                      placeholder="Describe the feature and how it would help you…"
                      className="rounded-xl min-h-[100px] resize-none" maxLength={3000} />
                  </div>

                  {/* Category */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-slate-700">Category</Label>
                    <select value={category} onChange={e => setCategory(e.target.value)}
                      className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300">
                      {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c.replace(/-/g, " ")}</option>)}
                    </select>
                  </div>

                  {/* Business impact */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-slate-700">Business Impact</Label>
                    <div className="flex gap-2 flex-wrap">
                      {IMPACTS.map(i => (
                        <button key={i.key} type="button" onClick={() => setImpact(i.key)}
                          className={cn("px-3 py-1.5 rounded-xl border text-xs font-medium transition-all",
                            businessImpact === i.key
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : "bg-white text-slate-600 border-slate-200 hover:border-slate-300")}>
                          {i.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Screenshot */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-slate-700">Screenshot (optional)</Label>
                    {screenshotUrl ? (
                      <div className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50">
                        <img src={screenshotUrl} alt="screenshot" className="h-10 w-10 object-cover rounded-lg" />
                        <span className="text-xs text-slate-600 flex-1 truncate">Screenshot attached</span>
                        <button type="button" onClick={() => setScreenshot(null)}><X className="h-4 w-4 text-slate-400 hover:text-red-500" /></button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 p-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition-all cursor-pointer text-slate-400 hover:text-blue-500">
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        <span className="text-xs">{uploading ? "Uploading…" : "Click to upload screenshot"}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                      </label>
                    )}
                  </div>

                  <p className="text-xs text-slate-400">
                    Submitting from: <span className="font-mono">{location}</span> · {getBrowser()} · {getOS()}
                  </p>
                </div>

                {/* Footer */}
                <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
                  <Button type="button" variant="outline" className="flex-1 rounded-xl" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" className="flex-1 rounded-xl gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 border-0" disabled={submitting}>
                    {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</> : "Submit Idea"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
