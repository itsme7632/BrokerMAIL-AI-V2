/**
 * AdminAnalytics.tsx — Phase 11: Admin Analytics
 *
 * Full-platform analytics dashboard: overview cards, trend charts, leaderboard
 * tables, date-range filters, and CSV/Excel/PDF export. Revenue/MRR/ARR are
 * intentionally left as "billing integration required" placeholders — no
 * payment processor (Lemon Squeezy) is connected yet, so these are never
 * estimated from subscription rows.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  Mail, Users, RefreshCw, CheckCircle2, XCircle, Eye, MousePointerClick,
  Megaphone, UserMinus, ShieldAlert, DollarSign, TrendingUp, Server,
  PieChart as PieChartIcon, CalendarRange, Download, FileSpreadsheet, FileText,
  UserCheck, Crown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type RangeKey = "today" | "7d" | "30d" | "90d" | "custom";

interface Cards {
  totalUsers: number; activeUsers: number; trialUsers: number; payingUsers: number;
  campaignsSent: number; emailsSent: number;
  smtpSuccessRate: number; gmailSuccessRate: number;
  openRate: number; bounceRate: number; clickRate: number;
  unsubscribes: number; suppressions: number;
  revenue: null; mrr: null; arr: null;
}

interface Overview {
  range: { label: string; start: string; end: string };
  cards: Cards;
  charts: {
    emailVolume: { date: string; gmail: number; smtp: number; total: number }[];
    userGrowth: { date: string; new: number }[];
    campaignActivity: { date: string; new: number }[];
    subscriptionGrowth: { date: string; new: number }[];
    openRateTrend: { date: string; rate: number }[];
    bounceTrend: { date: string; rate: number }[];
    smtpVsGmail: { smtp: number; gmail: number };
    mailboxProviders: { provider: string; count: number }[];
    planDistribution: { plan: string; count: number }[];
    revenueGrowth: null;
  };
  tables: {
    topCustomers: { userId: number; name: string; email: string; plan: string; gmailSent: number; smtpSent: number; totalSent: number }[];
    mostActiveUsers: { userId: number; name: string; email: string; lastActiveAt: string | null; campaignCount: number }[];
    topCampaigns: { id: number; name: string; status: string; sentCount: number; totalLeads: number; userName: string | null; createdAt: string }[];
    largestMailboxes: { id: number; smtpHost: string; smtpUser: string; userName: string | null; sendCount: number; provider: string }[];
  };
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

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
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

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
    borderRadius: "8px", fontSize: "12px",
  },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 600 },
};

const PIE_COLORS = [
  "hsl(217 91% 60%)", "hsl(142 76% 36%)", "hsl(263 70% 50%)", "hsl(38 92% 50%)",
  "hsl(0 84% 60%)", "hsl(199 89% 48%)", "hsl(280 65% 60%)",
];

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, accent, loading }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; accent: string; loading: boolean;
}) {
  const ACCENTS: Record<string, string> = {
    blue:    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    red:     "bg-red-500/10 text-red-600 dark:text-red-400",
    violet:  "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    teal:    "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    indigo:  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    orange:  "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    slate:   "bg-muted text-muted-foreground",
  };
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ACCENTS[accent]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
        {loading ? <Skeleton className="h-6 w-16 mt-1" /> : (
          <>
            <p className="text-xl font-bold text-foreground leading-tight">{typeof value === "number" ? value.toLocaleString() : value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

function ChartSection({ title, children, loading, empty }: {
  title: string; children: React.ReactNode; loading: boolean; empty?: boolean;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-foreground mb-4">{title}</p>
      {loading ? <Skeleton className="h-52 w-full rounded-xl" /> : empty ? (
        <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No data in this period.</div>
      ) : children}
    </Card>
  );
}

// ─── Export helpers ──────────────────────────────────────────────────────────

function rangeQuery(range: RangeKey, customStart?: Date, customEnd?: Date): string {
  if (range === "custom" && customStart && customEnd) {
    return `range=custom&start=${customStart.toISOString()}&end=${customEnd.toISOString()}`;
  }
  return `range=${range}`;
}

async function downloadExport(format: "csv" | "xlsx", qs: string) {
  const res = await fetch(`/api/admin/analytics/export?format=${format}&${qs}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `analytics.${format}`;
  const disposition = res.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="(.+)"/);
  if (match) a.download = match[1];
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printPdf(data: Overview | null) {
  if (!data) return;
  const c = data.cards;
  const win = window.open("", "_blank");
  if (!win) return;
  const rows = [
    ["Total Users", c.totalUsers], ["Active Users", c.activeUsers],
    ["Trial Users", c.trialUsers], ["Paying Users", c.payingUsers],
    ["Campaigns Sent", c.campaignsSent], ["Emails Sent", c.emailsSent],
    ["SMTP Success Rate", fmtPct(c.smtpSuccessRate)], ["Gmail Success Rate", fmtPct(c.gmailSuccessRate)],
    ["Open Rate", fmtPct(c.openRate)], ["Bounce Rate", fmtPct(c.bounceRate)],
    ["Click Rate", fmtPct(c.clickRate)], ["Unsubscribes", c.unsubscribes],
    ["Suppressions", c.suppressions],
  ];
  win.document.write(`
    <html><head><title>Admin Analytics — ${data.range.label}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;color:#1e293b;}
      h1{font-size:20px;margin-bottom:4px;} p.sub{color:#64748b;margin-top:0;margin-bottom:24px;font-size:13px;}
      table{width:100%;border-collapse:collapse;} td{padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;}
      td:first-child{color:#64748b;} td:last-child{text-align:right;font-weight:600;}
    </style></head><body>
    <h1>Platform Analytics</h1>
    <p class="sub">Range: ${data.range.label} · ${new Date(data.range.start).toLocaleDateString()} – ${new Date(data.range.end).toLocaleDateString()}</p>
    <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
    </body></html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function AdminAnalytics() {
  const [data, setData]             = useState<Overview | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange]           = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd]     = useState<Date | undefined>();
  const [customOpen, setCustomOpen]   = useState(false);

  const qs = useMemo(() => rangeQuery(range, customStart, customEnd), [range, customStart, customEnd]);

  const load = useCallback(async (silent = false) => {
    if (range === "custom" && (!customStart || !customEnd)) return;
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const d = await apiFetch(`analytics/overview?${qs}`);
      setData(d);
    } catch { /* silent */ } finally { setLoading(false); setRefreshing(false); }
  }, [qs, range, customStart, customEnd]);

  useEffect(() => { load(); }, [load]);

  const c = data?.cards;
  const tick = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };

  const emailChartData = (data?.charts.emailVolume ?? []).map(d => ({ ...d, label: shortDate(d.date) }));
  const userChartData = (data?.charts.userGrowth ?? []).map(d => ({ ...d, label: shortDate(d.date) }));
  const campChartData = (data?.charts.campaignActivity ?? []).map(d => ({ ...d, label: shortDate(d.date) }));
  const subChartData = (data?.charts.subscriptionGrowth ?? []).map(d => ({ ...d, label: shortDate(d.date) }));
  const openTrendData = (data?.charts.openRateTrend ?? []).map(d => ({ ...d, label: shortDate(d.date) }));
  const bounceTrendData = (data?.charts.bounceTrend ?? []).map(d => ({ ...d, label: shortDate(d.date) }));
  const providerData = data?.charts.mailboxProviders ?? [];
  const planData = data?.charts.planDistribution ?? [];
  const smtpVsGmail = data ? [
    { name: "Gmail", value: data.charts.smtpVsGmail.gmail },
    { name: "SMTP", value: data.charts.smtpVsGmail.smtp },
  ] : [];

  return (
    <div className="space-y-5">

      {/* Header + Filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold text-foreground">Platform Analytics</p>
        <div className="flex items-center gap-2 flex-wrap">
          {(["today", "7d", "30d", "90d"] as RangeKey[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                range === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {r === "today" ? "Today" : r}
            </button>
          ))}
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <button
                onClick={() => setRange("custom")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1 ${
                  range === "custom" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <CalendarRange className="h-3 w-3" />
                {range === "custom" && customStart && customEnd
                  ? `${customStart.toLocaleDateString()} – ${customEnd.toLocaleDateString()}`
                  : "Custom"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="end">
              <Calendar
                mode="range"
                selected={customStart && customEnd ? { from: customStart, to: customEnd } : undefined}
                onSelect={(r: any) => {
                  setCustomStart(r?.from);
                  setCustomEnd(r?.to);
                  if (r?.from && r?.to) setCustomOpen(false);
                }}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>

          <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadExport("csv", qs)}>
                <FileText className="h-3.5 w-3.5 mr-2" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadExport("xlsx", qs)}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-2" /> Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => printPdf(data)}>
                <FileText className="h-3.5 w-3.5 mr-2" /> PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard icon={DollarSign}        label="Revenue"           value="—" sub="Billing integration required" accent="slate" loading={false} />
        <StatCard icon={TrendingUp}        label="MRR"               value="—" sub="Billing integration required" accent="slate" loading={false} />
        <StatCard icon={TrendingUp}        label="ARR"               value="—" sub="Billing integration required" accent="slate" loading={false} />
        <StatCard icon={Users}             label="Active Users"      value={c?.activeUsers ?? 0} sub="Currently active" accent="violet" loading={loading} />
        <StatCard icon={UserCheck}         label="Trial Users"       value={c?.trialUsers ?? 0} sub="Free plan" accent="teal" loading={loading} />
        <StatCard icon={Crown}             label="Paying Users"      value={c?.payingUsers ?? 0} sub="Paid plans" accent="amber" loading={loading} />
        <StatCard icon={Megaphone}         label="Campaigns Sent"    value={c?.campaignsSent ?? 0} sub={data ? data.range.label : ""} accent="indigo" loading={loading} />
        <StatCard icon={Mail}              label="Emails Sent"       value={c?.emailsSent ?? 0} sub={data ? data.range.label : ""} accent="blue" loading={loading} />
        <StatCard icon={Server}            label="SMTP Success Rate" value={c ? fmtPct(c.smtpSuccessRate) : "—"} accent="teal" loading={loading} />
        <StatCard icon={CheckCircle2}      label="Gmail Success Rate" value={c ? fmtPct(c.gmailSuccessRate) : "—"} accent="emerald" loading={loading} />
        <StatCard icon={Eye}               label="Open Rate"         value={c ? fmtPct(c.openRate) : "—"} accent="emerald" loading={loading} />
        <StatCard icon={XCircle}           label="Bounce Rate"       value={c ? fmtPct(c.bounceRate) : "—"} accent="red" loading={loading} />
        <StatCard icon={MousePointerClick} label="Click Rate"        value={c ? fmtPct(c.clickRate) : "—"} accent="violet" loading={loading} />
        <StatCard icon={UserMinus}         label="Unsubscribes"      value={c?.unsubscribes ?? 0} sub={data ? data.range.label : ""} accent="orange" loading={loading} />
        <StatCard icon={ShieldAlert}       label="Suppressions"      value={c?.suppressions ?? 0} sub={data ? data.range.label : ""} accent="red" loading={loading} />
      </div>

      {/* Email delivery + user/campaign growth */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSection title="Email Volume (Gmail vs SMTP)" loading={loading} empty={emailChartData.length === 0}>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={emailChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={tick} interval={Math.max(Math.floor(emailChartData.length / 7) - 1, 0)} />
              <YAxis allowDecimals={false} tick={tick} />
              <ReTooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Bar dataKey="gmail" name="Gmail" stackId="a" fill="hsl(217 91% 60%)" />
              <Bar dataKey="smtp"  name="SMTP"  stackId="a" fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="Revenue Growth" loading={false}>
          <div className="h-52 flex flex-col items-center justify-center text-sm text-muted-foreground gap-1.5">
            <DollarSign className="h-6 w-6 opacity-40" />
            Billing integration required
          </div>
        </ChartSection>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSection title="User Growth" loading={loading} empty={userChartData.length === 0}>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={userChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={tick} interval={Math.max(Math.floor(userChartData.length / 5) - 1, 0)} />
              <YAxis allowDecimals={false} tick={tick} />
              <ReTooltip {...TOOLTIP_STYLE} />
              <Line dataKey="new" name="New Users" type="monotone" stroke="hsl(263 70% 50%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="Campaign Activity" loading={loading} empty={campChartData.length === 0}>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={campChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={tick} interval={Math.max(Math.floor(campChartData.length / 5) - 1, 0)} />
              <YAxis allowDecimals={false} tick={tick} />
              <ReTooltip {...TOOLTIP_STYLE} />
              <Line dataKey="new" name="New Campaigns" type="monotone" stroke="hsl(142 76% 36%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSection title="Open Rate Trend" loading={loading} empty={openTrendData.length === 0}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={openTrendData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={tick} interval={Math.max(Math.floor(openTrendData.length / 5) - 1, 0)} />
              <YAxis tick={tick} unit="%" />
              <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, "Open Rate"]} />
              <Line dataKey="rate" name="Open Rate" type="monotone" stroke="hsl(160 84% 39%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="Bounce Trend" loading={loading} empty={bounceTrendData.length === 0}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={bounceTrendData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={tick} interval={Math.max(Math.floor(bounceTrendData.length / 5) - 1, 0)} />
              <YAxis tick={tick} unit="%" />
              <ReTooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, "Bounce Rate"]} />
              <Line dataKey="rate" name="Bounce Rate" type="monotone" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>
      </div>

      <ChartSection title="Subscription Growth" loading={loading} empty={subChartData.length === 0}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={subChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={tick} interval={Math.max(Math.floor(subChartData.length / 7) - 1, 0)} />
            <YAxis allowDecimals={false} tick={tick} />
            <ReTooltip {...TOOLTIP_STYLE} />
            <Bar dataKey="new" name="New Subscriptions" fill="hsl(263 70% 50%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartSection>

      {/* Distribution charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartSection title="Mailbox Providers" loading={loading} empty={providerData.length === 0}>
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie data={providerData} dataKey="count" nameKey="provider" cx="50%" cy="50%" outerRadius={70} label={({ provider }: any) => provider}>
                {providerData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <ReTooltip {...TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="SMTP vs Gmail Usage" loading={loading} empty={!data || (smtpVsGmail[0].value === 0 && smtpVsGmail[1].value === 0)}>
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie data={smtpVsGmail} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name }: any) => name}>
                {smtpVsGmail.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <ReTooltip {...TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="Plan Distribution" loading={loading} empty={planData.length === 0}>
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie data={planData} dataKey="count" nameKey="plan" cx="50%" cy="50%" outerRadius={70} label={({ plan }: any) => plan}>
                {planData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <ReTooltip {...TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </ChartSection>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><PieChartIcon className="h-3.5 w-3.5" /> Top Customers</p>
          {loading ? <Skeleton className="h-40 w-full rounded-xl" /> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>User</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">Sent</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(data?.tables.topCustomers ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-6">No data yet.</TableCell></TableRow>
                )}
                {(data?.tables.topCustomers ?? []).map(u => (
                  <TableRow key={u.userId}>
                    <TableCell><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email}</p></TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{u.plan}</Badge></TableCell>
                    <TableCell className="text-right font-semibold">{u.totalSent.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Most Active Users</p>
          {loading ? <Skeleton className="h-40 w-full rounded-xl" /> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>User</TableHead><TableHead>Campaigns</TableHead><TableHead className="text-right">Last Active</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(data?.tables.mostActiveUsers ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-6">No data yet.</TableCell></TableRow>
                )}
                {(data?.tables.mostActiveUsers ?? []).map(u => (
                  <TableRow key={u.userId}>
                    <TableCell><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email}</p></TableCell>
                    <TableCell>{u.campaignCount}</TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs">{relativeTime(u.lastActiveAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Top Campaigns</p>
          {loading ? <Skeleton className="h-40 w-full rounded-xl" /> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Campaign</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Sent</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(data?.tables.topCampaigns ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-6">No data yet.</TableCell></TableRow>
                )}
                {(data?.tables.topCampaigns ?? []).map(cm => (
                  <TableRow key={cm.id}>
                    <TableCell><p className="font-medium">{cm.name}</p><p className="text-xs text-muted-foreground">{cm.userName ?? "—"}</p></TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{cm.status.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-right font-semibold">{cm.sentCount.toLocaleString()} / {cm.totalLeads.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><Server className="h-3.5 w-3.5" /> Largest Mailboxes</p>
          {loading ? <Skeleton className="h-40 w-full rounded-xl" /> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Mailbox</TableHead><TableHead>Provider</TableHead><TableHead className="text-right">Sent</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(data?.tables.largestMailboxes ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-6">No data yet.</TableCell></TableRow>
                )}
                {(data?.tables.largestMailboxes ?? []).map(m => (
                  <TableRow key={m.id}>
                    <TableCell><p className="font-medium">{m.smtpUser}</p><p className="text-xs text-muted-foreground">{m.userName ?? "—"}</p></TableCell>
                    <TableCell><Badge variant="secondary">{m.provider}</Badge></TableCell>
                    <TableCell className="text-right font-semibold">{m.sendCount.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

    </div>
  );
}
