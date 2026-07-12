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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  Server, RefreshCw, Search, MoreHorizontal,
  CheckCircle2, XCircle, AlertTriangle, Loader2,
  Zap, Clock, Mail, Activity, ChevronLeft, ChevronRight,
  Eye, List, Wifi, WifiOff, BarChart3, Inbox,
  Shield, ShieldOff, RotateCcw, PlayCircle, Ban,
  TrendingUp, Users, Globe, Timer, Database,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminMailbox {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpSecure: string;
  fromName: string | null;
  replyTo: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapUser: string | null;
  isActive: boolean;
  maxPerHour: number;
  batchSize: number;
  quotaStatus: string | null;
  quotaCooldownUntil: string | null;
  quotaProbeCount: number;
  quotaSmtpResponse: string | null;
  quotaReachedAt: string | null;
  cooldownMinutes: number;
  probeRetryMinutes: number;
  createdAt: string;
  updatedAt: string;
  emailsSent: number;
  usedThisHour: number;
  deferredCount: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  activeCampaigns: number;
  openCount: number;
  suppressed: number;
}

interface MailboxStats {
  totalMailboxes: number;
  connected: number;
  disconnected: number;
  coolingDown: number;
  smtpAccounts: number;
  gmailAccounts: number;
  activeToday: number;
  failedConnections: number;
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

interface SmtpUsagePoint {
  hour: string;
  total: number;
  success: number;
  failed: number;
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

function fmtHour(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? "am" : "pm"}`;
}

function bounceRate(m: AdminMailbox): string {
  const total = m.emailsSent + m.deferredCount;
  if (total === 0) return "—";
  return `${Math.round((m.deferredCount / total) * 100)}%`;
}

function openRate(m: AdminMailbox): string {
  if (m.emailsSent === 0) return "—";
  return `${Math.round((m.openCount / m.emailsSent) * 100)}%`;
}

type HealthState = "connected" | "healthy" | "cooling_down" | "recovering" | "auth_failed" | "disconnected" | "warning";

function deriveHealth(m: AdminMailbox): HealthState {
  if (!m.isActive) return "disconnected";
  if (m.lastError &&
    (m.lastError.includes("EAUTH") || m.lastError.includes("Invalid login") ||
     m.lastError.includes("authentication failed") || m.lastError.includes('"rawCode":"EAUTH"'))) {
    // Only show auth_failed if no success has happened since — we approximate by checking deferredCount
    if (m.deferredCount > 0 && m.emailsSent === 0) return "auth_failed";
  }
  if (m.quotaStatus === "quota_reached" && (m.quotaProbeCount ?? 0) > 2) return "recovering";
  if (m.quotaStatus === "quota_reached") return "cooling_down";
  if (m.deferredCount > 5) return "warning";
  if (m.usedThisHour > 0) return "healthy";
  return "connected";
}

function getHealthInfo(state: HealthState): { label: string; cls: string; dotCls: string } {
  const map: Record<HealthState, { label: string; cls: string; dotCls: string }> = {
    connected:    { label: "Connected",    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dotCls: "bg-emerald-500" },
    healthy:      { label: "Healthy",      cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",         dotCls: "bg-blue-500 animate-pulse" },
    cooling_down: { label: "Cooling Down", cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400",   dotCls: "bg-orange-500" },
    recovering:   { label: "Recovering",   cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400",   dotCls: "bg-violet-500 animate-pulse" },
    auth_failed:  { label: "Auth Failed",  cls: "bg-red-500/10 text-red-600 dark:text-red-400",            dotCls: "bg-red-500" },
    disconnected: { label: "Disconnected", cls: "bg-muted text-muted-foreground",                           dotCls: "bg-muted-foreground" },
    warning:      { label: "Warning",      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",      dotCls: "bg-amber-500" },
  };
  return map[state];
}

function inferProvider(host: string): string {
  const h = host.toLowerCase();
  if (h.includes("gmail") || h.includes("google")) return "Google";
  if (h.includes("outlook") || h.includes("office365") || h.includes("hotmail")) return "Microsoft";
  if (h.includes("sendgrid")) return "SendGrid";
  if (h.includes("mailgun")) return "Mailgun";
  if (h.includes("amazonaws")) return "Amazon SES";
  if (h.includes("zoho")) return "Zoho";
  if (h.includes("yahoo")) return "Yahoo";
  if (h.includes("fastmail")) return "Fastmail";
  if (h.includes("protonmail")) return "Proton";
  return host;
}

function maskStr(s: string | null | undefined, show = 3): string {
  if (!s) return "—";
  if (s.length <= show) return "•".repeat(s.length);
  return s.slice(0, show) + "•".repeat(Math.min(s.length - show, 8));
}

// ─── Overview card ────────────────────────────────────────────────────────────

const CARD_ACCENTS: Record<string, string> = {
  blue:    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  red:     "bg-red-500/10 text-red-600 dark:text-red-400",
  orange:  "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  violet:  "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  teal:    "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  indigo:  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
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

// ─── Health badge ─────────────────────────────────────────────────────────────

function HealthBadge({ m }: { m: AdminMailbox }) {
  const state = deriveHealth(m);
  const { label, cls, dotCls } = getHealthInfo(state);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dotCls}`} />
      {label}
    </span>
  );
}

