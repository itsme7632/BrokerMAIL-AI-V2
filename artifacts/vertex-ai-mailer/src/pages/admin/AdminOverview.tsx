import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, UserCheck, Send, Zap, MailOpen, AlertTriangle, ShieldOff,
  Server, Mail, HeartPulse, RefreshCw, AlertCircle, UserPlus, Megaphone,
  BadgeDollarSign, LifeBuoy, Lightbulb, Bug, ArrowRight, Database,
  Cog, ListChecks, Cpu,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Kpis {
  totalUsers: number; activeUsers: number; activeCampaigns: number;
  emailsSentToday: number; emailsSentMonth: number;
  openRate: number; bounceRate: number; suppressedEmails: number;
  connectedMailboxes: number; gmailAccounts: number;
  platformHealth: "healthy" | "degraded" | "critical";
}

interface RecentSignup { id: number; name: string; email: string; plan: string; createdAt: string; }
interface RecentCampaign { id: number; name: string; status: string; sentCount: number; totalLeads: number; userName: string | null; updatedAt: string | null; }
interface RecentPayment { id: number; userName: string | null; userEmail: string | null; toPlanId: number; priceSnapshot: number; status: string; paymentStatus: string; createdAt: string; }
interface SupportItem { id: number; subject: string; userName: string | null; userEmail: string; priority: string; status: string; createdAt: string; }
interface FeatureRequestItem { id: number; title: string; category: string; status: string; createdAt: string; }
interface BugReportItem { id: number; title: string; severity: string; status: string; createdAt: string; }
interface AnnouncementItem { id: number; message: string; priority: number; createdAt: string; }
interface ActivityItem { id: number; type: string; severity: string; description: string; createdAt: string; }

interface DashboardOverview {
  kpis: Kpis;
  recent: {
    signups: RecentSignup[]; campaigns: RecentCampaign[]; payments: RecentPayment[];
    supportRequests: SupportItem[]; featureRequests: FeatureRequestItem[];
    bugReports: BugReportItem[]; announcements: AnnouncementItem[]; activity: ActivityItem[];
  };
  systemStatus: {
    database: string; api: string; workers: string;
    queue: { pending: number }; smtp: string; imap: string; mailboxHealthPct: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function apiFetch(path: string) {
  const res = await fetch(`/api/admin/${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `Error ${res.status}`);
  }
  return res.json();
}

function relativeTime(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── KPI card ────────────────────────────────────────────────────────────────

const KPI_ACCENTS: Record<string, string> = {
  blue:    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  purple:  "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red:     "bg-red-500/10 text-red-600 dark:text-red-400",
  indigo:  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  teal:    "bg-teal-500/10 text-teal-600 dark:text-teal-400",
};

function KpiCard({ icon: Icon, label, value, accent, loading }: {
  icon: React.ElementType; label: string; value: string; accent: string; loading: boolean;
}) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${KPI_ACCENTS[accent]}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        {/* No truncate — allow label to wrap naturally */}
        <p className="text-xs text-muted-foreground font-medium leading-tight">{label}</p>
        {loading
          ? <Skeleton className="h-5 w-14 mt-1" />
          : <p className="text-lg font-bold text-foreground leading-tight mt-0.5">{value}</p>}
      </div>
    </Card>
  );
}

// ─── Health pill ─────────────────────────────────────────────────────────────

function HealthPill({ health }: { health: Kpis["platformHealth"] }) {
  const map = {
    healthy:  { label: "Healthy",  cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
    degraded: { label: "Degraded", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",       dot: "bg-amber-500"   },
    critical: { label: "Critical", cls: "bg-red-500/10 text-red-600 dark:text-red-400",             dot: "bg-red-500"     },
  } as const;
  const m = map[health] ?? map.healthy;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} animate-pulse`} />
      {m.label}
    </span>
  );
}

// ─── Passive severity badge ───────────────────────────────────────────────────
// Not interactive — no hover/focus/cursor styles.

function SeverityBadge({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  const cls =
    s === "error"   ? "bg-red-500/10 text-red-700 dark:text-red-400"
    : s === "warn" || s === "warning" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
    : s === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : "bg-blue-500/10 text-blue-700 dark:text-blue-400"; // info + default
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize select-none pointer-events-none ${cls}`}>
      {severity}
    </span>
  );
}

// ─── System status row ───────────────────────────────────────────────────────

function StatusRow({ label, status, sub }: { label: string; status: string; sub?: string }) {
  const good = ["operational", "processing", "idle"].includes(status);
  const bad  = status === "down";
  const cls  = bad ? "text-red-600 dark:text-red-400" : good ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";
  const dot  = bad ? "bg-red-500"     : good ? "bg-emerald-500"     : "bg-amber-500";
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`flex items-center gap-1.5 text-xs font-semibold capitalize shrink-0 ${cls}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {sub ?? status}
      </span>
    </div>
  );
}

// ─── Section shell ───────────────────────────────────────────────────────────

function Section({ title, icon: Icon, action, children, empty }: {
  title: string; icon: React.ElementType; action?: React.ReactNode;
  children: React.ReactNode; empty?: boolean;
}) {
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
        {action}
      </div>
      {empty ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Nothing here yet.</div>
      ) : (
        <div className="flex flex-col">{children}</div>
      )}
    </Card>
  );
}

