import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Eye, Sparkles, ArrowRight, CheckCircle2,
  ChevronLeft, ChevronRight, Monitor, Smartphone,
} from "lucide-react";

type TemplateStyle = {
  id: string;
  label: string;
  desc: string;
  category: string;
  categoryColor: string;
  badge?: string;
  badgeColor?: string;
};

const TEMPLATES: TemplateStyle[] = [
  { id: "clean",     label: "Clean",            desc: "Classic blue header, white card — the industry standard for transport quotes.",       category: "Standard",   categoryColor: "bg-blue-50 text-blue-700",      badge: "Popular",  badgeColor: "bg-blue-100 text-blue-700" },
  { id: "modern",    label: "Modern",            desc: "Indigo header with quote summary panel and CTA button — forward-thinking brokers.",   category: "Featured",   categoryColor: "bg-violet-50 text-violet-700",  badge: "Featured", badgeColor: "bg-violet-100 text-violet-700" },
  { id: "minimal",   label: "Minimal",           desc: "Clean white with thin accent line — high deliverability, text-focused design.",       category: "Deliverability", categoryColor: "bg-slate-50 text-slate-700" },
  { id: "luxury",    label: "Luxury",            desc: "Dark navy with gold accents and serif typography — premium service positioning.",     category: "Premium",    categoryColor: "bg-amber-50 text-amber-700",    badge: "Premium",  badgeColor: "bg-amber-100 text-amber-700" },
  { id: "corporate", label: "Corporate",         desc: "Navy header with structured quote details table — enterprise authority.",             category: "Enterprise", categoryColor: "bg-indigo-50 text-indigo-700" },
  { id: "urgent",    label: "Urgent",            desc: "Red header with availability alert panel and CTA — ideal for follow-up sequences.",  category: "Follow-up",  categoryColor: "bg-red-50 text-red-700",        badge: "New",      badgeColor: "bg-emerald-100 text-emerald-700" },
  { id: "dispatch",  label: "Dispatch",          desc: "Emerald green with route visualization panel — logistics-focused layout.",           category: "Logistics",  categoryColor: "bg-emerald-50 text-emerald-700",badge: "New",      badgeColor: "bg-emerald-100 text-emerald-700" },
  { id: "friendly",  label: "Friendly Broker",   desc: "Sky blue with personalized greeting box and warm footer — trust-building style.",   category: "Warm",       categoryColor: "bg-sky-50 text-sky-700",        badge: "New",      badgeColor: "bg-emerald-100 text-emerald-700" },
  { id: "mobile",    label: "Mobile Optimized",  desc: "Large text, prominent price display, oversized CTA — perfect for mobile readers.", category: "Mobile",     categoryColor: "bg-blue-50 text-blue-700",      badge: "New",      badgeColor: "bg-emerald-100 text-emerald-700" },
  { id: "dark",      label: "Dark Modern",       desc: "Dark navy card with quote reference panel — modern SaaS email experience.",         category: "Dark",       categoryColor: "bg-slate-50 text-slate-700",    badge: "New",      badgeColor: "bg-emerald-100 text-emerald-700" },
];

const SAMPLE_SUBJECT = "Your Auto Transport Quote — {vehicle} from {pickup} to {delivery}";
const SAMPLE_BODY = `Hi {name},

Thank you for reaching out! I've prepared a personalized transport quote for your {vehicle}.

Here are the details:

• Vehicle: {vehicle}
• Pickup: {pickup}
• Delivery: {delivery}
• Quoted Price: {price}
• Quote Reference: {quote_id}

This is a fully insured, door-to-door service from a licensed auto transport broker. We handle everything from pickup scheduling to final delivery confirmation.

Please reply to this email or call us to confirm your booking. This quote is valid for 7 days.

We look forward to transporting your vehicle safely!`;

const SAMPLE_ROW = {
  name:       "Sarah Johnson",
  vehicle:    "2022 Tesla Model 3",
  pickup:     "Los Angeles, CA",
  delivery:   "New York, NY",
  price:      "1250",
  quote_id:   "BM-20240528",
};

// ─── Unique mini-previews per template ────────────────────────────────────────

