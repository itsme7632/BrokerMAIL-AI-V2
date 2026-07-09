import { useState, useRef } from "react";
import { Bug, Upload, X, CheckCircle2, Loader2, Image, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function getAuthHeaders(contentType?: string) {
  const t = localStorage.getItem("auth_token");
  const h: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {};
  if (contentType) h["Content-Type"] = contentType;
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

const SEVERITIES = [
  { key: "low",      label: "Low",      emoji: "🟢", desc: "Minor inconvenience",    color: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  { key: "medium",   label: "Medium",   emoji: "🟡", desc: "Affects my workflow",    color: "border-amber-300 bg-amber-50 text-amber-800"       },
  { key: "high",     label: "High",     emoji: "🔴", desc: "Can't complete tasks",   color: "border-orange-300 bg-orange-50 text-orange-800"    },
  { key: "critical", label: "Critical", emoji: "🚨", desc: "App completely broken",  color: "border-red-400 bg-red-50 text-red-800"             },
];

interface UploadedFile { url: string; name: string; type: string; }

export default function ReportBug() {
  const { toast } = useToast();

  const [form, setForm] = useState({
    title: "", description: "", stepsToReproduce: "", expectedResult: "", actualResult: "",
    severity: "medium",
  });
  const [screenshot, setScreenshot] = useState<UploadedFile | null>(null);
  const [video, setVideo]           = useState<UploadedFile | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]             = useState(false);

  const screenshotRef = useRef<HTMLInputElement>(null);
  const videoRef      = useRef<HTMLInputElement>(null);

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function uploadFile(file: File, setter: (f: UploadedFile | null) => void) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/product-hub/bug-reports/upload", {
        method: "POST", headers: getAuthHeaders(), body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setter(data);
    } catch {
      toast({ title: "Upload failed", description: "Max 50 MB. Images and videos only.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { title, description, stepsToReproduce, expectedResult, actualResult, severity } = form;
    if (!title.trim() || !description.trim() || !stepsToReproduce.trim() || !expectedResult.trim() || !actualResult.trim()) {
      toast({ title: "Please fill in all required fields", variant: "destructive" }); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/product-hub/bug-reports", {
        method: "POST",
        headers: getAuthHeaders("application/json"),
        body: JSON.stringify({
          ...form,
          currentUrl:       window.location.href,
          browser:          getBrowser(),
          os:               getOS(),
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          screenshotUrl:    screenshot?.url,
          videoUrl:         video?.url,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setDone(true);
    } catch {
      toast({ title: "Failed to submit bug report", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-4">
        <div className="flex items-center justify-center h-16 w-16 rounded-full bg-emerald-50 mx-auto">
          <CheckCircle2 className="h-9 w-9 text-emerald-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Bug Report Submitted</h2>
        <p className="text-sm text-slate-500">Our team will investigate and reply to you as soon as possible.</p>
        <Button className="rounded-xl" onClick={() => { setDone(false); setForm({ title: "", description: "", stepsToReproduce: "", expectedResult: "", actualResult: "", severity: "medium" }); setScreenshot(null); setVideo(null); }}>
          Report another bug
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Bug className="h-6 w-6 text-red-500" />Report a Bug</h1>
        <p className="text-sm text-slate-500 mt-0.5">Help us squash bugs faster by giving us as much detail as possible.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5 shadow-sm">

          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-700">Bug Title <span className="text-red-500">*</span></Label>
            <Input value={form.title} onChange={e => set("title", e.target.value)}
              placeholder="Brief, clear description of the bug" className="rounded-xl" required />
          </div>

          {/* Severity */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Severity <span className="text-red-500">*</span></Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SEVERITIES.map(s => (
                <button key={s.key} type="button" onClick={() => set("severity", s.key)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center",
                    form.severity === s.key ? s.color + " border-current" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  )}>
                  <span className="text-lg">{s.emoji}</span>
                  <span className="text-xs font-semibold">{s.label}</span>
                  <span className="text-[10px] text-current opacity-70">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-700">What happened? <span className="text-red-500">*</span></Label>
            <Textarea value={form.description} onChange={e => set("description", e.target.value)}
              placeholder="Describe the bug in detail" className="rounded-xl min-h-[100px] resize-none" required />
          </div>

          {/* Steps to reproduce */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-700">Steps to Reproduce <span className="text-red-500">*</span></Label>
            <Textarea value={form.stepsToReproduce} onChange={e => set("stepsToReproduce", e.target.value)}
              placeholder={"1. Go to...\n2. Click on...\n3. See error"}
              className="rounded-xl min-h-[100px] resize-none font-mono text-xs" required />
          </div>

          {/* Expected vs Actual */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">Expected Result <span className="text-red-500">*</span></Label>
              <Textarea value={form.expectedResult} onChange={e => set("expectedResult", e.target.value)}
                placeholder="What should have happened?" className="rounded-xl min-h-[80px] resize-none" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">Actual Result <span className="text-red-500">*</span></Label>
              <Textarea value={form.actualResult} onChange={e => set("actualResult", e.target.value)}
                placeholder="What actually happened?" className="rounded-xl min-h-[80px] resize-none" required />
            </div>
          </div>

          {/* Attachments */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Attachments (optional)</Label>
            <div className="grid grid-cols-2 gap-3">
              {/* Screenshot */}
              <div>
                {screenshot ? (
                  <div className="relative rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-2">
                    <Image className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <span className="text-xs text-slate-700 truncate flex-1">{screenshot.name}</span>
                    <button type="button" onClick={() => setScreenshot(null)}><X className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => screenshotRef.current?.click()} disabled={uploading}
                    className="w-full flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-slate-400 hover:text-blue-500 disabled:opacity-50">
                    <Image className="h-5 w-5" />
                    <span className="text-xs font-medium">Screenshot</span>
                  </button>
                )}
                <input ref={screenshotRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0], setScreenshot); }} />
              </div>

              {/* Video */}
              <div>
                {video ? (
                  <div className="relative rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-2">
                    <Video className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <span className="text-xs text-slate-700 truncate flex-1">{video.name}</span>
                    <button type="button" onClick={() => setVideo(null)}><X className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => videoRef.current?.click()} disabled={uploading}
                    className="w-full flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-slate-400 hover:text-blue-500 disabled:opacity-50">
                    <Video className="h-5 w-5" />
                    <span className="text-xs font-medium">Video</span>
                  </button>
                )}
                <input ref={videoRef} type="file" accept="video/*" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0], setVideo); }} />
              </div>
            </div>
            {uploading && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Uploading…</p>}
          </div>

          {/* Auto-captured */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-xs text-slate-400">
              We'll automatically include: URL ({window.location.href}), Browser ({getBrowser()}),
              OS ({getOS()}), Screen ({window.screen.width}×{window.screen.height}).
            </p>
          </div>
        </div>

        <Button type="submit" className="w-full rounded-xl gap-2 bg-red-600 hover:bg-red-700 text-white" disabled={submitting || uploading}>
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</> : <><Bug className="h-4 w-4" />Submit Bug Report</>}
        </Button>
      </form>
    </div>
  );
}
