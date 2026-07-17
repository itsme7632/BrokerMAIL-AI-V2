import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Search, Star, Archive, Inbox, ChevronRight, ChevronLeft, ChevronDown,
  Reply, Forward, MoreHorizontal, Mail, Phone, Truck,
  MapPin, DollarSign, Megaphone, Server, Tag,
  CheckCircle2, Eye, MousePointerClick, AlertTriangle,
  Loader2, RefreshCw, Send, StickyNote, X,
  MessageSquare, Sparkles, ArrowUpRight,
  CornerDownLeft, Bold, Italic, Paperclip, ListTodo,
  Wifi, WifiOff, Clock, Download, File,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Types ────────────────────────────────────────────────────────────────────

type Conversation = {
  id: number;
  leadId: number | null;
  campaignId: number | null;
  subject: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  status: string;
  starred: boolean;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string;
};

type Message = {
  id: number;
  conversationId: number;
  direction: "outbound" | "inbound";
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string | null;
  body: string;
  htmlBody: string | null;
  snippet: string | null;
  isRead: boolean;
  sentAt: string | null;
  createdAt: string;
  attachmentsMeta: string | null;
};

type Lead = {
  id: number;
  name: string;
  email: string;
  vehicle: string | null;
  route: string | null;
  pickup: string | null;
  delivery: string | null;
  price: string | null;
  notes: string | null;
  quoteId: string | null;
};

type Campaign = { id: number; name: string };

type Note = { id: number; content: string; createdAt: string };

type ConversationDetail = {
  conversation: Conversation;
  messages: Message[];
  notes: Note[];
  lead: Lead | null;
  campaign: Campaign | null;
};

type Stats = { total: number; unread: number; needsReply: number; starred: number };

type MailboxOption = { id: string | number; email: string; type: "gmail" | "smtp" };

type AttachmentMeta = { name: string; size: number; mimeType: string; partId?: string };

