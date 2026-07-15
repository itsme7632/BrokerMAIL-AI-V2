/**
 * AdminMonitoring.tsx — Phase 9: Platform Monitoring
 * True operations dashboard: API, DB, Queue, Workers, Memory, CPU, Sessions, Error Rate
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  Server, Database, Inbox, Cpu, MemoryStick, Activity, Clock,
  Users, Zap, ShieldAlert, Play, Pause, BarChart3, HardDrive,
  MailSearch, TimerReset, RotateCcw, ListChecks,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function apiFetch(path: string) {
  const res = await fetch(`/api/admin/${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

async function apiPost(path: string) {
  const res = await fetch(`/api/admin/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
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
              <>
                <StatusDot ok={isOk} degraded={status === "degraded"} />
                <span className="text-sm font-semibold text-foreground">{title}</span>
              </>
            )}
          </div>
          {loading ? <Skeleton className="h-3 w-32 mt-1" /> : (
            <p className="text-xs text-muted-foreground">{detail}</p>
          )}
          {!loading && (
            <span className={`inline-flex mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
              isOk ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : status === "degraded" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}>
              {status}
            </span>
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
              <div
                className={`h-full rounded-full ${progressColor ?? "bg-primary"}`}
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Queue row ────────────────────────────────────────────────────────────────

function QueueRow({ label, count, total, cls }: {
  label: string; count: number; total: number; cls: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-foreground tabular-nums w-12 text-right">{count.toLocaleString()}</span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function AdminMonitoring() {
  const { toast } = useToast();
  const [health, setHealth]       = useState<PlatformHealth | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [actionBusy, setActionBusy]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await apiFetch("platform-health");
      setHealth(data);
      setLastRefresh(new Date());
    } catch { /* silent */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    timerRef.current = setInterval(() => load(true), 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load, autoRefresh]);

  const runBounceScanNow = useCallback(async () => {
    setActionBusy("bounce-scan");
    try {
      await apiPost("monitoring/run-bounce-scan");
      toast({ title: "Bounce scan started" });
      setTimeout(() => load(true), 2000);
    } catch (err) {
      toast({ title: "Failed to start bounce scan", description: (err as Error).message, variant: "destructive" });
    } finally {
      setActionBusy(null);
    }
  }, [load, toast]);

  const retryQueueItem = useCallback(async (id: number) => {
    setActionBusy(`retry-${id}`);
    try {
      await apiPost(`monitoring/queue/${id}/retry`);
      toast({ title: "Queue item requeued" });
      load(true);
    } catch (err) {
      toast({ title: "Retry failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setActionBusy(null);
    }
  }, [load, toast]);

  const retryAllFailed = useCallback(async () => {
    setActionBusy("retry-all");
    try {
      const res = await apiPost("monitoring/queue/retry-all");
      toast({ title: `Requeued ${res.retried} failed item(s)` });
      load(true);
    } catch (err) {
      toast({ title: "Bulk retry failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setActionBusy(null);
    }
  }, [load, toast]);

  const q = health?.queue;
  const qTotal = q ? (q.pending + q.sending + q.deferred + q.failed + q.success) : 0;
  const qActive = q ? (q.pending + q.sending + q.deferred) : 0;

  const memPct    = health?.system.memPct ?? 0;
  const apiMemPct = health ? Math.round((health.api.memUsedMb / health.api.memTotalMb) * 100) : 0;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Platform Monitoring</p>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground">
              Last checked {lastRefresh.toLocaleTimeString()} · auto-refreshes every 30s
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "secondary" : "outline"}
            size="sm"
            className="h-8 rounded-xl gap-1.5"
            onClick={() => setAutoRefresh(v => !v)}
          >
            {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            Auto-refresh {autoRefresh ? "On" : "Off"}
          </Button>
          <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Service status cards */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Service Status</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ServiceCard
            icon={Server} title="API Server"
            status={health?.api.status ?? "checking"}
            detail={health ? `Uptime ${fmtUptime(health.api.uptimeSeconds)} · PID ${health.api.pid}` : ""}
            accent="emerald" loading={loading}
          />
          <ServiceCard
            icon={Database} title="Database"
            status={health?.database.status ?? "checking"}
            detail={health ? `${health.database.latencyMs}ms response time` : ""}
            accent={health?.database.status === "operational" ? "emerald" : "red"} loading={loading}
          />
          <ServiceCard
            icon={Inbox} title="Email Queue"
            status={qActive > 0 ? "active" : "idle"}
            detail={health ? `${qActive} active · ${q?.deferred ?? 0} deferred · ${q?.failed ?? 0} failed` : ""}
            accent={qActive > 0 ? "blue" : "emerald"} loading={loading}
          />
          <ServiceCard
            icon={MailSearch} title="IMAP / Bounce Scan"
            status={health?.imap.status ?? "checking"}
            detail={health ? `Last scan ${timeAgo(health.imap.lastScanAt)}` : ""}
            accent={health?.imap.status === "operational" ? "emerald" : health?.imap.status === "checking" ? "blue" : "red"}
            loading={loading}
          />
        </div>
      </div>

      {/* System metrics */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">System Metrics</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <MetricTile
            label="System Memory"
            value={health ? fmtMem(health.system.usedMemMb) : "—"}
            sub={health ? `${health.system.memPct}% of ${fmtMem(health.system.totalMemMb)}` : ""}
            progress={memPct}
            progressColor={memPct >= 90 ? "bg-red-500" : memPct >= 70 ? "bg-amber-500" : "bg-primary"}
            loading={loading}
          />
          <MetricTile
            label="Heap Memory"
            value={health ? fmtMem(health.api.memUsedMb) : "—"}
            sub={health ? `${apiMemPct}% of ${fmtMem(health.api.memTotalMb)} heap` : ""}
            progress={apiMemPct}
            progressColor={apiMemPct >= 90 ? "bg-red-500" : apiMemPct >= 70 ? "bg-amber-500" : "bg-primary"}
            loading={loading}
          />
          <MetricTile
            label="CPU Load (1m)"
            value={health ? health.system.cpuLoad1m : "—"}
            sub={health ? `5m: ${health.system.cpuLoad5m} · 15m: ${health.system.cpuLoad15m}` : ""}
            loading={loading}
          />
          <MetricTile
            label="API Uptime"
            value={health ? fmtUptime(health.api.uptimeSeconds) : "—"}
            sub={health ? `Node ${health.api.nodeVersion}` : ""}
            loading={loading}
          />
          <MetricTile
            label="CPU Cores"
            value={health?.system.cpuCount ?? "—"}
            sub={health ? health.system.platform : ""}
            loading={loading}
          />
          <MetricTile
            label="RSS Memory"
            value={health ? fmtMem(health.api.rssMemMb) : "—"}
            sub="Process resident set"
            loading={loading}
          />
          <MetricTile
            label="Free Memory"
            value={health ? fmtMem(health.system.freeMemMb) : "—"}
            sub="System available"
            loading={loading}
          />
          <MetricTile
            label="Process ID"
            value={health?.api.pid ?? "—"}
            sub="Server PID"
            loading={loading}
          />
          <MetricTile
            label="Disk Usage"
            value={health?.disk && health.disk.totalGb >= 0.5 ? `${health.disk.usedGb} GB` : "N/A"}
            sub={health?.disk && health.disk.totalGb >= 0.5 ? `${health.disk.usedPct}% of ${health.disk.totalGb} GB` : "Not reported by this environment"}
            progress={health?.disk && health.disk.totalGb >= 0.5 ? health.disk.usedPct : undefined}
            progressColor={(health?.disk?.usedPct ?? 0) >= 90 ? "bg-red-500" : (health?.disk?.usedPct ?? 0) >= 70 ? "bg-amber-500" : "bg-primary"}
            loading={loading}
          />
        </div>
      </div>

      {/* Queue breakdown */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Queue Health</p>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-foreground">Email Queue</p>
            {loading ? <Skeleton className="h-4 w-24" /> : (
              <span className="text-xs text-muted-foreground">{qTotal.toLocaleString()} total items</span>
            )}
          </div>
          {loading ? (
            <div className="space-y-3">
              {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              <QueueRow label="Success"  count={q?.success  ?? 0} total={qTotal} cls="bg-emerald-500" />
              <QueueRow label="Pending"  count={q?.pending  ?? 0} total={qTotal} cls="bg-blue-500" />
              <QueueRow label="Sending"  count={q?.sending  ?? 0} total={qTotal} cls="bg-indigo-500" />
              <QueueRow label="Deferred" count={q?.deferred ?? 0} total={qTotal} cls="bg-amber-500" />
              <QueueRow label="Failed"   count={q?.failed   ?? 0} total={qTotal} cls="bg-red-500" />
            </div>
          )}
        </Card>
      </div>

      {/* Workers + Sessions + Errors */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* Workers */}
        <Card className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Background Workers</p>
          {loading ? (
            <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : (
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
                    <span className={`text-xs font-medium ${active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                      {active ? "Active" : "Idle"}
                    </span>
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground/60 pt-1">Worker state inferred from active campaign sends</p>
            </div>
          )}
        </Card>

        {/* Sessions */}
        <Card className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Active Sessions</p>
          {loading ? (
            <div className="space-y-2">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="space-y-2">
              {[
                { label: "Last 1 hour",  value: health?.sessions.active1h  ?? 0 },
                { label: "Last 24 hours", value: health?.sessions.active24h ?? 0 },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border p-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-base font-bold text-foreground">{value}</span>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground/60 pt-1">Based on user last-active timestamp</p>
            </div>
          )}
        </Card>

        {/* Error rate */}
        <Card className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Error Rate</p>
          {loading ? (
            <div className="space-y-2">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="space-y-2">
              {[
                { label: "Last 1 hour",  value: health?.errors.last1h  ?? 0, cls: (health?.errors.last1h  ?? 0) > 10 ? "text-red-600 dark:text-red-400" : "text-foreground" },
                { label: "Last 24 hours", value: health?.errors.last24h ?? 0, cls: (health?.errors.last24h ?? 0) > 50 ? "text-red-600 dark:text-red-400" : "text-foreground" },
              ].map(({ label, value, cls }) => (
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
            <Button
              variant="outline" size="sm" className="h-8 rounded-xl gap-1.5"
              onClick={runBounceScanNow} disabled={actionBusy === "bounce-scan"}
            >
              {actionBusy === "bounce-scan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailSearch className="h-3.5 w-3.5" />}
              Run Bounce Scan Now
            </Button>
            <Button
              variant="outline" size="sm" className="h-8 rounded-xl gap-1.5"
              onClick={retryAllFailed} disabled={actionBusy === "retry-all" || (health?.queue.failed ?? 0) === 0}
            >
              {actionBusy === "retry-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Retry All Failed ({health?.queue.failed ?? 0})
            </Button>
            <p className="text-xs text-muted-foreground">Manual controls for recovering stuck or failed background work.</p>
          </div>
        </Card>
      </div>

      {/* Cron Jobs */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Background Jobs (Cron)</p>
        <Card className="p-4 overflow-x-auto">
          {loading ? (
            <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : (
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
          {loading ? (
            <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (health?.runningJobs.length ?? 0) === 0 ? (
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
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Failed Jobs</p>
          </div>
          {loading ? (
            <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (health?.failedJobs.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No failed queue items</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {health!.failedJobs.map(job => (
                <div key={job.id} className="rounded-lg border border-border p-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{job.email}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{job.lastError ?? "Unknown error"} · {job.attempts} attempt(s)</p>
                  </div>
                  <Button
                    variant="ghost" size="sm" className="h-6 px-2 text-[10px] flex-shrink-0"
                    onClick={() => retryQueueItem(job.id)} disabled={actionBusy === `retry-${job.id}`}
                  >
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
          {loading ? (
            <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (health?.recentErrors.length ?? 0) === 0 ? (
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

    </div>
  );
}