function MiniPreview({ id }: { id: string }) {
  switch (id) {
    case "clean":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#f8fafc" }}>
          <div className="w-28 bg-white overflow-hidden shadow" style={{ border: "1px solid #e2e8f0" }}>
            <div style={{ background: "#1d4ed8", height: 18 }} />
            <div className="p-1.5 space-y-1.5">
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
              <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "70%" }} />
              <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "50%" }} />
            </div>
          </div>
        </div>
      );
    case "modern":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#eef2ff" }}>
          <div className="w-28 bg-white overflow-hidden shadow" style={{ border: "1px solid #c7d2fe" }}>
            <div style={{ background: "#312e81", height: 4 }} />
            <div style={{ background: "#4f46e5", padding: "5px 7px" }}>
              <div className="h-1.5 rounded" style={{ background: "rgba(199,210,254,0.7)", width: "70%" }} />
            </div>
            <div style={{ margin: "5px 7px 3px", background: "#eef2ff", borderLeft: "3px solid #4f46e5", padding: "4px 6px" }}>
              <div className="h-2 rounded" style={{ background: "#34d399", width: "45%" }} />
              <div className="h-1 rounded-full mt-1 bg-slate-300" style={{ width: "65%" }} />
            </div>
            <div className="px-2 space-y-1 pb-1">
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
            </div>
            <div style={{ background: "#f8fafc", padding: "4px 7px", textAlign: "center" }}>
              <div style={{ background: "#4f46e5", height: 8, borderRadius: 3, width: "55%", margin: "0 auto" }} />
            </div>
          </div>
        </div>
      );
    case "minimal":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#ffffff" }}>
          <div className="w-28 overflow-hidden" style={{ borderTop: "3px solid #2563eb" }}>
            <div style={{ padding: "8px 6px 6px", borderBottom: "1px solid #e2e8f0" }}>
              <div className="h-1.5 rounded-full" style={{ background: "#2563eb", width: "50%", opacity: 0.6 }} />
            </div>
            <div className="space-y-1.5 pt-2 px-1.5">
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "85%" }} />
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "65%" }} />
              <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "75%" }} />
              <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "55%" }} />
            </div>
          </div>
        </div>
      );
    case "luxury":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#0f172a" }}>
          <div className="w-28 overflow-hidden" style={{ border: "1px solid #1e293b", borderTop: "2px solid #d97706" }}>
            <div style={{ background: "#0f172a", padding: "6px 7px" }}>
              <div className="h-1.5 rounded" style={{ background: "rgba(255,255,255,0.7)", width: "65%" }} />
              <div className="h-1 rounded mt-1" style={{ background: "#d97706", width: "40%", opacity: 0.8 }} />
            </div>
            <div style={{ background: "#ffffff", padding: "6px 7px" }}>
              <div className="space-y-1.5">
                <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
                <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "60%" }} />
                <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "70%" }} />
              </div>
            </div>
            <div style={{ background: "#0f172a", height: 8, borderTop: "2px solid #d97706" }} />
          </div>
        </div>
      );
    case "corporate":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#eef2f7" }}>
          <div className="w-28 bg-white overflow-hidden shadow" style={{ borderTop: "3px solid #0a2558" }}>
            <div style={{ background: "#0a2558", padding: "5px 7px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="h-1.5 rounded" style={{ background: "rgba(255,255,255,0.7)", width: "50%" }} />
              <div style={{ border: "1px solid rgba(255,255,255,0.35)", padding: "1px 4px" }}>
                <div className="h-1 rounded" style={{ background: "rgba(255,255,255,0.5)", width: 16 }} />
              </div>
            </div>
            <div style={{ margin: "5px 5px 3px", border: "1px solid #e2e8f0", borderTop: "2px solid #0a2558" }}>
              <div style={{ background: "#f1f5f9", padding: "2px 5px", borderBottom: "1px solid #e2e8f0" }}>
                <div className="h-1 rounded" style={{ background: "#0a2558", width: "50%", opacity: 0.5 }} />
              </div>
              <div style={{ padding: "3px 5px" }}>
                <div className="h-1.5 rounded bg-slate-200 mb-1" style={{ width: "80%" }} />
                <div className="h-2 rounded" style={{ background: "#34d399", width: "35%" }} />
              </div>
            </div>
            <div className="px-2 pb-2 space-y-1">
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "75%" }} />
              <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "55%" }} />
            </div>
          </div>
        </div>
      );
    case "urgent":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#fff5f5" }}>
          <div className="w-28 bg-white overflow-hidden shadow" style={{ border: "1px solid #fecaca", borderTop: "3px solid #dc2626" }}>
            <div style={{ background: "#dc2626", padding: "5px 7px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="h-1.5 rounded" style={{ background: "rgba(255,255,255,0.7)", width: "45%" }} />
              <div style={{ background: "rgba(255,255,255,0.2)", padding: "1px 4px", border: "1px solid rgba(255,255,255,0.35)" }}>
                <div style={{ fontSize: 8, color: "#fff", lineHeight: 1, letterSpacing: 0.5 }}>⚡ URGENT</div>
              </div>
            </div>
            <div style={{ margin: "5px 5px 3px", background: "#fff7ed", border: "1px solid #fed7aa", borderLeft: "3px solid #ea580c", padding: "4px 5px" }}>
              <div className="h-1 rounded mb-1" style={{ background: "#ea580c", width: "60%", opacity: 0.7 }} />
              <div className="h-1.5 rounded" style={{ background: "#34d399", width: "40%" }} />
            </div>
            <div className="px-2 pb-1 space-y-1">
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
              <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "55%" }} />
            </div>
            <div style={{ padding: "4px 7px", textAlign: "center", background: "#fff5f5", borderTop: "1px solid #fecaca" }}>
              <div style={{ background: "#dc2626", height: 8, borderRadius: 2, width: "60%", margin: "0 auto" }} />
            </div>
          </div>
        </div>
      );
    case "dispatch":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#f0fdf4" }}>
          <div className="w-28 bg-white overflow-hidden shadow" style={{ border: "1px solid #d1fae5" }}>
            <div style={{ background: "#065f46", padding: "5px 7px", display: "flex", justifyContent: "space-between" }}>
              <div className="h-1.5 rounded" style={{ background: "rgba(255,255,255,0.7)", width: "50%" }} />
              <div className="h-1 rounded" style={{ background: "rgba(255,255,255,0.35)", width: "25%" }} />
            </div>
            <div style={{ margin: "5px 5px 3px", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "4px 5px" }}>
              <div className="h-1 rounded mb-1.5" style={{ background: "#059669", width: "50%", opacity: 0.6 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <div className="h-1.5 rounded" style={{ background: "#065f46", width: "30%" }} />
                <div style={{ color: "#059669", fontSize: 8 }}>→</div>
                <div className="h-1.5 rounded" style={{ background: "#065f46", width: "30%" }} />
              </div>
            </div>
            <div className="px-2 pb-1.5 space-y-1">
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
              <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "60%" }} />
            </div>
            <div style={{ padding: "4px 7px", background: "#f0fdf4", borderTop: "1px solid #d1fae5" }}>
              <div className="h-1 rounded-full" style={{ background: "#059669", width: "70%", opacity: 0.6 }} />
            </div>
          </div>
        </div>
      );
    case "friendly":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#f0f9ff" }}>
          <div className="w-28 bg-white overflow-hidden shadow" style={{ border: "1px solid #bae6fd" }}>
            <div style={{ background: "#0369a1", padding: "5px 7px" }}>
              <div className="h-1.5 rounded" style={{ background: "rgba(255,255,255,0.7)", width: "60%" }} />
              <div className="h-1 rounded mt-1" style={{ background: "rgba(255,255,255,0.4)", width: "40%" }} />
            </div>
            <div style={{ margin: "5px 5px 3px", background: "#f0f9ff", borderRadius: 4, border: "1px solid #bae6fd", padding: "4px 5px" }}>
              <div className="h-1.5 rounded mb-1" style={{ background: "#0369a1", width: "65%" }} />
              <div className="h-1 rounded" style={{ background: "#34d399", width: "40%" }} />
            </div>
            <div className="px-2 pb-1 space-y-1">
              <div className="h-1.5 rounded-full bg-slate-200" style={{ width: "80%" }} />
              <div className="h-1.5 rounded-full bg-slate-100" style={{ width: "55%" }} />
            </div>
            <div style={{ padding: "4px 7px", background: "#f0f9ff", borderTop: "1px solid #bae6fd" }}>
              <div className="h-1 rounded-full" style={{ background: "#0ea5e9", width: "80%", opacity: 0.5 }} />
            </div>
          </div>
        </div>
      );
    case "mobile":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#ffffff" }}>
          <div className="w-28 overflow-hidden" style={{ borderTop: "4px solid #1e40af" }}>
            <div style={{ padding: "6px 6px 4px" }}>
              <div className="h-1.5 rounded" style={{ background: "#1e40af", width: "45%", opacity: 0.6 }} />
            </div>
            <div style={{ margin: "4px 5px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, padding: "5px 6px" }}>
              <div className="h-3 rounded" style={{ background: "#34d399", width: "50%" }} />
              <div className="h-1.5 rounded mt-1" style={{ background: "#1e40af", width: "70%", opacity: 0.7 }} />
            </div>
            <div className="px-1.5 pt-1 space-y-1.5">
              <div className="h-2 rounded-full bg-slate-200" style={{ width: "85%" }} />
              <div className="h-2 rounded-full bg-slate-200" style={{ width: "65%" }} />
            </div>
            <div style={{ padding: "5px 6px", textAlign: "center" }}>
              <div style={{ background: "#1e40af", height: 12, borderRadius: 4, width: "75%", margin: "0 auto" }} />
            </div>
          </div>
        </div>
      );
    case "dark":
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: "#0f172a" }}>
          <div className="w-28 overflow-hidden" style={{ background: "#1e293b", border: "1px solid #334155", borderTop: "3px solid #3b82f6" }}>
            <div style={{ padding: "5px 7px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="h-1.5 rounded" style={{ background: "#f1f5f9", width: "55%", opacity: 0.8 }} />
              <div className="h-1 rounded" style={{ background: "#3b82f6", width: "20%", opacity: 0.7 }} />
            </div>
            <div style={{ margin: "5px 5px 3px", background: "#0f172a", border: "1px solid #334155", borderLeft: "2px solid #3b82f6", padding: "4px 5px" }}>
              <div className="h-1 rounded mb-1" style={{ background: "#3b82f6", width: "45%", opacity: 0.7 }} />
              <div className="h-2 rounded" style={{ background: "#34d399", width: "40%" }} />
            </div>
            <div className="px-2 pb-2 space-y-1">
              <div className="h-1.5 rounded-full" style={{ background: "#94a3b8", width: "75%", opacity: 0.6 }} />
              <div className="h-1.5 rounded-full" style={{ background: "#64748b", width: "55%", opacity: 0.5 }} />
            </div>
            <div style={{ background: "#0f172a", padding: "4px 7px", borderTop: "1px solid #1e293b" }}>
              <div className="h-1 rounded-full" style={{ background: "#475569", width: "60%" }} />
            </div>
          </div>
        </div>
      );
    default:
      return <div className="w-full h-full bg-slate-100" />;
  }
}

