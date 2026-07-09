import { useState } from "react";
import { MessageSquare, Lightbulb, TrendingUp, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

function getAuthHeaders() {
  const t = localStorage.getItem("auth_token");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
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

const TYPES = [
  { key: "feature_request", label: "Feature Request", icon: Lightbulb,     desc: "Suggest something new"       },
  { key: "improvement",     label: "Improvement",     icon: TrendingUp,    desc: "Help us do better"           },
  { key: "general",         label: "General Feedback", icon: MessageSquare, desc: "Share your thoughts"        },
];

const PRIORITIES = [
  { key: "low",      label: "Low",      color: "text-slate-600 bg-slate-50 border-slate-200"     },
  { key: "medium",   label: "Medium",   color: "text-amber-700 bg-amber-50 border-amber-200"    },
  { key: "high",     label: "High",     color: "text-orange-700 bg-orange-50 border-orange-200" },
  { key: "critical", label: "Critical", color: "text-red-700 bg-red-50 border-red-200"           },
];

const CATEGORIES = ["general", "email-sending", "campaigns", "templates", "gmail", "mailbox", "billing", "ui-ux", "performance", "other"];

export default function Feedback() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [type, setType]           = useState("feature_request");
  const [title, setTitle]         = useState("");
  const [description, setDesc]    = useState("");
  const [category, setCategory]   = useState("general");
  const [priority, setPriority]   = useState("medium");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]           = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast({ title: "Please fill in all required fields", variant: "destructive" }); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/product-hub/feedback", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          type, title: title.trim(), description: description.trim(),
          category, priority,
          currentPage: window.location.pathname,
          browser: getBrowser(), os: getOS(),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setDone(true);
    } catch {
      toast({ title: "Failed to submit feedback", description: "Please try again.", variant: "destructive" });
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
        <h2 className="text-xl font-bold text-slate-900">Thank you for your feedback!</h2>
        <p className="text-sm text-slate-500">We read every submission and use it to improve BrokerMAIL AI.</p>
        <Button className="rounded-xl" onClick={() => { setDone(false); setTitle(""); setDesc(""); }}>
          Submit another
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">💬 Feedback</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your feedback shapes the future of BrokerMAIL AI.</p>
      </div>

      {/* Type selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TYPES.map(t => {
          const Icon = t.icon;
          const active = type === t.key;
          return (
            <button key={t.key} onClick={() => setType(t.key)}
              className={cn(
                "flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-200 text-center",
                active ? "border-indigo-500 bg-indigo-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              )}>
              <Icon className={cn("h-5 w-5", active ? "text-indigo-600" : "text-slate-400")} />
              <div>
                <p className={cn("text-sm font-semibold", active ? "text-indigo-700" : "text-slate-700")}>{t.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{t.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5 shadow-sm">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="fb-title" className="text-sm font-semibold text-slate-700">Title <span className="text-red-500">*</span></Label>
            <Input id="fb-title" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Give your feedback a clear title"
              className="rounded-xl" maxLength={200} required />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="fb-desc" className="text-sm font-semibold text-slate-700">Description <span className="text-red-500">*</span></Label>
            <Textarea id="fb-desc" value={description} onChange={e => setDesc(e.target.value)}
              placeholder="Tell us more — what's the problem, what would you like to see, and why does it matter?"
              className="rounded-xl min-h-[120px] resize-none" maxLength={5000} required />
          </div>

          {/* Category + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">Category</Label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 capitalize">
                {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c.replace(/-/g, " ")}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">Priority</Label>
              <div className="flex gap-1.5 flex-wrap">
                {PRIORITIES.map(p => (
                  <button key={p.key} type="button" onClick={() => setPriority(p.key)}
                    className={cn("px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all", priority === p.key ? p.color : "bg-white text-slate-500 border-slate-200 hover:border-slate-300")}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Auto-captured info */}
          <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-xs text-slate-400 leading-relaxed">
              We'll automatically include your user ID, current page, browser ({getBrowser()}), and OS ({getOS()}) to help us reproduce the issue.
            </p>
          </div>
        </div>

        <Button type="submit" className="w-full rounded-xl gap-2" disabled={submitting}>
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</> : "Submit Feedback"}
        </Button>
      </form>
    </div>
  );
}
