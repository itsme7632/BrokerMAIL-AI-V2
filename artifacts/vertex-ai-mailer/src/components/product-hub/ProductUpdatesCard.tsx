import { useEffect, useState } from "react";
import { Sparkles, ChevronRight, Tag, Rocket, Megaphone, Heart } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function getAuthHeaders(): Record<string, string> {
  const t = localStorage.getItem("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface Summary {
  latestRelease: { id: number; version: string; title: string; releaseDate: string } | null;
  latestAnnouncement: { id: number; message: string } | null;
  topFeature: { id: number; title: string; status: string } | null;
  upcoming: { id: number; title: string; status: string; voteCount: number } | null;
  unreadCount: number;
}

export function ProductUpdatesCard() {
  const [data, setData]     = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/product-hub/dashboard-summary", { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <span className="font-semibold text-slate-900 text-sm">Product Updates</span>
            {!loading && data?.unreadCount ? (
              <span className="ml-2 inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                {data.unreadCount}
              </span>
            ) : null}
          </div>
        </div>
        <Link href="/whats-new" className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
          View all <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Body */}
      <div className="divide-y divide-slate-50">
        {loading ? (
          <>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="px-5 py-3 flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-xl flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {/* Latest version */}
            {data?.latestRelease ? (
              <Link href="/whats-new" className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group">
                <div className="h-8 w-8 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                  <Tag className="h-4 w-4 text-violet-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">Latest: v{data.latestRelease.version}</p>
                  <p className="text-xs text-slate-400 truncate">{data.latestRelease.title}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-400 flex-shrink-0" />
              </Link>
            ) : (
              <div className="px-5 py-3 flex items-center gap-3 text-slate-400">
                <Tag className="h-4 w-4" />
                <p className="text-xs">No releases yet</p>
              </div>
            )}

            {/* Announcement */}
            {data?.latestAnnouncement ? (
              <div className="flex items-center gap-3 px-5 py-3">
                <div className="h-8 w-8 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Megaphone className="h-4 w-4 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700">Announcement</p>
                  <p className="text-xs text-slate-400 truncate">{data.latestAnnouncement.message}</p>
                </div>
              </div>
            ) : null}

            {/* Top requested */}
            {data?.topFeature ? (
              <Link href="/product-hub/feedback" className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group">
                <div className="h-8 w-8 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0">
                  <Heart className="h-4 w-4 text-rose-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">Top Request</p>
                  <p className="text-xs text-slate-400 truncate">{data.topFeature.title}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-400 flex-shrink-0" />
              </Link>
            ) : null}

            {/* Upcoming */}
            {data?.upcoming ? (
              <Link href="/roadmap" className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group">
                <div className="h-8 w-8 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <Rocket className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">In Development</p>
                  <p className="text-xs text-slate-400 truncate">{data.upcoming.title}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-400 flex-shrink-0" />
              </Link>
            ) : null}

            {/* Empty state */}
            {!data?.latestRelease && !data?.topFeature && !data?.upcoming && !data?.latestAnnouncement && (
              <div className="px-5 py-8 text-center text-slate-400">
                <Sparkles className="h-8 w-8 mx-auto mb-2 text-slate-200" />
                <p className="text-xs">Product updates will appear here.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