// ─── Standard row (title truncates) ─────────────────────────────────────────

function Row({ title, subtitle, meta, badge }: {
  title: string; subtitle?: string; meta?: string; badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {badge}
        {meta && <span className="text-xs text-muted-foreground whitespace-nowrap">{meta}</span>}
      </div>
    </div>
  );
}

// ─── Activity row (description wraps, 3-column layout) ───────────────────────

function ActivityRow({ description, severity, time }: {
  description: string; severity: string; time: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-start gap-3 py-2 border-b border-border/40 last:border-0">
      <p className="text-sm text-foreground leading-snug">{description}</p>
      <SeverityBadge severity={severity} />
      <span className="text-xs text-muted-foreground whitespace-nowrap pt-0.5">{time}</span>
    </div>
  );
}

// ─── Quick actions ───────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: "Manage users",       tab: "users",     icon: Users         },
  { label: "Mailbox monitor",    tab: "mailboxes",  icon: Server        },
  { label: "Platform analytics", tab: "analytics",  icon: Cpu           },
  { label: "Billing & plans",    tab: "billing",    icon: BadgeDollarSign },
  { label: "Feature flags",      tab: "settings",   icon: Cog           },
  { label: "Support center",     tab: "support",    icon: LifeBuoy      },
];

// ─── Main component ──────────────────────────────────────────────────────────

