/**
 * AdminAnalytics.tsx — Phase 10: Executive Analytics
 * Email Volume, User Growth, Campaign Growth, Open Rate, Bounce Rate, Active Users
 */
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  TrendingUp, Mail, Users, BarChart3, RefreshCw, Percent,
  CheckCircle2, XCircle, Eye, Megaphone,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayPoint   { date: string; sent: number; failed: number; }
interface UserPoint  { date: string; new: number; }
interface CampPoint  { date: string; new: number; }

interface AnalyticsOverview {
  emailByDay:    DayPoint[];
  userByDay:     UserPoint[];
  campaignByDay: CampPoint[];
  totals: {
    emailsSent: number; emailsFailed: number; emailsBounced: number;
    openCount: number; openRate: number; bounceRate: number;
    totalUsers: number; activeUsers30d: number;
    campaignsByStatus: Record<string, number>;
  };
  days: number;
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
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

// ─── Chart Section ────────────────────────────────────────────────────────────

function ChartSection({ title, children, loading }: {
  title: string; children: React.ReactNode; loading: boolean;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-foreground mb-4">{title}</p>
      {loading ? <Skeleton className="h-52 w-full rounded-xl" /> : children}
    </Card>
  );
}

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
    borderRadius: "8px", fontSize: "12px",
  },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 600 },
};

// ─── Campaign Status Bar ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  sending:     "bg-blue-500",
  completed:   "bg-emerald-500",
  paused:      "bg-amber-500",
  cooling_down:"bg-orange-500",
  failed:      "bg-red-500",
  draft:       "bg-muted-foreground",
  pending:     "bg-indigo-500",
  queued:      "bg-violet-500",
};

function CampaignStatusBar({ data, loading }: { data: Record<string, number>; loading: boolean; }) {
  const total = Object.values(data).reduce((s, n) => s + n, 0);
  if (loading) return <Skeleton className="h-8 w-full rounded-full" />;
  if (total === 0) return <p className="text-xs text-muted-foreground py-2">No campaigns yet.</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
        {Object.entries(data).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
          <div
            key={s}
            className={`h-full ${STATUS_COLORS[s] ?? "bg-muted"}`}
            style={{ width: `${Math.max((n / total) * 100, 1)}%` }}
            title={`${s}: ${n}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(data).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
          <span key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[s] ?? "bg-muted-foreground"}`} />
            {s.replace(/_/g, " ")} ({n})
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function AdminAnalytics() {
  const [data, setData]       = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays]       = useState(30);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const d = await apiFetch(`analytics/overview?days=${days}`);
      setData(d);
    } catch { /* silent */ } finally { setLoading(false); setRefreshing(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  // Sparse x-axis: show every N-th label
  const emailChartData = (data?.emailByDay ?? []).map(d => ({
    ...d, label: shortDate(d.date),
  }));
  const userChartData = (data?.userByDay ?? []).map(d => ({
    ...d, label: shortDate(d.date),
  }));
  const campChartData = (data?.campaignByDay ?? []).map(d => ({
    ...d, label: shortDate(d.date),
  }));

  const tick = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };
  const t = data?.totals;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold text-foreground">Platform Analytics</p>
        <div className="flex items-center gap-2">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                days === d
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}d
            </button>
          ))}
          <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5 ml-1" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Mail}         label="Emails Sent"      value={t?.emailsSent      ?? 0} sub={`Last ${days} days`}   accent="blue"    loading={loading} />
        <StatCard icon={CheckCircle2} label="Open Rate"        value={t ? fmtPct(t.openRate)  : "—"} sub={`${t?.openCount?.toLocaleString() ?? 0} opens`} accent="emerald" loading={loading} />
        <StatCard icon={XCircle}      label="Bounce Rate"      value={t ? fmtPct(t.bounceRate) : "—"} sub={`${t?.emailsFailed?.toLocaleString() ?? 0} failed`} accent="red"     loading={loading} />
        <StatCard icon={Users}        label="Active Users"     value={t?.activeUsers30d  ?? 0} sub="Last 30 days"          accent="violet"  loading={loading} />
        <StatCard icon={Users}        label="Total Users"      value={t?.totalUsers      ?? 0} sub="All time"              accent="indigo"  loading={loading} />
        <StatCard icon={Mail}         label="Emails Failed"    value={t?.emailsFailed    ?? 0} sub={`Last ${days} days`}   accent="orange"  loading={loading} />
        <StatCard icon={Eye}          label="Total Opens"      value={t?.openCount       ?? 0} sub={`Last ${days} days`}   accent="teal"    loading={loading} />
        <StatCard icon={Megaphone}    label="MRR"              value="—"                        sub="Lemon Squeezy not yet connected" accent="amber"   loading={false} />
      </div>

      {/* Email delivery chart */}
      <ChartSection title={`Email Delivery — Last ${days} days`} loading={loading}>
        {emailChartData.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No email data in this period.</div>
        ) : (
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={emailChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={tick} interval={Math.max(Math.floor(emailChartData.length / 7) - 1, 0)} />
              <YAxis allowDecimals={false} tick={tick} />
              <ReTooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Bar dataKey="sent"   name="Sent"   stackId="a" fill="hsl(217 91% 60%)"  radius={[0,0,0,0]} />
              <Bar dataKey="failed" name="Failed" stackId="a" fill="hsl(0 84% 60%)"    radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartSection>

      {/* User + Campaign growth charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSection title={`User Growth — Last ${days} days`} loading={loading}>
          {userChartData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No user data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={userChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={tick} interval={Math.max(Math.floor(userChartData.length / 5) - 1, 0)} />
                <YAxis allowDecimals={false} tick={tick} />
                <ReTooltip {...TOOLTIP_STYLE} />
                <Line dataKey="new" name="New Users" type="monotone" stroke="hsl(263 70% 50%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartSection>

        <ChartSection title={`Campaign Growth — Last ${days} days`} loading={loading}>
          {campChartData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No campaign data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={campChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={tick} interval={Math.max(Math.floor(campChartData.length / 5) - 1, 0)} />
                <YAxis allowDecimals={false} tick={tick} />
                <ReTooltip {...TOOLTIP_STYLE} />
                <Line dataKey="new" name="New Campaigns" type="monotone" stroke="hsl(142 76% 36%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartSection>
      </div>

      {/* Campaign status breakdown */}
      <Card className="p-5">
        <p className="text-sm font-semibold text-foreground mb-4">Campaign Status Breakdown</p>
        <CampaignStatusBar data={t?.campaignsByStatus ?? {}} loading={loading} />
      </Card>

    </div>
  );
}
