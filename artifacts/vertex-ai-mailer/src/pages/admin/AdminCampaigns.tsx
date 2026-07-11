import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Search, RefreshCw, ChevronLeft, ChevronRight,
  Zap, Clock, CheckCircle2, XCircle, Send, Mail,
  MoreHorizontal, Pause, Play, Ban, Eye, List,
  FileDown, Server, AlertTriangle, Megaphone,
  TrendingUp, Inbox, Timer, Loader2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminCampaign {
  id: number;
  name: string;
  status: string;
  sendMode: string;
  totalLeads: number;
  sentCount: number;
  draftedCount: number;
  failedCount: number;
  pauseReason: string | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  mailboxHost: string | null;
  mailboxId: number | null;
  mailboxQuotaStatus: string | null;
  recentErrorsCount: number;
  openCount: number;
}

interface MonitorStats {
  activeCampaigns: number;
  sendingNow: number;
  coolingDown: number;
  completedToday: number;
  failedToday: number;
  queuedEmails: number;
}

interface QueueItem {
  id: number;
  email: string;
  status: string;
  attempts: number;
  deferredCount: number;
  lastError: string | null;
  sentAt: string | null;
  retryAfter: string | null;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/admin/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `Error ${res.status}`);
  }
  return res.json();
}

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function bounceRate(c: AdminCampaign): string {
  const total = c.sentCount + c.draftedCount + c.failedCount;
  if (total === 0) return "—";
  return `${Math.round((c.failedCount / total) * 100)}%`;
}

function remaining(c: AdminCampaign): number {
  return Math.max(0, c.totalLeads - c.sentCount - c.draftedCount - c.failedCount);
}

function currentAction(c: AdminCampaign): string {
  const isCooling = c.cooldownUntil && new Date(c.cooldownUntil) > new Date();
  if (c.status === "sending" && isCooling) return "Cooling down";
  if (c.status === "cooling_down")         return "Cooling down";
  if (c.status === "sending")              return `Sending ${c.sentCount + c.draftedCount + 1} of ${c.totalLeads}`;
  if (c.status === "paused")               return c.pauseReason === "SMTP_QUOTA_REACHED" ? "Paused — quota" : "Paused";
  if (c.status === "pending")              return "Waiting to start";
  if (c.status === "completed")            return "Completed";
  if (c.status === "cancelled")            return "Cancelled";
  if (c.status === "failed")               return "Failed";
  return c.status;
}

