/**
 * AdminMonitoring.tsx — Platform Monitoring + Queue Management
 * Parts 1, 10, 11: Live queue monitor (10s), full queue management table, cross-refresh.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  Server, Database, Inbox, Cpu, MemoryStick, Activity, Clock,
  Users, Zap, ShieldAlert, Play, Pause, BarChart3, HardDrive,
  MailSearch, TimerReset, RotateCcw, ListChecks, Trash2,
  ChevronLeft, ChevronRight, Copy, Check, Eye, Filter, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CronJobState {
  name: string; intervalSec: number;
  lastRunAt: string | null; lastSuccessAt: string | null;
  lastError: string | null; runCount: number;
}

interface RunningJob {
  id: number; name: string; status: string; progress: number;
  sentCount: number; totalLeads: number; updatedAt: string;
}

interface FailedJob {
  id: number; email: string; campaignId: number | null;
  lastError: string | null; attempts: number; createdAt: string;
}

interface RecentError {
  id: number; type: string; description: string; createdAt: string;
}

interface PlatformHealth {
  api: {
    status: string; uptimeSeconds: number; memUsedMb: number;
    memTotalMb: number; rssMemMb: number; nodeVersion: string; pid: number;
  };
  system: {
    cpuLoad1m: number; cpuLoad5m: number; cpuLoad15m: number;
    totalMemMb: number; freeMemMb: number; usedMemMb: number;
    memPct: number; cpuCount: number; platform: string;
  };
  disk: { totalGb: number; usedGb: number; freeGb: number; usedPct: number } | null;
  database: { status: string; latencyMs: number; };
  queue: { pending: number; sending: number; deferred: number; failed: number; success: number; };
  workers: { smtpActive: boolean; gmailActive: boolean; bounceScanner: boolean; };
  imap: { status: string; lastScanAt: string | null; detail: string; };
  cronJobs: CronJobState[];
  runningJobs: RunningJob[];
  failedJobs: FailedJob[];
  recentErrors: RecentError[];
  sessions: { active24h: number; active1h: number; };
  errors: { last24h: number; last1h: number; };
  checkedAt: string;
}

interface QueueItem {
  id: number;
  jobId: string;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  mailboxId: number;
  mailboxEmail: string | null;
  campaignId: number | null;
  campaignName: string | null;
  email: string;
  subject: string;
  status: string;
  attempts: number;
  deferredCount: number;
  lastError: string | null;
  retryAfter: string | null;
  sentAt: string | null;
  firstAttemptAt: string | null;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function apiFetch(path: string) {
  const res = await fetch(`/api/admin/${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

async function apiPost(path: string, body?: unknown) {
  const res = await fetch(`/api/admin/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function fmtMem(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

// Parse SMTP error JSON to get the actual provider response (Part 12)
function smtpDisplayError(raw: string | null): string {
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw);
    if (obj.response) return obj.response;
    if (obj.rawCode && obj.friendly) return `${obj.rawCode}: ${obj.friendly}`;
    return obj.friendly ?? raw;
  } catch {
    return raw;
  }
}

// ─── StatusDot ────────────────────────────────────────────────────────────────

function StatusDot({ ok, degraded }: { ok: boolean; degraded?: boolean }) {
  if (!ok) return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />;
  if (degraded) return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 flex-shrink-0" />;
  return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />;
}

// ─── ServiceCard ──────────────────────────────────────────────────────────────

function ServiceCard({ icon: Icon, title, status, detail, accent, loading }: {
  icon: React.ElementType; title: string; status: string; detail: string;
  accent: string; loading: boolean;
}) {
  const ACCENTS: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    red:     "bg-red-500/10 text-red-600 dark:text-red-400",
    amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    blue:    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  };
  const isOk = status === "operational";
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ACCENTS[accent]}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {loading ? <Skeleton className="h-4 w-24" /> : (
              <><StatusDot ok={isOk} degraded={status === "degraded"} /><span className="text-sm font-semibold text-foreground">{title}</span></>
            )}
          </div>
          {loading ? <Skeleton className="h-3 w-32 mt-1" /> : <p className="text-xs text-muted-foreground">{detail}</p>}
          {!loading && (
            <span className={`inline-flex mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
              isOk ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : status === "degraded" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}>{status}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── MetricTile ───────────────────────────────────────────────────────────────

function MetricTile({ label, value, sub, progress, progressColor, loading }: {
  label: string; value: string | number; sub?: string;
  progress?: number; progressColor?: string; loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
      {loading ? <Skeleton className="h-6 w-20" /> : (
        <>
          <p className="text-xl font-bold text-foreground leading-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          {progress !== undefined && (
            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${progressColor ?? "bg-primary"}`} style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Live Queue Monitor bar (Part 10) ────────────────────────────────────────

function LiveQueueBar({ label, count, total, cls, loading }: {
  label: string; count: number; total: number; cls: string; loading: boolean;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden relative">
        {loading
          ? <div className="h-full w-1/3 bg-muted-foreground/20 rounded-full animate-pulse" />
          : <div className={`h-full rounded-full transition-all duration-700 ${cls}`} style={{ width: `${pct}%` }} />
        }
      </div>
      <span className="text-xs font-semibold text-foreground tabular-nums w-16 text-right">
        {loading ? <Skeleton className="h-3 w-10 inline-block" /> : count.toLocaleString()}
      </span>
    </div>
  );
}

// ─── Error detail modal ───────────────────────────────────────────────────────

function ErrorDetailModal({ raw, open, onClose }: { raw: string | null; open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!raw) return null;

  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { parsed = { friendly: raw }; }

  const displayMsg = parsed.response ?? parsed.friendly ?? raw;

  const copyAll = () => {
    navigator.clipboard.writeText([
      displayMsg && `Error: ${displayMsg}`,
      parsed.rawCode && `Code: ${parsed.rawCode}`,
      parsed.responseCode && `SMTP Code: ${parsed.responseCode}`,
      parsed.response && `Provider: ${parsed.response}`,
      parsed.command && `Command: ${parsed.command}`,
    ].filter(Boolean).join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <ShieldAlert className="h-4 w-4" /> SMTP Error Details
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Error Message</p>
            <p className="text-red-600 dark:text-red-400 break-words font-mono text-xs bg-red-50 dark:bg-red-900/10 rounded-lg p-3 border border-red-200 dark:border-red-800/40">
              {displayMsg}
            </p>
          </div>
          {parsed.response && parsed.response !== displayMsg && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Provider Response</p>
              <p className="font-mono text-xs bg-muted rounded-lg p-3 break-words">{parsed.response}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {parsed.rawCode && <div><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Code</p><p className="font-mono text-xs">{parsed.rawCode}</p></div>}
            {parsed.responseCode && <div><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">SMTP Code</p><p className="font-mono text-xs">{parsed.responseCode}</p></div>}
            {parsed.command && <div><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Command</p><p className="font-mono text-xs">{parsed.command}</p></div>}
          </div>
          {parsed.stack && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Stack Trace</p>
              <pre className="text-[10px] text-muted-foreground bg-muted rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">{parsed.stack}</pre>
            </div>
          )}
          <Button variant="outline" size="sm" className="w-full rounded-xl gap-2" onClick={copyAll}>
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy Error"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  open, onClose, onConfirm, label, description, busy,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  label: string; description: string; busy: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Confirm {label}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Queue Management Section (Part 1) ───────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  pending:   "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  success:   "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed:    "bg-red-500/10 text-red-600 dark:text-red-400",
  deferred:  "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  sending:   "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  cancelled: "bg-muted text-muted-foreground",
};

function QueueManagement({ onQueuesChanged }: { onQueuesChanged: () => void }) {
  const { toast } = useToast();

  const [items, setItems]     = useState<QueueItem[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);

  // Confirmation dialog for destructive actions
  const [pendingAction, setPendingAction] = useState<{
    action: string; label: string; description: string; body?: unknown;
  } | null>(null);

  // Filters
  const [statusFilter,   setStatusFilter]   = useState("all");
  const [userFilter,     setUserFilter]     = useState("");
  const [mailboxFilter,  setMailboxFilter]  = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [dateFrom,       setDateFrom]       = useState("");
  const [dateTo,         setDateTo]         = useState("");
  const [showFilters,    setShowFilters]    = useState(false);

  // Manual reload trigger
  const [refreshTick, setRefreshTick] = useState(0);
  const reload = useCallback(() => setRefreshTick(t => t + 1), []);

  const LIMIT = 50;
  const pageCount = Math.max(Math.ceil(total / LIMIT), 1);

  // Single effect: build params inline so there is no stale-closure race.
  // A version counter discards responses from superseded requests.
  const loadVersion = useRef(0);
  useEffect(() => {
    const v = ++loadVersion.current;
    setLoading(true);

    const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (statusFilter !== "all")    p.set("status",     statusFilter);
    if (userFilter.trim())         p.set("userId",     userFilter.trim());
    if (mailboxFilter.trim())      p.set("mailboxId",  mailboxFilter.trim());
    if (campaignFilter.trim())     p.set("campaignId", campaignFilter.trim());
    if (dateFrom)                  p.set("dateFrom",   dateFrom);
    if (dateTo)                    p.set("dateTo",     dateTo);

    fetch(`/api/admin/queue?${p.toString()}`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Error ${r.status}`)))
      .then(data => {
        if (v !== loadVersion.current) return; // discard stale response
        setItems(data.data);
        setTotal(data.total);
        setSelected(new Set());
      })
      .catch(() => {})
      .finally(() => { if (v === loadVersion.current) setLoading(false); });
  }, [page, statusFilter, userFilter, mailboxFilter, campaignFilter, dateFrom, dateTo, refreshTick]);

  // Reset to page 1 whenever a filter changes (not when page itself changes)
  const prevFiltersRef = useRef({ statusFilter, userFilter, mailboxFilter, campaignFilter, dateFrom, dateTo });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const changed =
      prev.statusFilter   !== statusFilter   ||
      prev.userFilter     !== userFilter     ||
      prev.mailboxFilter  !== mailboxFilter  ||
      prev.campaignFilter !== campaignFilter ||
      prev.dateFrom       !== dateFrom       ||
      prev.dateTo         !== dateTo;
    prevFiltersRef.current = { statusFilter, userFilter, mailboxFilter, campaignFilter, dateFrom, dateTo };
    if (changed && page !== 1) setPage(1);
  }, [statusFilter, userFilter, mailboxFilter, campaignFilter, dateFrom, dateTo, page]);

  // Execute a confirmed (or non-destructive) action
  const execAction = async (action: string, body?: unknown) => {
    setPendingAction(null);
    setActionBusy(action);
    try {
      let res: any;
      switch (action) {
        case "retry-selected":
          res = await apiPost("queue/retry-selected", { ids: [...selected] });
          toast({ title: `Retried ${res.retried} item(s)` });
          break;
        case "retry-deferred":
          res = await apiPost("queue/retry-deferred");
          toast({ title: `Retried ${res.retried} deferred item(s)` });
          break;
        case "retry-failed":
          res = await apiPost("queue/retry-failed");
          toast({ title: `Retried ${res.retried} failed item(s)` });
          break;
        case "clear-selected":
          res = await apiPost("queue/clear-selected", { ids: [...selected] });
          toast({ title: `Removed ${res.removed} queue item(s)` });
          break;
        case "clear":
          res = await apiPost("queue/clear", body);
          toast({ title: `Removed ${res.removed} queue item(s)` });
          break;
      }
      reload();
      onQueuesChanged();
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    } finally { setActionBusy(null); }
  };

  // Request confirmation before destructive actions
  const requestConfirm = (
    action: string, label: string, description: string, body?: unknown,
  ) => setPendingAction({ action, label, description, body });

  const toggleSelect = (id: number) => {
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(i => i.id)));
    }
  };

  const clearFilters = () => {
    setStatusFilter("all"); setUserFilter(""); setMailboxFilter("");
    setCampaignFilter(""); setDateFrom(""); setDateTo("");
  };
  const hasFilters = statusFilter !== "all" || userFilter || mailboxFilter || campaignFilter || dateFrom || dateTo;

  return (
    <div className="space-y-4">
      {/* Header + bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {/* Status filter pills */}
          {["all","pending","sending","deferred","failed","success","cancelled"].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors capitalize
                ${statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-xs"
            onClick={() => setShowFilters(v => !v)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {hasFilters && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
          </Button>
          <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-xs" onClick={reload} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="flex flex-wrap gap-2 p-3 rounded-xl border border-border bg-muted/30">
          <Input placeholder="User ID" value={userFilter}     onChange={e => setUserFilter(e.target.value)}     className="h-8 rounded-lg w-28 text-xs" />
          <Input placeholder="Mailbox ID" value={mailboxFilter}  onChange={e => setMailboxFilter(e.target.value)}  className="h-8 rounded-lg w-28 text-xs" />
          <Input placeholder="Campaign ID" value={campaignFilter} onChange={e => setCampaignFilter(e.target.value)} className="h-8 rounded-lg w-32 text-xs" />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 rounded-lg w-36 text-xs" />
          <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="h-8 rounded-lg w-36 text-xs" />
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 rounded-lg text-xs gap-1.5" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Selection-scoped actions — visible only when rows are checked */}
        {selected.size > 0 && (
          <>
            <Button
              variant="outline" size="sm"
              className="h-8 rounded-xl gap-1.5 text-xs text-amber-600 dark:text-amber-400"
              onClick={() => requestConfirm(
                "retry-selected",
                `Retry Selected (${selected.size})`,
                `Re-queue ${selected.size} selected item(s) for sending. Only failed and deferred items will actually be retried; others are skipped.`,
              )}
              disabled={!!actionBusy}
            >
              {actionBusy === "retry-selected" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Retry Selected ({selected.size})
            </Button>
            <Button
              variant="outline" size="sm"
              className="h-8 rounded-xl gap-1.5 text-xs text-red-600 dark:text-red-400"
              onClick={() => requestConfirm(
                "clear-selected",
                `Clear Selected (${selected.size})`,
                `Permanently delete ${selected.size} selected queue row(s). This only removes queue entries — campaign history, sent email records, and statistics are not affected.`,
              )}
              disabled={!!actionBusy}
            >
              {actionBusy === "clear-selected" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Clear Selected ({selected.size})
            </Button>
          </>
        )}

        {/* Global retry actions */}
        <Button
          variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-xs"
          onClick={() => requestConfirm(
            "retry-deferred",
            "Retry All Deferred",
            "Re-queue all deferred items across the entire queue for immediate re-attempt.",
          )}
          disabled={!!actionBusy}
        >
          {actionBusy === "retry-deferred" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Retry All Deferred
        </Button>
        <Button
          variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-xs"
          onClick={() => requestConfirm(
            "retry-failed",
            "Retry All Failed",
            "Re-queue all failed items across the entire queue. Only items with status 'failed' are affected.",
          )}
          disabled={!!actionBusy}
        >
          {actionBusy === "retry-failed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Retry All Failed
        </Button>

        <div className="flex-1" />

        {/* Clear queue dropdown — all options require confirmation */}
        <Select
          value=""
          onValueChange={v => {
            if (v === "clear-selected") {
              requestConfirm(
                "clear-selected",
                `Clear Selected (${selected.size})`,
                `Permanently delete ${selected.size} selected queue row(s). Campaign history, sent email records, and statistics are not affected.`,
              );
            } else if (v === "all") {
              requestConfirm(
                "clear",
                "Clear Entire Queue",
                "⚠️ This will permanently delete ALL items from the email queue regardless of status. Campaign history, sent email records, and statistics are not affected. This action cannot be undone.",
                { status: "all" },
              );
            } else {
              const label = { pending: "Clear Pending", deferred: "Clear Deferred", failed: "Clear Failed", success: "Clear Completed", cancelled: "Clear Cancelled" }[v] ?? `Clear ${v}`;
              requestConfirm(
                "clear",
                label,
                `Permanently delete all ${v} items from the queue. Campaign history, sent email records, and statistics are not affected.`,
                { status: v },
              );
            }
          }}
        >
          <SelectTrigger className="h-8 rounded-xl w-auto text-xs text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/40 hover:bg-red-50 dark:hover:bg-red-900/10">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            <span>Clear Queue…</span>
          </SelectTrigger>
          <SelectContent>
            {selected.size > 0 && (
              <SelectItem value="clear-selected" className="text-red-600 dark:text-red-400">
                Clear Selected ({selected.size})
              </SelectItem>
            )}
            <SelectItem value="pending">Clear Pending</SelectItem>
            <SelectItem value="deferred">Clear Deferred</SelectItem>
            <SelectItem value="failed">Clear Failed</SelectItem>
            <SelectItem value="success">Clear Completed</SelectItem>
            <SelectItem value="cancelled">Clear Cancelled</SelectItem>
            <SelectItem value="all" className="text-red-600 dark:text-red-400 font-semibold">
              Clear Entire Queue
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${total.toLocaleString()} item${total !== 1 ? "s" : ""}${selected.size > 0 ? ` · ${selected.size} selected` : ""}`}
        </p>
        {total > LIMIT && <p className="text-xs text-muted-foreground">Page {page} of {pageCount}</p>}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-left">
              <th className="px-3 py-2.5 w-8">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={selected.size === items.length && items.length > 0}
                  onChange={toggleAll}
                />
              </th>
              {["ID", "Recipient", "User", "Mailbox", "Campaign", "Status", "Attempts", "Deferred", "Retry After", "Created", "Last Error", ""].map(h => (
                <th key={h} className="px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? Array(5).fill(0).map((_, i) => (
              <tr key={i} className="border-b border-border">
                {Array(13).fill(0).map((__, j) => <td key={j} className="px-3 py-3"><Skeleton className="h-3 w-full" /></td>)}
              </tr>
            )) : items.length === 0 ? (
              <tr>
                <td colSpan={13} className="py-16 text-center text-muted-foreground">
                  <Inbox className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  No queue items found.
                </td>
              </tr>
            ) : items.map(item => (
              <tr key={item.id} className={`border-b border-border hover:bg-muted/30 transition-colors ${selected.has(item.id) ? "bg-primary/5" : ""}`}>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                  />
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted-foreground">#{item.id}</td>
                <td className="px-3 py-2.5 max-w-[140px]">
                  <p className="font-medium text-foreground truncate">{item.email}</p>
                  {item.subject && <p className="text-muted-foreground truncate">{item.subject}</p>}
                </td>
                <td className="px-3 py-2.5 max-w-[120px]">
                  <p className="text-foreground truncate">{item.userName ?? "—"}</p>
                  <p className="text-muted-foreground truncate">{item.userEmail ?? ""}</p>
                </td>
                <td className="px-3 py-2.5 max-w-[120px]">
                  <p className="text-foreground font-mono truncate">{item.mailboxEmail ?? `#${item.mailboxId}`}</p>
                </td>
                <td className="px-3 py-2.5 max-w-[120px]">
                  {item.campaignName
                    ? <p className="text-foreground truncate">{item.campaignName}</p>
                    : <span className="text-muted-foreground">—</span>}
                  {item.campaignId && <p className="text-muted-foreground">#{item.campaignId}</p>}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`px-1.5 py-0.5 rounded-full font-semibold capitalize ${STATUS_CLS[item.status] ?? "bg-muted text-muted-foreground"}`}>
                    {item.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-center text-foreground">{item.attempts}</td>
                <td className="px-3 py-2.5 tabular-nums text-center text-amber-600 dark:text-amber-400">{item.deferredCount || "—"}</td>
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                  {item.retryAfter && new Date(item.retryAfter) > new Date()
                    ? <span className="text-amber-600 dark:text-amber-400">{timeAgo(item.retryAfter)}</span>
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{timeAgo(item.createdAt)}</td>
                <td className="px-3 py-2.5 max-w-[160px]">
                  {item.lastError ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setErrorModal(item.lastError)}
                            className="text-red-600 dark:text-red-400 text-left hover:underline truncate block font-mono max-w-[160px]"
                          >
                            {smtpDisplayError(item.lastError).slice(0, 60)}{smtpDisplayError(item.lastError).length > 60 ? "…" : ""}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs break-words">
                          {smtpDisplayError(item.lastError)}
                          <p className="text-muted-foreground mt-1">Click to view full error</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  {(item.status === "failed" || item.status === "deferred") && (
                    <Button
                      variant="ghost" size="sm" className="h-6 px-2 rounded-lg text-[10px]"
                      onClick={() => {
                        // Select this row then confirm retry
                        setSelected(new Set([item.id]));
                        requestConfirm(
                          "retry-selected",
                          "Retry This Item",
                          `Re-queue item #${item.id} (${item.email}) for sending.`,
                        );
                      }}
                      title="Retry this item"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Page {page} of {pageCount}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount || loading} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      <ErrorDetailModal raw={errorModal} open={!!errorModal} onClose={() => setErrorModal(null)} />

      {/* Confirmation dialog for all destructive actions */}
      <ConfirmDialog
        open={!!pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={() => pendingAction && execAction(pendingAction.action, pendingAction.body)}
        label={pendingAction?.label ?? ""}
        description={pendingAction?.description ?? ""}
        busy={!!actionBusy}
      />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function AdminMonitoring() {
  const { toast } = useToast();
  const [health, setHealth]             = useState<PlatformHealth | null>(null);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [lastRefresh, setLastRefresh]   = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh]   = useState(true);
  const [actionBusy, setActionBusy]     = useState<string | null>(null);

  // Live queue data separate from full health (10s refresh, Part 10)
  const [liveQueue, setLiveQueue]       = useState<PlatformHealth["queue"] | null>(null);
  const [queueRefreshing, setQueueRefreshing] = useState(false);
  const queueTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Active section tab
  const [activeSection, setActiveSection] = useState<"monitoring" | "queue">("monitoring");

  const loadHealth = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await apiFetch("platform-health");
      setHealth(data);
      setLiveQueue(data.queue);
      setLastRefresh(new Date());
    } catch { /* silent */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    setQueueRefreshing(true);
    try {
      const data = await apiFetch("platform-health");
      setLiveQueue(data.queue);
    } catch { /* silent */ } finally {
      setQueueRefreshing(false);
    }
  }, []);

  // Health auto-refresh every 30s
  useEffect(() => {
    loadHealth();
    if (!autoRefresh) return;
    healthTimerRef.current = setInterval(() => loadHealth(true), 30_000);
    return () => { if (healthTimerRef.current) clearInterval(healthTimerRef.current); };
  }, [loadHealth, autoRefresh]);

  // Queue live refresh every 10s (Part 10)
  useEffect(() => {
    if (queueTimerRef.current) clearInterval(queueTimerRef.current);
    queueTimerRef.current = setInterval(refreshQueue, 10_000);
    return () => { if (queueTimerRef.current) clearInterval(queueTimerRef.current); };
  }, [refreshQueue]);

  // Refresh all after any queue action (Part 11)
  const handleQueuesChanged = useCallback(() => {
    loadHealth(true);
  }, [loadHealth]);

  const runBounceScanNow = useCallback(async () => {
    setActionBusy("bounce-scan");
    try {
      await apiPost("monitoring/run-bounce-scan");
      toast({ title: "Bounce scan started" });
      setTimeout(() => loadHealth(true), 2000);
    } catch (err) {
      toast({ title: "Failed to start bounce scan", description: (err as Error).message, variant: "destructive" });
    } finally { setActionBusy(null); }
  }, [loadHealth, toast]);

  const retryQueueItem = useCallback(async (id: number) => {
    setActionBusy(`retry-${id}`);
    try {
      await apiPost(`monitoring/queue/${id}/retry`);
      toast({ title: "Queue item requeued" });
      loadHealth(true);
    } catch (err) {
      toast({ title: "Retry failed", description: (err as Error).message, variant: "destructive" });
    } finally { setActionBusy(null); }
  }, [loadHealth, toast]);

  const retryAllFailed = useCallback(async () => {
    setActionBusy("retry-all");
    try {
      const res = await apiPost("monitoring/queue/retry-all");
      toast({ title: `Requeued ${res.retried} failed item(s)` });
      loadHealth(true);
    } catch (err) {
      toast({ title: "Bulk retry failed", description: (err as Error).message, variant: "destructive" });
    } finally { setActionBusy(null); }
  }, [loadHealth, toast]);

  const q = liveQueue;
  const hq = health?.queue;
  const qTotal  = q  ? (q.pending + q.sending + q.deferred + q.failed + q.success) : 0;
  const qActive = q  ? (q.pending + q.sending + q.deferred) : 0;
  const memPct    = health?.system.memPct ?? 0;
  const apiMemPct = health ? Math.round((health.api.memUsedMb / health.api.memTotalMb) * 100) : 0;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-foreground">Platform Monitoring</p>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground">
              Last checked {lastRefresh.toLocaleTimeString()} · queue updates every 10s
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Section tabs */}
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(["monitoring", "queue"] as const).map(s => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors
                  ${activeSection === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              >
                {s === "monitoring" ? "Monitoring" : "Queue Management"}
              </button>
            ))}
          </div>
          <Button
            variant={autoRefresh ? "secondary" : "outline"}
            size="sm" className="h-8 rounded-xl gap-1.5"
            onClick={() => setAutoRefresh(v => !v)}
          >
            {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            Auto {autoRefresh ? "On" : "Off"}
          </Button>
          <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5" onClick={() => loadHealth(true)} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Queue Management Tab ────────────────────────────────────────────── */}
      {activeSection === "queue" && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Queue Management</p>
          <Card className="p-4">
            <QueueManagement onQueuesChanged={handleQueuesChanged} />
          </Card>
        </div>
      )}

      {/* ── Monitoring Tab ──────────────────────────────────────────────────── */}
      {activeSection === "monitoring" && (
        <>
          {/* Service status */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Service Status</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <ServiceCard icon={Server} title="API Server" status={health?.api.status ?? "checking"} detail={health ? `Uptime ${fmtUptime(health.api.uptimeSeconds)} · PID ${health.api.pid}` : ""} accent="emerald" loading={loading} />
              <ServiceCard icon={Database} title="Database" status={health?.database.status ?? "checking"} detail={health ? `${health.database.latencyMs}ms response time` : ""} accent={health?.database.status === "operational" ? "emerald" : "red"} loading={loading} />
              <ServiceCard icon={Inbox} title="Email Queue" status={qActive > 0 ? "active" : "idle"} detail={health ? `${qActive} active · ${q?.deferred ?? 0} deferred · ${q?.failed ?? 0} failed` : ""} accent={qActive > 0 ? "blue" : "emerald"} loading={loading} />
              <ServiceCard icon={MailSearch} title="IMAP / Bounce Scan" status={health?.imap.status ?? "checking"} detail={health ? `Last scan ${timeAgo(health.imap.lastScanAt)}` : ""} accent={health?.imap.status === "operational" ? "emerald" : health?.imap.status === "checking" ? "blue" : "red"} loading={loading} />
            </div>
          </div>

          {/* System metrics */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">System Metrics</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <MetricTile label="System Memory" value={health ? fmtMem(health.system.usedMemMb) : "—"} sub={health ? `${health.system.memPct}% of ${fmtMem(health.system.totalMemMb)}` : ""} progress={memPct} progressColor={memPct >= 90 ? "bg-red-500" : memPct >= 70 ? "bg-amber-500" : "bg-primary"} loading={loading} />
              <MetricTile label="Heap Memory"   value={health ? fmtMem(health.api.memUsedMb) : "—"}    sub={health ? `${apiMemPct}% of ${fmtMem(health.api.memTotalMb)} heap` : ""}  progress={apiMemPct} progressColor={apiMemPct >= 90 ? "bg-red-500" : apiMemPct >= 70 ? "bg-amber-500" : "bg-primary"} loading={loading} />
              <MetricTile label="CPU Load (1m)" value={health ? health.system.cpuLoad1m : "—"} sub={health ? `5m: ${health.system.cpuLoad5m} · 15m: ${health.system.cpuLoad15m}` : ""} loading={loading} />
              <MetricTile label="API Uptime"    value={health ? fmtUptime(health.api.uptimeSeconds) : "—"} sub={health ? `Node ${health.api.nodeVersion}` : ""} loading={loading} />
              <MetricTile label="CPU Cores"     value={health?.system.cpuCount ?? "—"} sub={health ? health.system.platform : ""} loading={loading} />
              <MetricTile label="RSS Memory"    value={health ? fmtMem(health.api.rssMemMb) : "—"} sub="Process resident set" loading={loading} />
              <MetricTile label="Free Memory"   value={health ? fmtMem(health.system.freeMemMb) : "—"} sub="System available" loading={loading} />
              <MetricTile label="Process ID"    value={health?.api.pid ?? "—"} sub="Server PID" loading={loading} />
              <MetricTile
                label="Disk Usage"
                value={health?.disk && health.disk.totalGb >= 0.5 ? `${health.disk.usedGb} GB` : "N/A"}
                sub={health?.disk && health.disk.totalGb >= 0.5 ? `${health.disk.usedPct}% of ${health.disk.totalGb} GB` : "Not reported"}
                progress={health?.disk && health.disk.totalGb >= 0.5 ? health.disk.usedPct : undefined}
                progressColor={(health?.disk?.usedPct ?? 0) >= 90 ? "bg-red-500" : (health?.disk?.usedPct ?? 0) >= 70 ? "bg-amber-500" : "bg-primary"}
                loading={loading}
              />
            </div>
          </div>

          {/* Live Queue Monitor (Part 10) — 10s auto-refresh */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Live Queue Monitor</p>
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${queueRefreshing ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-pulse"}`} />
                <span className="text-[10px] text-muted-foreground">updates every 10s</span>
                <Button variant="ghost" size="sm" className="h-6 px-2 rounded-lg" onClick={refreshQueue} disabled={queueRefreshing}>
                  <RefreshCw className={`h-3 w-3 ${queueRefreshing ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
            <Card className="p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-foreground">Email Queue</p>
                <span className="text-xs text-muted-foreground">{qTotal.toLocaleString()} total items</span>
              </div>
              <div className="space-y-3">
                <LiveQueueBar label="Success"  count={q?.success  ?? 0} total={qTotal} cls="bg-emerald-500" loading={queueRefreshing && !q} />
                <LiveQueueBar label="Pending"  count={q?.pending  ?? 0} total={qTotal} cls="bg-blue-500"    loading={queueRefreshing && !q} />
                <LiveQueueBar label="Sending"  count={q?.sending  ?? 0} total={qTotal} cls="bg-indigo-500"  loading={queueRefreshing && !q} />
                <LiveQueueBar label="Deferred" count={q?.deferred ?? 0} total={qTotal} cls="bg-amber-500"   loading={queueRefreshing && !q} />
                <LiveQueueBar label="Failed"   count={q?.failed   ?? 0} total={qTotal} cls="bg-red-500"     loading={queueRefreshing && !q} />
              </div>
            </Card>
          </div>

          {/* Workers + Sessions + Errors */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Background Workers</p>
              {loading ? <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div> : (
                <div className="space-y-2.5">
                  {[
                    { label: "SMTP Processor",  active: health?.workers.smtpActive    ?? false },
                    { label: "Gmail Processor", active: health?.workers.gmailActive   ?? false },
                    { label: "Bounce Scanner",  active: health?.workers.bounceScanner ?? false },
                  ].map(({ label, active }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-foreground">{label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"}`} />
                        <span className={`text-xs font-medium ${active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{active ? "Active" : "Idle"}</span>
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground/60 pt-1">Worker state inferred from active sends</p>
                </div>
              )}
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Active Sessions</p>
              {loading ? <div className="space-y-2">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> : (
                <div className="space-y-2">
                  {[{ label: "Last 1 hour",    value: health?.sessions.active1h  ?? 0 },
                    { label: "Last 24 hours",   value: health?.sessions.active24h ?? 0 }].map(({ label, value }) => (
                    <div key={label} className="rounded-lg border border-border p-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-base font-bold text-foreground">{value}</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground/60 pt-1">Based on last-active timestamp</p>
                </div>
              )}
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Error Rate</p>
              {loading ? <div className="space-y-2">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> : (
                <div className="space-y-2">
                  {[{ label: "Last 1 hour",   value: health?.errors.last1h  ?? 0, cls: (health?.errors.last1h  ?? 0) > 10 ? "text-red-600 dark:text-red-400" : "text-foreground" },
                    { label: "Last 24 hours",  value: health?.errors.last24h ?? 0, cls: (health?.errors.last24h ?? 0) > 50 ? "text-red-600 dark:text-red-400" : "text-foreground" }].map(({ label, value, cls }) => (
                    <div key={label} className="rounded-lg border border-border p-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className={`text-base font-bold ${cls}`}>{value}</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground/60 pt-1">System log entries with severity=error</p>
                </div>
              )}
            </Card>
          </div>

          {/* Restart Actions */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Restart Actions</p>
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5" onClick={runBounceScanNow} disabled={actionBusy === "bounce-scan"}>
                  {actionBusy === "bounce-scan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailSearch className="h-3.5 w-3.5" />}
                  Run Bounce Scan Now
                </Button>
                <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5" onClick={retryAllFailed} disabled={actionBusy === "retry-all" || (hq?.failed ?? 0) === 0}>
                  {actionBusy === "retry-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Retry All Failed ({hq?.failed ?? 0})
                </Button>
                <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-amber-600 dark:text-amber-400" onClick={async () => {
                  setActionBusy("retry-deferred");
                  try {
                    const res = await apiPost("queue/retry-deferred");
                    toast({ title: `Retried ${res.retried} deferred item(s)` });
                    loadHealth(true);
                  } catch (err) {
                    toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
                  } finally { setActionBusy(null); }
                }} disabled={actionBusy === "retry-deferred" || (hq?.deferred ?? 0) === 0}>
                  {actionBusy === "retry-deferred" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Retry All Deferred ({hq?.deferred ?? 0})
                </Button>
                <Button
                  variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 text-blue-600 dark:text-blue-400"
                  onClick={() => setActiveSection("queue")}
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  Open Queue Manager
                </Button>
                <p className="text-xs text-muted-foreground">Manual controls for recovering stuck or failed background work.</p>
              </div>
            </Card>
          </div>

          {/* Cron Jobs */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Background Jobs (Cron)</p>
            <Card className="p-4 overflow-x-auto">
              {loading ? <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div> : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="pb-2 font-medium">Job</th>
                      <th className="pb-2 font-medium">Interval</th>
                      <th className="pb-2 font-medium">Last Run</th>
                      <th className="pb-2 font-medium">Last Success</th>
                      <th className="pb-2 font-medium">Runs</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(health?.cronJobs ?? []).map(job => (
                      <tr key={job.name} className="border-b border-border/50 last:border-0">
                        <td className="py-2 text-foreground font-medium">{job.name}</td>
                        <td className="py-2 text-muted-foreground">{job.intervalSec}s</td>
                        <td className="py-2 text-muted-foreground">{timeAgo(job.lastRunAt)}</td>
                        <td className="py-2 text-muted-foreground">{timeAgo(job.lastSuccessAt)}</td>
                        <td className="py-2 text-muted-foreground tabular-nums">{job.runCount}</td>
                        <td className="py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                            job.lastError ? "bg-red-500/10 text-red-600 dark:text-red-400"
                            : job.lastRunAt ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          }`}>
                            {job.lastError ? "error" : job.lastRunAt ? "ok" : "pending"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {(health?.cronJobs ?? []).length === 0 && !loading && (
                      <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No cron jobs registered</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          {/* Running Jobs + Failed Jobs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Running Campaigns</p>
              {loading ? <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div> :
              (health?.runningJobs.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No campaigns currently sending</p>
              ) : (
                <div className="space-y-2">
                  {health!.runningJobs.map(job => (
                    <div key={job.id} className="rounded-lg border border-border p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-foreground truncate">{job.name}</span>
                        <span className="text-[10px] text-muted-foreground uppercase">{job.status}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-1">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${job.progress}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground">{job.sentCount}/{job.totalLeads} sent · updated {timeAgo(job.updatedAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recent Failed Jobs</p>
              {loading ? <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div> :
              (health?.failedJobs.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No failed queue items</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {health!.failedJobs.map(job => (
                    <div key={job.id} className="rounded-lg border border-border p-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{job.email}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">
                          {smtpDisplayError(job.lastError) || "Unknown error"} · {job.attempts} attempt(s)
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] flex-shrink-0" onClick={() => retryQueueItem(job.id)} disabled={actionBusy === `retry-${job.id}`}>
                        {actionBusy === `retry-${job.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Recent Errors */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recent Errors</p>
            <Card className="p-4">
              {loading ? <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div> :
              (health?.recentErrors.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No error log entries</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {health!.recentErrors.map(e => (
                    <div key={e.id} className="rounded-lg border border-border p-2.5">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium text-foreground">{e.type}</span>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(e.createdAt)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{e.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
