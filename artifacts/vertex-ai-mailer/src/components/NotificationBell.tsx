import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bell, Eye, Mail, X, AlertCircle, CheckCircle2,
  RefreshCw, ExternalLink, BellOff, Sparkles, Megaphone,
  Map, MessageSquare, Bug, Lightbulb, Trash2, UserMinus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";

// ─── Types ───────────────────────────────────────────────────────────────────

type EmailNotifType = "open" | "failed_delivery" | "campaign_completed" | "smtp_error" | "draft_completed";
type HubNotifType   = "new_version" | "announcement" | "roadmap_update" | "feedback_reply" | "bug_reply" | "feature_reply" | "unsubscribe";

interface NotifItem {
  id: string;
  source: "email" | "hub";
  hubId?: number;
  type: EmailNotifType | HubNotifType;
  title: string;
  body: string;
  timestamp: string;
  href?: string;
  isAppleMail?: boolean;
  isRead?: boolean;
  metadata?: Record<string, unknown>;
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

const LS_SEEN_KEY   = "notif_last_seen_v2";
const POLL_INTERVAL = 20_000;

function getIconForType(n: NotifItem) {
  if (n.source === "hub") {
    switch (n.type as HubNotifType) {
      case "new_version":    return { bg: "bg-violet-50",  icon: <Sparkles      className="h-3.5 w-3.5 text-violet-600" /> };
      case "announcement":   return { bg: "bg-amber-50",   icon: <Megaphone     className="h-3.5 w-3.5 text-amber-600"  /> };
      case "roadmap_update": return { bg: "bg-blue-50",    icon: <Map           className="h-3.5 w-3.5 text-blue-600"   /> };
      case "feedback_reply": return { bg: "bg-emerald-50", icon: <MessageSquare className="h-3.5 w-3.5 text-emerald-600"/> };
      case "bug_reply":      return { bg: "bg-red-50",     icon: <Bug           className="h-3.5 w-3.5 text-red-500"    /> };
      case "feature_reply":  return { bg: "bg-indigo-50",  icon: <Lightbulb     className="h-3.5 w-3.5 text-indigo-600" /> };
      case "unsubscribe":    return { bg: "bg-orange-50",  icon: <UserMinus     className="h-3.5 w-3.5 text-orange-600" /> };
      default:               return { bg: "bg-slate-100",  icon: <Bell          className="h-3.5 w-3.5 text-slate-400"  /> };
    }
  }
  switch (n.type as EmailNotifType) {
    case "open":
      return {
        bg:   n.isAppleMail ? "bg-slate-100" : "bg-emerald-50",
        icon: <Eye className={cn("h-3.5 w-3.5", n.isAppleMail ? "text-slate-400" : "text-emerald-600")} />,
      };
    case "failed_delivery":    return { bg: "bg-red-50",    icon: <AlertCircle  className="h-3.5 w-3.5 text-red-500"    /> };
    case "campaign_completed": return { bg: "bg-blue-50",   icon: <CheckCircle2 className="h-3.5 w-3.5 text-blue-600"   /> };
    case "smtp_error":         return { bg: "bg-amber-50",  icon: <AlertCircle  className="h-3.5 w-3.5 text-amber-500"  /> };
    case "draft_completed":    return { bg: "bg-violet-50", icon: <Mail         className="h-3.5 w-3.5 text-violet-600" /> };
    default:                   return { bg: "bg-slate-100", icon: <Bell         className="h-3.5 w-3.5 text-slate-400"  /> };
  }
}

// ─── Sound ────────────────────────────────────────────────────────────────────

function playNotifSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [
      { freq: 880, start: 0,    duration: 0.18 },
      { freq: 660, start: 0.20, duration: 0.22 },
    ].forEach(({ freq, start, duration }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.start(now + start);
      osc.stop(now + start + duration);
    });
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch { /* AudioContext not available */ }
}

function fireBrowserNotification(item: NotifItem) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window))  return;
  if (window.Notification.permission !== "granted") return;
  try {
    const bn = new window.Notification(item.title, {
      body: item.body, icon: "/favicon.ico", tag: item.id, requireInteraction: false,
    });
    bn.onclick = () => { window.focus(); if (item.href) window.location.href = item.href; bn.close(); };
  } catch { /* blocked */ }
}

// ─── Deep-link href builder ───────────────────────────────────────────────────

/**
 * Builds the navigation URL for a notification.
 *
 * Email opens/clicks  → /sent-emails?email=<queueId>   (deep-opens the preview drawer)
 * Failed deliveries   → /sent-emails?email=<queueId>   (deep-opens edit/retry modal)
 * new_version hub     → /whats-new?release=<refId>      (scrolls to the release card)
 * announcement hub    → stored link or /whats-new
 * Other hub           → stored link or /notifications
 */