type SyncStatus = {
  isSyncing: boolean;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  liveConnections: number;
  mailboxes: Array<{ email: string; type: string; connected: boolean; lastSyncAt: string | null }>;
  lastSyncResults: Array<{ mailbox: string; imported: number; error?: string }>;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token") ?? "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function initials(name: string): string {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

function avatarColor(email: string): string {
  const colors = [
    "from-blue-500 to-indigo-600",
    "from-violet-500 to-purple-600",
    "from-emerald-500 to-teal-600",
    "from-rose-500 to-pink-600",
    "from-amber-500 to-orange-600",
    "from-cyan-500 to-sky-600",
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) & 0xffff;
  return colors[hash % colors.length];
}

function statusBadge(status: string) {
  switch (status) {
    case "unread":      return { label: "Unread",      cls: "bg-blue-500 text-white" };
    case "needs_reply": return { label: "Needs Reply", cls: "bg-amber-500 text-white" };
    case "replied":     return { label: "Replied",     cls: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30" };
    case "archived":    return { label: "Archived",    cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" };
    default:            return null;
  }
}

// ─── Filter tab ───────────────────────────────────────────────────────────────

type FilterKey = "all" | "unread" | "needs_reply" | "starred" | "archived" | "spam";

const FILTERS: { key: FilterKey; label: string; icon: React.ElementType }[] = [
  { key: "all",         label: "Inbox",       icon: Inbox },
  { key: "unread",      label: "Unread",      icon: Mail },
  { key: "needs_reply", label: "Needs Reply", icon: CornerDownLeft },
  { key: "starred",     label: "Starred",     icon: Star },
  { key: "archived",    label: "Archived",    icon: Archive },
  { key: "spam",        label: "Spam",        icon: AlertTriangle },
];

// ─── Today's Work quick chips ─────────────────────────────────────────────────

const TODAY_CHIPS: { key: FilterKey | "waiting_payment" | "booked_today" | "high_priority"; label: string; color: string }[] = [
  { key: "needs_reply",    label: "Needs Reply",     color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800/40" },
  { key: "unread",         label: "Unread",          color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800/40" },
  { key: "waiting_payment",label: "Waiting Payment", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-violet-200 dark:border-violet-800/40" },
  { key: "booked_today",   label: "Booked Today",    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40" },
  { key: "high_priority",  label: "High Priority",   color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-rose-200 dark:border-rose-800/40" },
];

// ─── Collapsible right-panel section ─────────────────────────────────────────

function usePanelSection(key: string, defaultOpen: boolean) {
  const storageKey = `comm_panel_${key}`;
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? String(defaultOpen)); }
    catch { return defaultOpen; }
  });
  const toggle = () => setOpen((v: boolean) => {
    const next = !v;
    localStorage.setItem(storageKey, String(next));
    return next;
  });
  return [open as boolean, toggle] as const;
}

function PanelSection({ title, sectionKey, defaultOpen = false, children }: {
  title: string; sectionKey: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, toggle] = usePanelSection(sectionKey, defaultOpen);
  return (
    <div className="border-b border-slate-100 dark:border-slate-800/80">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group"
      >
        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
          {title}
        </span>
        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-slate-400 dark:text-slate-500 transition-transform duration-200",
          open && "rotate-180"
        )} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ─── Conversation Item ────────────────────────────────────────────────────────

function ConvItem({
  conv, isActive, onClick,
}: {
  conv: Conversation; isActive: boolean; onClick: () => void;
}) {
  const color = avatarColor(conv.customerEmail);
  const badge = statusBadge(conv.status);
  const isUnread = conv.status === "unread";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-3.5 border-b border-slate-100 dark:border-slate-800/60 transition-colors group relative",
        isActive
          ? "bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500"
          : "hover:bg-slate-50 dark:hover:bg-slate-800/40 border-l-2 border-l-transparent",
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <Avatar className="h-9 w-9 flex-shrink-0 mt-0.5">
          <AvatarFallback className={`bg-gradient-to-br ${color} text-white text-xs font-semibold`}>
            {initials(conv.customerName)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          {/* Row 1: name + time */}
          <div className="flex items-center justify-between gap-1.5">
            <span className={cn("text-sm truncate", isUnread ? "font-semibold text-slate-900 dark:text-slate-100" : "font-medium text-slate-700 dark:text-slate-300")}>
              {conv.customerName}
            </span>
            <span className="text-[10px] text-slate-400 flex-shrink-0">
              {timeAgo(conv.lastMessageAt)}
            </span>
          </div>

          {/* Row 2: subject */}
          <p className={cn("text-xs truncate mt-0.5", isUnread ? "text-slate-700 dark:text-slate-200 font-medium" : "text-slate-500 dark:text-slate-400")}>
            {conv.subject}
          </p>

          {/* Row 3: email + badges */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[10px] text-slate-400 truncate flex-1">{conv.customerEmail}</span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {conv.starred && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
              {badge && (
                <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-semibold leading-none", badge.cls)}>
                  {badge.label}
                </span>
              )}
              {conv.unreadCount > 0 && (
                <span className="h-4 min-w-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center">
                  {conv.unreadCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── SSE hook ─────────────────────────────────────────────────────────────────

function useCommEvents() {
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(2_000);

  const connect = useCallback(() => {
    const token = localStorage.getItem("auth_token") ?? "";
    if (!token) { setStatus("disconnected"); return; }
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    setStatus("connecting");

    const es = new EventSource(`/api/communications/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.onopen = () => { setStatus("connected"); delayRef.current = 2_000; };

    es.onmessage = (e: MessageEvent) => {
      try {
        const ev: { type: string; conversationId?: number } = JSON.parse(e.data);
        switch (ev.type) {
          case "connected": setStatus("connected"); break;
          case "new_message":
          case "conversation_updated":
          case "note_added":
            if (ev.conversationId) queryClient.invalidateQueries({ queryKey: ["conv-detail", ev.conversationId] });
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
            break;
          case "sync_started":
          case "sync_complete":
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
            queryClient.invalidateQueries({ queryKey: ["comm-sync-status"] });
            break;
          case "tracking_event":
            if (ev.conversationId) queryClient.invalidateQueries({ queryKey: ["conv-detail", ev.conversationId] });
            break;
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setStatus("disconnected");
      const delay = Math.min(delayRef.current, 30_000);
      delayRef.current = Math.min(delay * 2, 30_000);
      retryRef.current = setTimeout(connect, delay);
    };
  }, [queryClient]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);

  return status;
}

// ─── Email-specific helpers ───────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d === 1) return "Yesterday";
  return `${d}d ago`;
}

// ─── HTML Email Renderer ──────────────────────────────────────────────────────
// Renders HTML email in a sandboxed iframe; strips scripts + inline handlers.

function HtmlEmailRenderer({ html, isOutbound }: { html: string; isOutbound: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);

  const clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\s+on\w+\s*=/gi, " data-removed=");

  const doc = [
    "<!DOCTYPE html><html><head><meta charset='utf-8'><style>",
    "*{box-sizing:border-box}",
    `body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.5;color:${isOutbound ? "#fff" : "#1e293b"};background:transparent;word-break:break-word;overflow:hidden}`,
    `img{max-width:100%;height:auto}a{color:${isOutbound ? "#93c5fd" : "#3b82f6"}}`,
    "table{max-width:100%!important;border-collapse:collapse}p{margin:2px 0}",
    `blockquote{margin:4px 0 4px 12px;padding-left:8px;border-left:3px solid ${isOutbound ? "rgba(255,255,255,.3)" : "#e2e8f0"};color:${isOutbound ? "rgba(255,255,255,.7)" : "#64748b"}}`,
    `</style></head><body>${clean}</body></html>`,
  ].join("");

  const handleLoad = useCallback(() => {
    try {
      const el = iframeRef.current?.contentDocument?.documentElement;
      if (el) setHeight(Math.max(40, Math.min(500, el.scrollHeight)));
    } catch { /* sandboxed */ }
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={doc}
      sandbox="allow-same-origin"
      onLoad={handleLoad}
      style={{ width: "100%", height: `${height}px`, border: "none", display: "block" }}
      title="Email content"
    />
  );
}

// ─── Attachment List ──────────────────────────────────────────────────────────

function AttachmentList({ metaJson, isOutbound }: { metaJson: string; isOutbound: boolean }) {
  let items: AttachmentMeta[] = [];
  try { items = JSON.parse(metaJson); } catch { return null; }
  if (!items.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((att, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium",
            isOutbound
              ? "bg-white/15 text-white"
              : "bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300",
          )}
          title={att.name}
        >
          <File className="h-3 w-3 flex-shrink-0" />
          <span className="truncate max-w-[100px]">{att.name}</span>
          <span className="opacity-60 flex-shrink-0">{formatBytes(att.size)}</span>
          <Download className="h-3 w-3 flex-shrink-0 opacity-50 hover:opacity-100 cursor-pointer" />
        </div>
      ))}
    </div>
  );
}

// ─── Sync Status Widget ───────────────────────────────────────────────────────

function SyncStatusWidget() {
  const { data } = useQuery<SyncStatus>({
    queryKey: ["comm-sync-status"],
    queryFn: () => apiFetch("/api/communications/sync-status"),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  if (!data) return null;

  const nextIn = data.nextSyncAt
    ? Math.max(0, Math.ceil((new Date(data.nextSyncAt).getTime() - Date.now()) / 60_000))
    : null;

  return (
    <div className="mx-3 mb-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
      {data.isSyncing ? (
        <div className="flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin text-blue-500 flex-shrink-0" />
          <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400">Syncing mailboxes…</p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <Clock className="h-2.5 w-2.5 text-slate-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-400 truncate">
              {data.lastSyncAt ? `Synced ${timeAgoShort(data.lastSyncAt)}` : "Never synced"}
            </span>
          </div>
          {nextIn !== null && (
            <span className="text-[10px] text-slate-400 flex-shrink-0">
              {nextIn === 0 ? "due now" : `next ${nextIn}m`}
            </span>
          )}
        </div>
      )}
      {data.mailboxes.length > 0 && (
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {data.mailboxes.map(mb => (
            <div key={mb.email} className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px]",
              mb.connected
                ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
                : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400",
            )}>
              <div className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0",
                mb.connected ? "bg-emerald-500" : "bg-red-500")} />
              <span className="truncate max-w-[72px]">{mb.email.split("@")[0]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Left Panel ───────────────────────────────────────────────────────────────

function LeftPanel({
  filter, setFilter, search, setSearch,
  conversations, isLoading, selectedId, onSelect, stats, onRefresh, isSyncing,
  mailboxes, selectedMailboxId, onMailboxChange, connectionStatus,
}: {
  filter: FilterKey; setFilter: (f: FilterKey) => void;
  search: string; setSearch: (s: string) => void;
  conversations: Conversation[]; isLoading: boolean;
  selectedId: number | null; onSelect: (id: number) => void;
  stats: Stats | undefined; onRefresh: () => void; isSyncing: boolean;
  mailboxes: MailboxOption[]; selectedMailboxId: string | number | null;
  onMailboxChange: (id: string | number | null) => void;
  connectionStatus: "connecting" | "connected" | "disconnected";
}) {
  const { toast } = useToast();

  const handleChip = (key: string) => {
    if (key === "needs_reply" || key === "unread") {
      setFilter(key as FilterKey);
    } else {
      toast({ title: "Coming soon", description: "This filter will be available with full inbox sync." });
    }
  };

  const safeMailboxes = mailboxes ?? [];
  const selectedMailboxLabel = selectedMailboxId === null
    ? "All Mailboxes"
    : safeMailboxes.find(m => m.id === selectedMailboxId)?.email ?? "All Mailboxes";

  return (
    <div className="flex flex-col h-full border-r border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900">
      {/* Top bar: title + mailbox selector + refresh */}
      <div className="px-4 pt-4 pb-3 flex-shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">Communications</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-default">
                  {connectionStatus === "disconnected" ? (
                    <WifiOff className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                  ) : (
                    <Wifi className={cn("h-3.5 w-3.5 flex-shrink-0", {
                      "text-emerald-500": connectionStatus === "connected",
                      "text-amber-500 animate-pulse": connectionStatus === "connecting",
                    })} />
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {connectionStatus === "connected" ? "Live updates active" :
                 connectionStatus === "connecting" ? "Connecting to live updates…" :
                 "Disconnected — reconnecting"}
              </TooltipContent>
            </Tooltip>
          </div>
          <button
            onClick={onRefresh}
            disabled={isSyncing}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors disabled:opacity-50"
            title={isSyncing ? "Syncing…" : "Sync mailboxes"}
          >
            <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
          </button>
        </div>

        {/* Mailbox selector — dynamic from API */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors">
              <div className="flex items-center gap-2">
                <Server className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                <span className="truncate">{selectedMailboxLabel}</span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {/* All Mailboxes */}
            <DropdownMenuItem
              onClick={() => onMailboxChange(null)}
              className={cn("text-xs gap-2", selectedMailboxId === null && "text-blue-600 dark:text-blue-400 font-medium")}
            >
              <Server className="h-3 w-3 text-slate-400 flex-shrink-0" />
              <span className="flex-1">All Mailboxes</span>
              {selectedMailboxId === null && <CheckCircle2 className="h-3 w-3 text-blue-500 flex-shrink-0" />}
            </DropdownMenuItem>

            {safeMailboxes.length === 0 ? (
              <>
                <DropdownMenuSeparator />
                <div className="px-3 py-2">
                  <p className="text-[10px] text-slate-400 font-medium mb-1.5">No mailboxes connected</p>
                  <a href="/mailbox" className="block text-[10px] text-blue-500 hover:text-blue-600 font-medium">Connect Gmail →</a>
                  <a href="/mailbox" className="block text-[10px] text-blue-500 hover:text-blue-600 font-medium mt-0.5">Connect SMTP →</a>
                </div>
              </>
            ) : (
              <>
                <DropdownMenuSeparator />
                {safeMailboxes.map(mb => (
                  <DropdownMenuItem
                    key={String(mb.id)}
                    onClick={() => onMailboxChange(mb.id)}
                    className={cn("text-xs gap-2", selectedMailboxId === mb.id && "text-blue-600 dark:text-blue-400 font-medium")}
                  >
                    <Server className={cn("h-3 w-3 flex-shrink-0", mb.type === "gmail" ? "text-rose-400" : "text-slate-400")} />
                    <span className="flex-1 truncate">{mb.email}</span>
                    <span className="text-[9px] uppercase tracking-wide text-slate-400">{mb.type}</span>
                    {selectedMailboxId === mb.id && <CheckCircle2 className="h-3 w-3 text-blue-500 flex-shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customer, email, vehicle…"
            className="pl-8 h-8 text-xs rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-slate-400 hover:text-slate-600" />
            </button>
          )}
        </div>
      </div>

      {/* Sync status */}
      <SyncStatusWidget />

      {/* Filter tabs */}
      <div className="px-3 pb-2 flex-shrink-0 space-y-0.5">
        {FILTERS.map(f => {
          const count = f.key === "unread" ? stats?.unread
            : f.key === "needs_reply" ? stats?.needsReply
            : f.key === "starred" ? stats?.starred
            : undefined;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800",
              )}
            >
              <f.icon className={cn("h-3.5 w-3.5 flex-shrink-0", filter === f.key ? "text-blue-500" : "text-slate-400")} />
              <span className="flex-1 text-left">{f.label}</span>
              {count !== undefined && count > 0 && (
                <span className="h-4 min-w-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Today's Work quick chips */}
      <div className="px-3 pb-3 flex-shrink-0">
        <div className="mb-2">
          <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1 mb-1.5">Today's Work</p>
          <div className="flex flex-wrap gap-1.5">
            {TODAY_CHIPS.map(chip => (
              <button
                key={chip.key}
                onClick={() => handleChip(chip.key)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors",
                  chip.color,
                  (chip.key === filter) && "ring-1 ring-offset-1 ring-current"
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-3 border-t border-slate-100 dark:border-slate-800 flex-shrink-0" />

      {/* Conversation count */}
      <div className="px-4 py-2 flex-shrink-0">
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          {stats ? `${stats.total} conversation${stats.total === 1 ? "" : "s"}` : "Loading…"}
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-0 divide-y divide-slate-100 dark:divide-slate-800">
            {Array(6).fill(0).map((_, i) => (
              <div key={i} className="px-3 py-3.5 flex items-start gap-2.5">
                <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="h-14 w-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
              <MessageSquare className="h-7 w-7 text-slate-300 dark:text-slate-600" />
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {search ? "No matching conversations" : filter !== "all" ? `No ${filter.replace("_", " ")} conversations` : "No conversations yet"}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {search ? "Try a different search" : "Send your first campaign to get started"}
            </p>
          </div>
        ) : (
          conversations.map(conv => (
            <ConvItem
              key={conv.id}
              conv={conv}
              isActive={selectedId === conv.id}
              onClick={() => onSelect(conv.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, customerName }: { msg: Message; customerName: string }) {
  const isOut = msg.direction === "outbound";
  const time = msg.sentAt ?? msg.createdAt;

  return (
    <div className={cn("flex gap-3 group", isOut ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <Avatar className="h-7 w-7 flex-shrink-0 mt-1">
        <AvatarFallback className={cn(
          "text-white text-[10px] font-semibold bg-gradient-to-br",
          isOut ? "from-blue-500 to-indigo-600" : avatarColor(msg.fromEmail)
        )}>
          {isOut ? "You" : initials(customerName)}
        </AvatarFallback>
      </Avatar>

      <div className={cn("flex flex-col max-w-[72%]", isOut ? "items-end" : "items-start")}>
        {/* Meta */}
        <div className={cn("flex items-center gap-2 mb-1", isOut ? "flex-row-reverse" : "flex-row")}>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {isOut ? "You" : (msg.fromName ?? customerName)}
          </span>
          <span className="text-[10px] text-slate-400">{fullTime(time)}</span>
        </div>

        {/* Bubble */}
        <div className={cn(
          "rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isOut
            ? "bg-blue-600 text-white rounded-tr-sm"
            : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-tl-sm",
        )}>
          {msg.htmlBody ? (
            <HtmlEmailRenderer html={msg.htmlBody} isOutbound={isOut} />
          ) : (
            <p className="whitespace-pre-wrap">{msg.body}</p>
          )}
          {msg.attachmentsMeta && (
            <AttachmentList metaJson={msg.attachmentsMeta} isOutbound={isOut} />
          )}
        </div>

        {/* Actions */}
        <div className={cn(
          "flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity",
          isOut ? "flex-row-reverse" : "flex-row"
        )}>
          <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors">
            <Reply className="h-3 w-3" />
          </button>
          <button className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors">
            <Forward className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reply Composer ───────────────────────────────────────────────────────────

function ReplyComposer({
  conv, onNoteSent,
}: {
  conv: Conversation; onNoteSent: () => void;
}) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleNote = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/api/communications/conversations/${conv.id}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      setText("");
      toast({ title: "Note saved" });
      queryClient.invalidateQueries({ queryKey: ["conv-detail", conv.id] });
      onNoteSent();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setSending(false);
    }
  };

  const handleReply = () => {
    toast({ title: "Reply coming soon", description: "Direct reply will be live once mailbox sync is enabled." });
  };

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
      {/* Mode tabs */}
      <div className="flex border-b border-slate-100 dark:border-slate-800">
        <button
          onClick={() => setMode("reply")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors",
            mode === "reply"
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Reply className="h-3.5 w-3.5" /> Reply
        </button>
        <button
          onClick={() => setMode("note")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors",
            mode === "note"
              ? "border-amber-500 text-amber-600 dark:text-amber-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <StickyNote className="h-3.5 w-3.5" /> Internal Note
        </button>
      </div>

      <div className="p-3">
        {mode === "note" && (
          <div className="mb-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-[10px] text-amber-700 dark:text-amber-400">
            <StickyNote className="h-3 w-3 flex-shrink-0" />
            This note is private — never sent to the customer
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 mb-2 pb-2 border-b border-slate-100 dark:border-slate-800">
          {[
            { icon: Bold, label: "Bold" },
            { icon: Italic, label: "Italic" },
          ].map(({ icon: Icon, label }) => (
            <button key={label} title={label} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 transition-colors">
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
          <button title="Attach file" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 transition-colors">
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          {mode === "reply" && (
            <>
              <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
              <button
                title="AI Generate Reply"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-800/40 transition-colors border border-violet-200 dark:border-violet-800/40"
              >
                <Sparkles className="h-3 w-3" /> AI Reply
              </button>
            </>
          )}
        </div>

        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={mode === "reply" ? `Reply to ${conv.customerName}…` : "Add a private note for your team…"}
          className={cn(
            "min-h-[80px] resize-none text-sm rounded-xl border-slate-200 dark:border-slate-700 bg-transparent focus-visible:ring-1",
            mode === "note" ? "focus-visible:ring-amber-400" : "focus-visible:ring-blue-400"
          )}
        />

        <div className="flex items-center justify-between mt-2">
          <p className="text-[10px] text-slate-400">
            {mode === "reply" ? `To: ${conv.customerEmail}` : "Visible to team only"}
          </p>
          <Button
            size="sm"
            onClick={mode === "reply" ? handleReply : handleNote}
            disabled={!text.trim() || sending}
            className={cn(
              "h-8 px-4 text-xs rounded-xl gap-1.5",
              mode === "note" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""
            )}
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : mode === "reply" ? <Send className="h-3 w-3" /> : <StickyNote className="h-3 w-3" />}
            {mode === "reply" ? "Send Reply" : "Save Note"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Middle Panel (Thread) ────────────────────────────────────────────────────

function MiddlePanel({
  selectedId, onBack, onOpenDetails, showDetailsButton,
}: {
  selectedId: number | null; onBack: () => void;
  onOpenDetails: () => void; showDetailsButton: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ConversationDetail>({
    queryKey: ["conv-detail", selectedId],
    queryFn: () => apiFetch(`/api/communications/conversations/${selectedId}`),
    enabled: selectedId !== null,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/api/communications/conversations/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conv-detail", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
    },
  });

  useEffect(() => {
    if (data) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [data?.messages?.length]);

  if (!selectedId) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-950">
        <div className="h-16 w-16 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mb-4 shadow-sm">
          <MessageSquare className="h-8 w-8 text-slate-300 dark:text-slate-600" />
        </div>
        <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300">Select a conversation</h3>
        <p className="text-sm text-slate-400 mt-1">Choose a conversation from the list to view the thread</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
        <div className="h-14 px-4 flex items-center border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="flex-1 p-5 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className={cn("flex gap-3", i % 2 === 0 ? "flex-row-reverse" : "flex-row")}>
              <Skeleton className="h-7 w-7 rounded-full flex-shrink-0" />
              <Skeleton className="h-20 w-64 rounded-2xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { conversation: conv, messages, notes } = data;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      {/* Thread header */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
        {/* Mobile back */}
        <button onClick={onBack} className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
          <ChevronLeft className="h-4 w-4" />
        </button>

        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarFallback className={`bg-gradient-to-br ${avatarColor(conv.customerEmail)} text-white text-xs font-semibold`}>
            {initials(conv.customerName)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{conv.customerName}</p>
          <p className="text-xs text-slate-400 truncate">{conv.subject}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => updateMutation.mutate({ starred: !conv.starred })}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Star className={cn("h-4 w-4", conv.starred ? "fill-amber-400 text-amber-400" : "text-slate-400")} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{conv.starred ? "Unstar" : "Star"}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => updateMutation.mutate({ status: "needs_reply" })} className="gap-2 text-xs">
                <CornerDownLeft className="h-3.5 w-3.5" /> Mark Needs Reply
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateMutation.mutate({ status: "replied" })} className="gap-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark Replied
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => updateMutation.mutate({ status: "archived" })} className="gap-2 text-xs text-slate-500">
                <Archive className="h-3.5 w-3.5" /> Archive
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateMutation.mutate({ status: "spam" })} className="gap-2 text-xs text-red-500 focus:text-red-600">
                <AlertTriangle className="h-3.5 w-3.5" /> Mark as Spam
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {showDetailsButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onOpenDetails}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Customer Details</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Mail className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-sm">No messages in this thread yet</p>
          </div>
        ) : (
          messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} customerName={conv.customerName} />
          ))
        )}

        {/* Notes inline */}
        {notes.length > 0 && (
          <div className="space-y-2">
            {notes.map(note => (
              <div key={note.id} className="flex items-start gap-2.5 mx-4">
                <div className="h-6 w-6 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <StickyNote className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-3 py-2">
                  <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-0.5">Internal Note · {timeAgo(note.createdAt)}</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{note.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Reply composer */}
      <ReplyComposer
        conv={conv}
        onNoteSent={() => queryClient.invalidateQueries({ queryKey: ["conv-detail", selectedId] })}
      />
    </div>
  );
}

// ─── Right Panel (Customer Details) ──────────────────────────────────────────

function RightPanel({
  selectedId, onClose, showCloseButton,
}: {
  selectedId: number | null; onClose: () => void; showCloseButton: boolean;
}) {
  const { data, isLoading } = useQuery<ConversationDetail>({
    queryKey: ["conv-detail", selectedId],
    queryFn: () => apiFetch(`/api/communications/conversations/${selectedId}`),
    enabled: selectedId !== null,
    staleTime: 30_000,
  });

  if (!selectedId) {
    return (
      <div className="flex flex-col h-full border-l border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 items-center justify-center p-6">
        <Tag className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-2" />
        <p className="text-xs text-slate-400 text-center">Select a conversation to view customer details</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col h-full border-l border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-4 space-y-4">
        <Skeleton className="h-16 w-16 rounded-full mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
        <Skeleton className="h-3 w-48 mx-auto" />
        {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}
      </div>
    );
  }

  const { conversation: conv, lead, campaign, notes } = data;
  const color = avatarColor(conv.customerEmail);

  const fields = [
    { icon: Mail,       label: "Email",    value: conv.customerEmail },
    { icon: Phone,      label: "Phone",    value: conv.customerPhone },
    { icon: Truck,      label: "Vehicle",  value: lead?.vehicle },
    { icon: MapPin,     label: "Pickup",   value: lead?.pickup },
    { icon: MapPin,     label: "Delivery", value: lead?.delivery },
    { icon: DollarSign, label: "Quote",    value: lead?.price },
    { icon: Megaphone,  label: "Campaign", value: campaign?.name },
    { icon: Tag,        label: "Quote ID", value: lead?.quoteId },
  ].filter(f => f.value);

  const timeline = [
    { icon: Send,             label: "Quote Sent",       done: true  },
    { icon: Eye,              label: "Email Opened",     done: false },
    { icon: MousePointerClick,label: "Link Clicked",     done: false },
    { icon: CornerDownLeft,   label: "Customer Replied", done: false },
    { icon: CheckCircle2,     label: "Vehicle Booked",   done: false },
  ];

  return (
    <div className="flex flex-col h-full border-l border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 overflow-y-auto">
      {/* Header: avatar + name (always visible) */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Customer</p>
        {showCloseButton && (
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Customer identity — always expanded */}
      <div className="flex flex-col items-center text-center px-4 py-5 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
        <Avatar className="h-14 w-14 mb-3">
          <AvatarFallback className={`bg-gradient-to-br ${color} text-white text-lg font-bold`}>
            {initials(conv.customerName)}
          </AvatarFallback>
        </Avatar>
        <p className="font-semibold text-slate-900 dark:text-slate-100">{conv.customerName}</p>
        <p className="text-xs text-slate-400 mt-0.5">{conv.customerEmail}</p>
        {conv.customerPhone && (
          <p className="text-xs text-slate-400 mt-0.5">{conv.customerPhone}</p>
        )}
        <div className="flex gap-1.5 mt-3 flex-wrap justify-center">
          {lead && (
            <Link href="/leads/import">
              <Button variant="outline" size="sm" className="h-7 px-3 text-[10px] rounded-lg gap-1.5">
                <ArrowUpRight className="h-3 w-3" /> Open Lead
              </Button>
            </Link>
          )}
          {campaign && (
            <Link href={`/campaigns/${campaign.id}`}>
              <Button variant="outline" size="sm" className="h-7 px-3 text-[10px] rounded-lg gap-1.5">
                <Megaphone className="h-3 w-3" /> Campaign
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* ── Collapsible sections ── */}

      {/* Customer Details */}
      <PanelSection title="Customer Details" sectionKey="details" defaultOpen={true}>
        {fields.length > 0 ? (
          <div className="space-y-2.5 pt-1">
            {fields.map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-2.5">
                <div className="h-6 w-6 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-3 w-3 text-slate-500 dark:text-slate-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-slate-400">{label}</p>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 break-words">{value}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 pt-1">No additional details available.</p>
        )}
      </PanelSection>

      {/* Tracking */}
      <PanelSection title="Email Tracking" sectionKey="tracking" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2 pt-1">
          {[
            { icon: CheckCircle2,     label: "Delivered", value: conv.messageCount > 0 ? "Yes" : "—", ok: conv.messageCount > 0 },
            { icon: Eye,              label: "Opens",     value: "—", ok: false },
            { icon: MousePointerClick,label: "Clicks",    value: "—", ok: false },
            { icon: CornerDownLeft,   label: "Replies",   value: "—", ok: false },
          ].map(({ icon: Icon, label, value, ok }) => (
            <div key={label} className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-2.5 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <Icon className={cn("h-3 w-3", ok ? "text-emerald-500" : "text-slate-400")} />
                <span className="text-[10px] text-slate-500">{label}</span>
              </div>
              <p className={cn("text-sm font-semibold", ok ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")}>{value}</p>
            </div>
          ))}
        </div>
      </PanelSection>

      {/* Timeline */}
      <PanelSection title="Timeline" sectionKey="timeline" defaultOpen={false}>
        <div className="space-y-0 pt-1">
          {timeline.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5 relative">
              {i < timeline.length - 1 && (
                <div className={cn(
                  "absolute left-[10px] top-5 w-px h-full",
                  item.done ? "bg-emerald-200 dark:bg-emerald-800" : "bg-slate-100 dark:bg-slate-800"
                )} />
              )}
              <div className={cn(
                "h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 z-10",
                item.done ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-slate-100 dark:bg-slate-800"
              )}>
                <item.icon className={cn("h-2.5 w-2.5", item.done ? "text-emerald-600 dark:text-emerald-400" : "text-slate-300 dark:text-slate-600")} />
              </div>
              <div className="pb-3">
                <p className={cn("text-xs font-medium", item.done ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-600")}>
                  {item.label}
                </p>
              </div>
            </div>
          ))}
        </div>
      </PanelSection>

      {/* Internal Notes */}
      <PanelSection title="Internal Notes" sectionKey="notes" defaultOpen={false}>
        {notes && notes.length > 0 ? (
          <div className="space-y-2 pt-1">
            {notes.map(note => (
              <div key={note.id} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-3 py-2">
                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-0.5">
                  {timeAgo(note.createdAt)}
                </p>
                <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{note.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 pt-1">No internal notes yet.</p>
        )}
      </PanelSection>

      {/* Tasks */}
      <PanelSection title="Tasks" sectionKey="tasks" defaultOpen={false}>
        <div className="pt-1">
          <div className="flex flex-col items-center py-3 text-center">
            <ListTodo className="h-6 w-6 text-slate-300 dark:text-slate-600 mb-1.5" />
            <p className="text-xs text-slate-400 dark:text-slate-500">Tasks coming soon</p>
          </div>
        </div>
      </PanelSection>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Communications() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | number | null>(null);
  // Mobile panel: "list" | "thread" | "details"
  const [mobilePanel, setMobilePanel] = useState<"list" | "thread" | "details">("list");
  // Desktop: show right panel
  const [showDetails, setShowDetails] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Live updates via SSE
  const connectionStatus = useCommEvents();

  // Fetch connected mailboxes (Gmail + SMTP)
  const { data: mailboxes = [] } = useQuery<MailboxOption[]>({
    queryKey: ["comm-mailboxes"],
    queryFn: () => apiFetch("/api/communications/mailboxes"),
    staleTime: 5 * 60_000,
  });

  // Build conversations URL with optional mailboxId filter
  const convsUrl = () => {
    const params = new URLSearchParams({
      filter,
      search,
      limit: "50",
    });
    // Only numeric IDs map to mailboxId in the DB; "gmail" has no DB mailboxId yet
    if (selectedMailboxId !== null && typeof selectedMailboxId === "number") {
      params.set("mailboxId", String(selectedMailboxId));
    }
    return `/api/communications/conversations?${params.toString()}`;
  };

  const { data: convData, isLoading } = useQuery<{ data: Conversation[]; total: number }>({
    queryKey: ["conversations", filter, search, selectedMailboxId],
    queryFn: () => apiFetch(convsUrl()),
    staleTime: 30_000,
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["comm-stats"],
    queryFn: () => apiFetch("/api/communications/stats"),
    staleTime: 60_000,
  });

  const conversations = convData?.data ?? [];

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setMobilePanel("thread");
  };

  const handleRefresh = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await apiFetch<{ totalImported: number; totalCreated: number; errors: string[] }>(
        "/api/communications/sync",
        { method: "POST" },
      );
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
      queryClient.invalidateQueries({ queryKey: ["comm-mailboxes"] });
      const newItems = result.totalImported;
      toast({
        title: "Sync complete",
        description: newItems > 0
          ? `Imported ${newItems} new message${newItems === 1 ? "" : "s"}`
          : "Your inbox is up to date",
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Sync failed", description: e.message });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleMailboxChange = (id: string | number | null) => {
    setSelectedMailboxId(id);
    setSelectedId(null); // clear selection when switching mailbox
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  // Auto-select first on desktop when list loads
  useEffect(() => {
    if (conversations.length > 0 && !selectedId) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations.length]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — hidden on mobile when thread/details */}
      <div className={cn(
        "w-72 flex-shrink-0 h-full",
        mobilePanel !== "list" ? "hidden lg:flex lg:flex-col" : "flex flex-col w-full lg:w-72"
      )}>
        <LeftPanel
          filter={filter}
          setFilter={f => { setFilter(f); setSelectedId(null); }}
          search={search}
          setSearch={setSearch}
          conversations={conversations}
          isLoading={isLoading}
          selectedId={selectedId}
          onSelect={handleSelect}
          stats={stats}
          onRefresh={handleRefresh}
          isSyncing={isSyncing}
          mailboxes={mailboxes}
          selectedMailboxId={selectedMailboxId}
          onMailboxChange={handleMailboxChange}
          connectionStatus={connectionStatus}
        />
      </div>

      {/* Middle panel */}
      <div className={cn(
        "flex-1 h-full min-w-0",
        mobilePanel === "list" ? "hidden lg:flex lg:flex-col" :
        mobilePanel === "details" ? "hidden lg:flex lg:flex-col" :
        "flex flex-col w-full"
      )}>
        <MiddlePanel
          selectedId={selectedId}
          onBack={() => setMobilePanel("list")}
          onOpenDetails={() => {
            setShowDetails(true);
            setMobilePanel("details");
          }}
          showDetailsButton={!showDetails}
        />
      </div>

      {/* Right panel */}
      {(showDetails || mobilePanel === "details") && (
        <div className={cn(
          "w-72 flex-shrink-0 h-full",
          mobilePanel === "details" ? "flex flex-col w-full lg:w-72" : "hidden lg:flex lg:flex-col"
        )}>
          <RightPanel
            selectedId={selectedId}
            onClose={() => {
              setShowDetails(false);
              if (mobilePanel === "details") setMobilePanel("thread");
            }}
            showCloseButton={mobilePanel !== "details"}
          />
        </div>
      )}
    </div>
  );
}