export function AdminOverview({ onNavigateTab }: { onNavigateTab: (tab: string) => void }) {
  const [data, setData]       = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [myAnalytics, setMyAnalytics] = useState<{
    totalEmailsSent: number; gmailEmailsSent: number; smtpEmailsSent: number;
    totalDraftsCreated: number; activeCampaigns: number;
    monthlyUsage: number; monthlyLimit: number; currentPlan: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overview, analyticsData] = await Promise.all([
        apiFetch("dashboard-overview"),
        fetch("/api/analytics/overview", {
          headers: { Authorization: `Bearer ${token()}` },
        }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setData(overview);
      if (analyticsData) setMyAnalytics(analyticsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm font-medium text-foreground">Couldn't load the dashboard</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </Card>
    );
  }

  const k = data?.kpis;

  return (
    <div className="w-full space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Platform command center</p>
          <p className="text-xs text-muted-foreground">Live snapshot across users, campaigns, and infrastructure</p>
        </div>
        <div className="flex items-center gap-2">
          {k && <HealthPill health={k.platformHealth} />}
          <Button size="sm" variant="outline" onClick={load} aria-label="Refresh dashboard" className="h-8 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* ── My Account Stats (admin's own analytics) ────────────────────── */}
      {(myAnalytics || loading) && (
        <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">My Account</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            <KpiCard icon={Send}    label="Emails Sent (All Time)"  value={myAnalytics ? myAnalytics.totalEmailsSent.toLocaleString() : "—"}  accent="blue"    loading={loading} />
            <KpiCard icon={Send}    label="Sent This Month"         value={myAnalytics ? myAnalytics.monthlyUsage.toLocaleString() : "—"}      accent="indigo"  loading={loading} />
            <KpiCard icon={Mail}    label="Gmail Drafts"            value={myAnalytics ? myAnalytics.totalDraftsCreated.toLocaleString() : "—"} accent="purple"  loading={loading} />
            <KpiCard icon={Zap}     label="My Active Campaigns"     value={myAnalytics ? myAnalytics.activeCampaigns.toLocaleString() : "—"}   accent="emerald" loading={loading} />
            <KpiCard icon={UserCheck} label="My Plan"               value={myAnalytics?.currentPlan ?? "—"}                                     accent="teal"    loading={loading} />
          </div>
        </div>
      )}

      {/* ── KPI grid — 2 cols → 3 → 4 → 5 → 6 as viewport grows ────────── */}
      {/*    Labels are allowed to wrap — no truncation. Cards stay aligned   */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        <KpiCard icon={Users}         label="Total Users"            value={String(k?.totalUsers ?? 0)}                                                                                  accent="blue"    loading={loading} />
        <KpiCard icon={UserCheck}     label="Active Users"           value={String(k?.activeUsers ?? 0)}                                                                                 accent="emerald" loading={loading} />
        <KpiCard icon={Zap}           label="Active Campaigns"       value={String(k?.activeCampaigns ?? 0)}                                                                             accent="indigo"  loading={loading} />
        <KpiCard icon={Send}          label="Emails Sent Today"      value={String(k?.emailsSentToday ?? 0)}                                                                             accent="blue"    loading={loading} />
        <KpiCard icon={Send}          label="Emails Sent This Month" value={(k?.emailsSentMonth ?? 0).toLocaleString()}                                                                  accent="blue"    loading={loading} />
        <KpiCard icon={MailOpen}      label="Open Rate"              value={`${k?.openRate ?? 0}%`}                                                                                      accent="teal"    loading={loading} />
        <KpiCard icon={AlertTriangle} label="Bounce Rate"            value={`${k?.bounceRate ?? 0}%`}                                                                                    accent="amber"   loading={loading} />
        <KpiCard icon={ShieldOff}     label="Suppressed Emails"      value={String(k?.suppressedEmails ?? 0)}                                                                            accent="red"     loading={loading} />
        <KpiCard icon={Server}        label="Connected Mailboxes"    value={String(k?.connectedMailboxes ?? 0)}                                                                          accent="purple"  loading={loading} />
        <KpiCard icon={Mail}          label="Gmail Accounts"         value={String(k?.gmailAccounts ?? 0)}                                                                               accent="purple"  loading={loading} />
        <KpiCard icon={HeartPulse}    label="Platform Health"        value={k ? k.platformHealth.charAt(0).toUpperCase() + k.platformHealth.slice(1) : "—"}                             accent={k?.platformHealth === "healthy" ? "emerald" : k?.platformHealth === "degraded" ? "amber" : "red"} loading={loading} />
      </div>

      {/* ── Two-column body ─────────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-4">

        {/* ── Left: main content ──────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Recent Activity — structured 3-col table */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Recent Activity</p>
            </div>
            {loading ? (
              <div className="space-y-2">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (data?.recent.activity.length ?? 0) === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">Nothing here yet.</div>
            ) : (
              /* Column headers */
              <div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 pb-1.5 border-b border-border mb-0.5">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Event</span>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Severity</span>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Time</span>
                </div>
                {data?.recent.activity.map(a => (
                  <ActivityRow key={a.id} description={a.description} severity={a.severity} time={relativeTime(a.createdAt)} />
                ))}
              </div>
            )}
          </Card>

          <div className="grid sm:grid-cols-2 gap-4">
            <Section
              title="Latest Signups" icon={UserPlus}
              action={<button onClick={() => onNavigateTab("users")} className="text-xs text-primary hover:underline flex items-center gap-1">View all <ArrowRight className="h-3 w-3" /></button>}
              empty={!loading && (data?.recent.signups.length ?? 0) === 0}
            >
              {loading
                ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
                : data?.recent.signups.map(u => (
                    <Row key={u.id} title={u.name} subtitle={u.email} meta={relativeTime(u.createdAt)}
                      badge={<Badge variant="outline" className="capitalize">{u.plan}</Badge>} />
                  ))}
            </Section>

            <Section
              title="Recent Campaigns" icon={Send}
              empty={!loading && (data?.recent.campaigns.length ?? 0) === 0}
            >
              {loading
                ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
                : data?.recent.campaigns.map(c => (
                    <Row key={c.id} title={c.name} subtitle={c.userName ?? undefined} meta={`${c.sentCount}/${c.totalLeads} sent`}
                      badge={<Badge variant="outline" className="capitalize">{c.status}</Badge>} />
                  ))}
            </Section>
          </div>

          <Section
            title="Recent Payments & Upgrades" icon={BadgeDollarSign}
            empty={!loading && (data?.recent.payments.length ?? 0) === 0}
          >
            {loading
              ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
              : data?.recent.payments.map(p => (
                  <Row key={p.id}
                    title={p.userName ?? p.userEmail ?? "Unknown user"}
                    subtitle={`$${(p.priceSnapshot / 100).toFixed(2)} · ${p.paymentStatus}`}
                    meta={relativeTime(p.createdAt)}
                    badge={<Badge variant={p.status === "approved" ? "default" : "outline"} className="capitalize">{p.status}</Badge>} />
                ))}
          </Section>
        </div>

        {/* ── Right: sidebar ──────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Quick Actions */}
          <Card className="p-4">
            <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Cog className="h-4 w-4 text-muted-foreground" /> Quick Actions
            </p>
            {/* stretch grid so every cell is equal height */}
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ACTIONS.map(qa => (
                <button
                  key={qa.tab}
                  onClick={() => onNavigateTab(qa.tab)}
                  className="flex flex-col items-start gap-2 rounded-lg border border-border p-3 text-left w-full hover-elevate active-elevate-2 transition-colors"
                >
                  <qa.icon className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-xs font-medium text-foreground leading-tight">{qa.label}</span>
                </button>
              ))}
            </div>
          </Card>

          {/* System Status */}
          <Card className="p-4">
            <p className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" /> System Status
            </p>
            {loading
              ? <div className="space-y-2">{Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
              : data && (
                <div>
                  <StatusRow label="Database" status={data.systemStatus.database} />
                  <StatusRow label="API"      status={data.systemStatus.api} />
                  <StatusRow label="Workers"  status={data.systemStatus.workers} />
                  <StatusRow label="Queue"    status={data.systemStatus.queue.pending > 0 ? "processing" : "idle"} sub={`${data.systemStatus.queue.pending} pending`} />
                  <StatusRow label="SMTP"     status={data.systemStatus.smtp}  sub={`${data.systemStatus.mailboxHealthPct}% healthy`} />
                  <StatusRow label="IMAP"     status={data.systemStatus.imap} />
                </div>
              )}
          </Card>

          <Section
            title="Support Requests" icon={LifeBuoy}
            action={<button onClick={() => onNavigateTab("support")} className="text-xs text-primary hover:underline flex items-center gap-1">View all <ArrowRight className="h-3 w-3" /></button>}
            empty={!loading && (data?.recent.supportRequests.length ?? 0) === 0}
          >
            {loading
              ? Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
              : data?.recent.supportRequests.map(s => (
                  <Row key={s.id} title={s.subject} subtitle={s.userEmail} meta={relativeTime(s.createdAt)}
                    badge={<Badge variant={s.priority === "high" ? "destructive" : "outline"} className="capitalize">{s.priority}</Badge>} />
                ))}
          </Section>

          <Section
            title="Feature Requests" icon={Lightbulb}
            empty={!loading && (data?.recent.featureRequests.length ?? 0) === 0}
          >
            {loading
              ? Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
              : data?.recent.featureRequests.map(f => (
                  <Row key={f.id} title={f.title} meta={relativeTime(f.createdAt)}
                    badge={<Badge variant="outline" className="capitalize">{f.category}</Badge>} />
                ))}
          </Section>

          <Section
            title="Bug Reports" icon={Bug}
            empty={!loading && (data?.recent.bugReports.length ?? 0) === 0}
          >
            {loading
              ? Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
              : data?.recent.bugReports.map(b => (
                  <Row key={b.id} title={b.title} meta={relativeTime(b.createdAt)}
                    badge={<Badge variant={b.severity === "critical" || b.severity === "high" ? "destructive" : "outline"} className="capitalize">{b.severity}</Badge>} />
                ))}
          </Section>

          <Section
            title="Announcements" icon={Megaphone}
            empty={!loading && (data?.recent.announcements.length ?? 0) === 0}
          >
            {loading
              ? Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
              : data?.recent.announcements.map(a => (
                  <Row key={a.id} title={a.message} meta={relativeTime(a.createdAt)} />
                ))}
          </Section>

        </div>
      </div>
    </div>
  );
}
