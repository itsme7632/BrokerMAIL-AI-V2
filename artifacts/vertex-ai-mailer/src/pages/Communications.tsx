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
  Trash2, Edit2, ReplyAll, CheckSquare, Square, Minus,
  Copy, ExternalLink, Ban, RotateCcw, Check, ChevronUp,
  TrendingUp, AlertCircle, Zap, Languages, FileText,
  CalendarClock, Plus, Info,
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
  mailboxId: number | null;
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
  status: string | null;
};

type Campaign = { id: number; name: string };

type Note = {
  id: number;
  content: string;
  createdAt: string;
  userId: number;
  authorName: string;
};

type ConversationDetail = {
  conversation: Conversation;
  messages: Message[];
  notes: Note[];
  lead: Lead | null;
  campaign: Campaign | null;
};

type Stats = {
  total: number;
  unread: number;
  needsReply: number;
  starred: number;
  archived: number;
  spam: number;
  inbox?: number;
  sent?: number;
};

type MailboxOption = { id: string | number; email: string; type: "gmail" | "smtp" };

type AttachmentMeta = { name: string; size: number; mimeType: string; partId?: string };

type SyncStatus = {
  isSyncing: boolean;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  liveConnections: number;
  mailboxes: Array<{ email: string; type: string; connected: boolean; lastSyncAt: string | null }>;
  lastSyncResults: Array<{ mailbox: string; imported: number; error?: string }>;
  currentMailbox: string | null;
  currentFolder: string | null;
  scanned: number;
  imported: number;
  totalMailboxes: number;
  completedMailboxes: number;
};

type SyncProgressState = {
  mailbox: string;
  folder: string | null;
  scanned: number;
  imported: number;
  mailboxDone?: boolean;
  error?: string;
};

type BulkAction = "mark_read" | "mark_unread" | "archive" | "spam" | "delete" | "star" | "unstar";
type FilterKey  = "all" | "inbox" | "sent" | "unread" | "needs_reply" | "starred" | "archived" | "spam";
type ReplyMode  = "reply" | "reply_all" | "forward" | "note";

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
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

const FILTERS: { key: FilterKey; label: string; icon: React.ElementType }[] = [
  { key: "inbox",       label: "Inbox",       icon: Inbox },
  { key: "sent",        label: "Sent",        icon: Send },
  { key: "unread",      label: "Unread",      icon: Mail },
  { key: "needs_reply", label: "Needs Reply", icon: CornerDownLeft },
  { key: "starred",     label: "Starred",     icon: Star },
  { key: "archived",    label: "Archived",    icon: Archive },
  { key: "spam",        label: "Spam",        icon: AlertTriangle },
];

// ─── Collapsible section ──────────────────────────────────────────────────────

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

function PanelSection({ title, sectionKey, defaultOpen = false, children, action }: {
  title: string; sectionKey: string; defaultOpen?: boolean;
  children: React.ReactNode; action?: React.ReactNode;
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
        <div className="flex items-center gap-1">
          {action && <span onClick={e => e.stopPropagation()}>{action}</span>}
          <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 dark:text-slate-500 transition-transform duration-200", open && "rotate-180")} />
        </div>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ─── SSE Hook ─────────────────────────────────────────────────────────────────

function useCommEvents(
  onSyncProgress?: (p: SyncProgressState) => void,
  onSyncStarted?: () => void,
  onSyncComplete?: () => void,
) {
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const queryClient = useQueryClient();
  const esRef   = useRef<EventSource | null>(null);
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
        const ev: { type: string; conversationId?: number; data?: any } = JSON.parse(e.data);
        switch (ev.type) {
          case "connected":
            setStatus("connected");
            break;

          case "new_message":
            if (ev.conversationId) queryClient.invalidateQueries({ queryKey: ["conv-detail", ev.conversationId] });
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
            break;

          case "read_updated":
            if (ev.conversationId) {
              // Optimistically update the conversation list cache
              queryClient.setQueriesData<{ data: Conversation[]; total: number }>(
                { queryKey: ["conversations"] },
                (old) => {
                  if (!old) return old;
                  return {
                    ...old,
                    data: old.data.map(c =>
                      c.id === ev.conversationId
                        ? { ...c, status: ev.data?.status ?? "read", unreadCount: ev.data?.unreadCount ?? 0 }
                        : c
                    ),
                  };
                },
              );
              queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
            }
            break;

          case "conversation_updated":
            if (ev.conversationId) {
              queryClient.setQueriesData<{ data: Conversation[]; total: number }>(
                { queryKey: ["conversations"] },
                (old) => {
                  if (!old) return old;
                  const updates = ev.data ?? {};
                  if (updates.deleted) {
                    return { ...old, data: old.data.filter(c => c.id !== ev.conversationId), total: Math.max(0, old.total - 1) };
                  }
                  return { ...old, data: old.data.map(c => c.id === ev.conversationId ? { ...c, ...updates } : c) };
                },
              );
              if (ev.data?.ids) {
                // Bulk action — full refetch
                queryClient.invalidateQueries({ queryKey: ["conversations"] });
              }
            } else if (ev.data?.ids) {
              queryClient.invalidateQueries({ queryKey: ["conversations"] });
            }
            queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
            break;

          case "note_added":
          case "note_updated":
          case "note_deleted":
            if (ev.conversationId) queryClient.invalidateQueries({ queryKey: ["conv-detail", ev.conversationId] });
            break;

          case "sync_started":
            onSyncStarted?.();
            queryClient.invalidateQueries({ queryKey: ["comm-sync-status"] });
            break;

          case "sync_progress":
            if (ev.data) onSyncProgress?.(ev.data as SyncProgressState);
            break;

          case "sync_complete":
            onSyncComplete?.();
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
  }, [queryClient, onSyncProgress, onSyncStarted, onSyncComplete]);

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

// ─── HtmlEmailRenderer ────────────────────────────────────────────────────────

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

// ─── AttachmentList ───────────────────────────────────────────────────────────

function AttachmentList({ metaJson, isOutbound }: { metaJson: string; isOutbound: boolean }) {
  let items: AttachmentMeta[] = [];
  try { items = JSON.parse(metaJson); } catch { return null; }
  if (!items.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((att, i) => {
        const isImage = att.mimeType.startsWith("image/");
        return (
          <button
            key={i}
            onClick={() => window.open(`#attachment-${att.partId ?? i}`, "_blank")}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-opacity hover:opacity-80",
              isOutbound
                ? "bg-white/15 text-white"
                : "bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300",
            )}
            title={`${att.name} (${formatBytes(att.size)})`}
          >
            {isImage
              ? <Eye className="h-3 w-3 flex-shrink-0" />
              : <File className="h-3 w-3 flex-shrink-0" />}
            <span className="truncate max-w-[100px]">{att.name}</span>
            <span className="opacity-60 flex-shrink-0">{formatBytes(att.size)}</span>
            <Download className="h-3 w-3 flex-shrink-0 opacity-50 hover:opacity-100" />
          </button>
        );
      })}
    </div>
  );
}