function getStatusInfo(c: Pick<AdminCampaign, "status" | "pauseReason" | "cooldownUntil">) {
  const isCooling = c.status === "cooling_down" ||
    (c.status === "sending" && !!c.cooldownUntil && new Date(c.cooldownUntil) > new Date());
  if (isCooling) return { label: "Cooling Down", cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400" };
  if (c.status === "paused" && c.pauseReason === "SMTP_QUOTA_REACHED")
    return { label: "Paused (Quota)", cls: "bg-red-500/10 text-red-600 dark:text-red-400" };
  const map: Record<string, { label: string; cls: string }> = {
    pending:      { label: "Pending",      cls: "bg-muted text-muted-foreground" },
    sending:      { label: "Live",         cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    testing_smtp: { label: "Testing SMTP", cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
    paused:       { label: "Paused",       cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
    completed:    { label: "Completed",    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    cancelled:    { label: "Cancelled",    cls: "bg-muted text-muted-foreground" },
    failed:       { label: "Failed",       cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
  };
  return map[c.status] ?? { label: c.status, cls: "bg-muted text-muted-foreground" };
}

function StatusBadge({ c }: { c: Pick<AdminCampaign, "status" | "pauseReason" | "cooldownUntil"> }) {
  const { label, cls } = getStatusInfo(c);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cls}`}>
      {c.status === "sending" && !(c.cooldownUntil && new Date(c.cooldownUntil) > new Date()) && (
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
      {label}
    </span>
  );
}

function ProgressBar({ c }: { c: AdminCampaign }) {
  const done = c.sentCount + c.draftedCount + c.failedCount;
  const pct  = c.totalLeads > 0 ? Math.min((done / c.totalLeads) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${c.failedCount > 0 ? "bg-amber-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{Math.round(pct)}%</span>
    </div>
  );
}

// ─── Overview card ────────────────────────────────────────────────────────────

const CARD_ACCENTS: Record<string, string> = {
  blue:    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  indigo:  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  orange:  "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  red:     "bg-red-500/10 text-red-600 dark:text-red-400",
  teal:    "bg-teal-500/10 text-teal-600 dark:text-teal-400",
};

function MonitorCard({
  icon: Icon, label, value, accent, loading,
}: {
  icon: React.ElementType; label: string; value: number | string; accent: string; loading: boolean;
}) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${CARD_ACCENTS[accent]}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
        {loading
          ? <Skeleton className="h-5 w-12 mt-1" />
          : <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
        }
      </div>
    </Card>
  );
}

// ─── Queue drawer ─────────────────────────────────────────────────────────────

function QueueDrawer({ campaignId, campaignName, open, onClose }: {
  campaignId: number; campaignName: string; open: boolean; onClose: () => void;
}) {
  const [items, setItems]   = useState<QueueItem[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const data = await apiFetch(`campaigns/${campaignId}/queue?page=${page}&limit=30`);
      setItems(data.data);
      setTotal(data.total);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [campaignId, open, page]);

  useEffect(() => { load(); }, [load]);

  const pageCount = Math.max(Math.ceil(total / 30), 1);

  const STATUS_CLS: Record<string, string> = {
    pending:  "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    sending:  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    success:  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    failed:   "bg-red-500/10 text-red-600 dark:text-red-400",
    deferred: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <List className="h-4 w-4 text-muted-foreground" />
            Email Queue
          </SheetTitle>
          <p className="text-xs text-muted-foreground truncate">{campaignName} · {total} items</p>
        </SheetHeader>

        <div className="space-y-2">
          {loading ? Array(5).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          )) : items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No queue items found.
            </div>
          ) : items.map(item => (
            <div key={item.id} className="rounded-xl border border-border p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground truncate">{item.email}</p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize flex-shrink-0 ${STATUS_CLS[item.status] ?? "bg-muted text-muted-foreground"}`}>
                  {item.status}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>Attempts: <span className="text-foreground font-medium">{item.attempts}</span></span>
                {item.deferredCount > 0 && <span>Deferred: <span className="text-amber-600 dark:text-amber-400 font-medium">{item.deferredCount}×</span></span>}
                {item.sentAt && <span>Sent: {timeAgo(item.sentAt)}</span>}
                {item.retryAfter && new Date(item.retryAfter) > new Date() && (
                  <span className="text-amber-600 dark:text-amber-400">Retry after: {timeAgo(item.retryAfter)}</span>
                )}
              </div>
              {item.lastError && (
                <p className="text-xs text-red-600 dark:text-red-400 truncate">{
                  (() => {
                    try { return JSON.parse(item.lastError).friendly ?? item.lastError; }
                    catch { return item.lastError; }
                  })()
                }</p>
              )}
            </div>
          ))}
        </div>

        {total > 30 && (
          <div className="flex items-center justify-between pt-4">
            <span className="text-xs text-muted-foreground">{page} / {pageCount}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Status tab bar ───────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: "all",       label: "All" },
  { value: "sending",   label: "Live" },
  { value: "paused",    label: "Paused" },
  { value: "cooling_down", label: "Cooling Down" },
  { value: "pending",   label: "Queued" },
  { value: "completed", label: "Completed" },
  { value: "failed",    label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(campaigns: AdminCampaign[]) {
  const headers = [
    "ID","Name","User","Email","Status","Mode","Total","Sent","Remaining","Failed","Opens","Bounce Rate","Mailbox","Created","Last Activity",
  ];
  const rows = campaigns.map(c => [
    c.id, c.name,
    c.userName ?? "", c.userEmail ?? "",
    getStatusInfo(c).label, c.sendMode,
    c.totalLeads, c.sentCount + c.draftedCount, remaining(c), c.failedCount,
    c.openCount, bounceRate(c),
    c.mailboxHost ?? "",
    fmtDate(c.createdAt), fmtDate(c.updatedAt),
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: "campaigns.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminCampaigns({ onNavigateTab }: { onNavigateTab?: (tab: string) => void }) {
  // Stats
  const [stats, setStats]       = useState<MonitorStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Campaign list
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Filters
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");

  // Actions
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Queue drawer
  const [queueCampaign, setQueueCampaign] = useState<{ id: number; name: string } | null>(null);

  const pageCount = Math.max(Math.ceil(total / 25), 1);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    try {
      const overview = await apiFetch("dashboard-overview");
      setStats(overview.campaignMonitor ?? null);
    } catch { /* silent */ }
    finally { setStatsLoading(false); }
  }, []);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: "25",
        ...(search       && { search }),
        ...(statusFilter !== "all" && { status: statusFilter }),
        ...(dateFrom     && { dateFrom }),
        ...(dateTo       && { dateTo }),
      });
      const data = await apiFetch(`campaigns?${params}`);
      setCampaigns(data.data);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, dateFrom, dateTo]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  // Auto-refresh every 30s when live campaigns are present
  useEffect(() => {
    const hasLive = campaigns.some(c => c.status === "sending" || c.status === "cooling_down");
    if (hasLive) {
      refreshTimerRef.current = setInterval(() => {
        loadStats();
        loadCampaigns();
      }, 30_000);
    }
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [campaigns, loadStats, loadCampaigns]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function doAction(id: number, action: "pause" | "resume" | "cancel") {
    setActionLoading(id);
    try {
      await apiFetch(`campaigns/${id}/${action}`, { method: "POST" });
      await Promise.all([loadCampaigns(), loadStats()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to ${action} campaign`);
    } finally {
      setActionLoading(null);
    }
  }

  function canPause(c: AdminCampaign)  { return ["sending", "pending", "cooling_down"].includes(c.status); }
  function canResume(c: AdminCampaign) { return c.status === "paused"; }
  function canCancel(c: AdminCampaign) { return !["completed", "cancelled"].includes(c.status); }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Campaign Monitor</p>
          <p className="text-xs text-muted-foreground">Live view across all user campaigns</p>
        </div>
        <Button
          size="sm" variant="outline"
          onClick={() => { loadStats(); loadCampaigns(); }}
          className="h-8 gap-1.5 rounded-xl"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading || statsLoading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* ── Overview cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MonitorCard icon={Zap}         label="Active Campaigns" value={stats?.activeCampaigns ?? 0} accent="indigo"  loading={statsLoading} />
        <MonitorCard icon={Inbox}       label="Queued Emails"    value={stats?.queuedEmails    ?? 0} accent="blue"   loading={statsLoading} />
        <MonitorCard icon={Send}        label="Sending Now"      value={stats?.sendingNow       ?? 0} accent="teal"   loading={statsLoading} />
        <MonitorCard icon={Timer}       label="Cooling Down"     value={stats?.coolingDown      ?? 0} accent="orange" loading={statsLoading} />
        <MonitorCard icon={CheckCircle2} label="Completed Today" value={stats?.completedToday   ?? 0} accent="emerald" loading={statsLoading} />
        <MonitorCard icon={XCircle}     label="Failed Today"     value={stats?.failedToday      ?? 0} accent="red"    loading={statsLoading} />
      </div>

      {/* ── Status tab bar ──────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
        {STATUS_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => { setStatusFilter(t.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              statusFilter === t.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search campaign, user, email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 h-9 rounded-xl text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="hidden sm:inline">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="h-9 px-2 rounded-xl border border-input bg-background text-foreground text-sm appearance-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="hidden sm:inline">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="h-9 px-2 rounded-xl border border-input bg-background text-foreground text-sm appearance-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {(search || dateFrom || dateTo) && (
          <Button
            variant="ghost" size="sm"
            className="h-9 text-xs text-muted-foreground rounded-xl"
            onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setPage(1); }}
          >
            Clear
          </Button>
        )}
        <Button
          variant="outline" size="sm"
          className="h-9 px-3 rounded-xl gap-1.5 text-xs ml-auto"
          onClick={() => exportCSV(campaigns)}
          disabled={campaigns.length === 0}
        >
          <FileDown className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      {/* ── Error state ─────────────────────────────────────────────────── */}
      {error && (
        <Card className="p-8 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium text-foreground">Couldn't load campaigns</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={loadCampaigns} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </Card>
      )}

      {/* ── Desktop table ───────────────────────────────────────────────── */}
      {!error && (
        <div className="hidden lg:block overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left border-b border-border">
                {[
                  "Campaign", "User", "Mailbox", "Status", "Progress",
                  "Sent", "Remaining", "Failed", "Opens", "Bounce",
                  "Mode", "Current Action", "Created", "Last Activity", "",
                ].map(h => (
                  <th key={h} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(6).fill(0).map((_, i) => (
                  <tr key={i} className="border-b border-border/60">
                    {Array(15).fill(0).map((_, j) => (
                      <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-14" /></td>
                    ))}
                  </tr>
                ))
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-14 text-center text-muted-foreground text-sm">
                    <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    No campaigns found.
                  </td>
                </tr>
              ) : campaigns.map(c => (
                <tr key={c.id} className="border-b border-border/60 hover:bg-muted/40 transition-colors group">

                  {/* Campaign name */}
                  <td className="px-3 py-3 max-w-[180px]">
                    <p className="font-medium text-foreground text-sm truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">#{c.id}</p>
                  </td>

                  {/* User */}
                  <td className="px-3 py-3 max-w-[150px]">
                    <p className="text-xs font-medium text-foreground truncate">{c.userName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.userEmail ?? ""}</p>
                  </td>

                  {/* Mailbox */}
                  <td className="px-3 py-3 max-w-[130px]">
                    {c.mailboxHost ? (
                      <div className="flex items-center gap-1.5">
                        <Server className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-xs text-muted-foreground truncate">{c.mailboxHost}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Gmail</span>
                    )}
                    {c.mailboxQuotaStatus === "quota_reached" && (
                      <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">Quota reached</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-3 py-3"><StatusBadge c={c} /></td>

                  {/* Progress */}
                  <td className="px-3 py-3 min-w-[120px]"><ProgressBar c={c} /></td>

                  {/* Sent */}
                  <td className="px-3 py-3">
                    <span className="text-xs font-semibold text-foreground tabular-nums">{(c.sentCount + c.draftedCount).toLocaleString()}</span>
                  </td>

                  {/* Remaining */}
                  <td className="px-3 py-3">
                    <span className="text-xs text-muted-foreground tabular-nums">{remaining(c).toLocaleString()}</span>
                  </td>

                  {/* Failed */}
                  <td className="px-3 py-3">
                    {c.failedCount > 0
                      ? <span className="text-xs font-semibold text-red-600 dark:text-red-400 tabular-nums">{c.failedCount.toLocaleString()}</span>
                      : <span className="text-xs text-muted-foreground">0</span>
                    }
                  </td>

                  {/* Opens */}
                  <td className="px-3 py-3">
                    {c.openCount > 0
                      ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          <TrendingUp className="h-3 w-3" />
                          {c.openCount.toLocaleString()}
                        </span>
                      )
                      : <span className="text-xs text-muted-foreground">0</span>
                    }
                  </td>

                  {/* Bounce rate */}
                  <td className="px-3 py-3">
                    <span className={`text-xs tabular-nums ${c.failedCount > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                      {bounceRate(c)}
                    </span>
                  </td>

                  {/* Mode badge */}
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase ${
                      c.sendMode === "gmail"
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    }`}>
                      {c.sendMode === "gmail" ? <Mail className="h-2.5 w-2.5" /> : <Server className="h-2.5 w-2.5" />}
                      {c.sendMode}
                    </span>
                  </td>

                  {/* Current action */}
                  <td className="px-3 py-3 max-w-[140px]">
                    <span className="text-xs text-muted-foreground truncate block">{currentAction(c)}</span>
                  </td>

                  {/* Created */}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>
                  </td>

                  {/* Last activity */}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="text-xs text-muted-foreground">{timeAgo(c.updatedAt)}</span>
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg opacity-60 group-hover:opacity-100">
                          {actionLoading === c.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <MoreHorizontal className="h-3.5 w-3.5" />
                          }
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem
                          className="gap-2 text-xs"
                          onClick={() => window.open(`/campaigns/${c.id}`, "_blank")}
                        >
                          <Eye className="h-3.5 w-3.5" /> Open Campaign
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                          className="gap-2 text-xs"
                          disabled={!canPause(c) || actionLoading === c.id}
                          onClick={() => doAction(c.id, "pause")}
                        >
                          <Pause className="h-3.5 w-3.5" /> Pause
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="gap-2 text-xs"
                          disabled={!canResume(c) || actionLoading === c.id}
                          onClick={() => doAction(c.id, "resume")}
                        >
                          <Play className="h-3.5 w-3.5" /> Resume
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="gap-2 text-xs text-destructive focus:text-destructive"
                          disabled={!canCancel(c) || actionLoading === c.id}
                          onClick={() => {
                            if (confirm(`Cancel campaign "${c.name}"? This cannot be undone.`)) {
                              doAction(c.id, "cancel");
                            }
                          }}
                        >
                          <Ban className="h-3.5 w-3.5" /> Cancel
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                          className="gap-2 text-xs"
                          onClick={() => setQueueCampaign({ id: c.id, name: c.name })}
                        >
                          <List className="h-3.5 w-3.5" /> View Queue
                        </DropdownMenuItem>

                        {onNavigateTab && (
                          <DropdownMenuItem
                            className="gap-2 text-xs"
                            onClick={() => onNavigateTab("logs")}
                          >
                            <Eye className="h-3.5 w-3.5" /> View Logs
                          </DropdownMenuItem>
                        )}

                        <DropdownMenuSeparator />

                        <DropdownMenuItem className="gap-2 text-xs opacity-40 cursor-not-allowed" disabled>
                          <RefreshCw className="h-3.5 w-3.5" />
                          Retry Failed
                          <Badge variant="outline" className="ml-auto text-[9px] px-1 py-0">Soon</Badge>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="gap-2 text-xs"
                          onClick={() => exportCSV([c])}
                        >
                          <FileDown className="h-3.5 w-3.5" /> Export
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Mobile / tablet cards ────────────────────────────────────────── */}
      {!error && (
        <div className="lg:hidden space-y-3">
          {loading ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)
          ) : campaigns.length === 0 ? (
            <div className="py-14 text-center text-muted-foreground text-sm">
              <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No campaigns found.
            </div>
          ) : campaigns.map(c => (
            <Card key={c.id} className="p-4 space-y-3">
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground text-sm truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.userName} · {c.userEmail}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <StatusBadge c={c} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg">
                        {actionLoading === c.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <MoreHorizontal className="h-3.5 w-3.5" />
                        }
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem className="gap-2 text-xs" onClick={() => window.open(`/campaigns/${c.id}`, "_blank")}>
                        <Eye className="h-3.5 w-3.5" /> Open Campaign
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="gap-2 text-xs" disabled={!canPause(c) || actionLoading === c.id} onClick={() => doAction(c.id, "pause")}>
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2 text-xs" disabled={!canResume(c) || actionLoading === c.id} onClick={() => doAction(c.id, "resume")}>
                        <Play className="h-3.5 w-3.5" /> Resume
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2 text-xs text-destructive focus:text-destructive" disabled={!canCancel(c) || actionLoading === c.id}
                        onClick={() => { if (confirm(`Cancel "${c.name}"?`)) doAction(c.id, "cancel"); }}>
                        <Ban className="h-3.5 w-3.5" /> Cancel
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="gap-2 text-xs" onClick={() => setQueueCampaign({ id: c.id, name: c.name })}>
                        <List className="h-3.5 w-3.5" /> View Queue
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="gap-2 text-xs opacity-40 cursor-not-allowed" disabled>
                        <RefreshCw className="h-3.5 w-3.5" /> Retry Failed
                        <Badge variant="outline" className="ml-auto text-[9px] px-1 py-0">Soon</Badge>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2 text-xs" onClick={() => exportCSV([c])}>
                        <FileDown className="h-3.5 w-3.5" /> Export
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Progress */}
              <ProgressBar c={c} />

              {/* Stats row */}
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: "Sent",      value: (c.sentCount + c.draftedCount).toLocaleString(), cls: "text-foreground" },
                  { label: "Remaining", value: remaining(c).toLocaleString(),                   cls: "text-muted-foreground" },
                  { label: "Failed",    value: c.failedCount.toLocaleString(),                  cls: c.failedCount > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground" },
                  { label: "Opens",     value: c.openCount.toLocaleString(),                    cls: c.openCount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground" },
                ].map(s => (
                  <div key={s.label} className="rounded-lg bg-muted/50 px-2 py-1.5">
                    <p className={`text-sm font-bold ${s.cls}`}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Footer row */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1 capitalize">
                  {c.sendMode === "gmail" ? <Mail className="h-3 w-3" /> : <Server className="h-3 w-3" />}
                  {c.sendMode}{c.mailboxHost ? ` · ${c.mailboxHost}` : ""}
                </span>
                <span>{timeAgo(c.updatedAt)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <p className="text-xs text-muted-foreground">
          {total.toLocaleString()} campaign{total !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg"
            disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[60px] text-center">{page} / {pageCount}</span>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg"
            disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Queue drawer ─────────────────────────────────────────────────── */}
      {queueCampaign && (
        <QueueDrawer
          campaignId={queueCampaign.id}
          campaignName={queueCampaign.name}
          open={!!queueCampaign}
          onClose={() => setQueueCampaign(null)}
        />
      )}
    </div>
  );
}
