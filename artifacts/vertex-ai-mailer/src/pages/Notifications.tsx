import { useState, useEffect, useCallback } from "react";
import {
  Bell, Sparkles, Megaphone, Map, MessageSquare, Bug, Lightbulb,
  Check, Trash2, X, RefreshCw, BellOff, Loader2, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

function getAuthHeaders(): Record<string, string> {
  const t = localStorage.getItem("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

interface Notif {
  id: number;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

type FilterKey = "all" | "new_version" | "announcement" | "roadmap_update" | "feedback_reply" | "bug_reply" | "feature_reply";

const FILTERS: { key: FilterKey; label: string; icon: React.ElementType }[] = [
  { key: "all",            label: "All",             icon: Bell          },
  { key: "new_version",    label: "Releases",        icon: Sparkles      },
  { key: "announcement",   label: "Announcements",   icon: Megaphone     },
  { key: "roadmap_update", label: "Roadmap",         icon: Map           },
  { key: "feedback_reply", label: "Feedback",        icon: MessageSquare },
  { key: "bug_reply",      label: "Bugs",            icon: Bug           },
  { key: "feature_reply",  label: "Features",        icon: Lightbulb     },
];

function getTypeStyle(type: string): { bg: string; icon: React.ReactNode } {
  switch (type) {
    case "new_version":    return { bg: "bg-violet-50",  icon: <Sparkles      className="h-4 w-4 text-violet-600" /> };
    case "announcement":   return { bg: "bg-amber-50",   icon: <Megaphone     className="h-4 w-4 text-amber-600"  /> };
    case "roadmap_update": return { bg: "bg-blue-50",    icon: <Map           className="h-4 w-4 text-blue-600"   /> };
    case "feedback_reply": return { bg: "bg-emerald-50", icon: <MessageSquare className="h-4 w-4 text-emerald-600"/> };
    case "bug_reply":      return { bg: "bg-red-50",     icon: <Bug           className="h-4 w-4 text-red-500"    /> };
    case "feature_reply":  return { bg: "bg-indigo-50",  icon: <Lightbulb     className="h-4 w-4 text-indigo-600" /> };
    default:               return { bg: "bg-slate-100",  icon: <Bell          className="h-4 w-4 text-slate-400"  /> };
  }
}

export default function Notifications() {
  const [notifs, setNotifs]           = useState<Notif[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState<FilterKey>("all");
  const [deleting, setDeleting]       = useState<number | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (filter !== "all") qs.set("type", filter);
      const res = await fetch(`/api/product-hub/notifications?${qs}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setNotifs(data.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function markAllRead() {
    await fetch("/api/product-hub/notifications/read-all", { method: "POST", headers: getAuthHeaders() });
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
  }

  async function deleteOne(id: number) {
    setDeleting(id);
    try {
      await fetch(`/api/product-hub/notifications/${id}`, { method: "DELETE", headers: getAuthHeaders() });
      setNotifs(prev => prev.filter(n => n.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  async function clearAll() {
    setClearingAll(true);
    try {
      await fetch("/api/product-hub/notifications", { method: "DELETE", headers: getAuthHeaders() });
      setNotifs([]);
    } finally {
      setClearingAll(false);
    }
  }

  const unread = notifs.filter(n => !n.isRead).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Bell className="h-6 w-6 text-slate-700" />
            Notification Center
            {unread > 0 && (
              <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-blue-600 text-white text-xs font-bold">
                {unread}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Updates from releases, announcements, and your submitted items.</p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs" onClick={markAllRead}>
              <Check className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
          {notifs.length > 0 && (
            <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs text-red-600 hover:text-red-700 hover:border-red-300" onClick={clearAll} disabled={clearingAll}>
              {clearingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Clear all
            </Button>
          )}
          <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 pb-0">
        {FILTERS.map(f => {
          const Icon = f.icon;
          const count = f.key === "all" ? notifs.length : notifs.filter(n => n.type === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                filter === f.key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {f.label}
              {count > 0 && (
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none",
                  filter === f.key ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-2xl" />)}
        </div>
      ) : notifs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
          <div className="h-14 w-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
            <BellOff className="h-7 w-7 text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-500">No notifications here</p>
          <p className="text-xs text-slate-400">New releases, announcements, and replies will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifs.map(n => {
            const { bg, icon } = getTypeStyle(n.type);
            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 p-4 rounded-2xl border transition-colors",
                  !n.isRead ? "bg-blue-50/40 border-blue-100" : "bg-white border-slate-200"
                )}
              >
                {/* Icon */}
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", bg)}>
                  {icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn("text-sm font-semibold leading-tight", !n.isRead ? "text-slate-900" : "text-slate-700")}>
                      {n.title}
                      {!n.isRead && <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle" />}
                    </p>
                    <span className="text-xs text-slate-400 flex-shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">{n.message}</p>
                  {n.link && (
                    <Link href={n.link} className="inline-flex items-center gap-1 mt-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
                      View <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>

                {/* Delete */}
                <button
                  onClick={() => deleteOne(n.id)}
                  disabled={deleting === n.id}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0 disabled:opacity-50"
                  aria-label="Delete notification"
                >
                  {deleting === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