// ─── Note Item ────────────────────────────────────────────────────────────────

function NoteItem({ note, convId, currentUserId, onChanged }: {
  note: Note; convId: number; currentUserId: number;
  onChanged: () => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [editText, setEditText] = useState(note.content);
  const [saving, setSaving]     = useState(false);
  const [confirm, setConfirm]   = useState(false);
  const { toast } = useToast();
  const canEdit = note.userId === currentUserId;

  const handleSave = async () => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/communications/conversations/${convId}/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: editText }),
      });
      toast({ title: "Note updated" });
      setEditing(false);
      onChanged();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to update note", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/communications/conversations/${convId}/notes/${note.id}`, { method: "DELETE" });
      toast({ title: "Note deleted" });
      setConfirm(false);
      onChanged();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to delete note", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-3 py-2.5">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="h-4.5 w-4.5 rounded-full bg-amber-200 dark:bg-amber-800/60 flex items-center justify-center flex-shrink-0">
            <StickyNote className="h-2.5 w-2.5 text-amber-700 dark:text-amber-400" />
          </div>
          <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 truncate">
            {note.authorName} · {timeAgo(note.createdAt)}
          </p>
        </div>
        {canEdit && !editing && !confirm && (
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/note:opacity-100 transition-opacity">
            <button
              onClick={() => { setEditing(true); setEditText(note.content); }}
              className="p-1 rounded hover:bg-amber-200/60 dark:hover:bg-amber-800/40 text-amber-600 dark:text-amber-400 transition-colors"
              title="Edit note"
            >
              <Edit2 className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={() => setConfirm(true)}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-amber-600 dark:text-amber-400 hover:text-red-600 transition-colors"
              title="Delete note"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        )}
      </div>

      {confirm ? (
        <div className="mt-1">
          <p className="text-xs text-amber-800 dark:text-amber-300 mb-2">Delete this note?</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="destructive" onClick={handleDelete} disabled={saving} className="h-6 px-2 text-[10px]">
              {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Delete"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm(false)} className="h-6 px-2 text-[10px]">Cancel</Button>
          </div>
        </div>
      ) : editing ? (
        <div className="mt-1">
          <Textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            className="min-h-[60px] text-xs resize-none border-amber-300 dark:border-amber-700 focus-visible:ring-amber-400 rounded-lg"
            autoFocus
          />
          <div className="flex gap-1.5 mt-1.5">
            <Button size="sm" onClick={handleSave} disabled={saving || !editText.trim()} className="h-6 px-2.5 text-[10px] bg-amber-500 hover:bg-amber-600 text-white">
              {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="h-6 px-2 text-[10px]">Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap mt-0.5">{note.content}</p>
      )}
    </div>
  );
}

// ─── Sync Status Widget ───────────────────────────────────────────────────────

