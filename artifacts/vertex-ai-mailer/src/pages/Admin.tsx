import { useState, useEffect, useCallback } from "react";
import { AdminSettings } from "./AdminSettings";
import { AdminProductHub } from "./AdminProductHub";
import { AdminOverview } from "./admin/AdminOverview";
import { AdminUsers } from "./admin/AdminUsers";
import { AdminCampaigns } from "./admin/AdminCampaigns";
import { AdminMailboxes } from "./admin/AdminMailboxes";
import { AdminAnalytics } from "./admin/AdminAnalytics";
import { AdminSupport } from "./admin/AdminSupport";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Mail, BarChart3, Server, Zap, AlertCircle, CheckCircle2,
  RefreshCw, ShieldCheck, ChevronLeft,
  ChevronRight, Search, Filter, Activity, TrendingUp, MailCheck,
  UserCheck, Settings, Eye, Ban, Edit2,
  CreditCard, ArrowUpCircle, CheckCheck, X as XIcon, TicketCheck,
  Sparkles,
  Megaphone,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminStats {
  totalUsers: number; activeUsers: number;
  emailsSentToday: number; emailsSentMonth: number;
  smtpMailboxes: number; totalCampaigns: number;
  failedSends: number; totalDraftsCreated: number;
  totalLeads: number; gmailConnectedUsers: number;
}

interface AdminMailbox {
  id: number; userId: number; userName: string; userEmail: string;
  smtpHost: string; smtpPort: number; smtpUser: string;
  smtpSecure: string; fromName: string | null;
  isActive: boolean; emailsSent: number; createdAt: string;
}

interface AdminLog {
  id: number; type: string; severity: string;
  description: string; userId: number | null; createdAt: string;
}

interface AdminSettingsData {
  maintenanceMode: string; maxEmailsPerDay: string;
  maxLeadsPerUpload: string; platformName: string;
  defaultSmtpHost: string; emailLimitPerUser: string;
}

// ─── Billing types ────────────────────────────────────────────────────────────

interface AdminPlanRequest {
  id: number; userId: number; userName: string; userEmail: string;
  fromPlanName: string; toPlanName: string;
  fromPlanId: number | null; toPlanId: number;
  toPlanPrice: number;
  priceSnapshot: number;
  status: string; paymentStatus: string;
  adminNote: string | null; createdAt: string;
}

interface AdminPlan {
  id: number; name: string; slug: string; description: string;
  monthlyEmailLimit: number; smtpAccountsLimit: number;
  campaignsLimit: number; batchSendLimit: number;
  isActive: boolean; sortOrder: number;
}

interface AdminSub {
  userId: number; userName: string; userEmail: string;
  planName: string; planSlug: string; planId: number;
  billingStatus: string; status: string;
  monthlyEmailLimit: number;
  emailsSentThisMonth: number; smtpAccountsUsed: number;
  currentPeriodStart: string; currentPeriodEnd: string | null;
  stripeCustomerId: string | null; stripeSubscriptionId: string | null;
}

type Tab = "overview" | "users" | "campaigns" | "mailboxes" | "analytics" | "logs" | "settings" | "billing" | "support" | "product_hub";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/admin/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `Error ${res.status}`); }
  return res.json();
}