function buildHref(n: Omit<NotifItem, "id" | "title" | "body" | "timestamp">): string {
  if (n.source === "hub") {
    const type = n.type as HubNotifType;
    if (type === "new_version" && (n as any).refId) {
      return `/whats-new?release=${(n as any).refId}`;
    }
    // For announcements use the stored link (it may point to the banner or a custom page)
    return n.href ?? "/notifications";
  }
  // Email notifications: already set during fetch; returned as-is
  return n.href ?? "/sent-emails";
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [unread,  setUnread]  = useState(0);

  const [, navigate] = useLocation();

  const dropRef     = useRef<HTMLDivElement>(null);
  const lastSeenRef = useRef<string | null>(
    typeof window !== "undefined" ? localStorage.getItem(LS_SEEN_KEY) : null
  );
  const shownIds    = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);

  function recomputeUnread(notifs: NotifItem[], seenTs: string | null) {
    const count = notifs.filter(n => {
      if (n.source === "hub") return n.isRead === false;
      return !seenTs || n.timestamp > seenTs;
    }).length;
    setUnread(count);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window))  return;
    if (window.Notification.permission === "default") {
      window.Notification.requestPermission();
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const [opensRes, failedRes, hubRes] = await Promise.all([
        fetch("/api/notifications/live?limit=20",                    { headers: getAuthHeaders() }),
        fetch("/api/sent-emails?statusFilter=failed&limit=8&page=1", { headers: getAuthHeaders() }),
        fetch("/api/product-hub/notifications?limit=20",             { headers: getAuthHeaders() }),
      ]);

      const notifs: NotifItem[] = [];

      // ── Email opens / clicks ──────────────────────────────────────────────
      if (opensRes.ok) {
        const data = await opensRes.json();
        for (const e of (data.events ?? [])) {
          const who = e.customerName ?? e.email ?? "Someone";
          // queueId is the emailQueueTable PK — used to deep-link into Sent Emails
          const emailHref = e.queueId ? `/sent-emails?email=${e.queueId}` : "/sent-emails";
          if (e.eventType === "click") {
            const label = e.buttonLabel ?? e.linkUrl ?? "a link";
            notifs.push({ id: `click-${e.id}`, source: "email", type: "open", title: who,
              body: `Clicked ${label}${e.subject ? ` — ${e.subject}` : ""}`,
              timestamp: e.openedAt, href: emailHref });
          } else {
            notifs.push({ id: `open-${e.id}`, source: "email", type: "open", title: who,
              body: e.isAppleMail
                ? `Possibly opened your email${e.subject ? ` — ${e.subject}` : ""}`
                : `Opened your email${e.subject ? ` — ${e.subject}` : ""}`,
              timestamp: e.openedAt, href: emailHref, isAppleMail: e.isAppleMail });
          }
        }
      }

      // ── Failed deliveries ─────────────────────────────────────────────────
      if (failedRes.ok) {
        const data = await failedRes.json();
        for (const item of (data.data ?? [])) {
          // item.id is the emailQueueTable PK — deep-links to the edit/retry modal
          notifs.push({ id: `fail-${item.id}`, source: "email", type: "failed_delivery",
            title: "Delivery failed",
            body: `${item.email}${item.subject ? ` — ${item.subject}` : ""}`,
            timestamp: item.sentAt ?? item.createdAt,
            href: `/sent-emails?email=${item.id}` });
        }
      }

      // ── Product Hub notifications ─────────────────────────────────────────
      if (hubRes.ok) {
        const data = await hubRes.json();
        for (const n of (data.data ?? [])) {
          // Build deep-link: new_version → /whats-new?release=<refId>; others use stored link
          let href = n.link ?? "/notifications";
          if (n.type === "new_version" && n.refId) {
            href = `/whats-new?release=${n.refId}`;
          }
          notifs.push({
            id:        `hub-${n.id}`,
            source:    "hub",
            hubId:     n.id,
            type:      n.type as HubNotifType,
            title:     n.title,
            body:      n.message,
            timestamp: n.createdAt,
            href,
            isRead:    n.isRead,
            metadata:  n.metadata as Record<string, unknown> | undefined,
          });
        }
      }

      notifs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const sliced = notifs.slice(0, 40);

      if (!isFirstLoad.current) {
        const brandNew = sliced.filter(n => !shownIds.current.has(n.id));
        if (brandNew.length > 0) {
          playNotifSound();
          for (const n of brandNew) fireBrowserNotification(n);
        }
      }
      for (const n of sliced) shownIds.current.add(n.id);
      isFirstLoad.current = false;

      setNotifications(sliced);
      recomputeUnread(sliced, lastSeenRef.current);
    } catch { /* silent — notifications are non-critical */ }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { setLoading(true); fetchNotifications(); }, [fetchNotifications]);
  useEffect(() => {
    const id = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function handleToggle() {
    if (!open) {
      const now = new Date().toISOString();
      localStorage.setItem(LS_SEEN_KEY, now);
      lastSeenRef.current = now;
      // Mark hub notifications as read server-side
      const unreadHub = notifications.filter(n => n.source === "hub" && !n.isRead);
      if (unreadHub.length > 0) {
        fetch("/api/product-hub/notifications/read-all", { method: "POST", headers: getAuthHeaders() });
        setNotifications(prev => prev.map(n => n.source === "hub" ? { ...n, isRead: true } : n));
      }
      recomputeUnread(
        notifications.map(n => n.source === "hub" ? { ...n, isRead: true } : n),
        now
      );
    }
    setOpen(v => !v);
  }

  function handleMarkAllRead() {
    const now = new Date().toISOString();
    localStorage.setItem(LS_SEEN_KEY, now);
    lastSeenRef.current = now;
    fetch("/api/product-hub/notifications/read-all", { method: "POST", headers: getAuthHeaders() });
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnread(0);
  }

  async function handleDelete(n: NotifItem) {
    if (n.source !== "hub" || !n.hubId) return;
    await fetch(`/api/product-hub/notifications/${n.hubId}`, { method: "DELETE", headers: getAuthHeaders() });
    setNotifications(prev => {
      const updated = prev.filter(x => x.id !== n.id);
      recomputeUnread(updated, lastSeenRef.current);
      return updated;
    });
  }

  /** Navigate to a notification's target page using the wouter router (SPA nav, no reload). */
  function handleNotifClick(n: NotifItem) {
    setOpen(false);
    const href = n.href;
    if (!href) return;
    if (href.startsWith("/")) {
      navigate(href);
    } else {
      // External URL (e.g. a doc link stored in n.link)
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }

  const badge = unread > 9 ? "9+" : unread > 0 ? String(unread) : null;

  // Unused but kept so buildHref is not dead code (used externally via fireBrowserNotification)
  void buildHref;

  return (
    <div className="relative" ref={dropRef}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className={cn(
          "relative flex items-center justify-center h-9 w-9 rounded-xl transition-colors",
          open
            ? "bg-blue-50 text-blue-600"
            : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60 hover:text-slate-700 dark:hover:text-slate-200"
        )}
        aria-label="Notifications"
      >
        <Bell className="h-[18px] w-[18px]" />
        {badge && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none border-2 border-white">
            {badge}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="
          fixed left-2 right-2 top-[3.75rem] z-50
          sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:w-[400px]
          bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700/60 overflow-hidden flex flex-col max-h-[540px]
        ">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-slate-700" />
              <span className="text-sm font-semibold text-slate-900">Notifications</span>
              {unread > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-600 text-white rounded-full leading-none">
                  {unread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={handleMarkAllRead}
                  className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors font-medium">
                  Mark all read
                </button>
              )}
              <button onClick={() => { setLoading(true); fetchNotifications(); }} disabled={loading}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors disabled:opacity-50"
                aria-label="Refresh notifications">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
              <button onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors">
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
                  <p className="text-xs text-slate-400 mt-0.5">Email opens, releases, and replies appear here.</p>
                </div>
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {notifications.map(n => {
                  const isUnread = n.source === "hub"
                    ? n.isRead === false
                    : (!lastSeenRef.current || n.timestamp > lastSeenRef.current);
                  const { bg, icon } = getIconForType(n);
                  return (
                    <div key={n.id} className={cn(
                      "group flex items-start gap-3 px-2.5 py-2.5 rounded-xl transition-colors",
                      isUnread
                        ? "bg-blue-50/40 dark:bg-blue-900/20 hover:bg-blue-50 dark:hover:bg-blue-900/35"
                        : "hover:bg-slate-50 dark:hover:bg-slate-700/40"
                    )}>
                      <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", bg)}>
                        {icon}
                      </div>
                      {/* Clickable notification body — uses wouter SPA navigation */}
                      <button
                        onClick={() => handleNotifClick(n)}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn("text-xs font-semibold truncate", isUnread ? "text-slate-900" : "text-slate-700")}>
                            {n.title}
                            {isUnread && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle" />}
                          </p>
                          <span className="text-[11px] text-slate-400 flex-shrink-0 mt-0.5">{timeAgo(n.timestamp)}</span>
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5 leading-relaxed">{n.body}</p>
                        {n.type === "unsubscribe" && n.metadata && (
                          <div className="mt-1.5 space-y-0.5">
                            <p className="text-[11px] text-slate-400 leading-snug">
                              <span className="font-medium text-slate-500">Campaign:</span>{" "}
                              {(n.metadata.campaignName as string) || "Unknown"}
                            </p>
                            <p className="text-[11px] text-slate-400 leading-snug">
                              <span className="font-medium text-slate-500">Template:</span>{" "}
                              {(n.metadata.templateName as string) || "Unknown"}
                            </p>
                            <p className="text-[11px] text-slate-400 leading-snug">
                              <span className="font-medium text-slate-500">Reason:</span>{" "}
                              {((n.metadata.unsubscribeReason as string) || "").replace(/_/g, " ") || "Not provided"}
                            </p>
                          </div>
                        )}
                        {n.isAppleMail && (
                          <span className="inline-block mt-0.5 text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                            Apple Mail
                          </span>
                        )}
                      </button>
                      {n.source === "hub" && (
                        <button onClick={() => handleDelete(n)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0 mt-0.5"
                          aria-label="Delete notification">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-slate-100 flex-shrink-0">
            <Link href="/notifications" onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium py-1 rounded-lg hover:bg-blue-50 transition-colors">
              View all notifications <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
