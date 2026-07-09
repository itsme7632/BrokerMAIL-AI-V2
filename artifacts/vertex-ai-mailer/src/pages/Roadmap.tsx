import { useState, useEffect } from "react";
import { Heart, Search, X, RefreshCw, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function getAuthHeaders(): Record<string, string> {
  const t = localStorage.getItem("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface RoadmapItem {
  id: number; title: string; description: string; status: string; category: string;
  progress: number; estimatedRelease?: string | null; voteCount: number; hasVoted: boolean;
}

const STATUSES: { key: string; label: string; emoji: string; color: string; bg: string; dot: string }[] = [
  { key: "in_development", label: "In Development", emoji: "🟢", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  { key: "in_progress",    label: "In Progress",    emoji: "🟢", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  { key: "beta",           label: "Beta",           emoji: "🟣", color: "text-violet-700",  bg: "bg-violet-50 border-violet-200",  dot: "bg-violet-500" },
  { key: "planned",        label: "Planned",        emoji: "🟡", color: "text-amber-700",   bg: "bg-amber-50 border-amber-200",   dot: "bg-amber-400"  },
  { key: "researching",    label: "Researching",    emoji: "🔵", color: "text-blue-700",    bg: "bg-blue-50 border-blue-200",    dot: "bg-blue-500"   },
  { key: "released",       label: "Released",       emoji: "✅", color: "text-teal-700",    bg: "bg-teal-50 border-teal-200",    dot: "bg-teal-500"   },
  { key: "future",         label: "Future",         emoji: "⚪", color: "text-slate-600",   bg: "bg-slate-50 border-slate-200",  dot: "bg-slate-400"  },
];

function StatusBadge({ status }: { status: string }) {
  const s = STATUSES.find(x => x.key === status) ?? STATUSES[3];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border", s.bg, s.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />{s.label}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-xs text-slate-500 font-mono flex-shrink-0">{value}%</span>
    </div>
  );
}

function RoadmapCard({ item, onVote, voting }: { item: RoadmapItem; onVote: (id: number) => void; voting: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={item.status} />
            {item.category && item.category !== "general" && (
              <span className="text-xs text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full capitalize">
                {item.category}
              </span>
            )}
          </div>
          <h3 className="mt-2 font-semibold text-slate-900 text-sm sm:text-base leading-tight">{item.title}</h3>
          <p className="mt-1 text-sm text-slate-500 leading-relaxed">{item.description}</p>
          {item.status === "in_development" && item.progress > 0 && <ProgressBar value={item.progress} />}
          {item.estimatedRelease && (
            <p className="mt-2 text-xs text-slate-400 flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />Est. {item.estimatedRelease}
            </p>
          )}
        </div>

        {/* Vote button */}
        <button
          onClick={() => onVote(item.id)}
          disabled={voting}
          className={cn(
            "flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-all duration-200 flex-shrink-0 min-w-[56px] group",
            item.hasVoted
              ? "bg-red-50 border-red-200 text-red-600"
              : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-500"
          )}
        >
          {voting
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Heart className={cn("h-4 w-4 transition-transform group-hover:scale-110", item.hasVoted && "fill-current")} />}
          <span className="text-xs font-semibold">{item.voteCount}</span>
        </button>
      </div>
    </div>
  );
}

export default function Roadmap() {
  const [items, setItems]       = useState<RoadmapItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [voting, setVoting]     = useState<number | null>(null);
  const [search, setSearch]     = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const { toast } = useToast();
  const debounceRef = { current: null as ReturnType<typeof setTimeout> | null };

  async function load(q = "", s = "") {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (q) qs.set("q", q);
      if (s) qs.set("status", s);
      const res = await fetch(`/api/product-hub/roadmap?${qs}`, { headers: getAuthHeaders() });
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleSearch(v: string) {
    setSearchInput(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setSearch(v); load(v, statusFilter); }, 350);
  }

  function handleStatusFilter(s: string) {
    setStatusFilter(s);
    load(search, s);
  }

  async function handleVote(id: number) {
    if (voting) return;
    setVoting(id);
    try {
      const res = await fetch(`/api/product-hub/roadmap/${id}/vote`, { method: "POST", headers: getAuthHeaders() });
      if (!res.ok) { toast({ title: "Failed to vote", variant: "destructive" }); return; }
      const { voted } = await res.json();
      setItems(prev => prev.map(item =>
        item.id === id
          ? { ...item, hasVoted: voted, voteCount: item.voteCount + (voted ? 1 : -1) }
          : item
      ));
    } finally {
      setVoting(null);
    }
  }

  const grouped = STATUSES.map(s => ({
    ...s,
    items: items.filter(i => i.status === s.key),
  })).filter(g => g.items.length > 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">🗺️ Roadmap</h1>
        <p className="text-sm text-slate-500 mt-0.5">Vote for what matters to you. We build what you need most.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input className="pl-9 rounded-xl" placeholder="Search features…" value={searchInput} onChange={e => handleSearch(e.target.value)} />
          {searchInput && <button onClick={() => handleSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {[{ key: "", label: "All" }, ...STATUSES.map(s => ({ key: s.key, label: s.label }))].map(s => (
            <button key={s.key} onClick={() => handleStatusFilter(s.key)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors",
                statusFilter === s.key
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              )}>{s.label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
          <p className="text-sm">No roadmap items found.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(group => (
            <div key={group.key}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{group.emoji}</span>
                <h2 className="font-semibold text-slate-800">{group.label}</h2>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{group.items.length}</span>
              </div>
              <div className="space-y-3">
                {group.items.map(item => (
                  <RoadmapCard key={item.id} item={item} onVote={handleVote} voting={voting === item.id} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
