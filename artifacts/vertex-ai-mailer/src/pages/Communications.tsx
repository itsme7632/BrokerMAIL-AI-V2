import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import {
  Search, Star, Archive, Inbox, ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Reply, Forward, MoreHorizontal, Mail, Phone, Truck,
  MapPin, DollarSign, Megaphone, Server, Tag,
  CheckCircle2, Eye, MousePointerClick, AlertTriangle,
  Loader2, RefreshCw, Send, StickyNote, X,
  MessageSquare, Sparkles, ArrowUpRight,
  CornerDownLeft, Bold, Italic, Paperclip, ListTodo,
  Wifi, WifiOff, Clock, Download, File,
  Trash2, Edit2, ReplyAll, Check,
  Copy, ExternalLink, Ban, RotateCcw,
  TrendingUp, AlertCircle, Zap, Languages, FileText,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterKey =
  | "all" | "inbox" | "sent" | "drafts" | "unread"
  | "needs_reply" | "starred" | "archived" | "spam"
  | "trash" | "system";

type ReplyMode = "reply" | "reply_all" | "forward" | "note";

type BulkAction =
  | "mark_read" | "mark_unread" | "archive" | "spam"
  | "trash" | "restore" | "delete" | "star" | "unstar";

type Conversation = {
  id: number;
  leadId: number | null;
  campaignId: number | null;
  mailboxId: number | null;
  mailboxType: "gmail" | "smtp" | null;
  subject: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  status: string; // unread|read|needs_reply|replied|archived|spam|trash|system
  starred: boolean;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string;
};

type Message = {
  id: number;
  conversationId: number;
  direction: "inbound" | "outbound";
  fromEmail: string;
  fromName: string | null;
  toEmail: string | null;
  subject: string | null;
  body: string;
  htmlBody: string | null;
  snippet: string | null;
  isRead: boolean;
  draftId: string | null;
  externalId: string | null;
  attachmentsMeta: string | null;
  sentAt: string | null;
  createdAt: string;
};

type Note = {
  id: number;
  conversationId: number;
  userId: number;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type Lead = {
  id: number;
  vehicle: string | null;
  route: string | null;
  pickup: string | null;
  delivery: string | null;
  price: string | null;
  quoteId: string | null;
  status: string | null;
};

type Campaign = { id: number; name: string };

type ConversationDetail = {
  conversation: Conversation;
  messages: Message[];
  notes: Note[];
  lead: Lead | null;
  campaign: Campaign | null;
};

type MailboxOption = { id: string | number; email: string; type: "gmail" | "smtp"; connected?: boolean };

type AttachmentMeta = { partId?: string; name: string; mimeType: string; size: number };

type Stats = {
  total: number;
  unread: number;
  needsReply: number;
  starred: number;
  archived: number;
  spam: number;
  trash?: number;
  system?: number;
  inbox?: number;
  sent?: number;
};

type SyncProgressState = {
  mailbox?: string; folder?: string;
  imported: number; scanned: number;
  totalMailboxes?: number; completedMailboxes?: number;
};

type SyncStatus = {
  isSyncing: boolean;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastSyncResults: { mailbox: string; imported: number; error?: string }[];
  mailboxes: { email: string; type: string; connected: boolean; lastSyncAt?: string | null }[];
  liveConnections: number;
  currentMailbox?: string;
  currentFolder?: string;
  scanned: number;
  imported: number;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function apiFetch<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(), ...opts });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [
  "from-violet-500 to-purple-600",
  "from-blue-500 to-cyan-600",
  "from-emerald-500 to-teal-600",
  "from-rose-500 to-pink-600",
  "from-amber-500 to-orange-600",
  "from-indigo-500 to-blue-600",
  "from-teal-500 to-green-600",
  "from-fuchsia-500 to-violet-600",
];

function avatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function statusBadge(status: string): { label: string; cls: string } | null {
  switch (status) {
    case "needs_reply": return { label: "Needs Reply", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
    case "replied":     return { label: "Replied",     cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" };
    case "archived":    return { label: "Archived",    cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" };
    case "spam":        return { label: "Spam",        cls: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" };
    case "trash":       return { label: "Trash",       cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" };
    case "system":      return { label: "Notification", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
    default: return null;
  }
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

/** Strip quoted reply content from HTML email body. Returns primary and quoted parts. */
function extractQuotedContent(html: string): { primary: string; quoted: string | null } {
  if (!html) return { primary: html, quoted: null };

  // Strategy 1: Gmail's quote wrapper div
  const gmailIdx = html.search(/(<div[^>]*class="[^"]*gmail_quote[^"]*")/i);
  if (gmailIdx > 80) {
    return { primary: html.slice(0, gmailIdx).replace(/<br\s*\/?>\s*$/i, "").trim(), quoted: html.slice(gmailIdx) };
  }

  // Strategy 2: Trailing blockquote (Outlook/IMAP style)
  const lastBq = html.lastIndexOf("<blockquote");
  if (lastBq > 200) {
    const beforeBq = html.slice(0, lastBq).trim();
    if (beforeBq.replace(/<[^>]*>/g, "").trim().length > 40) {
      return { primary: beforeBq, quoted: html.slice(lastBq) };
    }
  }

  // Strategy 3: "On <date>, <name> wrote:" separator
  const m = html.match(/^([\s\S]{80,}?)(?:<br\s*\/?>\s*){1,2}(On .{10,200} wrote:|-----Original Message-----)/i);
  if (m?.[1] && m[1].length < html.length * 0.9) {
    return { primary: m[1].trim(), quoted: html.slice(m[1].length) };
  }

  return { primary: html, quoted: null };
}

// ─── Panel section helper ─────────────────────────────────────────────────────

function usePanelSection(key: string, defaultOpen: boolean) {
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`panel-${key}`) ?? String(defaultOpen)); } catch { return defaultOpen; }
  });
  const toggle = () => setOpen((v: boolean) => {
    localStorage.setItem(`panel-${key}`, String(!v));
    return !v;
  });
  return [open as boolean, toggle as () => void] as const;
}

function PanelSection({ title, sectionKey, defaultOpen, children }: {
  title: string; sectionKey: string; defaultOpen: boolean; children: React.ReactNode;
}) {
  const [open, toggle] = usePanelSection(sectionKey, defaultOpen);
  return (
    <div className="border-b border-slate-100 dark:border-slate-800 last:border-none">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      >
        {title}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

// ─── SSE Hook ────────────────────────────────────────────────────────────────

function useCommEvents(
  onSyncProgress?: (p: SyncProgressState) => void,
  onSyncStarted?: () => void,
  onSyncComplete?: () => void,
): "connecting" | "connected" | "disconnected" {
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const esRef     = useRef<EventSource | null>(null);
  const retryRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef  = useRef(2_000);
  const queryClient = useQueryClient();

  const connect = useCallback(() => {
    esRef.current?.close();
    setStatus("connecting");
    const token = localStorage.getItem("auth_token");
    if (!token) { setStatus("disconnected"); return; }
    const es = new EventSource(`/api/communications/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;
    es.onopen = () => { setStatus("connected"); delayRef.current = 2_000; };
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        switch (ev.type) {
          case "connected":
            setStatus("connected");
            break;

          case "new_message":
            if (ev.conversationId) {
              queryClient.invalidateQueries({ queryKey: ["conv-detail", ev.conversationId] });
            }
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
            break;

          case "read_updated":
            if (ev.conversationId) {
              queryClient.setQueriesData<{ data: Conversation[]; total: number }>(
                { queryKey: ["conversations"] },
                (old) => {
                  if (!old) return old;
                  return {
                    ...old,
                    data: old.data.map(c =>
                      c.id === ev.conversationId
                        ? { ...c, status: c.status === "unread" ? "read" : c.status, unreadCount: 0 }
                        : c,
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

/**
 * Email HTML renderer — always rendered in light mode regardless of the app's
 * dark-mode setting. Email HTML is author-intended for light backgrounds; dark
 * mode inversion would make inline `color: black` and similar styles invisible.
 * `color-scheme: light` tells the browser to stay in light mode for this frame.
 */
function HtmlEmailRenderer({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);

  const clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\s+on\w+\s*=/gi, " data-removed=");

  const doc = [
    "<!DOCTYPE html><html><head>",
    "<meta charset='utf-8'>",
    "<meta name='color-scheme' content='light'>",
    "<style>",
    "*, *::before, *::after { box-sizing: border-box; }",
    "html { color-scheme: light !important; }",
    "body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.5; color: #1e293b !important; background: #ffffff !important; word-break: break-word; overflow: hidden; }",
    "img { max-width: 100% !important; height: auto; }",
    "a { color: #3b82f6; }",
    "table { max-width: 100% !important; border-collapse: collapse; }",
    "td, th { word-break: break-word; }",
    "p { margin: 2px 0; }",
    "pre { white-space: pre-wrap; word-break: break-word; }",
    "blockquote { margin: 4px 0 4px 12px; padding-left: 8px; border-left: 3px solid #e2e8f0; color: #64748b; }",
    "</style></head><body>",
    clean,
    "</body></html>",
  ].join("");

  const handleLoad = useCallback(() => {
    try {
      const el = iframeRef.current?.contentDocument?.documentElement;
      if (el) setHeight(Math.max(40, Math.min(600, el.scrollHeight)));
    } catch { /* sandboxed */ }
  }, []);

  return (
    <div className="bg-white rounded-sm overflow-hidden">
      <iframe
        ref={iframeRef}
        srcDoc={doc}
        sandbox="allow-same-origin"
        onLoad={handleLoad}
        style={{ width: "100%", height: `${height}px`, border: "none", display: "block" }}
        title="Email content"
      />
    </div>
  );
}

// ─── AttachmentList ───────────────────────────────────────────────────────────

function AttachmentList({ metaJson }: { metaJson: string }) {
  let items: AttachmentMeta[] = [];
  try { items = JSON.parse(metaJson); } catch { return null; }
  if (!items.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {items.map((att, i) => {
        const isImage = att.mimeType.startsWith("image/");
        return (
          <button
            key={i}
            onClick={() => window.open(`#attachment-${att.partId ?? i}`, "_blank")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/80 transition-colors"
            title={`${att.name} (${formatBytes(att.size)})`}
          >
            {isImage ? <Eye className="h-3 w-3 flex-shrink-0 text-slate-400" /> : <File className="h-3 w-3 flex-shrink-0 text-slate-400" />}
            <span className="truncate max-w-[120px]">{att.name}</span>
            <span className="opacity-60 flex-shrink-0">{formatBytes(att.size)}</span>
            <Download className="h-3 w-3 flex-shrink-0 opacity-40" />
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
          <div className="h-4 w-4 rounded-full bg-amber-200 dark:bg-amber-800/60 flex items-center justify-center flex-shrink-0">
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

// ─── Account Health Panel (replaces SyncStatusWidget) ─────────────────────────

function AccountHealthPanel({ liveProgress, isSyncingLive, onSync, isSyncing }: {
  liveProgress: SyncProgressState | null;
  isSyncingLive: boolean;
  onSync: () => void;
  isSyncing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const { data } = useQuery<SyncStatus>({
    queryKey: ["comm-sync-status"],
    queryFn: () => apiFetch("/api/communications/sync-status"),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  if (!data) return null;

  const isSyncingNow = isSyncingLive || data.isSyncing;
  const errors = data.lastSyncResults.filter(r => r.error);
  const currentMailbox = liveProgress?.mailbox ?? (isSyncingNow ? data.currentMailbox : null);
  const imported = liveProgress?.imported ?? (isSyncingNow ? data.imported : 0);
  const scanned  = liveProgress?.scanned  ?? (isSyncingNow ? data.scanned  : 0);
  const hasIssues = errors.length > 0 && !isSyncingNow;

  return (
    <div className={cn(
      "mx-3 mb-3 rounded-xl border overflow-hidden transition-all",
      isSyncingNow
        ? "border-blue-200 dark:border-blue-800/50"
        : hasIssues
          ? "border-red-200 dark:border-red-800/50"
          : "border-slate-200 dark:border-slate-700/60",
    )}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
          isSyncingNow
            ? "bg-blue-50 dark:bg-blue-900/20"
            : hasIssues
              ? "bg-red-50 dark:bg-red-900/20"
              : "bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800",
        )}
      >
        {isSyncingNow ? (
          <Loader2 className="h-3 w-3 text-blue-500 animate-spin flex-shrink-0" />
        ) : hasIssues ? (
          <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
        ) : (
          <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-shrink-0" />
        )}
        <span className={cn(
          "text-[10px] font-semibold flex-1",
          isSyncingNow ? "text-blue-700 dark:text-blue-400"
            : hasIssues  ? "text-red-700 dark:text-red-400"
            : "text-slate-600 dark:text-slate-400",
        )}>
          {isSyncingNow ? "Syncing mailboxes…" : hasIssues ? "Sync error" : "All accounts connected"}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onSync(); }}
          disabled={isSyncing}
          className="p-1 rounded hover:bg-white/60 dark:hover:bg-slate-700/40 text-slate-400 disabled:opacity-40 transition-colors"
          title="Sync now"
        >
          <RefreshCw className={cn("h-2.5 w-2.5", isSyncing && "animate-spin")} />
        </button>
        {!isSyncingNow && (
          expanded ? <ChevronUp className="h-3 w-3 text-slate-400" /> : <ChevronDown className="h-3 w-3 text-slate-400" />
        )}
      </button>

      {/* Sync progress bar */}
      {isSyncingNow && currentMailbox && (
        <div className="px-3 py-2 bg-blue-50/80 dark:bg-blue-900/15 border-t border-blue-100 dark:border-blue-900/30">
          <p className="text-[10px] text-blue-700 dark:text-blue-400 font-medium truncate">
            {currentMailbox.replace(/^(Gmail|IMAP):/, "")}
          </p>
          {(scanned > 0 || imported > 0) && (
            <p className="text-[9px] text-blue-500 dark:text-blue-400 mt-0.5">
              {imported} imported · {scanned} scanned
            </p>
          )}
        </div>
      )}

      {/* Expanded: per-mailbox status */}
      {(expanded || isSyncingNow) && data.mailboxes.length > 0 && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {data.mailboxes.map(mb => (
            <div key={mb.email} className="px-3 py-2 flex items-center gap-2 bg-white dark:bg-slate-900">
              <div className={cn(
                "h-2 w-2 rounded-full flex-shrink-0",
                mb.connected ? "bg-emerald-500" : "bg-red-500",
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-700 dark:text-slate-300 truncate">{mb.email}</p>
                {mb.lastSyncAt && (
                  <p className="text-[9px] text-slate-400">{timeAgoShort(mb.lastSyncAt)}</p>
                )}
              </div>
              <span className={cn(
                "text-[8px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0",
                mb.type === "gmail"
                  ? "bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
              )}>
                {mb.type}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Errors */}
      {hasIssues && expanded && (
        <div className="px-3 py-1.5 bg-red-50 dark:bg-red-900/10 border-t border-red-100 dark:border-red-900/20">
          {errors.map((e, i) => (
            <div key={i} className="flex items-center gap-1 text-[9px] text-red-600 dark:text-red-400 py-0.5">
              <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />
              <span className="truncate">{e.mailbox.replace(/^(Gmail|IMAP):/, "")}: {e.error}</span>
            </div>
          ))}
        </div>
      )}

      {/* No mailboxes empty state */}
      {data.mailboxes.length === 0 && !isSyncingNow && (
        <div className="px-3 py-3 bg-white dark:bg-slate-900">
          <p className="text-[10px] text-slate-400 mb-1.5">No mailboxes connected</p>
          <a href="/mailbox" className="text-[10px] text-blue-500 hover:text-blue-600 font-medium">
            Connect Gmail or SMTP →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Bulk Action Bar ──────────────────────────────────────────────────────────

function BulkActionBar({ selectedIds, total, onAction, onSelectAll, onClear, currentFilter }: {
  selectedIds: Set<number>; total: number;
  onAction: (action: BulkAction) => void;
  onSelectAll: () => void;
  onClear: () => void;
  currentFilter: FilterKey;
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
        {currentFilter !== "archived" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => onAction("archive")} className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-600 dark:text-blue-400 transition-colors">
                <Archive className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Archive</TooltipContent>
          </Tooltip>
        )}
        {currentFilter === "trash" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => onAction("restore")} className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-600 dark:text-blue-400 transition-colors">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Restore</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => onAction("trash")} className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-600 dark:text-blue-400 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Move to Trash</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => onAction("delete")} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Delete Permanently</TooltipContent>
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

// ─── Conversation Item (Gmail-compact style) ──────────────────────────────────

function ConvItem({
  conv, isActive, isSelected, onClick, onToggleSelect, showCheckboxes, showMailboxBadge,
}: {
  conv: Conversation; isActive: boolean; isSelected: boolean;
  onClick: () => void; onToggleSelect: (id: number) => void;
  showCheckboxes: boolean;
  showMailboxBadge: boolean;
}) {
  const isSystem = conv.status === "system";
  const isUnread = conv.status === "unread";
  const [hovering, setHovering] = useState(false);
  const showCheck = showCheckboxes || hovering;

  return (
    <div
      className={cn(
        "flex items-center border-b border-slate-100 dark:border-slate-800/40 transition-colors cursor-pointer group relative select-none",
        isActive
          ? "bg-blue-50 dark:bg-blue-900/20 border-l-[3px] border-l-blue-500"
          : isUnread
            ? "bg-white dark:bg-slate-900 border-l-[3px] border-l-blue-400 hover:bg-blue-50/40 dark:hover:bg-blue-900/10"
            : isSystem
              ? "bg-amber-50/30 dark:bg-amber-900/5 border-l-[3px] border-l-amber-300 dark:border-l-amber-800/50 hover:bg-amber-50/60 dark:hover:bg-amber-900/10"
              : "bg-white dark:bg-slate-900 border-l-[3px] border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/30",
      )}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={onClick}
    >
      {/* Checkbox / indicator column */}
      <div className="flex flex-col items-center justify-center px-2 py-3 gap-1.5 flex-shrink-0 w-9">
        {showCheck ? (
          <div
            className={cn(
              "h-4 w-4 rounded border-2 flex items-center justify-center cursor-pointer transition-colors flex-shrink-0",
              isSelected ? "bg-blue-600 border-blue-600" : "border-slate-300 dark:border-slate-600 hover:border-blue-400",
            )}
            onClick={e => { e.stopPropagation(); onToggleSelect(conv.id); }}
          >
            {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
          </div>
        ) : (
          <Star
            className={cn(
              "h-3.5 w-3.5 transition-colors flex-shrink-0",
              conv.starred ? "fill-amber-400 text-amber-400" : "text-slate-200 dark:text-slate-700 group-hover:text-slate-400 dark:group-hover:text-slate-500",
            )}
            onClick={e => e.stopPropagation()}
          />
        )}
        {isUnread && !showCheck && (
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
        )}
      </div>

      {/* Text content */}
      <div className="flex-1 min-w-0 py-2.5 pr-3">
        {/* Row 1: sender + date */}
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn(
            "text-[13px] truncate",
            isUnread ? "font-bold text-slate-900 dark:text-slate-50" : "font-medium text-slate-600 dark:text-slate-300",
          )}>
            {isSystem ? "System" : conv.customerName}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0 tabular-nums">{timeAgo(conv.lastMessageAt)}</span>
        </div>

        {/* Row 2: subject */}
        <p className={cn(
          "text-[12px] truncate mt-0.5 leading-snug",
          isUnread ? "font-semibold text-slate-800 dark:text-slate-100" : "font-normal text-slate-600 dark:text-slate-400",
        )}>
          {conv.subject || "(No subject)"}
        </p>

        {/* Row 3: preview / tags */}
        <div className="flex items-center gap-1.5 mt-0.5">
          {isSystem ? (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5 truncate">
              <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" /> Delivery notification
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate flex-1 font-normal">{conv.customerEmail}</span>
          )}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Mailbox type badge — only when "All Mailboxes" is selected */}
            {showMailboxBadge && conv.mailboxType && (
              <span className={cn(
                "text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide",
                conv.mailboxType === "gmail"
                  ? "bg-rose-100 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
              )}>
                {conv.mailboxType === "gmail" ? "Gmail" : "SMTP"}
              </span>
            )}
            {conv.unreadCount > 0 && (
              <span className="h-4 min-w-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center">
                {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
              </span>
            )}
            {conv.status === "needs_reply" && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Reply</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Filter groups (shared between sidebar and mobile strip) ─────────────────

const FILTER_GROUPS: {
  label?: string;
  items: { key: FilterKey; label: string; icon: React.ElementType }[];
}[] = [
  {
    items: [
      { key: "inbox",       label: "Inbox",         icon: Inbox },
      { key: "starred",     label: "Starred",        icon: Star },
      { key: "sent",        label: "Sent",           icon: Send },
      { key: "drafts",      label: "Drafts",         icon: FileText },
      { key: "all",         label: "All Mail",       icon: MoreHorizontal },
    ],
  },
  {
    label: "Categories",
    items: [
      { key: "unread",      label: "Unread",         icon: Mail },
      { key: "needs_reply", label: "Needs Reply",    icon: CornerDownLeft },
    ],
  },
  {
    items: [
      { key: "archived",    label: "Archived",       icon: Archive },
      { key: "spam",        label: "Spam",           icon: Ban },
      { key: "trash",       label: "Trash",          icon: Trash2 },
      { key: "system",      label: "Notifications",  icon: AlertTriangle },
    ],
  },
];

const FILTER_LABELS: Record<FilterKey, string> = {
  inbox: "Inbox", sent: "Sent", drafts: "Drafts", starred: "Starred",
  all: "All Mail", unread: "Unread", needs_reply: "Needs Reply",
  archived: "Archived", spam: "Spam", trash: "Trash", system: "Notifications",
};

// ─── Folder Sidebar ───────────────────────────────────────────────────────────

function FolderSidebar({
  filter, setFilter, stats, mailboxes, selectedMailboxId, onMailboxChange,
  connectionStatus, liveProgress, isSyncing, onSync,
}: {
  filter: FilterKey; setFilter: (f: FilterKey) => void;
  stats: Stats | undefined;
  mailboxes: MailboxOption[]; selectedMailboxId: string | number | null;
  onMailboxChange: (id: string | number | null) => void;
  connectionStatus: "connecting" | "connected" | "disconnected";
  liveProgress: SyncProgressState | null;
  isSyncing: boolean;
  onSync: () => void;
}) {
  const safeMailboxes = mailboxes ?? [];
  const selectedMailboxLabel = selectedMailboxId === null
    ? "All Mailboxes"
    : safeMailboxes.find(m => m.id === selectedMailboxId)?.email ?? "All Mailboxes";

  const countFor = (key: FilterKey): number | undefined => {
    if (!stats) return undefined;
    switch (key) {
      case "inbox":       return stats.inbox;
      case "sent":        return stats.sent;
      case "unread":      return stats.unread;
      case "needs_reply": return stats.needsReply;
      case "starred":     return stats.starred;
      case "archived":    return stats.archived;
      case "spam":        return stats.spam;
      case "trash":       return stats.trash;
      case "system":      return stats.system;
      default:            return undefined;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900/60 border-r border-slate-200 dark:border-slate-700/60">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">Mail</h1>
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
        </div>

        {/* Mailbox selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <Server className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                <span className="truncate">{selectedMailboxLabel}</span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Folder nav */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2">
        {FILTER_GROUPS.map((group, gi) => (
          <div key={gi} className={gi > 0 ? "mt-2 pt-2 border-t border-slate-200/80 dark:border-slate-700/40" : ""}>
            {group.label && (
              <p className="px-3 py-1.5 text-[9px] font-semibold text-slate-400 dark:text-slate-600 uppercase tracking-widest">
                {group.label}
              </p>
            )}
            {group.items.map(f => {
              const count = countFor(f.key);
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                    filter === f.key
                      ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400"
                      : "text-slate-600 hover:bg-white dark:text-slate-400 dark:hover:bg-slate-800",
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
        ))}
      </nav>

      {/* Sync status at bottom */}
      <div className="flex-shrink-0">
        <AccountHealthPanel
          liveProgress={liveProgress}
          isSyncingLive={isSyncing}
          onSync={onSync}
          isSyncing={isSyncing}
        />
      </div>
    </div>
  );
}

// ─── Conversation List Panel ──────────────────────────────────────────────────

function ConversationListPanel({
  filter, search, setSearch,
  conversations, isLoading, total,
  selectedId, onSelect,
  selectedIds, onToggleSelect, onBulkAction,
  onLoadMore, hasMore, isFetchingMore,
  onRefresh, showMailboxBadge,
}: {
  filter: FilterKey;
  search: string; setSearch: (s: string) => void;
  conversations: Conversation[]; isLoading: boolean; total: number;
  selectedId: number | null; onSelect: (id: number) => void;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onBulkAction: (action: BulkAction) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isFetchingMore: boolean;
  onRefresh: () => void;
  showMailboxBadge: boolean;
}) {
  const queryClient = useQueryClient();
  const showCheckboxes = selectedIds.size > 0;

  const handleSelectAll = () => conversations.forEach(c => onToggleSelect(c.id));
  const handleClear = () => conversations.forEach(c => { if (selectedIds.has(c.id)) onToggleSelect(c.id); });

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasMore && !isFetchingMore) onLoadMore(); },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isFetchingMore, onLoadMore]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {/* Header: label + search */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0 border-b border-slate-100 dark:border-slate-800 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
            {FILTER_LABELS[filter] ?? filter}
            {total > 0 && <span className="ml-1.5 text-[11px] text-slate-400 font-normal">{total}</span>}
          </h2>
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["conversations"] });
              queryClient.invalidateQueries({ queryKey: ["comm-stats"] });
              onRefresh();
            }}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors flex-shrink-0"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="pl-8 h-8 text-xs rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-slate-400 hover:text-slate-600" />
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          total={conversations.length}
          onAction={onBulkAction}
          onSelectAll={handleSelectAll}
          onClear={handleClear}
          currentFilter={filter}
        />
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div>
            {Array(8).fill(0).map((_, i) => (
              <div key={i} className="px-3 py-3 border-b border-slate-100 dark:border-slate-800/40 space-y-1.5">
                <div className="flex justify-between gap-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2.5 w-3/4" />
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="h-12 w-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
              {filter === "spam"    ? <Ban className="h-6 w-6 text-slate-300 dark:text-slate-600" />
               : filter === "archived" ? <Archive className="h-6 w-6 text-slate-300 dark:text-slate-600" />
               : filter === "starred"  ? <Star className="h-6 w-6 text-slate-300 dark:text-slate-600" />
               : filter === "trash"    ? <Trash2 className="h-6 w-6 text-slate-300 dark:text-slate-600" />
               : filter === "system"   ? <AlertTriangle className="h-6 w-6 text-slate-300 dark:text-slate-600" />
               : <MessageSquare className="h-6 w-6 text-slate-300 dark:text-slate-600" />}
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {search ? "No matches" :
               filter === "inbox"    ? "Inbox is empty" :
               filter === "sent"     ? "No sent messages" :
               filter === "drafts"   ? "No drafts" :
               filter === "trash"    ? "Trash is empty" :
               filter === "system"   ? "No notifications" :
               `No ${filter.replace("_", " ")} conversations`}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {search ? "Try a different search term" :
               filter === "inbox"  ? "Inbound emails appear here after syncing" :
               filter === "trash"  ? "Deleted conversations appear here" :
               filter === "system" ? "Delivery failures and bounce notices appear here" :
               "Nothing here yet"}
            </p>
          </div>
        ) : (
          <>
            {conversations.map(conv => (
              <ConvItem
                key={conv.id}
                conv={conv}
                isActive={selectedId === conv.id}
                isSelected={selectedIds.has(conv.id)}
                onClick={() => onSelect(conv.id)}
                onToggleSelect={onToggleSelect}
                showCheckboxes={showCheckboxes}
                showMailboxBadge={showMailboxBadge}
              />
            ))}
            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="py-2 flex justify-center">
              {isFetchingMore && <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
              {!hasMore && conversations.length > 0 && (
                <p className="text-[10px] text-slate-300 dark:text-slate-600 py-1">All loaded</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Reply Composer ───────────────────────────────────────────────────────────

type ComposerTrigger = { mode: ReplyMode; ts: number } | null;

function ReplyComposer({ conv, messages, currentUserId, onNoteAdded, composerTrigger }: {
  conv: Conversation; messages: Message[];
  currentUserId: number; onNoteAdded: () => void;
  composerTrigger: ComposerTrigger;
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
  const [expanded, setExpanded] = useState(false);
  const fileRef    = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // React to external reply triggers (from ThreadEmailCard reply buttons)
  useEffect(() => {
    if (!composerTrigger) return;
    handleModeChange(composerTrigger.mode);
    setExpanded(true);
    setTimeout(() => textareaRef.current?.focus(), 60);
  }, [composerTrigger?.ts]);

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

      setBody(""); setFiles([]); setToField(conv.customerEmail); setExpanded(false);
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
      setBody(""); setExpanded(false);
      toast({ title: "Note saved" });
      onNoteAdded();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setSending(false);
    }
  };

  const isSystem = conv.status === "system";
  const tabClass = (m: ReplyMode) => cn(
    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors",
    mode === m
      ? m === "note" ? "border-amber-500 text-amber-600 dark:text-amber-400"
                     : "border-blue-500 text-blue-600 dark:text-blue-400"
      : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
  );

  // Collapsed: just a click-to-reply bar (Gmail style)
  if (!expanded) {
    return (
      <div
        className="mx-6 mb-4 mt-2 flex-shrink-0"
        onClick={() => { setExpanded(true); setTimeout(() => textareaRef.current?.focus(), 60); }}
      >
        <div className={cn(
          "flex items-center gap-3 px-4 py-2.5 rounded-2xl border cursor-text shadow-sm transition-shadow hover:shadow-md",
          isSystem
            ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/40"
            : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700",
        )}>
          <Avatar className="h-7 w-7 flex-shrink-0">
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[9px] font-semibold">
              Me
            </AvatarFallback>
          </Avatar>
          <span className="text-sm text-slate-400 dark:text-slate-500 flex-1">
            {isSystem ? "Add internal note…" : `Reply to ${conv.customerName}…`}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={e => { e.stopPropagation(); setMode("reply"); setExpanded(true); setTimeout(() => textareaRef.current?.focus(), 60); }}
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors"
              title="Reply"
            >
              <Reply className="h-3.5 w-3.5" />
            </button>
            {!isSystem && (
              <button
                onClick={e => { e.stopPropagation(); setMode("forward"); setExpanded(true); setTimeout(() => textareaRef.current?.focus(), 60); }}
                className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors"
                title="Forward"
              >
                <Forward className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Expanded composer
  return (
    <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0 sticky bottom-0 z-10">
      {/* Mode tabs */}
      <div className="flex border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
        {!isSystem && (
          <>
            <button onClick={() => handleModeChange("reply")} className={tabClass("reply")}>
              <Reply className="h-3.5 w-3.5" /> Reply
            </button>
            <button onClick={() => handleModeChange("reply_all")} className={tabClass("reply_all")}>
              <ReplyAll className="h-3.5 w-3.5" /> Reply All
            </button>
            <button onClick={() => handleModeChange("forward")} className={tabClass("forward")}>
              <Forward className="h-3.5 w-3.5" /> Forward
            </button>
          </>
        )}
        <button onClick={() => handleModeChange("note")} className={tabClass("note")}>
          <StickyNote className="h-3.5 w-3.5" /> Note
        </button>
        <button onClick={() => setExpanded(false)} className="ml-auto p-1.5 m-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
          <ChevronDown className="h-3.5 w-3.5" />
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
              >CC</button>
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
          ref={textareaRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={
            mode === "note"      ? "Add a private note for your team…"
            : mode === "forward" ? "Add a forwarding note…"
            : `Reply to ${conv.customerName}…`
          }
          className={cn(
            "min-h-[80px] resize-none text-sm rounded-xl border-slate-200 dark:border-slate-700 bg-transparent focus-visible:ring-1",
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
            {mode === "note" ? "Save Note" : mode === "forward" ? "Forward" : "Send Reply"}
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
          { key: "summarize",      label: "Summarize Thread",     icon: FileText },
          { key: "suggest_reply",  label: "Suggest Reply",        icon: Reply },
          { key: "extract_intent", label: "Extract Intent",       icon: TrendingUp },
          { key: "sentiment",      label: "Sentiment Analysis",   icon: Zap },
          { key: "rewrite",        label: "Rewrite Last Message", icon: RotateCcw },
          { key: "translate",      label: "Translate Thread",     icon: Languages },
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
            <p className="text-xs text-slate-400">Choose an action above to get AI insights.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Thread Email Card (Gmail-style collapsible) ──────────────────────────────

function ThreadEmailCard({
  msg, isExpanded, onToggle, isLatest, isSystem, customerName, onReply,
}: {
  msg: Message;
  isExpanded: boolean;
  onToggle: () => void;
  isLatest: boolean;
  isSystem: boolean;
  customerName: string;
  onReply?: (mode: ReplyMode) => void;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const isOut   = msg.direction === "outbound";
  const isUnread = !msg.isRead && !isOut;
  const time    = msg.sentAt ?? msg.createdAt;
  const color   = isOut ? "from-blue-500 to-indigo-600"
    : isSystem ? "from-amber-500 to-orange-600"
    : avatarColor(msg.fromEmail);

  const { primary: primaryHtml, quoted: quotedHtml } = useMemo(
    () => msg.htmlBody ? extractQuotedContent(msg.htmlBody) : { primary: null, quoted: null },
    [msg.htmlBody],
  );

  // ── Collapsed row: sender + snippet + time, no avatar ──
  if (!isExpanded) {
    return (
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-6 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-100 dark:border-slate-800/40 last:border-none"
      >
        <div className={cn(
          "w-1.5 h-1.5 rounded-full flex-shrink-0",
          isUnread ? "bg-blue-500" : "bg-transparent",
        )} />
        <span className={cn(
          "text-[13px] flex-shrink-0 w-32 truncate",
          isOut
            ? "text-slate-400 dark:text-slate-500 italic"
            : isUnread
              ? "font-bold text-slate-900 dark:text-slate-100"
              : "font-medium text-slate-700 dark:text-slate-300",
        )}>
          {isOut ? "Me (sent)" : (msg.fromName ?? customerName)}
        </span>
        <span className="text-[12px] text-slate-400 dark:text-slate-500 truncate flex-1">
          {msg.snippet ?? msg.body.slice(0, 120)}
        </span>
        <span className="text-[11px] text-slate-400 flex-shrink-0 tabular-nums">{timeAgo(time)}</span>
      </div>
    );
  }

  // ── Expanded email document — Gmail-style: header → body → reply strip ──
  return (
    <div className="group/expanded border-b border-slate-100 dark:border-slate-800/40 last:border-none">

      {/* ── Email header ── */}
      <div className="px-6 pt-4 pb-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* From line */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
              {isOut ? "Me" : (msg.fromName ?? msg.fromEmail)}
            </span>
            {!isOut && msg.fromName && (
              <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-xs">
                {"<"}{msg.fromEmail}{">"}
              </span>
            )}
            {isSystem && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-2.5 w-2.5" /> System
              </span>
            )}
            {isOut && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-200 dark:border-blue-800/30">
                Sent
              </span>
            )}
            {isUnread && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
          </div>
          {/* To line */}
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            <span className="text-slate-300 dark:text-slate-600 mr-1">to</span>
            {msg.toEmail ?? customerName}
          </p>
        </div>

        {/* Date + hover actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <span className="text-[11px] text-slate-400 tabular-nums mr-1">{fullTime(time)}</span>
          <div
            className="flex items-center gap-0.5 opacity-0 group-hover/expanded:opacity-100 transition-opacity"
            onClick={e => e.stopPropagation()}
          >
            {!isSystem && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onReply?.("reply")}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <Reply className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Reply</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigator.clipboard.writeText(msg.body)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Copy text</TooltipContent>
            </Tooltip>
          </div>
          {/* Collapse button */}
          <button
            onClick={e => { e.stopPropagation(); onToggle(); }}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
            title="Collapse"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Thin divider between header and body */}
      <div className="mx-6 border-t border-slate-100 dark:border-slate-800" />

      {/* ── Email body — full width, no left indentation ── */}
      <div className="px-6 py-4">
        {msg.htmlBody ? (
          <>
            <HtmlEmailRenderer html={primaryHtml ?? msg.htmlBody} />
            {quotedHtml && (
              <div className="mt-3">
                <button
                  onClick={() => setShowQuoted(v => !v)}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {showQuoted
                    ? <><ChevronUp className="h-3 w-3" /> Hide quoted text</>
                    : <><ChevronDown className="h-3 w-3" /> Show quoted text</>}
                </button>
                {showQuoted && (
                  <div className="mt-2 pl-3 border-l-2 border-slate-200 dark:border-slate-700">
                    <HtmlEmailRenderer html={quotedHtml} />
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
            {msg.body}
          </p>
        )}

        {msg.attachmentsMeta && <AttachmentList metaJson={msg.attachmentsMeta} />}
      </div>

      {/* ── Reply strip — only on the latest message ── */}
      {isLatest && !isSystem && (
        <div className="px-6 pb-4 pt-1 flex flex-wrap gap-2 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={() => onReply?.("reply")}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
          >
            <Reply className="h-3.5 w-3.5" /> Reply
          </button>
          <button
            onClick={() => onReply?.("reply_all")}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
          >
            <ReplyAll className="h-3.5 w-3.5" /> Reply all
          </button>
          <button
            onClick={() => onReply?.("forward")}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
          >
            <Forward className="h-3.5 w-3.5" /> Forward
          </button>
        </div>
      )}
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
  const bottomRef   = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [showAI, setShowAI]         = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger>(null);

  // Expanded message IDs — default to expanding the latest message
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<ConversationDetail>({
    queryKey: ["conv-detail", selectedId],
    queryFn: () => apiFetch(`/api/communications/conversations/${selectedId}`),
    enabled: selectedId !== null,
    staleTime: 30_000,
  });

  // When conversation changes or messages load, auto-expand the latest message
  useEffect(() => {
    if (data?.messages && data.messages.length > 0) {
      const latestId = data.messages[data.messages.length - 1].id;
      setExpandedIds(new Set([latestId]));
    }
  }, [data?.conversation?.id, data?.messages?.length]);

  // Scroll to bottom when messages load
  useEffect(() => {
    if (data) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
  }, [data?.messages?.length]);

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

  const toggleExpanded = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Trigger reply from a ThreadEmailCard
  const handleThreadReply = (mode: ReplyMode) => {
    setComposerTrigger({ mode, ts: Date.now() });
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

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
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-5 pb-3">
            <Skeleton className="h-6 w-80 mb-2" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl mx-4 border border-slate-200 dark:border-slate-700/60 overflow-hidden">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 last:border-none space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-3 w-20 flex-shrink-0" />
                </div>
                <Skeleton className="h-3 w-24" />
                <div className="border-t border-slate-100 dark:border-slate-800 pt-3 mt-1">
                  <Skeleton className="h-20 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { conversation: conv, messages, notes } = data;
  const isSystem = conv.status === "system";

  // ── Thread: chronologically merge messages + notes ──
  type ThreadItem =
    | { kind: "message"; msg: Message; time: string }
    | { kind: "note";    note: Note;   time: string };

  const threadItems: ThreadItem[] = [
    ...messages.map(msg  => ({ kind: "message" as const, msg,  time: msg.sentAt ?? msg.createdAt })),
    ...notes.map(note => ({ kind: "note"    as const, note, time: note.createdAt })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  let lastDayLabel = "";

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 relative">
      {/* Thread header */}
      <div className={cn(
        "flex items-center gap-2 px-4 h-14 border-b border-slate-200 dark:border-slate-700 flex-shrink-0",
        isSystem
          ? "bg-amber-50 dark:bg-amber-900/20"
          : "bg-white dark:bg-slate-900",
      )}>
        <button onClick={onBack} className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
          <ChevronLeft className="h-4 w-4" />
        </button>

        {isSystem && <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{conv.subject}</p>
          <p className="text-xs text-slate-400 truncate">
            {isSystem ? "System Notification" : `${conv.customerName} · ${messages.length} message${messages.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        {/* Action toolbar */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Reply button — quick access to composer from the reading pane header */}
          {!isSystem && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setComposerTrigger({ mode: "reply", ts: Date.now() })}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-xs font-medium"
                >
                  <CornerDownLeft className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">Reply</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Reply (R)</TooltipContent>
            </Tooltip>
          )}

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
                <DropdownMenuItem onClick={() => updateMutation.mutate({ status: "trash" })} className="gap-2 text-xs">
                  <Trash2 className="h-3.5 w-3.5" /> Move to Trash
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => updateMutation.mutate({ status: "spam" })} className="gap-2 text-xs text-amber-600 focus:text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Mark as Spam
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDeleteConfirm(true)} className="gap-2 text-xs text-red-500 focus:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" /> Delete Permanently
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

      {/* System notification banner */}
      {isSystem && (
        <div className="px-6 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 flex-shrink-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Delivery Notification</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                This message is a system notification — it may indicate a delivery failure or bounce. No reply is needed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Thread body */}
      <div className="flex-1 overflow-y-auto">
        {/* Subject heading */}
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug">{conv.subject}</h2>
          {messages.length > 1 && (
            <button
              onClick={() => {
                // Collapse all; or if all expanded, collapse all
                if (expandedIds.size === messages.length) {
                  setExpandedIds(new Set([messages[messages.length - 1].id]));
                } else {
                  setExpandedIds(new Set(messages.map(m => m.id)));
                }
              }}
              className="text-[11px] text-blue-500 hover:text-blue-600 mt-1 transition-colors"
            >
              {expandedIds.size === messages.length
                ? "Collapse older messages"
                : `Expand all ${messages.length} messages`}
            </button>
          )}
        </div>

        {/* Thread items (messages + notes) */}
        <div className="bg-white dark:bg-slate-900 rounded-xl mx-4 mb-2 border border-slate-200 dark:border-slate-700/60 overflow-hidden">
          {threadItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
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
                    <div className="flex items-center gap-3 px-6 py-2 bg-slate-50 dark:bg-slate-800/50">
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">{label}</span>
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    </div>
                  )}

                  {item.kind === "message" ? (
                    <ThreadEmailCard
                      msg={item.msg}
                      isExpanded={expandedIds.has(item.msg.id)}
                      onToggle={() => toggleExpanded(item.msg.id)}
                      isLatest={idx === threadItems.length - 1 || (
                        item.kind === "message" &&
                        item.msg.id === messages[messages.length - 1].id
                      )}
                      isSystem={isSystem}
                      customerName={conv.customerName}
                      onReply={handleThreadReply}
                    />
                  ) : (
                    <div className="px-6 py-3 group/note border-b border-slate-100 dark:border-slate-800/40 last:border-none">
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
        </div>

        <div ref={bottomRef} />
      </div>

      {/* Reply composer — sticky at bottom */}
      <ReplyComposer
        conv={conv}
        messages={messages}
        currentUserId={currentUserId}
        onNoteAdded={() => queryClient.invalidateQueries({ queryKey: ["conv-detail", selectedId] })}
        composerTrigger={composerTrigger}
      />

      {/* AI panel overlay */}
      {showAI && (
        <AIAssistPanel
          convId={conv.id}
          onClose={() => setShowAI(false)}
          onUseReply={text => {
            setShowAI(false);
            setComposerTrigger({ mode: "reply", ts: Date.now() });
            // Brief delay to let composer open, then inject body
            setTimeout(() => {
              const ta = document.querySelector<HTMLTextAreaElement>(".comm-reply-textarea");
              if (ta) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                nativeInputValueSetter?.call(ta, text);
                ta.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, 100);
          }}
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
    { icon: Mail,         label: "Email",    value: conv.customerEmail, copyable: true },
    { icon: Phone,        label: "Phone",    value: conv.customerPhone, tel: true },
    { icon: Truck,        label: "Vehicle",  value: lead?.vehicle },
    { icon: MapPin,       label: "Route",    value: lead?.route },
    { icon: MapPin,       label: "Pickup",   value: lead?.pickup },
    { icon: MapPin,       label: "Delivery", value: lead?.delivery },
    { icon: DollarSign,   label: "Quote",    value: lead?.price },
    { icon: Tag,          label: "Quote ID", value: lead?.quoteId },
    { icon: Megaphone,    label: "Campaign", value: campaign?.name },
    { icon: CheckCircle2, label: "Status",   value: lead?.status },
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

const CONVS_PAGE_SIZE = 50;

export default function Communications() {
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;

  const [filter, setFilter]                   = useState<FilterKey>("inbox");
  const [search, setSearch]                   = useState("");
  const [selectedId, setSelectedId]           = useState<number | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | number | null>(null);
  const [mobilePanel, setMobilePanel]         = useState<"list" | "thread" | "details">("list");
  const [showDetails, setShowDetails]         = useState(true);
  const [isSyncing, setIsSyncing]             = useState(false);
  const [selectedIds, setSelectedIds]         = useState<Set<number>>(new Set());
  const [liveProgress, setLiveProgress]       = useState<SyncProgressState | null>(null);

  // ── Pagination state ─────────────────────────────────────────────────────
  const [convPage, setConvPage]               = useState(1);
  const [accConversations, setAccConversations] = useState<Conversation[]>([]);
  const [convTotal, setConvTotal]             = useState(0);

  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const handleSyncProgress = useCallback((p: SyncProgressState) => setLiveProgress(p), []);
  const handleSyncStarted  = useCallback(() => { setIsSyncing(true); setLiveProgress(null); }, []);
  const handleSyncComplete = useCallback(() => {
    setIsSyncing(false);
    setTimeout(() => setLiveProgress(null), 2_000);
  }, []);

  const connectionStatus = useCommEvents(handleSyncProgress, handleSyncStarted, handleSyncComplete);

  const { data: mailboxes = [] } = useQuery<MailboxOption[]>({
    queryKey: ["comm-mailboxes"],
    queryFn: () => apiFetch("/api/communications/mailboxes"),
    staleTime: 5 * 60_000,
  });

  // Reset pagination whenever the filter, search, or mailbox changes
  useEffect(() => {
    setConvPage(1);
    setAccConversations([]);
    setConvTotal(0);
  }, [filter, search, selectedMailboxId]);

  const convsUrl = (page: number) => {
    const params = new URLSearchParams({ filter, search, limit: String(CONVS_PAGE_SIZE), page: String(page) });
    if (selectedMailboxId !== null) {
      // Send both numeric SMTP IDs and the special "gmail" string
      params.set("mailboxId", String(selectedMailboxId));
    }
    return `/api/communications/conversations?${params.toString()}`;
  };

  const { data: convData, isLoading, isFetching } = useQuery<{ data: Conversation[]; total: number }>({
    queryKey: ["conversations", filter, search, selectedMailboxId, convPage],
    queryFn: () => apiFetch(convsUrl(convPage)),
    staleTime: 30_000,
  });

  // Accumulate conversations across pages, deduplicating by id
  useEffect(() => {
    if (!convData) return;
    setConvTotal(convData.total);
    if (convPage === 1) {
      setAccConversations(convData.data);
    } else {
      setAccConversations(prev => {
        const existingIds = new Set(prev.map(c => c.id));
        const fresh = convData.data.filter(c => !existingIds.has(c.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    }
  }, [convData, convPage]);

  const { data: stats } = useQuery<Stats>({
    queryKey: ["comm-stats"],
    queryFn: () => apiFetch("/api/communications/stats"),
    staleTime: 60_000,
  });

  const conversations = accConversations;
  const hasMoreConvs  = conversations.length < convTotal;
  const isFetchingMore = isFetching && convPage > 1;

  const handleLoadMore = useCallback(() => {
    if (hasMoreConvs && !isFetching) setConvPage(p => p + 1);
  }, [hasMoreConvs, isFetching]);

  // Optimistic mark-as-read when selecting a conversation (inbound unread only)
  const handleSelect = (id: number) => {
    setSelectedId(id);
    setMobilePanel("thread");
    const conv = conversations.find(c => c.id === id);
    // Only apply optimistic update if the conversation actually has unread inbound messages
    if (conv && conv.unreadCount > 0 && conv.status === "unread") {
      queryClient.setQueriesData<{ data: Conversation[]; total: number }>(
        { queryKey: ["conversations"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map(c =>
              c.id === id ? { ...c, status: "read", unreadCount: 0 } : c,
            ),
          };
        },
      );
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["comm-stats"] }), 500);
    }
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
        setIsSyncing(true);
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
      {/* ── Folder sidebar — desktop only ────────────────────────────────────── */}
      <div className="hidden lg:flex lg:flex-col w-52 flex-shrink-0 h-full">
        <FolderSidebar
          filter={filter}
          setFilter={f => { setFilter(f); setSelectedId(null); setSelectedIds(new Set()); }}
          stats={stats}
          mailboxes={mailboxes}
          selectedMailboxId={selectedMailboxId}
          onMailboxChange={handleMailboxChange}
          connectionStatus={connectionStatus}
          liveProgress={liveProgress}
          isSyncing={isSyncing}
          onSync={handleRefresh}
        />
      </div>

      {/* ── Conversation list panel ───────────────────────────────────────────── */}
      {/* On mobile: full-width when mobilePanel==="list"; hidden otherwise.
          On desktop: always visible at fixed width. */}
      <div className={cn(
        "flex-shrink-0 h-full",
        mobilePanel !== "list"
          ? "hidden lg:flex lg:flex-col lg:w-80"
          : "flex flex-col w-full lg:w-80",
      )}>
        {/* Mobile: compact folder filter strip above conversation list */}
        <div className="lg:hidden flex items-center gap-1 px-2 py-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto flex-shrink-0 bg-slate-50 dark:bg-slate-900/60">
          {FILTER_GROUPS.flatMap(g => g.items).map(f => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setSelectedId(null); setSelectedIds(new Set()); }}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap transition-colors flex-shrink-0",
                filter === f.key
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700",
              )}
            >
              <f.icon className="h-2.5 w-2.5" />
              {f.label}
            </button>
          ))}
        </div>

        <ConversationListPanel
          filter={filter}
          search={search}
          setSearch={setSearch}
          conversations={conversations}
          isLoading={isLoading}
          total={convTotal}
          selectedId={selectedId}
          onSelect={handleSelect}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onBulkAction={handleBulkAction}
          onLoadMore={handleLoadMore}
          hasMore={hasMoreConvs}
          isFetchingMore={isFetchingMore}
          onRefresh={handleRefresh}
          showMailboxBadge={selectedMailboxId === null}
        />
      </div>

      {/* ── Reading pane ─────────────────────────────────────────────────────── */}
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

      {/* ── Customer details panel ───────────────────────────────────────────── */}
      {(showDetails || mobilePanel === "details") && (
        <div className={cn(
          "w-64 flex-shrink-0 h-full",
          mobilePanel === "details" ? "flex flex-col w-full lg:w-64" : "hidden lg:flex lg:flex-col",
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
