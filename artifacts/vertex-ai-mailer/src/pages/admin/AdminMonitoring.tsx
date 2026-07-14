/**
 * AdminMonitoring.tsx — Phase 9: Platform Monitoring
 * True operations dashboard: API, DB, Queue, Workers, Memory, CPU, Sessions, Error Rate
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  Server, Database, Inbox, Cpu, MemoryStick, Activity, Clock,
  Users, Zap, ShieldAlert, Play, Pause, BarChart3,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  database: { status: string; latencyMs: number; };
  queue: { pending: number; sending: number; deferred: number; failed: number; success: number; };
  workers: { smtpActive: boolean; gmailActive: boolean; bounceScanner: boolean; };
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
  const [health, setHealth]       = useState<PlatformHealth | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
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
    timerRef.current = setInterval(() => load(true), 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

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
        <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Service status cards */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Service Status</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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

    </div>
  );
}