function SyncStatusWidget({ liveProgress, isSyncingLive }: {
  liveProgress: SyncProgressState | null; isSyncingLive: boolean;
}) {
  const startedAtRef = useRef<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (isSyncingLive) {
      if (!startedAtRef.current) { startedAtRef.current = Date.now(); setElapsedSec(0); }
      const iv = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current!) / 1000));
      }, 1_000);
      return () => clearInterval(iv);
    } else {
      startedAtRef.current = null;
      setElapsedSec(0);
      return;
    }
  }, [isSyncingLive]);

  const elapsedStr = elapsedSec >= 60
    ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
    : elapsedSec > 0 ? `${elapsedSec}s` : "";

  const { data } = useQuery<SyncStatus>({
    queryKey: ["comm-sync-status"],
    queryFn: () => apiFetch("/api/communications/sync-status"),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  if (!data) return null;

  const isSyncing = isSyncingLive || data.isSyncing;
  const nextIn = data.nextSyncAt
    ? Math.max(0, Math.ceil((new Date(data.nextSyncAt).getTime() - Date.now()) / 60_000))
    : null;

  const currentMailbox = liveProgress?.mailbox ?? data.currentMailbox;
  const currentFolder  = liveProgress?.folder  ?? data.currentFolder;
  const imported       = liveProgress?.imported ?? data.imported;
  const scanned        = liveProgress?.scanned  ?? data.scanned;

  const errors = data.lastSyncResults.filter(r => r.error);

  return (
    <div className={cn(
      "mx-3 mb-2 rounded-xl border transition-all",
      isSyncing
        ? "px-3 py-2.5 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/40"
        : "px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700/50",
    )}>
      {isSyncing ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin text-blue-500 flex-shrink-0" />
            <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400">Syncing mailboxes…</p>
          </div>
          {currentMailbox && (
            <div className="space-y-1">
              <p className="text-[9px] text-blue-600 dark:text-blue-400 truncate">
                <span className="font-medium">Mailbox:</span> {currentMailbox.replace(/^(Gmail|IMAP):/, "")}
              </p>
              {currentFolder && (
                <p className="text-[9px] text-blue-500 dark:text-blue-400 truncate">
                  <span className="font-medium">Folder:</span> {currentFolder}
                </p>
              )}
              {(scanned > 0 || imported > 0) && (
                <p className="text-[9px] text-blue-500 dark:text-blue-400">
                  {imported} imported · {scanned} scanned{elapsedStr ? ` · ⏱ ${elapsedStr}` : ""}
                </p>
              )}
            </div>
          )}
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

      {errors.length > 0 && !isSyncing && (
        <div className="mt-1.5 space-y-0.5">
          {errors.map((e, i) => (
            <div key={i} className="flex items-center gap-1 text-[9px] text-red-500 dark:text-red-400">
              <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />
              <span className="truncate">{e.mailbox.replace(/^(Gmail|IMAP):/, "")}: {e.error}</span>
            </div>
          ))}
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

// ─── Bulk Action Bar ──────────────────────────────────────────────────────────

function BulkActionBar({ selectedIds, total, onAction, onSelectAll, onClear }: {
  selectedIds: Set<number>; total: number;
  onAction: (action: BulkAction) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const count = selectedIds.size;
  return (
    <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800/40 flex items-center gap-2 flex-shrink-0">
      <button onClick={onClear} className="p-0.5 text-blue-600 hover:text-blue-800 dark:text-blue-400">
        <X className="h-3.5 w-3.5" />
      </button>
      <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 flex-1">{count} selected</span>
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => onAction("mark_read")} className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-600 dark:text-blue-400 transition-colors">
              <Eye className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Mark Read</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => onAction("mark_unread")} className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-600 dark:text-blue-400 transition-colors">
              <Mail className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Mark Unread</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => onAction("star")} className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-600 dark:text-blue-400 transition-colors">
              <Star className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Star</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => onAction("archive")} className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-600 dark:text-blue-400 transition-colors">
              <Archive className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => onAction("spam")} className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-600 dark:text-blue-400 transition-colors">
              <Ban className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Mark Spam</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => onAction("delete")} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
        {count < total && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={onSelectAll} className="ml-1 px-2 py-1 rounded text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors">
                All {total}
              </button>
            </TooltipTrigger>
            <TooltipContent>Select All</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// ─── Conversation Item ────────────────────────────────────────────────────────

function ConvItem({
  conv, isActive, isSelected, onClick, onToggleSelect, showCheckboxes,
}: {
  conv: Conversation; isActive: boolean; isSelected: boolean;
  onClick: () => void; onToggleSelect: (id: number) => void;
  showCheckboxes: boolean;
}) {
  const color  = avatarColor(conv.customerEmail);
  const badge  = statusBadge(conv.status);
  const isUnread = conv.status === "unread";
  const [hovering, setHovering] = useState(false);

  return (
    <div
      className={cn(
        "w-full text-left border-b border-slate-100 dark:border-slate-800/60 transition-colors group relative flex items-stretch",
        isActive
          ? "bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500"
          : "hover:bg-slate-50 dark:hover:bg-slate-800/40 border-l-2 border-l-transparent",
      )}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Checkbox area */}
      <div
        className={cn(
          "flex items-start justify-center pt-4 flex-shrink-0 transition-all",
          (showCheckboxes || hovering) ? "w-8 opacity-100" : "w-0 overflow-hidden opacity-0",
        )}
        onClick={e => { e.stopPropagation(); onToggleSelect(conv.id); }}
      >
        <div className={cn(
          "h-4 w-4 rounded border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors",
          isSelected
            ? "bg-blue-600 border-blue-600"
            : "border-slate-300 dark:border-slate-600 hover:border-blue-400",
        )}>
          {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
        </div>
      </div>

      <button className="flex-1 text-left px-3 py-3.5 min-w-0" onClick={onClick}>
        <div className="flex items-start gap-2.5">
          <Avatar className="h-9 w-9 flex-shrink-0 mt-0.5">
            <AvatarFallback className={`bg-gradient-to-br ${color} text-white text-xs font-semibold`}>
              {initials(conv.customerName)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1.5">
              <span className={cn("text-sm truncate", isUnread ? "font-semibold text-slate-900 dark:text-slate-100" : "font-medium text-slate-700 dark:text-slate-300")}>
                {conv.customerName}
              </span>
              <span className="text-[10px] text-slate-400 flex-shrink-0">{timeAgo(conv.lastMessageAt)}</span>
            </div>
            <p className={cn("text-xs truncate mt-0.5", isUnread ? "text-slate-700 dark:text-slate-200 font-medium" : "text-slate-500 dark:text-slate-400")}>
              {conv.subject}
            </p>
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
    </div>
  );
}

// ─── Left Panel ───────────────────────────────────────────────────────────────

function LeftPanel({
  filter, setFilter, search, setSearch,
  conversations, isLoading, selectedId, onSelect, stats, onRefresh, isSyncing,
  mailboxes, selectedMailboxId, onMailboxChange, connectionStatus,
  liveProgress, selectedIds, onToggleSelect, onBulkAction,
}: {
  filter: FilterKey; setFilter: (f: FilterKey) => void;
  search: string; setSearch: (s: string) => void;
  conversations: Conversation[]; isLoading: boolean;
  selectedId: number | null; onSelect: (id: number) => void;
  stats: Stats | undefined; onRefresh: () => void; isSyncing: boolean;
  mailboxes: MailboxOption[]; selectedMailboxId: string | number | null;
  onMailboxChange: (id: string | number | null) => void;
  connectionStatus: "connecting" | "connected" | "disconnected";
  liveProgress: SyncProgressState | null;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onBulkAction: (action: BulkAction) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const safeMailboxes = mailboxes ?? [];
  const selectedMailboxLabel = selectedMailboxId === null
    ? "All Mailboxes"
    : safeMailboxes.find(m => m.id === selectedMailboxId)?.email ?? "All Mailboxes";

  const total = (convData: { data: Conversation[]; total: number } | undefined) => convData?.total ?? 0;
  const showCheckboxes = selectedIds.size > 0;

  const handleSelectAll = () => {
    conversations.forEach(c => onToggleSelect(c.id));
  };
  const handleClear = () => {
    conversations.forEach(c => {
      if (selectedIds.has(c.id)) onToggleSelect(c.id);
    });
  };

  return (
    <div className="flex flex-col h-full border-r border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900">
      {/* Top bar */}
      <div className="px-4 pt-4 pb-3 flex-shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">Communications</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-default">
                  {connectionStatus === "disconnected" ? (
                    <WifiOff className="h-3.5 w-3.5 text-red-500" />
                  ) : (
                    <Wifi className={cn("h-3.5 w-3.5", {
                      "text-emerald-500": connectionStatus === "connected",
                      "text-amber-500 animate-pulse": connectionStatus === "connecting",
                    })} />
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {connectionStatus === "connected" ? "Live updates active" :
                 connectionStatus === "connecting" ? "Connecting…" : "Disconnected — reconnecting"}
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

        {/* Mailbox selector */}
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
            <DropdownMenuItem
              onClick={() => onMailboxChange(null)}
              className={cn("text-xs gap-2", selectedMailboxId === null && "text-blue-600 dark:text-blue-400 font-medium")}
            >
              <Server className="h-3 w-3 text-slate-400" />
              <span className="flex-1">All Mailboxes</span>
              {selectedMailboxId === null && <CheckCircle2 className="h-3 w-3 text-blue-500" />}
            </DropdownMenuItem>
            {safeMailboxes.length > 0 && (
              <>
                <DropdownMenuSeparator />
                {safeMailboxes.map(mb => (
                  <DropdownMenuItem
                    key={String(mb.id)}
                    onClick={() => onMailboxChange(mb.id)}
                    className={cn("text-xs gap-2", selectedMailboxId === mb.id && "text-blue-600 dark:text-blue-400 font-medium")}
                  >
                    <Server className={cn("h-3 w-3", mb.type === "gmail" ? "text-rose-400" : "text-slate-400")} />
                    <span className="flex-1 truncate">{mb.email}</span>
                    <span className="text-[9px] uppercase text-slate-400">{mb.type}</span>
                    {selectedMailboxId === mb.id && <CheckCircle2 className="h-3 w-3 text-blue-500" />}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {safeMailboxes.length === 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-3 py-2">
                  <p className="text-[10px] text-slate-400 font-medium mb-1.5">No mailboxes connected</p>
                  <a href="/mailbox" className="block text-[10px] text-blue-500 hover:text-blue-600 font-medium">Connect Gmail or SMTP →</a>
                </div>
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
            placeholder="Name, email, subject, vehicle…"
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
      <SyncStatusWidget liveProgress={liveProgress} isSyncingLive={isSyncing} />

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          total={conversations.length}
          onAction={onBulkAction}
          onSelectAll={handleSelectAll}
          onClear={handleClear}
        />
      )}

      {/* Filter tabs */}
      <div className="px-3 pb-2 flex-shrink-0 space-y-0.5">
        {FILTERS.map(f => {
          const count =
            f.key === "inbox"       ? stats?.inbox
            : f.key === "sent"      ? stats?.sent
            : f.key === "unread"    ? stats?.unread
            : f.key === "needs_reply" ? stats?.needsReply
            : f.key === "starred"   ? stats?.starred
            : f.key === "archived"  ? stats?.archived
            : f.key === "spam"      ? stats?.spam
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

      <div className="mx-3 border-t border-slate-100 dark:border-slate-800 flex-shrink-0" />

      {/* Conversation count */}
      <div className="px-4 py-2 flex-shrink-0">
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          {conversations.length > 0 ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
              {filter === "spam" ? <Ban className="h-7 w-7 text-slate-300 dark:text-slate-600" />
               : filter === "archived" ? <Archive className="h-7 w-7 text-slate-300 dark:text-slate-600" />
               : filter === "starred" ? <Star className="h-7 w-7 text-slate-300 dark:text-slate-600" />
               : <MessageSquare className="h-7 w-7 text-slate-300 dark:text-slate-600" />}
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {search ? "No matching conversations"
               : filter === "inbox" ? "No inbox messages yet"
               : filter === "sent" ? "No sent messages yet"
               : `No ${filter.replace("_", " ")} conversations`}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {search ? "Try a different search term"
               : filter === "inbox" ? "All caught up — inbound messages appear here"
               : filter === "sent" ? "Your outbound messages will appear here"
               : `Nothing here yet`}
            </p>
            {filter === "inbox" && safeMailboxes.length === 0 && (
              <a href="/mailbox" className="mt-3 text-xs text-blue-500 hover:text-blue-600 font-medium">
                Connect a mailbox to sync emails →
              </a>
            )}
          </div>
        ) : (
          conversations.map(conv => (
            <ConvItem
              key={conv.id}
              conv={conv}
              isActive={selectedId === conv.id}
              isSelected={selectedIds.has(conv.id)}
              onClick={() => onSelect(conv.id)}
              onToggleSelect={onToggleSelect}
              showCheckboxes={showCheckboxes}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Reply Composer ───────────────────────────────────────────────────────────

function ReplyComposer({ conv, messages, currentUserId, onNoteAdded, aiBodySuggestion, onAiBodyUsed }: {
  conv: Conversation; messages: Message[];
  currentUserId: number; onNoteAdded: () => void;
  aiBodySuggestion?: string; onAiBodyUsed?: () => void;
}) {
  const [mode, setMode]         = useState<ReplyMode>("reply");
  const [body, setBody]         = useState("");
  const [subject, setSubject]   = useState(`Re: ${conv.subject}`);
  const [toField, setToField]   = useState(conv.customerEmail);
  const [ccField, setCcField]   = useState("");
  const [showCc, setShowCc]     = useState(false);
  const [files, setFiles]       = useState<File[]>([]);
  const [sending, setSending]   = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Accept AI-generated body suggestion
  useEffect(() => {
    if (aiBodySuggestion) {
      setBody(aiBodySuggestion);
      if (mode === "note") setMode("reply");
      onAiBodyUsed?.();
    }
  }, [aiBodySuggestion]);

  const handleModeChange = (m: ReplyMode) => {
    setMode(m);
    if (m === "reply") {
      setToField(conv.customerEmail);
      setSubject(`Re: ${conv.subject}`);
    } else if (m === "reply_all") {
      const lastInbound = [...messages].reverse().find(msg => msg.direction === "inbound");
      setToField(lastInbound?.fromEmail ?? conv.customerEmail);
      setSubject(`Re: ${conv.subject}`);
    } else if (m === "forward") {
      setToField("");
      setSubject(`Fwd: ${conv.subject}`);
    }
  };

  const handleAiReply = async () => {
    setAiLoading(true);
    try {
      const { result } = await apiFetch<{ result: string }>("/api/communications/ai-assist", {
        method: "POST",
        body: JSON.stringify({ type: "suggest_reply", conversationId: conv.id }),
      });
      setBody(result);
      toast({ title: "AI reply generated" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "AI failed", description: e.message });
    } finally {
      setAiLoading(false);
    }
  };

  const handleSendReply = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("body", body);
      fd.append("subject", subject);
      fd.append("to", toField);
      if (ccField) fd.append("cc", ccField);
      files.forEach(f => fd.append("attachments", f));

      await fetch(`/api/communications/conversations/${conv.id}/reply`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      }).then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error((d as any).error ?? `HTTP ${r.status}`);
        }
      });

      setBody(""); setFiles([]); setToField(conv.customerEmail);
      toast({ title: "Reply sent" });
      queryClient.invalidateQueries({ queryKey: ["conv-detail", conv.id] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to send", description: e.message });
    } finally {
      setSending(false);
    }
  };

  const handleSaveNote = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/api/communications/conversations/${conv.id}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: body }),
      });
      setBody("");
      toast({ title: "Note saved" });
      onNoteAdded();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setSending(false);
    }
  };

  const tabClass = (m: ReplyMode) => cn(
    "flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border-b-2 transition-colors",
    mode === m
      ? m === "note"
        ? "border-amber-500 text-amber-600 dark:text-amber-400"
        : "border-blue-500 text-blue-600 dark:text-blue-400"
      : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
  );

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
      {/* Mode tabs */}
      <div className="flex border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
        <button onClick={() => handleModeChange("reply")} className={tabClass("reply")}>
          <Reply className="h-3.5 w-3.5" /> Reply
        </button>
        <button onClick={() => handleModeChange("reply_all")} className={tabClass("reply_all")}>
          <ReplyAll className="h-3.5 w-3.5" /> Reply All
        </button>
        <button onClick={() => handleModeChange("forward")} className={tabClass("forward")}>
          <Forward className="h-3.5 w-3.5" /> Forward
        </button>
        <button onClick={() => handleModeChange("note")} className={tabClass("note")}>
          <StickyNote className="h-3.5 w-3.5" /> Note
        </button>
      </div>

      <div className="p-3 space-y-2">
        {mode === "note" && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-[10px] text-amber-700 dark:text-amber-400">
            <StickyNote className="h-3 w-3 flex-shrink-0" />
            Private — never sent to the customer
          </div>
        )}

        {mode !== "note" && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 w-6 flex-shrink-0">To</span>
              <Input
                value={toField}
                onChange={e => setToField(e.target.value)}
                className="h-6 text-xs border-slate-200 dark:border-slate-700 flex-1"
              />
              <button
                onClick={() => setShowCc(v => !v)}
                className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
              >
                CC
              </button>
            </div>
            {showCc && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-6 flex-shrink-0">CC</span>
                <Input
                  value={ccField}
                  onChange={e => setCcField(e.target.value)}
                  className="h-6 text-xs border-slate-200 dark:border-slate-700 flex-1"
                  placeholder="cc@example.com"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 w-6 flex-shrink-0">Re</span>
              <Input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="h-6 text-xs border-slate-200 dark:border-slate-700 flex-1"
              />
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 pb-1.5 border-b border-slate-100 dark:border-slate-800">
          <button className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 transition-colors" title="Bold">
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 transition-colors" title="Italic">
            <Italic className="h-3.5 w-3.5" />
          </button>
          {mode !== "note" && (
            <>
              <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
              <button
                onClick={() => fileRef.current?.click()}
                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 transition-colors"
                title="Attach file"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files ?? [])])}
              />
              <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
              <button
                onClick={handleAiReply}
                disabled={aiLoading}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-800/40 transition-colors border border-violet-200 dark:border-violet-800/40 disabled:opacity-50"
              >
                {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                AI Reply
              </button>
            </>
          )}
        </div>

        {/* Attached files */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300">
                <File className="h-2.5 w-2.5" />
                <span className="max-w-[80px] truncate">{f.name}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-slate-600">
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={
            mode === "note"      ? "Add a private note for your team…"
            : mode === "forward" ? "Add a forwarding note…"
            : `Reply to ${conv.customerName}…`
          }
          className={cn(
            "min-h-[72px] resize-none text-sm rounded-xl border-slate-200 dark:border-slate-700 bg-transparent focus-visible:ring-1",
            mode === "note" ? "focus-visible:ring-amber-400" : "focus-visible:ring-blue-400",
          )}
        />

        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-400">
            {mode === "note" ? "Visible to team only" : `To: ${toField}`}
          </p>
          <Button
            size="sm"
            onClick={mode === "note" ? handleSaveNote : handleSendReply}
            disabled={!body.trim() || sending}
            className={cn(
              "h-8 px-4 text-xs rounded-xl gap-1.5",
              mode === "note" ? "bg-amber-500 hover:bg-amber-600 text-white" : "",
            )}
          >
            {sending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : mode === "note" ? <StickyNote className="h-3 w-3" />
              : <Send className="h-3 w-3" />}
            {mode === "note" ? "Save Note"
             : mode === "forward" ? "Forward"
             : "Send Reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── AI Assist Panel ──────────────────────────────────────────────────────────

function AIAssistPanel({ convId, onClose, onUseReply }: {
  convId: number; onClose: () => void; onUseReply: (text: string) => void;
}) {
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState("");
  const [activeType, setActiveType] = useState<string | null>(null);
  const [language, setLanguage] = useState("Spanish");
  const { toast } = useToast();

  const run = async (type: string) => {
    setLoading(true); setActiveType(type); setResult("");
    try {
      const { result: r } = await apiFetch<{ result: string }>("/api/communications/ai-assist", {
        method: "POST",
        body: JSON.stringify({
          type,
          conversationId: convId,
          language: type === "translate" ? language : undefined,
        }),
      });
      setResult(r);
    } catch (e: any) {
      toast({ variant: "destructive", title: "AI failed", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute right-0 top-14 bottom-0 w-80 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 flex flex-col z-10 shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI Assistant</h3>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-1.5 flex-shrink-0 border-b border-slate-100 dark:border-slate-800">
        {[
          { key: "summarize",     label: "Summarize Thread",      icon: FileText },
          { key: "suggest_reply", label: "Suggest Reply",         icon: Reply },
          { key: "extract_intent",label: "Extract Intent",        icon: TrendingUp },
          { key: "sentiment",     label: "Sentiment Analysis",    icon: Zap },
          { key: "rewrite",       label: "Rewrite Last Message",  icon: RotateCcw },
          { key: "translate",     label: "Translate Thread",      icon: Languages },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => run(key)}
            disabled={loading}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left",
              activeType === key && result
                ? "bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800/40"
                : "bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-700 dark:hover:text-violet-400",
            )}
          >
            {loading && activeType === key
              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
              : <Icon className="h-3.5 w-3.5 text-violet-500" />}
            {label}
          </button>
        ))}
        {activeType === "translate" && (
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 mt-1"
          >
            {["Spanish","French","German","Italian","Portuguese","Chinese","Japanese","Korean","Arabic","Russian"].map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {result ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{result}</p>
            {activeType === "suggest_reply" && (
              <Button
                size="sm"
                onClick={() => { onUseReply(result); onClose(); }}
                className="w-full h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white"
              >
                <Reply className="h-3 w-3 mr-1" /> Use as Reply
              </Button>
            )}
          </div>
        ) : !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Sparkles className="h-8 w-8 text-slate-200 dark:text-slate-700 mb-2" />
            <p className="text-xs text-slate-400">Choose an action above to get AI insights on this conversation.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, customerName, onReply }: {
  msg: Message; customerName: string; onReply?: () => void;
}) {
  const isOut = msg.direction === "outbound";
  const time  = msg.sentAt ?? msg.createdAt;

  return (
    <div className={cn("flex gap-3 group", isOut ? "flex-row-reverse" : "flex-row")}>
      <Avatar className="h-7 w-7 flex-shrink-0 mt-1">
        <AvatarFallback className={cn(
          "text-white text-[10px] font-semibold bg-gradient-to-br",
          isOut ? "from-blue-500 to-indigo-600" : avatarColor(msg.fromEmail),
        )}>
          {isOut ? "You" : initials(msg.fromName ?? customerName)}
        </AvatarFallback>
      </Avatar>

      <div className={cn("flex flex-col max-w-[72%]", isOut ? "items-end" : "items-start")}>
        <div className={cn("flex items-center gap-2 mb-1", isOut ? "flex-row-reverse" : "flex-row")}>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {isOut ? "You" : (msg.fromName ?? customerName)}
          </span>
          <span className="text-[10px] text-slate-400">{fullTime(time)}</span>
        </div>

        <div className={cn(
          "rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isOut
            ? "bg-blue-600 text-white rounded-tr-sm"
            : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-tl-sm",
        )}>
          {msg.htmlBody
            ? <HtmlEmailRenderer html={msg.htmlBody} isOutbound={isOut} />
            : <p className="whitespace-pre-wrap">{msg.body}</p>}
          {msg.attachmentsMeta && <AttachmentList metaJson={msg.attachmentsMeta} isOutbound={isOut} />}
        </div>

        <div className={cn(
          "flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity",
          isOut ? "flex-row-reverse" : "flex-row",
        )}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={onReply} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors">
                <Reply className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Reply</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { navigator.clipboard.writeText(msg.body); }}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <Copy className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Copy text</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

// ─── Middle Panel ─────────────────────────────────────────────────────────────

function MiddlePanel({
  selectedId, onBack, onOpenDetails, showDetailsButton, currentUserId,
}: {
  selectedId: number | null; onBack: () => void;
  onOpenDetails: () => void; showDetailsButton: boolean;
  currentUserId: number;
}) {
  const bottomRef  = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAI, setShowAI]     = useState(false);
  const [aiReply, setAiReply]   = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const { data, isLoading } = useQuery<ConversationDetail>({
    queryKey: ["conv-detail", selectedId],
    queryFn: () => apiFetch(`/api/communications/conversations/${selectedId}`),
    enabled: selectedId !== null,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/api/communications/conversations/${selectedId}`, {
        method: "PATCH", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conv-detail", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/api/communications/conversations/${selectedId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
      setDeleteConfirm(false);
    },
  });

  useEffect(() => {
    if (data) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [data?.messages?.length]);

  if (!selectedId) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-950">
        <div className="h-16 w-16 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mb-4 shadow-sm">
          <MessageSquare className="h-8 w-8 text-slate-300 dark:text-slate-600" />
        </div>
        <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300">Select a conversation</h3>
        <p className="text-sm text-slate-400 mt-1">Choose a conversation from the list to view messages</p>
        <div className="mt-6 grid grid-cols-2 gap-2 text-center">
          {[
            { label: "Press J/K", desc: "Navigate conversations" },
            { label: "Press E",   desc: "Archive selected" },
            { label: "Press R",   desc: "Reply to thread" },
            { label: "Press S",   desc: "Star conversation" },
          ].map(({ label, desc }) => (
            <div key={label} className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <p className="text-[10px] font-semibold font-mono text-slate-500 dark:text-slate-400">{label}</p>
              <p className="text-[9px] text-slate-400 mt-0.5">{desc}</p>
            </div>
          ))}
        </div>
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

  // Merge messages and notes chronologically
  type ThreadItem =
    | { kind: "message"; msg: Message; time: string }
    | { kind: "note"; note: Note; time: string };

  const threadItems: ThreadItem[] = [
    ...messages.map(msg => ({ kind: "message" as const, msg, time: msg.sentAt ?? msg.createdAt })),
    ...notes.map(note => ({ kind: "note" as const, note, time: note.createdAt })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  // Group by day
  let lastDayLabel = "";

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 relative">
      {/* Thread header */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
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

        {/* Action toolbar */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => updateMutation.mutate({ starred: !conv.starred })}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Star className={cn("h-4 w-4", conv.starred ? "fill-amber-400 text-amber-400" : "text-slate-400")} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{conv.starred ? "Unstar (S)" : "Star (S)"}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => updateMutation.mutate({ status: "archived" })}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
              >
                <Archive className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Archive (E)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => updateMutation.mutate({ status: "unread" })}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
              >
                <Mail className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Mark Unread</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowAI(v => !v)}
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  showAI
                    ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400",
                )}
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>AI Assistant</TooltipContent>
          </Tooltip>

          {deleteConfirm ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => deleteMutation.mutate()}
                className="px-2 py-1 text-[10px] font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
              </button>
              <button onClick={() => setDeleteConfirm(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => updateMutation.mutate({ status: "needs_reply" })} className="gap-2 text-xs">
                  <CornerDownLeft className="h-3.5 w-3.5" /> Mark Needs Reply
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateMutation.mutate({ status: "replied" })} className="gap-2 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Mark Replied
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => { navigator.clipboard.writeText(conv.customerEmail); toast({ title: "Email copied" }); }}
                  className="gap-2 text-xs"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy Email
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => window.open(`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(conv.customerEmail)}`, "_blank")}
                  className="gap-2 text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open in Gmail
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => window.open(`mailto:${conv.customerEmail}?subject=${encodeURIComponent(conv.subject)}`, "_blank")}
                  className="gap-2 text-xs"
                >
                  <Mail className="h-3.5 w-3.5" /> Open in Mail Client
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => updateMutation.mutate({ status: "spam" })} className="gap-2 text-xs text-amber-600 focus:text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Mark as Spam
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDeleteConfirm(true)} className="gap-2 text-xs text-red-500 focus:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" /> Delete Conversation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {showDetailsButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={onOpenDetails} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Customer Details</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-1">
        {threadItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Mail className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-sm">No messages in this thread yet</p>
          </div>
        ) : (
          threadItems.map((item, idx) => {
            const label = dayLabel(item.time);
            const showSep = label !== lastDayLabel;
            if (showSep) lastDayLabel = label;

            return (
              <div key={item.kind === "message" ? `msg-${item.msg.id}` : `note-${item.note.id}`}>
                {showSep && (
                  <div className="flex items-center gap-3 py-3">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium px-2">{label}</span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                  </div>
                )}

                {item.kind === "message" ? (
                  <div className="py-2">
                    <MessageBubble
                      msg={item.msg}
                      customerName={conv.customerName}
                      onReply={() => {}}
                    />
                  </div>
                ) : (
                  <div className="py-1.5 mx-4 group/note">
                    <NoteItem
                      note={item.note}
                      convId={conv.id}
                      currentUserId={currentUserId}
                      onChanged={() => queryClient.invalidateQueries({ queryKey: ["conv-detail", selectedId] })}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply composer */}
      <ReplyComposer
        conv={conv}
        messages={messages}
        currentUserId={currentUserId}
        onNoteAdded={() => queryClient.invalidateQueries({ queryKey: ["conv-detail", selectedId] })}
        aiBodySuggestion={aiReply}
        onAiBodyUsed={() => setAiReply("")}
      />

      {/* AI panel overlay */}
      {showAI && (
        <AIAssistPanel
          convId={conv.id}
          onClose={() => setShowAI(false)}
          onUseReply={text => { setShowAI(false); setAiReply(text); }}
        />
      )}
    </div>
  );
}

// ─── Right Panel ──────────────────────────────────────────────────────────────

function RightPanel({ selectedId, onClose, showCloseButton, currentUserId }: {
  selectedId: number | null; onClose: () => void;
  showCloseButton: boolean; currentUserId: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
    { icon: Mail,       label: "Email",    value: conv.customerEmail, copyable: true },
    { icon: Phone,      label: "Phone",    value: conv.customerPhone, tel: true },
    { icon: Truck,      label: "Vehicle",  value: lead?.vehicle },
    { icon: MapPin,     label: "Route",    value: lead?.route },
    { icon: MapPin,     label: "Pickup",   value: lead?.pickup },
    { icon: MapPin,     label: "Delivery", value: lead?.delivery },
    { icon: DollarSign, label: "Quote",    value: lead?.price },
    { icon: Tag,        label: "Quote ID", value: lead?.quoteId },
    { icon: Megaphone,  label: "Campaign", value: campaign?.name },
    { icon: CheckCircle2, label: "Status", value: lead?.status },
  ].filter(f => f.value) as { icon: any; label: string; value: string; copyable?: boolean; tel?: boolean }[];

  return (
    <div className="flex flex-col h-full border-l border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 overflow-y-auto">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Customer</p>
        {showCloseButton && (
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Customer identity */}
      <div className="flex flex-col items-center text-center px-4 py-5 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
        <Avatar className="h-14 w-14 mb-3">
          <AvatarFallback className={`bg-gradient-to-br ${color} text-white text-lg font-bold`}>
            {initials(conv.customerName)}
          </AvatarFallback>
        </Avatar>
        <p className="font-semibold text-slate-900 dark:text-slate-100">{conv.customerName}</p>
        <button
          onClick={() => { navigator.clipboard.writeText(conv.customerEmail); toast({ title: "Email copied" }); }}
          className="text-xs text-slate-400 mt-0.5 hover:text-blue-500 transition-colors"
        >
          {conv.customerEmail}
        </button>
        {conv.customerPhone && (
          <a href={`tel:${conv.customerPhone}`} className="text-xs text-slate-400 mt-0.5 hover:text-blue-500 transition-colors">
            {conv.customerPhone}
          </a>
        )}

        {/* Quick actions */}
        <div className="flex gap-1.5 mt-3 flex-wrap justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { navigator.clipboard.writeText(conv.customerEmail); toast({ title: "Email copied" }); }}
                className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Copy Email</TooltipContent>
          </Tooltip>

          {conv.customerPhone && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`tel:${conv.customerPhone}`}
                  className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                >
                  <Phone className="h-3.5 w-3.5" />
                </a>
              </TooltipTrigger>
              <TooltipContent>Call {conv.customerPhone}</TooltipContent>
            </Tooltip>
          )}

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

      {/* Customer Details */}
      <PanelSection title="Customer Details" sectionKey="details" defaultOpen={true}>
        {fields.length > 0 ? (
          <div className="space-y-2.5 pt-1">
            {fields.map(({ icon: Icon, label, value, copyable, tel }) => (
              <div key={label} className="flex items-start gap-2.5">
                <div className="h-6 w-6 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-3 w-3 text-slate-500 dark:text-slate-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-slate-400">{label}</p>
                  {tel ? (
                    <a href={`tel:${value}`} className="text-xs font-medium text-blue-500 hover:text-blue-600 break-words">{value}</a>
                  ) : copyable ? (
                    <button
                      onClick={() => { navigator.clipboard.writeText(value); toast({ title: `${label} copied` }); }}
                      className="text-xs font-medium text-slate-700 dark:text-slate-300 break-words hover:text-blue-500 transition-colors text-left"
                    >
                      {value}
                    </button>
                  ) : (
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300 break-words">{value}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 pt-1">No additional details available.</p>
        )}
      </PanelSection>

      {/* Email Tracking */}
      <PanelSection title="Email Tracking" sectionKey="tracking" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2 pt-1">
          {[
            { icon: CheckCircle2, label: "Delivered", value: conv.messageCount > 0 ? "Yes" : "—", ok: conv.messageCount > 0 },
            { icon: Eye,          label: "Opens",     value: "—", ok: false },
            { icon: MousePointerClick, label: "Clicks", value: "—", ok: false },
            { icon: CornerDownLeft, label: "Replies", value: "—", ok: false },
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

      {/* Internal Notes */}
      <PanelSection title="Internal Notes" sectionKey="notes" defaultOpen={false}>
        {notes && notes.length > 0 ? (
          <div className="space-y-2 pt-1">
            {notes.map(note => (
              <div key={note.id} className="group/note">
                <NoteItem
                  note={note}
                  convId={conv.id}
                  currentUserId={currentUserId}
                  onChanged={() => queryClient.invalidateQueries({ queryKey: ["conv-detail", selectedId] })}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 pt-1">No internal notes yet.</p>
        )}
      </PanelSection>

      {/* Tasks — placeholder */}
      <PanelSection title="Tasks" sectionKey="tasks" defaultOpen={false}>
        <div className="pt-1 flex flex-col items-center py-3 text-center">
          <ListTodo className="h-6 w-6 text-slate-300 dark:text-slate-600 mb-1.5" />
          <p className="text-xs text-slate-400 dark:text-slate-500">Tasks coming soon</p>
        </div>
      </PanelSection>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Communications() {
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;

  const [filter, setFilter]           = useState<FilterKey>("inbox");
  const [search, setSearch]           = useState("");
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"list" | "thread" | "details">("list");
  const [showDetails, setShowDetails] = useState(true);
  const [isSyncing, setIsSyncing]     = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [liveProgress, setLiveProgress] = useState<SyncProgressState | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSyncProgress = useCallback((p: SyncProgressState) => {
    setLiveProgress(p);
  }, []);
  const handleSyncStarted = useCallback(() => {
    setIsSyncing(true);
    setLiveProgress(null);
  }, []);
  const handleSyncComplete = useCallback(() => {
    setIsSyncing(false);
    setTimeout(() => setLiveProgress(null), 2000);
  }, []);

  const connectionStatus = useCommEvents(handleSyncProgress, handleSyncStarted, handleSyncComplete);

  const { data: mailboxes = [] } = useQuery<MailboxOption[]>({
    queryKey: ["comm-mailboxes"],
    queryFn: () => apiFetch("/api/communications/mailboxes"),
    staleTime: 5 * 60_000,
  });

  const convsUrl = () => {
    const params = new URLSearchParams({ filter, search, limit: "50" });
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

  // Optimistic mark-as-read when selecting a conversation
  const handleSelect = (id: number) => {
    setSelectedId(id);
    setMobilePanel("thread");
    // Optimistically mark as read in the list
    queryClient.setQueriesData<{ data: Conversation[]; total: number }>(
      { queryKey: ["conversations"] },
      (old) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map(c =>
            c.id === id ? { ...c, status: c.status === "unread" ? "read" : c.status, unreadCount: 0 } : c
          ),
        };
      },
    );
    // Also refresh stats after a short delay (the server marks as read on GET)
    setTimeout(() => queryClient.invalidateQueries({ queryKey: ["comm-stats"] }), 500);
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkAction = async (action: BulkAction) => {
    if (selectedIds.size === 0) return;
    try {
      await apiFetch("/api/communications/conversations/bulk", {
        method: "PATCH",
        body: JSON.stringify({ ids: Array.from(selectedIds), action }),
      });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
      toast({
        title: `${selectedIds.size} conversation${selectedIds.size === 1 ? "" : "s"} updated`,
        description: action.replace(/_/g, " "),
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Bulk action failed", description: e.message });
    }
  };

  const handleRefresh = async () => {
    if (isSyncing) return;
    try {
      const resp = await apiFetch<{ started: boolean; message?: string }>(
        "/api/communications/sync",
        { method: "POST" },
      );
      if (resp.started) {
        setIsSyncing(true); // SSE sync_complete will reset this
        setLiveProgress(null);
      } else {
        toast({ title: "Sync in progress", description: resp.message ?? "Already syncing, please wait" });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Sync failed", description: e.message });
    }
  };

  const handleMailboxChange = (id: string | number | null) => {
    setSelectedMailboxId(id);
    setSelectedId(null);
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  // Auto-select first conversation on desktop
  useEffect(() => {
    if (conversations.length > 0 && !selectedId) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations.length]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className={cn(
        "w-72 flex-shrink-0 h-full",
        mobilePanel !== "list" ? "hidden lg:flex lg:flex-col" : "flex flex-col w-full lg:w-72",
      )}>
        <LeftPanel
          filter={filter}
          setFilter={f => { setFilter(f); setSelectedId(null); setSelectedIds(new Set()); }}
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
          liveProgress={liveProgress}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onBulkAction={handleBulkAction}
        />
      </div>

      {/* Middle panel */}
      <div className={cn(
        "flex-1 h-full min-w-0",
        mobilePanel === "list"    ? "hidden lg:flex lg:flex-col" :
        mobilePanel === "details" ? "hidden lg:flex lg:flex-col" :
        "flex flex-col w-full",
      )}>
        <MiddlePanel
          selectedId={selectedId}
          onBack={() => setMobilePanel("list")}
          onOpenDetails={() => { setShowDetails(true); setMobilePanel("details"); }}
          showDetailsButton={!showDetails}
          currentUserId={currentUserId}
        />
      </div>

      {/* Right panel */}
      {(showDetails || mobilePanel === "details") && (
        <div className={cn(
          "w-72 flex-shrink-0 h-full",
          mobilePanel === "details" ? "flex flex-col w-full lg:w-72" : "hidden lg:flex lg:flex-col",
        )}>
          <RightPanel
            selectedId={selectedId}
            onClose={() => { setShowDetails(false); if (mobilePanel === "details") setMobilePanel("thread"); }}
            showCloseButton={mobilePanel !== "details"}
            currentUserId={currentUserId}
          />
        </div>
      )}
    </div>
  );
}