function relativeTime(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function StatCard({ icon: Icon, label, value, color, sub }: {
  icon: React.ElementType; label: string; value: number | string;
  color: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3 shadow-sm">
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="h-4.5 w-4.5 h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium truncate">{label}</p>
        <p className="text-xl font-bold text-slate-900 leading-tight">{value ?? 0}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const styles: Record<string, string> = {
    free:       "bg-muted text-muted-foreground",
    pro:        "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    enterprise: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${styles[plan] ?? styles.free}`}>
      {plan}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return status === "active"
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400"><Ban className="h-3 w-3" />Suspended</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    info:  "bg-blue-50 text-blue-700",
    warn:  "bg-amber-50 text-amber-700",
    error: "bg-red-50 text-red-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${map[severity] ?? map.info}`}>
      {severity}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",    label: "Overview",    icon: BarChart3 },
  { id: "users",       label: "Users",       icon: Users },
  { id: "campaigns",   label: "Campaigns",   icon: Megaphone },
  { id: "mailboxes",   label: "Mailboxes",   icon: Server },
  { id: "analytics",   label: "Analytics",   icon: TrendingUp },
  { id: "logs",        label: "Logs",        icon: Activity },
  { id: "settings",    label: "Settings",    icon: Settings },
  { id: "billing",     label: "Billing",     icon: CreditCard },
  { id: "support",     label: "Support",     icon: TicketCheck },
  { id: "product_hub", label: "Product Hub", icon: Sparkles },
];

export default function Admin() {
  const { toast } = useToast();
  const [tab, setTab]                 = useState<Tab>("overview");

  // Overview
  const [stats, setStats]             = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Mailboxes
  const [mailboxes, setMailboxes]     = useState<AdminMailbox[]>([]);
  const [mailboxesLoading, setMailboxesLoading] = useState(false);

  // Logs
  const [logs, setLogs]               = useState<AdminLog[]>([]);
  const [logsTotal, setLogsTotal]     = useState(0);
  const [logsPage, setLogsPage]       = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSeverity, setLogSeverity] = useState("all");
  const [logSearch, setLogSearch]     = useState("");

  // Settings
  const [settings, setSettings]       = useState<AdminSettingsData>({
    maintenanceMode: "false", maxEmailsPerDay: "1000",
    maxLeadsPerUpload: "10000", platformName: "BrokerMail AI",
    defaultSmtpHost: "", emailLimitPerUser: "500",
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [savingSettings, setSavingSettings]   = useState(false);

  // Billing
  const [planRequests, setPlanRequests]       = useState<AdminPlanRequest[]>([]);
  const [allPlans, setAllPlans]               = useState<AdminPlan[]>([]);
  const [allSubs, setAllSubs]                 = useState<AdminSub[]>([]);
  const [billingLoading, setBillingLoading]   = useState(false);
  const [editPlan, setEditPlan]               = useState<AdminPlan | null>(null);
  const [editPlanForm, setEditPlanForm]       = useState({ monthlyEmailLimit: 0, smtpAccountsLimit: 0, campaignsLimit: 0, batchSendLimit: 0 });
  const [savingPlan, setSavingPlan]           = useState(false);
  const [rejectModal, setRejectModal]         = useState<{ id: number; note: string } | null>(null);
  const [assignPlanModal, setAssignPlanModal] = useState<{ userId: number; userName: string; currentPlanId: number } | null>(null);
  const [markingPaid, setMarkingPaid]         = useState<number | null>(null);

  // ── Data fetchers ──────────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try { setStats(await apiFetch("stats")); }
    catch { /* silent */ }
    finally { setStatsLoading(false); }
  }, []);

  const loadMailboxes = useCallback(async () => {
    setMailboxesLoading(true);
    try { setMailboxes(await apiFetch("mailboxes")); }
    catch { /* silent */ }
    finally { setMailboxesLoading(false); }
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(logsPage), limit: "50",
        ...(logSeverity !== "all" && { severity: logSeverity }),
        ...(logSearch && { search: logSearch }),
      });
      const data = await apiFetch(`logs?${params}`);
      setLogs(data.data); setLogsTotal(data.total);
    } catch { /* silent */ }
    finally { setLogsLoading(false); }
  }, [logsPage, logSeverity, logSearch]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try { setSettings(await apiFetch("settings")); }
    catch { /* silent */ }
    finally { setSettingsLoading(false); }
  }, []);

  const loadBillingData = useCallback(async () => {
    setBillingLoading(true);
    try {
      const [requests, plans, subs] = await Promise.all([
        apiFetch("plan-requests?status=all"),
        apiFetch("plans"),
        apiFetch("subscriptions"),
      ]);
      setPlanRequests(requests);
      setAllPlans(plans);
      setAllSubs(subs);
    } catch { /* silent */ }
    finally { setBillingLoading(false); }
  }, []);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (tab === "mailboxes") loadMailboxes();}, [tab, loadMailboxes]);
  useEffect(() => { if (tab === "logs")      loadLogs();     }, [tab, loadLogs]);
  useEffect(() => { if (tab === "settings")  loadSettings(); }, [tab, loadSettings]);
  useEffect(() => { if (tab === "billing")   loadBillingData(); }, [tab, loadBillingData]);

  // ── User actions ───────────────────────────────────────────────────────────

  async function approvePlanRequest(id: number) {
    try {
      await apiFetch(`plan-requests/${id}/approve`, { method: "POST" });
      toast({ title: "Request approved" });
      loadBillingData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  }

  async function rejectPlanRequest(id: number, note: string) {
    try {
      await apiFetch(`plan-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) });
      toast({ title: "Request rejected" });
      setRejectModal(null);
      loadBillingData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  }

  async function savePlanConfig() {
    if (!editPlan) return;
    setSavingPlan(true);
    try {
      await apiFetch(`plans/save`, { method: "POST", body: JSON.stringify({ id: editPlan.id, ...editPlanForm }) });
      toast({ title: "Plan updated" });
      setEditPlan(null);
      loadBillingData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally { setSavingPlan(false); }
  }

  async function markRequestPaid(id: number) {
    setMarkingPaid(id);
    try {
      await apiFetch(`plan-requests/${id}/mark-paid`, { method: "POST", body: JSON.stringify({}) });
      toast({ title: "Payment marked", description: "Request payment status updated to paid." });
      loadBillingData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally { setMarkingPaid(null); }
  }

  async function doAssignPlan(userId: number, planId: number) {
    try {
      await apiFetch(`users/${userId}/assign-plan`, { method: "POST", body: JSON.stringify({ planId }) });
      toast({ title: "Plan assigned" });
      setAssignPlanModal(null);
      loadBillingData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      await apiFetch("settings", { method: "POST", body: JSON.stringify(settings) });
      toast({ title: "Settings saved" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally { setSavingSettings(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const logsPageCount  = Math.max(Math.ceil(logsTotal  / 50), 1);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Admin Dashboard</h1>
          <p className="text-slate-500 text-xs mt-0.5">BrokerMail AI · Platform management</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadStats} className="gap-1.5 rounded-xl">
          <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Compact stat cards — 2 cols mobile, 4 desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users}     label="Total Users"       value={statsLoading ? "—" : stats?.totalUsers ?? 0}       color="bg-blue-50 text-blue-600" />
        <StatCard icon={UserCheck} label="Active Users"      value={statsLoading ? "—" : stats?.activeUsers ?? 0}      color="bg-emerald-50 text-emerald-600" />
        <StatCard icon={Mail}      label="Emails Today"      value={statsLoading ? "—" : stats?.emailsSentToday ?? 0}  color="bg-blue-50 text-blue-600" />
        <StatCard icon={MailCheck} label="Emails This Month" value={statsLoading ? "—" : stats?.emailsSentMonth ?? 0} color="bg-indigo-50 text-indigo-600" />
        <StatCard icon={Server}    label="SMTP Connected"    value={statsLoading ? "—" : stats?.smtpMailboxes ?? 0}    color="bg-purple-50 text-purple-600" />
        <StatCard icon={BarChart3} label="Campaigns"         value={statsLoading ? "—" : stats?.totalCampaigns ?? 0}   color="bg-amber-50 text-amber-600" />
        <StatCard icon={AlertCircle} label="Failed Sends"   value={statsLoading ? "—" : stats?.failedSends ?? 0}      color="bg-red-50 text-red-600" />
        <StatCard icon={TrendingUp} label="Total Emails"    value={statsLoading ? "—" : stats?.totalDraftsCreated ?? 0} color="bg-teal-50 text-teal-600" />
      </div>

      {/* Tab nav */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-4 overflow-x-auto">
          <div className="flex gap-0.5 min-w-max">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
          {tab === "overview" && (
            <AdminOverview onNavigateTab={(t) => setTab(t as Tab)} />
          )}

          {/* ── USERS ────────────────────────────────────────────────────── */}
          {tab === "users" && <AdminUsers />}

          {/* ── CAMPAIGNS ────────────────────────────────────────────────── */}
          {tab === "campaigns" && (
            <AdminCampaigns onNavigateTab={(t) => setTab(t as Tab)} />
          )}

          {/* ── MAILBOXES ─────────────────────────────────────────────────── */}
          {tab === "mailboxes" && <AdminMailboxes />}

          {/* ── ANALYTICS ─────────────────────────────────────────────────── */}
          {tab === "analytics" && <AdminAnalytics />}

          {/* ── LOGS ──────────────────────────────────────────────────────── */}
          {tab === "logs" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <div className="flex gap-1">
                  {["all","info","warn","error"].map(s => (
                    <button key={s} onClick={() => { setLogSeverity(s); setLogsPage(1); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                        logSeverity === s
                          ? s === "error" ? "bg-red-600 text-white"
                          : s === "warn"  ? "bg-amber-500 text-white"
                          : s === "info"  ? "bg-blue-600 text-white"
                          : "bg-foreground text-background"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                      }`}>{s === "all" ? "All" : s}</button>
                  ))}
                </div>
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input placeholder="Search logs…" value={logSearch}
                    onChange={e => { setLogSearch(e.target.value); setLogsPage(1); }}
                    className="pl-8 h-8 rounded-xl text-sm" />
                </div>
                <Button variant="outline" size="sm" onClick={loadLogs} className="h-8 rounded-xl gap-1.5">
                  <RefreshCw className={`h-3.5 w-3.5 ${logsLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {logsLoading ? (
                <div className="space-y-2">{Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
              ) : logs.length === 0 ? (
                <div className="py-16 text-center">
                  <Activity className="h-10 w-10 mx-auto text-slate-200 mb-3" />
                  <p className="text-slate-400 text-sm">No logs found.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {logs.map(l => (
                    <div key={l.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-600/50">
                      <SeverityBadge severity={l.severity ?? "info"} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-slate-700 font-mono">{l.type}</span>
                          {l.userId && <span className="text-xs text-slate-400">uid:{l.userId}</span>}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{l.description}</p>
                      </div>
                      <p className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">{relativeTime(l.createdAt)}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 pt-1">
                <p className="text-xs text-slate-500">{logsTotal.toLocaleString()} entries</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg"
                    disabled={logsPage <= 1} onClick={() => setLogsPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-slate-600 min-w-[60px] text-center">{logsPage} / {logsPageCount}</span>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg"
                    disabled={logsPage >= logsPageCount} onClick={() => setLogsPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── SETTINGS ─────────────────────────────────────────────────── */}
          {tab === "settings" && (
            <AdminSettings />
          )}

          {/* ── BILLING ─────────────────────────────────────────────────── */}
          {tab === "billing" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Manage plans, subscriptions, and upgrade requests.</p>
                <Button variant="outline" size="sm" onClick={loadBillingData} className="gap-1.5 rounded-xl h-8">
                  <RefreshCw className={`h-3.5 w-3.5 ${billingLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {/* ── Pending plan requests ────────────────────── */}
              {(() => {
                const pending = planRequests.filter(r => r.status === "pending");
                return pending.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">Pending Upgrade Requests</p>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">{pending.length}</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {pending.map(r => {
                        const price = r.priceSnapshot ?? r.toPlanPrice ?? 0;
                        const fmtPrice = (c: number) => c === 0 ? "Free" : `${(c / 100).toFixed(0)}/mo`;
                        return (
                          <div key={r.id} className="bg-card border border-amber-500/30 rounded-2xl p-4 space-y-3 shadow-sm">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-foreground text-sm">{r.userName}</p>
                                <p className="text-xs text-muted-foreground">{r.userEmail}</p>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold">Pending</span>
                                {price > 0 && (
                                  <span className="text-xs font-bold text-primary">{fmtPrice(price)}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="px-2 py-0.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium">{r.fromPlanName || "None"}</span>
                              <ArrowUpCircle className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                              <span className="px-2 py-0.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold">{r.toPlanName}</span>
                            </div>
                            {/* Payment status */}
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                r.paymentStatus === "paid" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : r.paymentStatus === "not_required" ? "bg-muted text-muted-foreground"
                                : "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                              }`}>
                                {r.paymentStatus === "paid" ? "✓ Payment Received"
                                  : r.paymentStatus === "not_required" ? "No Payment Required"
                                  : "⏳ Payment Pending"}
                              </span>
                              {r.paymentStatus !== "paid" && price > 0 && (
                                <Button size="sm" variant="outline"
                                  className="h-6 text-[11px] rounded-lg px-2 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                                  disabled={markingPaid === r.id}
                                  onClick={() => markRequestPaid(r.id)}>
                                  {markingPaid === r.id ? "…" : "Mark Paid"}
                                </Button>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</p>
                            <div className="flex gap-2">
                              <Button size="sm" className="flex-1 h-8 rounded-xl gap-1.5 text-xs" onClick={() => approvePlanRequest(r.id)}>
                                <CheckCheck className="h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" className="flex-1 h-8 rounded-xl gap-1.5 text-xs text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/10"
                                onClick={() => setRejectModal({ id: r.id, note: "" })}>
                                <XIcon className="h-3.5 w-3.5" /> Reject
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">No pending upgrade requests.</p>
                  </div>
                );
              })()}

              {/* ── All plan requests history ─────────────────── */}
              {planRequests.filter(r => r.status !== "pending").length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground">Request History</p>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b border-border text-left">
                          {["User", "From", "To", "Price", "Payment", "Status", "Date"].map(h => (
                            <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {planRequests.filter(r => r.status !== "pending").slice(0, 15).map(r => {
                          const price = r.priceSnapshot ?? r.toPlanPrice ?? 0;
                          const fmtP = (c: number) => c === 0 ? "Free" : `${(c / 100).toFixed(0)}/mo`;
                          return (
                            <tr key={r.id} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                              <td className="px-4 py-2.5">
                                <p className="font-medium text-foreground text-xs">{r.userName}</p>
                                <p className="text-muted-foreground text-xs">{r.userEmail}</p>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.fromPlanName || "—"}</td>
                              <td className="px-4 py-2.5 text-xs font-semibold text-foreground">{r.toPlanName}</td>
                              <td className="px-4 py-2.5 text-xs font-semibold text-primary">{fmtP(price)}</td>
                              <td className="px-4 py-2.5">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  r.paymentStatus === "paid" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : r.paymentStatus === "not_required" ? "bg-muted text-muted-foreground"
                                  : "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                                }`}>
                                  {r.paymentStatus === "paid" ? "Paid"
                                    : r.paymentStatus === "not_required" ? "N/A"
                                    : "Unpaid"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  r.status === "approved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : r.status === "rejected" ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                  : "bg-muted text-muted-foreground"}`}>{r.status}</span>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── User subscriptions ───────────────────────── */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">User Subscriptions</p>
                {billingLoading ? (
                  <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
                ) : allSubs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No active subscriptions yet. Users get subscriptions when they visit Plans & Billing.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b border-border text-left">
                          {["User", "Plan", "Billing", "Emails Used", "SMTP", "Period Start", "Stripe Sub", "Actions"].map(h => (
                            <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allSubs.map(s => {
                          const unlimited = s.monthlyEmailLimit === -1;
                          const pct = unlimited ? 0 : Math.min((s.emailsSentThisMonth / Math.max(s.monthlyEmailLimit, 1)) * 100, 100);
                          return (
                            <tr key={s.userId} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                              <td className="px-4 py-3">
                                <p className="font-medium text-foreground text-xs">{s.userName}</p>
                                <p className="text-muted-foreground text-xs">{s.userEmail}</p>
                              </td>
                              <td className="px-4 py-3">
                                <PlanBadge plan={s.planSlug} />
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                                  s.billingStatus === "paid" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                                  {s.billingStatus}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2 min-w-[80px]">
                                  <span className="text-xs font-semibold text-foreground">{s.emailsSentThisMonth}</span>
                                  {!unlimited && (
                                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[40px]">
                                      <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-primary"}`}
                                        style={{ width: `${pct}%` }} />
                                    </div>
                                  )}
                                  <span className="text-xs text-muted-foreground">/ {unlimited ? "∞" : s.monthlyEmailLimit}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs font-semibold text-foreground">{s.smtpAccountsUsed}</td>
                              <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(s.currentPeriodStart).toLocaleDateString()}</td>
                              <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{s.stripeSubscriptionId ?? "—"}</td>
                              <td className="px-4 py-3">
                                <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg px-2"
                                  onClick={() => setAssignPlanModal({ userId: s.userId, userName: s.userName, currentPlanId: s.planId })}>
                                  Change Plan
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Plans config ─────────────────────────────── */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Plan Configuration</p>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-left">
                        {["Plan", "Emails/mo", "SMTP Accts", "Campaigns", "Batch Size", ""].map(h => (
                          <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allPlans.map(p => (
                        <tr key={p.id} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-3">
                            <PlanBadge plan={p.slug} />
                            <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                          </td>
                          {[p.monthlyEmailLimit, p.smtpAccountsLimit, p.campaignsLimit, p.batchSendLimit].map((v, i) => (
                            <td key={i} className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                              {v === -1 ? <span className="text-emerald-600 dark:text-emerald-400">∞</span> : v.toLocaleString()}
                            </td>
                          ))}
                          <td className="px-4 py-3">
                            <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg px-2 gap-1"
                              onClick={() => { setEditPlan(p); setEditPlanForm({ monthlyEmailLimit: p.monthlyEmailLimit, smtpAccountsLimit: p.smtpAccountsLimit, campaignsLimit: p.campaignsLimit, batchSendLimit: p.batchSendLimit }); }}>
                              <Edit2 className="h-3 w-3" /> Edit
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === "support" && (
            <div className="space-y-4">
              <AdminSupport />
            </div>
          )}

        </div>
      </div>

          {tab === "product_hub" && (
            <div className="space-y-6">
              <AdminProductHub />
            </div>
          )}

      {/* Reject plan request modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setRejectModal(null)} />
          <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-sm border border-border z-10 p-5 space-y-4">
            <h3 className="font-bold text-foreground">Reject Upgrade Request</h3>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reason (optional)</label>
              <textarea
                value={rejectModal.note}
                onChange={e => setRejectModal(r => r ? { ...r, note: e.target.value } : null)}
                placeholder="Let the user know why their request was rejected…"
                className="w-full h-24 px-3 py-2 rounded-xl border border-input bg-background text-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white gap-1.5"
                onClick={() => rejectPlanRequest(rejectModal.id, rejectModal.note)}>
                <XIcon className="h-4 w-4" /> Reject Request
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => setRejectModal(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Assign plan modal */}
      {assignPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAssignPlanModal(null)} />
          <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-sm border border-border z-10 p-5 space-y-4">
            <div>
              <h3 className="font-bold text-foreground">Assign Plan</h3>
              <p className="text-xs text-muted-foreground mt-0.5">for {assignPlanModal.userName}</p>
            </div>
            <div className="space-y-2">
              {allPlans.map(p => (
                <button key={p.id} onClick={() => doAssignPlan(assignPlanModal.userId, p.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-colors ${
                    p.id === assignPlanModal.currentPlanId
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/40 hover:bg-muted/50 text-foreground"
                  }`}>
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.monthlyEmailLimit === -1 ? "∞" : p.monthlyEmailLimit.toLocaleString()} emails/mo</span>
                  {p.id === assignPlanModal.currentPlanId && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
            <Button variant="outline" className="w-full rounded-xl" onClick={() => setAssignPlanModal(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Edit plan limits modal */}
      {editPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditPlan(null)} />
          <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-sm border border-border z-10 overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <CreditCard className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">Edit {editPlan.name} Plan</p>
                <p className="text-xs text-muted-foreground">Use -1 for unlimited</p>
              </div>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              {[
                { key: "monthlyEmailLimit",  label: "Emails/month" },
                { key: "smtpAccountsLimit",  label: "SMTP Accounts" },
                { key: "campaignsLimit",     label: "Campaigns" },
                { key: "batchSendLimit",     label: "Batch Size" },
              ].map(f => (
                <div key={f.key} className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{f.label}</label>
                  <Input type="number"
                    value={(editPlanForm as any)[f.key]}
                    onChange={e => setEditPlanForm(form => ({ ...form, [f.key]: parseInt(e.target.value) || 0 }))}
                    className="h-9 rounded-xl font-mono text-sm" />
                </div>
              ))}
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <Button className="flex-1 rounded-xl gap-1.5" onClick={savePlanConfig} disabled={savingPlan}>
                {savingPlan ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Saving…</> : "Save Limits"}
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => setEditPlan(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
