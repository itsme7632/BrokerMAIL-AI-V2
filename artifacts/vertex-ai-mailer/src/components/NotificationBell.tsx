import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bell, Eye, Mail, X, AlertCircle, CheckCircle2,
  RefreshCw, ExternalLink, BellOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

// ─── Types ───────────────────────────────────────────────────────────────────

type NotifType = "open" | "failed_delivery" | "campaign_completed" | "smtp_error" | "draft_completed";

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  timestamp: string;
  href?: string;
  isAppleMail?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function getAuthHeaders(): Record<string, string> {
  const t = localStorage.getItem("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const LS_SEEN_KEY = "notif_last_seen_v2";

function getIconForType(type: NotifType, isAppleMail?: boolean) {
  switch (type) {
    case "open":
      return {
        bg: isAppleMail ? "bg-slate-100" : "bg-emerald-50",
        icon: <Eye className={cn("h-3.5 w-3.5", isAppleMail ? "text-slate-400" : "text-emerald-600")} />,
      };
    case "failed_delivery":
      return { bg: "bg-red-50", icon: <AlertCircle className="h-3.5 w-3.5 text-red-500" /> };
    case "campaign_completed":
      return { bg: "bg-blue-50", icon: <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" /> };
    case "smtp_error":
      return { bg: "bg-amber-50", icon: <AlertCircle className="h-3.5 w-3.5 text-amber-500" /> };
    case "draft_completed":
      return { bg: "bg-violet-50", icon: <Mail className="h-3.5 w-3.5 text-violet-600" /> };
    default:
      return { bg: "bg-slate-100", icon: <Bell className="h-3.5 w-3.5 text-slate-400" /> };
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const lastSeen = useRef<string | null>(
    typeof window !== "undefined" ? localStorage.getItem(LS_SEEN_KEY) : null
  );

  const unreadCount = notifications.filter(n =>
    !lastSeen.current || n.timestamp > lastSeen.current
  ).length;

  // ─── Fetch ────────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    try {
      const [opensRes, failedRes] = await Promise.all([
        fetch("/api/notifications/live?limit=20", { headers: getAuthHeaders() }),
        fetch("/api/sent-emails?statusFilter=failed&limit=8&page=1", { headers: getAuthHeaders() }),
      ]);

      const notifs: Notification[] = [];

      // Email opens
      if (opensRes.ok) {
        const data = await opensRes.json();
        for (const e of (data.events ?? [])) {
          notifs.push({
            id:         `open-${e.id}`,
            type:       "open",
            title:      e.customerName ?? e.email ?? "Someone",
            body:       e.isAppleMail
              ? `Possibly opened your email${e.subject ? ` — ${e.subject}` : ""}`
              : `Opened your email${e.subject ? ` — ${e.subject}` : ""}`,
            timestamp:  e.openedAt,
            href:       "/sent-emails",
            isAppleMail: e.isAppleMail,
          });
        }
      }

      // Failed deliveries
      if (failedRes.ok) {
        const data = await failedRes.json();
        for (const item of (data.data ?? [])) {
          notifs.push({
            id:        `fail-${item.id}`,
            type:      "failed_delivery",
            title:     "Delivery failed",
            body:      `${item.email}${item.subject ? ` — ${item.subject}` : ""}`,
            timestamp: item.sentAt ?? item.createdAt,
            href:      "/sent-emails",
          });
        }
      }

      // Sort newest first
      notifs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setNotifications(notifs.slice(0, 30));
    } catch {
      // silent — notifications are non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    setLoading(true);
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const id = setInterval(fetchNotifications, 20_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Mark all as seen when opening
  function handleToggle() {
    if (!open) {
      const now = new Date().toISOString();
      localStorage.setItem(LS_SEEN_KEY, now);
      lastSeen.current = now;
    }
    setOpen(v => !v);
  }

  function handleMarkAllRead() {
    const now = new Date().toISOString();
    localStorage.setItem(LS_SEEN_KEY, now);
    lastSeen.current = now;
    setNotifications(prev => [...prev]); // re-render
  }

  const badge = unreadCount > 9 ? "9+" : unreadCount > 0 ? String(unreadCount) : null;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={dropRef}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className={cn(
          "relative flex items-center justify-center h-9 w-9 rounded-xl transition-colors",
          open
            ? "bg-blue-50 text-blue-600"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        )}
        aria-label="Notifications"
      >
        <Bell className="h-4.5 w-4.5 h-[18px] w-[18px]" />
        {badge && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none border-2 border-white">
            {badge}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[380px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[520px]
          max-[420px]:w-screen max-[420px]:right-[-1rem] max-[420px]:rounded-none max-[420px]:rounded-b-2xl">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-slate-700" />
              <span className="text-sm font-semibold text-slate-900">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-600 text-white rounded-full leading-none">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors font-medium"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => fetchNotifications()}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Refresh"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {loading && notifications.length === 0 ? (
              <div className="p-3 space-y-1">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl">
                    <div className="h-8 w-8 rounded-xl bg-slate-100 animate-pulse flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-slate-100 rounded animate-pulse w-3/4" />
                      <div className="h-2.5 bg-slate-100 rounded animate-pulse w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-slate-400 gap-3">
                <div className="h-12 w-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                  <BellOff className="h-5 w-5 text-slate-300" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-500">No notifications yet</p>
                  <p className="text-xs text-slate-400 mt-0.5">Email opens and alerts will appear here.</p>
                </div>
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {notifications.map(n => {
                  const isUnread = !lastSeen.current || n.timestamp > lastSeen.current;
                  const { bg, icon } = getIconForType(n.type, n.isAppleMail);
                  return (
                    <a
                      key={n.id}
                      href={n.href ?? "#"}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-start gap-3 px-2.5 py-2.5 rounded-xl transition-colors cursor-pointer no-underline",
                        isUnread ? "bg-blue-50/40 hover:bg-blue-50" : "hover:bg-slate-50"
                      )}
                    >
                      {/* Type icon */}
                      <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", bg)}>
                        {icon}
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn("text-xs font-semibold truncate", isUnread ? "text-slate-900" : "text-slate-700")}>
                            {n.title}
                            {isUnread && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle" />}
                          </p>
                          <span className="text-[11px] text-slate-400 flex-shrink-0 mt-0.5">{timeAgo(n.timestamp)}</span>
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5 leading-relaxed">{n.body}</p>
                        {n.isAppleMail && (
                          <span className="inline-block mt-0.5 text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                            Apple Mail
                          </span>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-slate-100 flex-shrink-0">
            <Link
              href="/sent-emails"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium py-1 rounded-lg hover:bg-blue-50 transition-colors"
            >
              View all sent emails <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