// ─── Template Card ─────────────────────────────────────────────────────────────

function TemplateCard({ tmpl, onPreview }: { tmpl: TemplateStyle; onPreview: (id: string) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md hover:border-slate-300 transition-all group">
      {/* Mini preview */}
      <div className="h-28 relative overflow-hidden">
        <MiniPreview id={tmpl.id} />
        {tmpl.badge && (
          <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-semibold ${tmpl.badgeColor}`}>
            {tmpl.badge}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-slate-900 text-sm">{tmpl.label}</h3>
          <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${tmpl.categoryColor}`}>{tmpl.category}</span>
        </div>
        <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{tmpl.desc}</p>
        <div className="flex items-center gap-2 mt-3">
          <Button
            variant="outline" size="sm"
            onClick={() => onPreview(tmpl.id)}
            className="rounded-xl gap-1.5 text-xs flex-1"
          >
            <Eye className="h-3.5 w-3.5" /> Preview
          </Button>
          <Button asChild size="sm" variant="ghost" className="rounded-xl gap-1 text-xs text-blue-600 hover:bg-blue-50 flex-1">
            <Link href="/leads/import">
              Use <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Preview Modal ─────────────────────────────────────────────────────────────

function PreviewModal({
  styleId,
  open,
  onClose,
  onNavigate,
}: {
  styleId: string | null;
  open: boolean;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const [html, setHtml]           = useState<string | null>(null);
  const [subject, setSubject]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [withSig, setWithSig]     = useState(false);
  const [viewMode, setViewMode]   = useState<"desktop" | "mobile">("desktop");

  const fetchPreview = useCallback(async (style: string, useSig: boolean) => {
    setLoading(true); setError(null); setHtml(null);
    try {
      const token = localStorage.getItem("auth_token") ?? "";
      const res = await fetch("/api/drafts/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          body: SAMPLE_BODY,
          subject: SAMPLE_SUBJECT,
          row: SAMPLE_ROW,
          style,
          useSignatureBuilder: useSig,
        }),
      });
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      const data = await res.json();
      setHtml(data.html ?? "");
      setSubject(data.subject ?? "");
    } catch (err: any) {
      setError(err.message ?? "Failed to load preview");
    } finally { setLoading(false); }
  }, []);

  const currentIdx = TEMPLATES.findIndex(t => t.id === styleId);
  const tmpl = TEMPLATES[currentIdx] ?? null;
  const prevTmpl = currentIdx > 0 ? TEMPLATES[currentIdx - 1] : null;
  const nextTmpl = currentIdx < TEMPLATES.length - 1 ? TEMPLATES[currentIdx + 1] : null;

  useEffect(() => {
    if (open && styleId) {
      setHtml(null);
      setError(null);
      fetchPreview(styleId, withSig);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, styleId]);

  function handleSigToggle() {
    const next = !withSig;
    setWithSig(next);
    if (styleId) fetchPreview(styleId, next);
  }

  function handleNavigate(id: string) {
    onNavigate(id);
    setHtml(null);
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setHtml(null); setError(null); } }}>
      <DialogContent className="max-w-3xl w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">

        {/* Header */}
        <DialogHeader className="px-5 py-3 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center justify-between gap-3 min-w-0">
            {/* Nav + title */}
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => prevTmpl && handleNavigate(prevTmpl.id)}
                disabled={!prevTmpl}
                className="h-7 w-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex-shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => nextTmpl && handleNavigate(nextTmpl.id)}
                disabled={!nextTmpl}
                className="h-7 w-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex-shrink-0"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-sm font-semibold text-slate-900 truncate">
                    {tmpl?.label ?? styleId}
                  </DialogTitle>
                  {tmpl && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium flex-shrink-0 ${tmpl.categoryColor}`}>
                      {tmpl.category}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {loading ? "Loading preview…" : (subject || SAMPLE_SUBJECT)}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Desktop/Mobile toggle */}
              <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
                <button
                  onClick={() => setViewMode("desktop")}
                  className={`h-7 px-2 flex items-center gap-1 text-xs transition-colors ${
                    viewMode === "desktop" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("mobile")}
                  className={`h-7 px-2 flex items-center gap-1 text-xs transition-colors ${
                    viewMode === "mobile" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Signature toggle */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleSigToggle}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    withSig ? "bg-blue-600" : "bg-slate-200"
                  }`}
                  title="Toggle signature"
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform ${
                    withSig ? "translate-x-4" : "translate-x-0"
                  }`} />
                </button>
                <span className="text-xs text-slate-500">Sig</span>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Preview area */}
        <div className="flex-1 overflow-auto bg-slate-100 min-h-0 flex items-start justify-center">
          {loading && (
            <div className="p-6 space-y-3 w-full max-w-xl">
              <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-48 w-full" /><Skeleton className="h-4 w-1/2" />
            </div>
          )}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 p-8">
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={() => styleId && fetchPreview(styleId, withSig)} className="rounded-lg mt-1">
                Retry
              </Button>
            </div>
          )}
          {html && !loading && (
            <div
              className={`transition-all duration-300 ${
                viewMode === "mobile" ? "w-[390px] my-4 shadow-2xl" : "w-full"
              }`}
            >
              <iframe
                srcDoc={html}
                className="w-full border-0 min-h-[500px]"
                style={{ height: viewMode === "mobile" ? "700px" : "100%" }}
                title="Template Preview"
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-white flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-400">Sample: Sarah Johnson · Tesla Model 3 · LA → NYC · $1,250</p>
            <span className="text-slate-200">·</span>
            <p className="text-xs text-slate-400">{currentIdx + 1} / {TEMPLATES.length}</p>
          </div>
          <Button asChild className="rounded-xl gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm flex-shrink-0">
            <Link href="/leads/import">
              <Sparkles className="h-3.5 w-3.5" /> Use this style <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function TemplateGallery() {
  const [previewStyle, setPreviewStyle] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Template Gallery</h1>
        <p className="text-slate-500 mt-1 text-sm">
          10 professional email styles for auto transport brokers. Each template has a unique layout, structure, and visual design.
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 p-4 bg-slate-50 rounded-2xl border border-slate-100">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> All templates are mobile-responsive
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Gmail, Outlook &amp; Apple Mail safe
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Supports company logo &amp; branding
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Unique layout per template
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Open tracking included
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {TEMPLATES.map(tmpl => (
          <TemplateCard key={tmpl.id} tmpl={tmpl} onPreview={id => setPreviewStyle(id)} />
        ))}
      </div>

      <PreviewModal
        styleId={previewStyle}
        open={!!previewStyle}
        onClose={() => setPreviewStyle(null)}
        onNavigate={id => setPreviewStyle(id)}
      />
    </div>
  );
}