// ─── Cooldown timer ───────────────────────────────────────────────────────────

function CooldownRemaining({ until }: { until: string | null }) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    if (!until) { setRemaining("—"); return; }
    const tick = () => {
      const ms = new Date(until).getTime() - Date.now();
      if (ms <= 0) { setRemaining("Expired"); return; }
      const m = Math.floor(ms / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setRemaining(`${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [until]);
  return <span>{remaining}</span>;
}

// ─── Queue drawer ─────────────────────────────────────────────────────────────

function QueueDrawer({ mailboxId, mailboxEmail, open, onClose }: {
  mailboxId: number; mailboxEmail: string; open: boolean; onClose: () => void;
}) {
  const [items, setItems]     = useState<QueueItem[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const data = await apiFetch(`mailboxes/${mailboxId}/queue?page=${page}&limit=30`);
      setItems(data.data);
      setTotal(data.total);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [mailboxId, open, page]);

  useEffect(() => { load(); }, [load]);

  const pageCount = Math.max(Math.ceil(total / 30), 1);

  const STATUS_CLS: Record<string, string> = {
    pending:  "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    success:  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    failed:   "bg-red-500/10 text-red-600 dark:text-red-400",
    deferred: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    sending:  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <List className="h-4 w-4 text-muted-foreground" />
            Email Queue
          </SheetTitle>
          <p className="text-xs text-muted-foreground truncate">{mailboxEmail} · {total} items</p>
        </SheetHeader>
        <div className="space-y-2">
          {loading ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />) :
          items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No queue items found.
            </div>
          ) : items.map(item => (
            <div key={item.id} className="rounded-xl border border-border p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground truncate">{item.email}</p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize flex-shrink-0 ${STATUS_CLS[item.status] ?? "bg-muted text-muted-foreground"}`}>{item.status}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>Attempts: <span className="text-foreground font-medium">{item.attempts}</span></span>
                {item.deferredCount > 0 && <span>Deferred: <span className="text-amber-600 dark:text-amber-400 font-medium">{item.deferredCount}×</span></span>}
                {item.sentAt && <span>Sent: {timeAgo(item.sentAt)}</span>}
                {item.retryAfter && new Date(item.retryAfter) > new Date() && (
                  <span className="text-amber-600 dark:text-amber-400">Retry: {timeAgo(item.retryAfter)}</span>
                )}
              </div>
              {item.lastError && (
                <p className="text-xs text-red-600 dark:text-red-400 truncate">{
                  (() => { try { return JSON.parse(item.lastError).friendly ?? item.lastError; } catch { return item.lastError; } })()
                }</p>
              )}
            </div>
          ))}
        </div>
        {total > 30 && (
          <div className="flex items-center justify-between pt-4">
            <span className="text-xs text-muted-foreground">{page} / {pageCount}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── SMTP Usage drawer ────────────────────────────────────────────────────────

function SmtpUsageDrawer({ mailboxId, mailboxEmail, open, onClose }: {
  mailboxId: number; mailboxEmail: string; open: boolean; onClose: () => void;
}) {
  const [data, setData]   = useState<SmtpUsagePoint[]>([]);
  const [peak, setPeak]   = useState(0);
  const [avg, setAvg]     = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch(`mailboxes/${mailboxId}/smtp-usage`)
      .then(r => { setData(r.data); setPeak(r.peak); setAvg(r.avg); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [mailboxId, open]);

  const chartData = data.map(d => ({ ...d, label: fmtHour(d.hour) }));
  const last24Total = data.reduce((s, d) => s + Number(d.total), 0);
  const last24Success = data.reduce((s, d) => s + Number(d.success), 0);

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            SMTP Usage
          </SheetTitle>
          <p className="text-xs text-muted-foreground truncate">{mailboxEmail} · Last 24 hours</p>
        </SheetHeader>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: "Last 24h", value: last24Total },
            { label: "Peak / hr", value: peak },
            { label: "Avg / hr", value: avg },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-border p-3 text-center">
              <p className="text-xs text-muted-foreground">{label}</p>
              {loading ? <Skeleton className="h-5 w-8 mx-auto mt-1" /> : <p className="text-base font-bold text-foreground">{value}</p>}
            </div>
          ))}
        </div>

        {/* Chart */}
        {loading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : data.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No send activity in the last 24 hours.
          </div>
        ) : (
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-3">Emails sent per hour</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <ReTooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                  labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                />
                <Bar dataKey="success" name="Success" stackId="a" fill="hsl(142 76% 36%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed" name="Failed"  stackId="a" fill="hsl(0 84% 60%)"   radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {last24Success > 0 && (
          <p className="text-xs text-muted-foreground mt-3 text-center">
            {last24Success} of {last24Total} sends succeeded in the last 24 hours
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Mailbox Detail drawer ────────────────────────────────────────────────────

function DetailDrawer({ mailbox, open, onClose, onAction }: {
  mailbox: AdminMailbox | null;
  open: boolean;
  onClose: () => void;
  onAction: (action: string, id: number) => void;
}) {
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { if (!open) { setTestResult(null); } }, [open]);

  if (!mailbox) return null;

  const health = deriveHealth(mailbox);
  const { label: healthLabel, cls: healthCls } = getHealthInfo(health);
  const provider = inferProvider(mailbox.smtpHost);
  const quotaUsedPct = mailbox.maxPerHour > 0 ? Math.min((mailbox.usedThisHour / mailbox.maxPerHour) * 100, 100) : 0;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await apiFetch(`mailboxes/${mailbox.id}/test-connection`, { method: "POST" });
      setTestResult({ ok: r.ok, msg: r.message ?? "Connection verified" });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            Mailbox Details
          </SheetTitle>
        </SheetHeader>

        {/* Header identity */}
        <div className="rounded-xl border border-border p-4 mb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{mailbox.smtpUser}</p>
              {mailbox.fromName && <p className="text-xs text-muted-foreground">{mailbox.fromName}</p>}
            </div>
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${healthCls}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {healthLabel}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">{provider}</span>
            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold">SMTP</span>
            {!mailbox.isActive && <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">Disabled</span>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <span>Owner: <span className="text-foreground font-medium">{mailbox.userName ?? "—"}</span></span>
            <span>Account: <span className="text-foreground font-medium">{mailbox.userEmail ?? "—"}</span></span>
            <span>Created: <span className="text-foreground font-medium">{fmtDate(mailbox.createdAt)}</span></span>
            <span>Updated: <span className="text-foreground font-medium">{timeAgo(mailbox.updatedAt)}</span></span>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: "Total Sent",       value: mailbox.emailsSent.toLocaleString() },
            { label: "Opens",            value: mailbox.openCount.toLocaleString() },
            { label: "Open Rate",        value: openRate(mailbox) },
            { label: "Deferred",         value: mailbox.deferredCount },
            { label: "Bounce Rate",      value: bounceRate(mailbox) },
            { label: "Active Campaigns", value: mailbox.activeCampaigns },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-border p-2.5 text-center">
              <p className="text-xs text-muted-foreground leading-tight">{label}</p>
              <p className="text-sm font-bold text-foreground mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* Hourly quota */}
        <div className="rounded-xl border border-border p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-foreground">Hourly Quota</p>
            <p className="text-xs text-muted-foreground">{mailbox.usedThisHour} / {mailbox.maxPerHour}</p>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${quotaUsedPct >= 90 ? "bg-red-500" : quotaUsedPct >= 70 ? "bg-amber-500" : "bg-primary"}`}
              style={{ width: `${quotaUsedPct}%` }}
            />
          </div>
          {mailbox.quotaStatus === "quota_reached" && (
            <div className="mt-3 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cooldown until</span>
                <span className="text-foreground font-medium">
                  {mailbox.quotaCooldownUntil ? <CooldownRemaining until={mailbox.quotaCooldownUntil} /> : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Probe attempts</span>
                <span className="text-foreground font-medium">{mailbox.quotaProbeCount}</span>
              </div>
              {mailbox.quotaSmtpResponse && (
                <p className="text-red-600 dark:text-red-400 truncate" title={mailbox.quotaSmtpResponse}>
                  {mailbox.quotaSmtpResponse.slice(0, 80)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* SMTP config (masked) */}
        <div className="rounded-xl border border-border p-4 mb-4">
          <p className="text-xs font-semibold text-foreground mb-2">SMTP Configuration</p>
          <div className="space-y-1 text-xs">
            {[
              { label: "Host",     value: mailbox.smtpHost },
              { label: "Port",     value: String(mailbox.smtpPort) },
              { label: "User",     value: mailbox.smtpUser },
              { label: "Password", value: "••••••••••" },
              { label: "Security", value: mailbox.smtpSecure.toUpperCase() },
              { label: "Batch",    value: `${mailbox.batchSize} / send` },
              { label: "Max/hr",   value: String(mailbox.maxPerHour) },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground w-20 flex-shrink-0">{label}</span>
                <span className="text-foreground font-mono text-xs truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* IMAP config (masked) */}
        {(mailbox.imapHost || mailbox.imapUser) && (
          <div className="rounded-xl border border-border p-4 mb-4">
            <p className="text-xs font-semibold text-foreground mb-2">IMAP Configuration</p>
            <div className="space-y-1 text-xs">
              {[
                { label: "Host",     value: mailbox.imapHost ?? "—" },
                { label: "Port",     value: String(mailbox.imapPort ?? "—") },
                { label: "User",     value: mailbox.imapUser ?? "—" },
                { label: "Password", value: mailbox.imapUser ? "••••••••••" : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">{label}</span>
                  <span className="text-foreground font-mono text-xs truncate">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last error */}
        {mailbox.lastError && (
          <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 p-3 mb-4">
            <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">Last Error</p>
            <p className="text-xs text-red-600 dark:text-red-400 break-words">
              {(() => { try { return JSON.parse(mailbox.lastError!).friendly ?? mailbox.lastError; } catch { return mailbox.lastError; } })()}
            </p>
          </div>
        )}

        {/* Suppression */}
        <div className="rounded-xl border border-border p-3 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Suppression List</p>
            <span className="text-xs font-bold text-foreground">{mailbox.suppressed.toLocaleString()}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Emails blocked from future sends</p>
        </div>

        {/* Test connection */}
        <div className="rounded-xl border border-border p-4 mb-4">
          <p className="text-xs font-semibold text-foreground mb-3">Test Connection</p>
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-xl h-9 gap-2"
            disabled={testing}
            onClick={handleTest}
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
            {testing ? "Testing…" : "Test SMTP Connection"}
          </Button>
          {testResult && (
            <div className={`mt-3 rounded-lg p-2.5 text-xs flex items-center gap-2 ${testResult.ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
              {testResult.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <XCircle className="h-4 w-4 flex-shrink-0" />}
              {testResult.msg}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          {mailbox.isActive ? (
            <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2 text-muted-foreground" onClick={() => onAction("disable", mailbox.id)}>
              <Ban className="h-4 w-4" /> Disable Mailbox
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2 text-emerald-600 dark:text-emerald-400" onClick={() => onAction("enable", mailbox.id)}>
              <PlayCircle className="h-4 w-4" /> Enable Mailbox
            </Button>
          )}
          {mailbox.quotaStatus && (
            <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2 text-violet-600 dark:text-violet-400" onClick={() => onAction("force-quota-reset", mailbox.id)}>
              <RotateCcw className="h-4 w-4" /> Force Quota Reset
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Status / Connection filter tabs ──────────────────────────────────────────

const STATUS_TABS = [
  { value: "all",          label: "All" },
  { value: "active",       label: "Connected" },
  { value: "cooling_down", label: "Cooling Down" },
  { value: "recovering",   label: "Recovering" },
  { value: "inactive",     label: "Disabled" },
];

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(mailboxes: AdminMailbox[]) {
  const headers = [
    "ID","Owner","Email","SMTP User","Host","Port","Security","Provider",
    "Status","Health","Used/hr","Max/hr","Total Sent","Deferred","Open Rate",
    "Bounce Rate","Active Campaigns","Suppressed","Last Success","Created",
  ];
  const rows = mailboxes.map(m => [
    m.id, m.userName ?? "", m.userEmail ?? "",
    m.smtpUser, m.smtpHost, m.smtpPort, m.smtpSecure,
    inferProvider(m.smtpHost),
    m.isActive ? "Active" : "Disabled",
    getHealthInfo(deriveHealth(m)).label,
    m.usedThisHour, m.maxPerHour, m.emailsSent, m.deferredCount,
    openRate(m), bounceRate(m), m.activeCampaigns, m.suppressed,
    m.lastSuccessAt ? fmtDate(m.lastSuccessAt) : "",
    fmtDate(m.createdAt),
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: "mailboxes.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminMailboxes() {
  // Stats
  const [stats, setStats]           = useState<MailboxStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Mailbox list
  const [mailboxes, setMailboxes]   = useState<AdminMailbox[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Filters
  const [search, setSearch]         = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("");
  const [dateFrom, setDateFrom]     = useState("");
  const [dateTo, setDateTo]         = useState("");

  // Action loading
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Drawers
  const [detailMailbox, setDetailMailbox] = useState<AdminMailbox | null>(null);
  const [queueMailbox, setQueueMailbox]   = useState<AdminMailbox | null>(null);
  const [usageMailbox, setUsageMailbox]   = useState<AdminMailbox | null>(null);

  const pageCount = Math.max(Math.ceil(total / 25), 1);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    try {
      const overview = await apiFetch("dashboard-overview");
      setStats(overview.mailboxMonitor ?? null);
    } catch { /* silent */ }
    finally { setStatsLoading(false); }
  }, []);

  const loadMailboxes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: "25",
        ...(search                          && { search }),
        ...(statusFilter !== "all"          && { status: statusFilter }),
        ...(providerFilter                  && { provider: providerFilter }),
        ...(dateFrom                        && { dateFrom }),
        ...(dateTo                          && { dateTo }),
      });
      const data = await apiFetch(`mailboxes?${params}`);
      setMailboxes(data.data);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mailboxes");
    } finally { setLoading(false); }
  }, [page, search, statusFilter, providerFilter, dateFrom, dateTo]);

  // Auto-refresh while mailboxes with live activity exist
  useEffect(() => {
    loadStats();
    loadMailboxes();
  }, [loadStats, loadMailboxes]);

  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    const hasLive = mailboxes.some(m => m.usedThisHour > 0 || m.quotaStatus === "quota_reached");
    if (hasLive) {
      refreshTimerRef.current = setInterval(() => {
        loadStats();
        loadMailboxes();
      }, 30_000);
    }
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [mailboxes, loadStats, loadMailboxes]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [search, statusFilter, providerFilter, dateFrom, dateTo]);

  // ── Action handler ────────────────────────────────────────────────────────

  const handleAction = async (action: string, id: number) => {
    setActionLoading(id);
    try {
      await apiFetch(`mailboxes/${id}/${action}`, { method: "POST" });
      // Refresh list + close detail drawer if the mailbox that was acted on matches
      await Promise.all([loadMailboxes(), loadStats()]);
      if (detailMailbox?.id === id) {
        // Re-find updated mailbox to refresh the drawer
        setDetailMailbox(prev => {
          const updated = mailboxes.find(m => m.id === id);
          return updated ?? prev;
        });
      }
    } catch (e) {
      // Silently fail — user sees no change
    } finally { setActionLoading(null); }
  };

  const clearFilters = () => {
    setSearch(""); setStatusFilter("all"); setProviderFilter("");
    setDateFrom(""); setDateTo("");
  };
  const hasFilters = search || statusFilter !== "all" || providerFilter || dateFrom || dateTo;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Overview Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <MonitorCard icon={Server}      label="Total Mailboxes"    value={stats?.totalMailboxes ?? 0}    accent="blue"    loading={statsLoading} />
        <MonitorCard icon={Wifi}        label="Connected"          value={stats?.connected ?? 0}         accent="emerald" loading={statsLoading} />
        <MonitorCard icon={WifiOff}     label="Disconnected"       value={stats?.disconnected ?? 0}      accent="amber"   loading={statsLoading} />
        <MonitorCard icon={Clock}       label="Cooling Down"       value={stats?.coolingDown ?? 0}       accent="orange"  loading={statsLoading} />
        <MonitorCard icon={Database}    label="SMTP Accounts"      value={stats?.smtpAccounts ?? 0}      accent="indigo"  loading={statsLoading} />
        <MonitorCard icon={Mail}        label="Gmail Accounts"     value={stats?.gmailAccounts ?? 0}     accent="violet"  loading={statsLoading} />
        <MonitorCard icon={Activity}    label="Active Today"       value={stats?.activeToday ?? 0}       accent="teal"    loading={statsLoading} />
        <MonitorCard icon={AlertTriangle} label="Failed Connections" value={stats?.failedConnections ?? 0} accent="red"   loading={statsLoading} />
      </div>

      {/* ── Status tab bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
              ${statusFilter === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search mailbox, user, host…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 rounded-xl"
          />
        </div>

        <Select value={providerFilter || "all"} onValueChange={v => setProviderFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 rounded-xl w-full sm:w-40">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Providers</SelectItem>
            <SelectItem value="google">Google</SelectItem>
            <SelectItem value="microsoft">Microsoft</SelectItem>
            <SelectItem value="sendgrid">SendGrid</SelectItem>
            <SelectItem value="mailgun">Mailgun</SelectItem>
            <SelectItem value="amazon">Amazon SES</SelectItem>
          </SelectContent>
        </Select>

        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 rounded-xl w-full sm:w-36" />
        <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="h-9 rounded-xl w-full sm:w-36" />

        <div className="flex gap-2">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-3 rounded-xl text-muted-foreground">
              Clear
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { loadMailboxes(); loadStats(); }} disabled={loading} className="h-9 px-3 rounded-xl gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportCSV(mailboxes)} disabled={mailboxes.length === 0} className="h-9 px-3 rounded-xl gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* ── Result count ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${total.toLocaleString()} mailbox${total !== 1 ? "es" : ""}`}
        </p>
        {total > 25 && (
          <p className="text-xs text-muted-foreground">Page {page} of {pageCount}</p>
        )}
      </div>

      {/* ── Error state ────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 p-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* ── Desktop table ──────────────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-left">
              {[
                "Mailbox", "Owner", "Provider", "Type", "Health",
                "Quota Status", "Used / Limit", "Cooldown",
                "Last Send", "Last Error", "Campaigns",
                "Created", "Updated", "",
              ].map(h => (
                <th key={h} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? Array(5).fill(0).map((_, i) => (
              <tr key={i} className="border-b border-border">
                {Array(14).fill(0).map((__, j) => (
                  <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-full" /></td>
                ))}
              </tr>
            )) : mailboxes.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-16 text-center text-muted-foreground text-sm">
                  <Server className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  No mailboxes found.
                </td>
              </tr>
            ) : mailboxes.map(m => {
              const quotaUsedPct = m.maxPerHour > 0 ? Math.min((m.usedThisHour / m.maxPerHour) * 100, 100) : 0;
              const isBusy = actionLoading === m.id;
              return (
                <tr key={m.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  {/* Mailbox */}
                  <td className="px-3 py-3 max-w-[160px]">
                    <p className="font-mono text-xs font-medium text-foreground truncate">{m.smtpUser}</p>
                    {m.fromName && <p className="text-xs text-muted-foreground truncate">{m.fromName}</p>}
                  </td>
                  {/* Owner */}
                  <td className="px-3 py-3 max-w-[140px]">
                    <p className="text-xs font-medium text-foreground truncate">{m.userName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.userEmail ?? ""}</p>
                  </td>
                  {/* Provider */}
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {inferProvider(m.smtpHost)}
                  </td>
                  {/* Type badge */}
                  <td className="px-3 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400">SMTP</span>
                  </td>
                  {/* Health */}
                  <td className="px-3 py-3"><HealthBadge m={m} /></td>
                  {/* Quota status */}
                  <td className="px-3 py-3">
                    {m.quotaStatus === "quota_reached" ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-600 dark:text-orange-400">
                        {(m.quotaProbeCount ?? 0) > 0 ? "Recovering" : "Cooling Down"}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* Usage bar */}
                  <td className="px-3 py-3 min-w-[100px]">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[50px]">
                        <div
                          className={`h-full rounded-full transition-all ${quotaUsedPct >= 90 ? "bg-red-500" : quotaUsedPct >= 70 ? "bg-amber-500" : "bg-primary"}`}
                          style={{ width: `${quotaUsedPct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {m.usedThisHour}/{m.maxPerHour}
                      </span>
                    </div>
                  </td>
                  {/* Cooldown */}
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {m.quotaCooldownUntil && new Date(m.quotaCooldownUntil) > new Date()
                      ? <CooldownRemaining until={m.quotaCooldownUntil} />
                      : "—"}
                  </td>
                  {/* Last success */}
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {m.lastSuccessAt ? timeAgo(m.lastSuccessAt) : "Never"}
                  </td>
                  {/* Last error */}
                  <td className="px-3 py-3 max-w-[140px]">
                    {m.lastError ? (
                      <p className="text-xs text-red-600 dark:text-red-400 truncate" title={m.lastError}>
                        {(() => { try { return JSON.parse(m.lastError).friendly ?? m.lastError; } catch { return m.lastError; } })()}
                      </p>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  {/* Active campaigns */}
                  <td className="px-3 py-3 text-xs tabular-nums text-center">
                    {m.activeCampaigns > 0
                      ? <span className="font-semibold text-blue-600 dark:text-blue-400">{m.activeCampaigns}</span>
                      : <span className="text-muted-foreground">0</span>}
                  </td>
                  {/* Created */}
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.createdAt)}</td>
                  {/* Updated */}
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(m.updatedAt)}</td>
                  {/* Actions */}
                  <td className="px-3 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" disabled={isBusy}>
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 rounded-xl">
                        <DropdownMenuItem onClick={() => setDetailMailbox(m)}>
                          <Eye className="h-4 w-4 mr-2" /> View Mailbox
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setQueueMailbox(m)}>
                          <List className="h-4 w-4 mr-2" /> View Queue
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setUsageMailbox(m)}>
                          <BarChart3 className="h-4 w-4 mr-2" /> View SMTP Usage
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleAction("test-connection", m.id)}>
                          <Wifi className="h-4 w-4 mr-2" /> Test Connection
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {m.isActive ? (
                          <DropdownMenuItem onClick={() => handleAction("disable", m.id)} className="text-muted-foreground">
                            <Ban className="h-4 w-4 mr-2" /> Disable
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => handleAction("enable", m.id)} className="text-emerald-600 dark:text-emerald-400">
                            <PlayCircle className="h-4 w-4 mr-2" /> Enable
                          </DropdownMenuItem>
                        )}
                        {m.quotaStatus && (
                          <DropdownMenuItem onClick={() => handleAction("force-quota-reset", m.id)} className="text-violet-600 dark:text-violet-400">
                            <RotateCcw className="h-4 w-4 mr-2" /> Force Quota Reset
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ───────────────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {loading ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />) :
        mailboxes.length === 0 ? (
          <div className="py-16 text-center">
            <Server className="h-10 w-10 mx-auto text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">No mailboxes found.</p>
          </div>
        ) : mailboxes.map(m => {
          const isBusy = actionLoading === m.id;
          return (
            <Card key={m.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-foreground truncate">{m.smtpUser}</p>
                  <p className="text-xs text-muted-foreground">{m.userName ?? "—"} · {inferProvider(m.smtpHost)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <HealthBadge m={m} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" disabled={isBusy}>
                        {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44 rounded-xl">
                      <DropdownMenuItem onClick={() => setDetailMailbox(m)}><Eye className="h-4 w-4 mr-2" /> View Mailbox</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setQueueMailbox(m)}><List className="h-4 w-4 mr-2" /> View Queue</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setUsageMailbox(m)}><BarChart3 className="h-4 w-4 mr-2" /> View SMTP Usage</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleAction("test-connection", m.id)}><Wifi className="h-4 w-4 mr-2" /> Test Connection</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {m.isActive
                        ? <DropdownMenuItem onClick={() => handleAction("disable", m.id)} className="text-muted-foreground"><Ban className="h-4 w-4 mr-2" /> Disable</DropdownMenuItem>
                        : <DropdownMenuItem onClick={() => handleAction("enable", m.id)} className="text-emerald-600 dark:text-emerald-400"><PlayCircle className="h-4 w-4 mr-2" /> Enable</DropdownMenuItem>}
                      {m.quotaStatus && (
                        <DropdownMenuItem onClick={() => handleAction("force-quota-reset", m.id)} className="text-violet-600 dark:text-violet-400"><RotateCcw className="h-4 w-4 mr-2" /> Force Quota Reset</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Quick stats grid */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Sent",   value: m.emailsSent.toLocaleString() },
                  { label: "Used/h", value: `${m.usedThisHour}/${m.maxPerHour}` },
                  { label: "Defer",  value: m.deferredCount },
                  { label: "Camps",  value: m.activeCampaigns },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-muted/50 p-2 text-center">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-bold text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              {m.quotaStatus && (
                <div className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400">
                  <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                  {m.quotaCooldownUntil
                    ? <><CooldownRemaining until={m.quotaCooldownUntil} /> remaining</>
                    : "Quota reached"}
                </div>
              )}
              {m.lastError && (
                <p className="text-xs text-red-600 dark:text-red-400 truncate">
                  {(() => { try { return JSON.parse(m.lastError).friendly ?? m.lastError; } catch { return m.lastError; } })()}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {total > 25 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Page {page} of {pageCount} · {total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount || loading} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Drawers ────────────────────────────────────────────────────────── */}
      <DetailDrawer
        mailbox={detailMailbox}
        open={!!detailMailbox}
        onClose={() => setDetailMailbox(null)}
        onAction={handleAction}
      />
      <QueueDrawer
        mailboxId={queueMailbox?.id ?? 0}
        mailboxEmail={queueMailbox?.smtpUser ?? ""}
        open={!!queueMailbox}
        onClose={() => setQueueMailbox(null)}
      />
      <SmtpUsageDrawer
        mailboxId={usageMailbox?.id ?? 0}
        mailboxEmail={usageMailbox?.smtpUser ?? ""}
        open={!!usageMailbox}
        onClose={() => setUsageMailbox(null)}
      />
    </div>
  );
}
