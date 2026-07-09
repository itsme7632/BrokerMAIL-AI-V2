import { useState, useEffect } from "react";
import { Sparkles, Check, Zap, Bug, ShieldCheck, ExternalLink, Play, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function getAuthHeaders(): Record<string, string> {
  const t = localStorage.getItem("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const CATEGORIES: Record<string, { label: string; icon: React.ElementType; color: string; bg: string; activeClass: string }> = {
  new_feature: { label: "New Feature",     icon: Sparkles,    color: "text-indigo-700", bg: "bg-indigo-50 border-indigo-200",   activeClass: "bg-indigo-600 text-white border-indigo-600"  },
  improvement: { label: "Improvement",     icon: Zap,         color: "text-amber-700",  bg: "bg-amber-50 border-amber-200",    activeClass: "bg-amber-500 text-white border-amber-500"    },
  bug_fix:     { label: "Bug Fix",         icon: Bug,         color: "text-red-700",    bg: "bg-red-50 border-red-200",        activeClass: "bg-red-600 text-white border-red-600"        },
  security:    { label: "Security Update", icon: ShieldCheck, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", activeClass: "bg-emerald-600 text-white border-emerald-600" },
};

interface Release {
  id: number; version: string; releaseDate: string; category: string;
  title: string; description: string; imageUrl?: string | null; videoUrl?: string | null;
  docUrl?: string | null; highlights?: string[] | null; isMajor: boolean; isRead: boolean;
}

function CategoryBadge({ category }: { category: string }) {
  const cfg = CATEGORIES[category] ?? CATEGORIES.improvement;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border", cfg.bg, cfg.color)}>
      <Icon className="h-3 w-3" />{cfg.label}
    </span>
  );
}

function ReleaseCard({ release, onRead }: { release: Release; onRead: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      "bg-white rounded-2xl border shadow-sm transition-all duration-200 overflow-hidden",
      !release.isRead ? "border-blue-200 shadow-blue-50" : "border-slate-200"
    )}>
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <CategoryBadge category={release.category} />
            {release.isMajor && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-violet-500 to-indigo-500 text-white">
                ✨ Major
              </span>
            )}
            {!release.isRead && (
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
              v{release.version}
            </span>
            <span className="text-xs text-slate-400">
              {new Date(release.releaseDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
          </div>
        </div>

        <h3 className="mt-3 text-lg font-bold text-slate-900 leading-tight">{release.title}</h3>
        <p className="mt-1.5 text-sm text-slate-600 leading-relaxed line-clamp-3">{release.description}</p>

        {release.highlights && release.highlights.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {release.highlights.slice(0, expanded ? undefined : 3).map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                {h}
              </li>
            ))}
            {!expanded && (release.highlights.length > 3) && (
              <li>
                <button onClick={() => setExpanded(true)} className="text-xs text-blue-600 hover:underline font-medium">
                  +{release.highlights.length - 3} more…
                </button>
              </li>
            )}
          </ul>
        )}

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          {release.docUrl && (
            <a href={release.docUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="rounded-xl gap-1.5 h-8 text-xs">
                <ExternalLink className="h-3.5 w-3.5" /> Documentation
              </Button>
            </a>
          )}
          {release.videoUrl && (
            <a href={release.videoUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="rounded-xl gap-1.5 h-8 text-xs">
                <Play className="h-3.5 w-3.5" /> Watch Demo
              </Button>
            </a>
          )}
          {!release.isRead && (
            <button
              onClick={() => onRead(release.id)}
              className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              <Check className="h-3.5 w-3.5" /> Mark as read
            </button>
          )}
        </div>
      </div>

      {release.imageUrl && (
        <img src={release.imageUrl} alt={release.title} className="w-full object-cover max-h-64 border-t border-slate-100" />
      )}
    </div>
  );
}

export default function WhatsNew() {
  const [releases, setReleases]         = useState<Release[]>([]);
  const [loading, setLoading]           = useState(true);
  const [unread, setUnread]             = useState(0);
  const [searchInput, setSearchInput]   = useState("");
  const [search, setSearch]             = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const debounceRef = useState<ReturnType<typeof setTimeout> | null>(null);

  async function load(q = "", cat = "") {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "50" });
      if (q)   qs.set("q", q);
      if (cat) qs.set("category", cat);
      const res = await fetch(`/api/product-hub/releases?${qs}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setReleases(data.data ?? []);
        setUnread(data.unreadCount ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleSearch(v: string) {
    setSearchInput(v);
    if (debounceRef[0]) clearTimeout(debounceRef[0]);
    (debounceRef as any)[0] = setTimeout(() => { setSearch(v); load(v, categoryFilter); }, 350);
  }

  function handleCategory(cat: string) {
    const next = cat === categoryFilter ? "" : cat;
    setCategoryFilter(next);
    load(search, next);
  }

  async function handleRead(id: number) {
    await fetch(`/api/product-hub/releases/${id}/read`, { method: "POST", headers: getAuthHeaders() });
    setReleases(prev => prev.map(r => r.id === id ? { ...r, isRead: true } : r));
    setUnread(prev => Math.max(0, prev - 1));
  }

  async function handleMarkAllRead() {
    await Promise.all(releases.filter(r => !r.isRead).map(r => handleRead(r.id)));
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            ✨ What's New
            {unread > 0 && (
              <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-blue-600 text-white text-xs font-bold">
                {unread}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Latest updates, improvements, and fixes.</p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs" onClick={handleMarkAllRead}>
              <Check className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
          <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs" onClick={() => load(search, categoryFilter)} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <Input
          className="pl-9 rounded-xl"
          placeholder="Search releases…"
          value={searchInput}
          onChange={e => handleSearch(e.target.value)}
        />
        {searchInput && (
          <button onClick={() => handleSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(CATEGORIES).map(([key, cfg]) => {
          const Icon = cfg.icon;
          const active = categoryFilter === key;
          return (
            <button
              key={key}
              onClick={() => handleCategory(key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150",
                active ? cfg.activeClass : cn("bg-white", cfg.bg, cfg.color, "hover:opacity-80")
              )}
            >
              <Icon className="h-3 w-3" />{cfg.label}
              {active && <X className="h-2.5 w-2.5 ml-0.5 opacity-80" />}
            </button>
          );
        })}
      </div>

      {/* Releases */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : releases.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
          <Sparkles className="h-10 w-10 text-slate-200" />
          <p className="text-sm">
            {search || categoryFilter
              ? `No releases matching your filters.`
              : "No releases yet."}
          </p>
          {(search || categoryFilter) && (
            <button
              onClick={() => { setSearchInput(""); setSearch(""); setCategoryFilter(""); load(); }}
              className="text-xs text-blue-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {releases.map(r => <ReleaseCard key={r.id} release={r} onRead={handleRead} />)}
        </div>
      )}
    </div>
  );
}
