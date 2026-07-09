import { useState, useEffect } from "react";
import { Check, X, Sparkles, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

function getAuthHeaders(): Record<string, string> {
  const t = localStorage.getItem("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface Release {
  id: number; version: string; title: string; description: string;
  highlights?: string[] | null; category: string; releaseDate: string;
}

export function VersionPopup() {
  const [release, setRelease] = useState<Release | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;
    fetch("/api/product-hub/version-popup", { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.id) setRelease(data); })
      .catch(() => {});
  }, []);

  async function dismiss() {
    if (!release) return;
    setDismissing(true);
    await fetch(`/api/product-hub/releases/${release.id}/read`, {
      method: "POST", headers: getAuthHeaders(),
    }).catch(() => {});
    setRelease(null);
    setDismissing(false);
  }

  if (!release) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={dismiss} />
      <div className="relative bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">

        {/* Top gradient bar */}
        <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500" />

        {/* Close */}
        <button onClick={dismiss} className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors z-10">
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 sm:p-7">
          {/* Icon + heading */}
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-200">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">What's New</p>
              <h2 className="text-xl font-bold text-slate-900 leading-tight mt-0.5">
                🎉 BrokerMAIL AI v{release.version}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">{release.title}</p>
            </div>
          </div>

          {/* Highlights */}
          {release.highlights && release.highlights.length > 0 && (
            <ul className="mt-5 space-y-2.5">
              {release.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <div className="h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="h-3 w-3 text-emerald-600" />
                  </div>
                  <span className="text-sm text-slate-700">{h}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Release date */}
          <p className="mt-4 text-xs text-slate-400">
            Released {new Date(release.releaseDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>

          {/* Actions */}
          <div className="mt-5 flex gap-2">
            <Link href="/whats-new" onClick={dismiss} className="flex-1">
              <Button className="w-full rounded-xl gap-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 border-0">
                View Details <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
            <Button variant="outline" className="rounded-xl" onClick={dismiss} disabled={dismissing}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
