import { useState, useEffect, useCallback } from "react";
import { AdminSettings } from "./AdminSettings";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Mail, BarChart3, Server, Zap, AlertCircle, CheckCircle2,
  XCircle, RefreshCw, Trash2, ShieldCheck, ShieldOff, ChevronLeft,
  ChevronRight, Search, Filter, Activity, TrendingUp, MailCheck,
  UserCheck, Settings, Eye, MoreVertical, Crown, Ban, Edit2,
  CreditCard, ArrowUpCircle, CheckCheck, X as XIcon,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminStats {
  totalUsers: number; activeUsers: number;
  emailsSentToday: number; emailsSentMonth: number;
  smtpMailboxes: number; totalCampaigns: number;
  failedSends: number; totalDraftsCreated: number;
  totalLeads: number; gmailConnectedUsers: number;
}

interface AdminUser {
  id: number; name: string; email: string;
  role: string; plan: string; credits: number; status: string;
  gmailConnected: boolean; smtpConnected: boolean;
  emailsSent: number; createdAt: string; lastActiveAt: string | null;
}

interface AdminMailbox {
  id: number; userId: number; userName: string; userEmail: string;
  smtpHost: string; smtpPort: number; smtpUser: string;
  smtpSecure: string; fromName: string | null;
  isActive: boolean; emailsSent: number; createdAt: string;
}

interface AnalyticsDay { date: string; sent: number; failed: number; }

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
  status: string; adminNote: string | null; createdAt: string;
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

type Tab = "overview" | "users" | "mailboxes" | "analytics" | "logs" | "settings" | "billing";

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
    free:       "bg-slate-100 text-slate-600",
    pro:        "bg-blue-100 text-blue-700",
    enterprise: "bg-purple-100 text-purple-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${styles[plan] ?? styles.free}`}>
      {plan}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return status === "active"
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600"><Ban className="h-3 w-3" />Suspended</span>;
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

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function AnalyticsChart({ data }: { data: AnalyticsDay[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const maxVal = Math.max(...data.map(d => d.sent + d.failed), 1);
  const totalSent   = data.reduce((s, d) => s + d.sent, 0);
  const totalFailed = data.reduce((s, d) => s + d.failed, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-blue-500 inline-block" />Sent ({totalSent.toLocaleString()})</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-red-400 inline-block" />Failed ({totalFailed.toLocaleString()})</span>
      </div>

      <div className="relative h-44 flex items-end gap-[2px] bg-slate-50/60 rounded-xl px-3 pb-6 pt-3 border border-slate-100">
        {data.map((d, i) => {
          const sentH   = maxVal > 0 ? (d.sent   / maxVal) * 100 : 0;
          const failedH = maxVal > 0 ? (d.failed / maxVal) * 100 : 0;
          const isHov = hovered === i;
          return (
            <div
              key={i}
              className="relative flex-1 flex flex-col justify-end gap-[1px] cursor-pointer group"
              style={{ minWidth: 0, height: "100%" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {failedH > 0 && (
                <div className="w-full rounded-t-[2px] bg-red-400 transition-opacity" style={{ height: `${failedH}%`, minHeight: "2px", opacity: isHov ? 1 : 0.75 }} />
              )}
              <div className="w-full rounded-t-[2px] bg-blue-500 transition-opacity" style={{ height: `${sentH}%`, minHeight: d.sent > 0 ? "2px" : "0" , opacity: isHov ? 1 : 0.8 }} />

              {isHov && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 bg-slate-900 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-xl pointer-events-none">
                  <p className="font-semibold">{new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                  <p>✉ {d.sent} sent</p>
                  {d.failed > 0 && <p className="text-red-300">✗ {d.failed} failed</p>}
                </div>
              )}
            </div>
          );
        })}
        {/* X-axis labels */}
        <div className="absolute bottom-1 left-3 right-3 flex justify-between text-[10px] text-slate-400 pointer-events-none">
          {data.length > 0 && <span>{new Date(data[0].date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
          {data.length > 14 && <span>{new Date(data[Math.floor(data.length / 2)].date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
          {data.length > 0 && <span>{new Date(data[data.length - 1].date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── User Edit Modal ──────────────────────────────────────────────────────────

function EditUserModal({ user, onClose, onSave }: {
  user: AdminUser; onClose: () => void;
  onSave: (updates: Partial<AdminUser>) => Promise<void>;
}) {
  const [form, setForm] = useState({ plan: user.plan, credits: user.credits, role: user.role, status: user.status });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    setSaving(true);
    try { await onSave(form); onClose(); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden z-10">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <Edit2 className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 text-sm">{user.name}</p>
            <p className="text-xs text-slate-500">{user.email}</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Plan</label>
              <select value={form.plan} onChange={e => set("plan", e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-slate-200 text-sm bg-white">
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Credits</label>
              <Input type="number" value={form.credits} min={0}
                onChange={e => set("credits", parseInt(e.target.value) || 0)}
                className="h-9 rounded-xl text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</label>
              <select value={form.role} onChange={e => set("role", e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-slate-200 text-sm bg-white">
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-slate-200 text-sm bg-white">
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <Button className="flex-1 rounded-xl gap-1.5" onClick={handleSave} disabled={saving}>
            {saving ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Saving…</> : "Save changes"}
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",   label: "Overview",   icon: BarChart3 },
  { id: "users",      label: "Users",      icon: Users },
  { id: "mailboxes",  label: "Mailboxes",  icon: Server },
  { id: "analytics",  label: "Analytics",  icon: TrendingUp },
  { id: "logs",       label: "Logs",       icon: Activity },
  { id: "settings",   label: "Settings",   icon: Settings },
  { id: "billing",    label: "Billing",    icon: CreditCard },
];

export default function Admin() {
  const { toast } = useToast();
  const [tab, setTab]                 = useState<Tab>("overview");

  // Overview
  const [stats, setStats]             = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Users
  const [users, setUsers]             = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal]   = useState(0);
  const [usersPage, setUsersPage]     = useState(1);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSearch, setUsersSearch] = useState("");
  const [usersRole, setUsersRole]     = useState("all");
  const [usersPlan, setUsersPlan]     = useState("all");
  const [usersStatus, setUsersStatus] = useState("all");
  const [editUser, setEditUser]       = useState<AdminUser | null>(null);

  // Mailboxes
  const [mailboxes, setMailboxes]     = useState<AdminMailbox[]>([]);
  const [mailboxesLoading, setMailboxesLoading] = useState(false);

  // Analytics
  const [analytics, setAnalytics]     = useState<AnalyticsDay[]>([]);
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

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

  // ── Data fetchers ──────────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try { setStats(await apiFetch("stats")); }
    catch { /* silent */ }
    finally { setStatsLoading(false); }
  }, []);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(usersPage), limit: "20",
        ...(usersSearch && { search: usersSearch }),
        ...(usersRole   !== "all" && { role: usersRole }),
        ...(usersPlan   !== "all" && { plan: usersPlan }),
        ...(usersStatus !== "all" && { status: usersStatus }),
      });
      const data = await apiFetch(`users?${params}`);
      setUsers(data.data); setUsersTotal(data.total);
    } catch { /* silent */ }
    finally { setUsersLoading(false); }
  }, [usersPage, usersSearch, usersRole, usersPlan, usersStatus]);

  const loadMailboxes = useCallback(async () => {
    setMailboxesLoading(true);
    try { setMailboxes(await apiFetch("mailboxes")); }
    catch { /* silent */ }
    finally { setMailboxesLoading(false); }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try { setAnalytics(await apiFetch(`analytics?days=${analyticsDays}`)); }
    catch { /* silent */ }
    finally { setAnalyticsLoading(false); }
  }, [analyticsDays]);

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
  useEffect(() => { if (tab === "users")     loadUsers();    }, [tab, loadUsers]);
  useEffect(() => { if (tab === "mailboxes") loadMailboxes();}, [tab, loadMailboxes]);
  useEffect(() => { if (tab === "analytics") loadAnalytics();}, [tab, loadAnalytics, analyticsDays]);
  useEffect(() => { if (tab === "logs")      loadLogs();     }, [tab, loadLogs]);
  useEffect(() => { if (tab === "settings")  loadSettings(); }, [tab, loadSettings]);
  useEffect(() => { if (tab === "billing")   loadBillingData(); }, [tab, loadBillingData]);

  // ── User actions ───────────────────────────────────────────────────────────

  async function saveUser(id: number, updates: Partial<AdminUser>) {
    await apiFetch(`users/${id}`, { method: "PATCH", body: JSON.stringify(updates) });
    toast({ title: "User updated" });
    loadUsers();
  }

  async function deleteUser(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`users/${id}`, { method: "DELETE" });
      toast({ title: "User deleted" });
      loadUsers();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  }

  async function toggleSuspend(user: AdminUser) {
    const newStatus = user.status === "active" ? "suspended" : "active";
    await saveUser(user.id, { status: newStatus });
  }

  async function toggleAdmin(user: AdminUser) {
    const newRole = user.role === "admin" ? "user" : "admin";
    await saveUser(user.id, { role: newRole });
  }

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
      await apiFetch(`plans/${editPlan.id}`, { method: "PUT", body: JSON.stringify(editPlanForm) });
      toast({ title: "Plan updated" });
      setEditPlan(null);
      loadBillingData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally { setSavingPlan(false); }
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
      await apiFetch("settings", { method: "PUT", body: JSON.stringify(settings) });
      toast({ title: "Settings saved" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally { setSavingSettings(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const usersPageCount = Math.max(Math.ceil(usersTotal / 20), 1);
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
            <div className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Platform Overview</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ["Total Users",     stats?.totalUsers],
                      ["Gmail Connected", stats?.gmailConnectedUsers],
                      ["SMTP Mailboxes",  stats?.smtpMailboxes],
                      ["Total Leads",     stats?.totalLeads],
                      ["Campaigns Run",   stats?.totalCampaigns],
                      ["Failed Sends",    stats?.failedSends],
                    ].map(([label, val]) => (
                      <div key={label as string} className="flex justify-between items-center py-1 border-b border-slate-100 last:border-0">
                        <span className="text-slate-500 text-xs">{label}</span>
                        <span className="font-semibold text-slate-800 text-sm">{statsLoading ? "…" : val ?? 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Email Volume</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-slate-400">Today</p>
                      <p className="text-2xl font-bold text-slate-900">{statsLoading ? "…" : stats?.emailsSentToday ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">This Month</p>
                      <p className="text-2xl font-bold text-blue-600">{statsLoading ? "…" : stats?.emailsSentMonth ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">All Time</p>
                      <p className="text-2xl font-bold text-slate-900">{statsLoading ? "…" : stats?.totalDraftsCreated ?? 0}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="text-center py-8 text-slate-400 text-sm">
                <Activity className="h-8 w-8 mx-auto mb-2 text-slate-200" />
                Navigate tabs above to manage users, mailboxes, analytics, logs, and settings.
              </div>
            </div>
          )}

          {/* ── USERS ────────────────────────────────────────────────────── */}
          {tab === "users" && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="Search name or email…"
                    value={usersSearch}
                    onChange={e => { setUsersSearch(e.target.value); setUsersPage(1); }}
                    className="pl-8 h-9 rounded-xl text-sm"
                  />
                </div>
                {[
                  { label: "Role",   value: usersRole,   setter: setUsersRole,   options: ["all","user","admin"] },
                  { label: "Plan",   value: usersPlan,   setter: setUsersPlan,   options: ["all","free","pro","enterprise"] },
                  { label: "Status", value: usersStatus, setter: setUsersStatus, options: ["all","active","suspended"] },
                ].map(f => (
                  <select key={f.label} value={f.value}
                    onChange={e => { f.setter(e.target.value); setUsersPage(1); }}
                    className="h-9 px-3 rounded-xl border border-slate-200 text-sm bg-white text-slate-700">
                    {f.options.map(o => <option key={o} value={o}>{o === "all" ? `All ${f.label}s` : o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
                  </select>
                ))}
                <Button size="sm" variant="outline" onClick={loadUsers} className="h-9 rounded-xl gap-1.5">
                  <RefreshCw className={`h-3.5 w-3.5 ${usersLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {/* Table — desktop */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left border-b border-slate-100">
                      {["User", "Plan", "Credits", "Emails", "Gmail", "SMTP", "Status", "Joined", "Last Active", ""].map(h => (
                        <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usersLoading ? Array(5).fill(0).map((_, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        {Array(10).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>)}
                      </tr>
                    )) : users.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400 text-sm">No users found.</td></tr>
                    ) : users.map(u => (
                      <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-slate-900 text-sm">{u.name}</p>
                            <p className="text-xs text-slate-400">{u.email}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3"><PlanBadge plan={u.plan} /></td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{u.credits}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800 text-xs">{u.emailsSent.toLocaleString()}</td>
                        <td className="px-4 py-3">
                          {u.gmailConnected
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            : <XCircle className="h-4 w-4 text-slate-300" />}
                        </td>
                        <td className="px-4 py-3">
                          {u.smtpConnected
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            : <XCircle className="h-4 w-4 text-slate-300" />}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{relativeTime(u.lastActiveAt)}</td>
                        <td className="px-4 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => setEditUser(u)} className="gap-2 text-sm">
                                <Edit2 className="h-3.5 w-3.5" /> Edit user
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => toggleAdmin(u)} className="gap-2 text-sm">
                                {u.role === "admin"
                                  ? <><ShieldOff className="h-3.5 w-3.5" /> Remove admin</>
                                  : <><Crown className="h-3.5 w-3.5" /> Make admin</>}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => toggleSuspend(u)} className="gap-2 text-sm">
                                {u.status === "active"
                                  ? <><Ban className="h-3.5 w-3.5 text-amber-500" /> Suspend</>
                                  : <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Activate</>}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => deleteUser(u.id, u.name)} className="gap-2 text-sm text-red-600 focus:text-red-600 focus:bg-red-50">
                                <Trash2 className="h-3.5 w-3.5" /> Delete user
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cards — mobile */}
              <div className="md:hidden space-y-3">
                {usersLoading ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />) :
                  users.map(u => (
                    <div key={u.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 text-sm truncate">{u.name}</p>
                          <p className="text-xs text-slate-400 truncate">{u.email}</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <StatusBadge status={u.status} />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => setEditUser(u)} className="gap-2 text-sm"><Edit2 className="h-3.5 w-3.5" /> Edit</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => toggleAdmin(u)} className="gap-2 text-sm">{u.role === "admin" ? <><ShieldOff className="h-3.5 w-3.5" />Remove admin</> : <><Crown className="h-3.5 w-3.5" />Make admin</>}</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => toggleSuspend(u)} className="gap-2 text-sm">{u.status === "active" ? <><Ban className="h-3.5 w-3.5" />Suspend</> : <><CheckCircle2 className="h-3.5 w-3.5" />Activate</>}</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => deleteUser(u.id, u.name)} className="gap-2 text-sm text-red-600"><Trash2 className="h-3.5 w-3.5" />Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <PlanBadge plan={u.plan} />
                        {u.role === "admin" && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700"><Crown className="h-3 w-3" />Admin</span>}
                        {u.gmailConnected && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">Gmail</span>}
                        {u.smtpConnected  && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700">SMTP</span>}
                      </div>
                      <p className="text-xs text-slate-400">{u.emailsSent} emails · Joined {new Date(u.createdAt).toLocaleDateString()}</p>
                    </div>
                  ))
                }
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <p className="text-xs text-slate-500">{usersTotal} user{usersTotal !== 1 ? "s" : ""} total</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg"
                    disabled={usersPage <= 1} onClick={() => setUsersPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-slate-600 min-w-[60px] text-center">
                    {usersPage} / {usersPageCount}
                  </span>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg"
                    disabled={usersPage >= usersPageCount} onClick={() => setUsersPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── MAILBOXES ─────────────────────────────────────────────────── */}
          {tab === "mailboxes" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">{mailboxes.length}</span> connected SMTP mailbox{mailboxes.length !== 1 ? "es" : ""}</p>
                <Button variant="outline" size="sm" onClick={loadMailboxes} className="gap-1.5 rounded-xl h-8">
                  <RefreshCw className={`h-3.5 w-3.5 ${mailboxesLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {mailboxesLoading ? (
                <div className="space-y-2">
                  {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
                </div>
              ) : mailboxes.length === 0 ? (
                <div className="py-16 text-center">
                  <Server className="h-10 w-10 mx-auto text-slate-200 mb-3" />
                  <p className="text-slate-500 text-sm">No SMTP mailboxes configured yet.</p>
                  <p className="text-slate-400 text-xs mt-1">Users connect mailboxes from their Mailbox Settings page.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-left">
                        {["User", "SMTP Address", "Provider", "Security", "Emails Sent", "Status", "Connected"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mailboxes.map(m => (
                        <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900 text-sm">{m.userName ?? "—"}</p>
                            <p className="text-xs text-slate-400">{m.userEmail ?? "—"}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-mono text-slate-700">{m.smtpUser}</p>
                            <p className="text-xs text-slate-400">{m.fromName ?? ""}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 font-mono">{m.smtpHost}:{m.smtpPort}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 uppercase">{m.smtpSecure}</span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-800 text-xs">{m.emailsSent.toLocaleString()}</td>
                          <td className="px-4 py-3">
                            {m.isActive
                              ? <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active</span>
                              : <span className="flex items-center gap-1 text-xs text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-slate-300" />Inactive</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{new Date(m.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── ANALYTICS ─────────────────────────────────────────────────── */}
          {tab === "analytics" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">Email Delivery Analytics</p>
                <div className="flex gap-1.5">
                  {[7, 14, 30, 90].map(d => (
                    <button key={d} onClick={() => setAnalyticsDays(d)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        analyticsDays === d
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}>{d}d</button>
                  ))}
                </div>
              </div>

              {analyticsLoading ? (
                <Skeleton className="h-48 w-full rounded-xl" />
              ) : (
                <AnalyticsChart data={analytics} />
              )}

              {/* Summary grid */}
              {!analyticsLoading && analytics.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Total Sent",   value: analytics.reduce((s, d) => s + d.sent, 0), color: "text-blue-700", bg: "bg-blue-50" },
                    { label: "Total Failed", value: analytics.reduce((s, d) => s + d.failed, 0), color: "text-red-600", bg: "bg-red-50" },
                    { label: "Success Rate", value: (() => {
                      const s = analytics.reduce((a, d) => a + d.sent, 0);
                      const f = analytics.reduce((a, d) => a + d.failed, 0);
                      return s + f > 0 ? `${Math.round(s / (s + f) * 100)}%` : "—";
                    })(), color: "text-emerald-700", bg: "bg-emerald-50" },
                    { label: "Daily Average", value: Math.round(analytics.reduce((s, d) => s + d.sent, 0) / analytics.length), color: "text-slate-700", bg: "bg-slate-50" },
                  ].map(c => (
                    <div key={c.label} className={`${c.bg} rounded-xl p-3 border border-slate-100`}>
                      <p className="text-xs text-slate-500">{c.label}</p>
                      <p className={`text-xl font-bold mt-0.5 ${c.color}`}>{c.value.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
                          : "bg-slate-800 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
                    <div key={l.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
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
                <p className="text-sm text-slate-500">Manage plans, subscriptions, and upgrade requests.</p>
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
                      <p className="text-sm font-semibold text-slate-800">Pending Upgrade Requests</p>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">{pending.length}</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {pending.map(r => (
                        <div key={r.id} className="bg-white border border-amber-200 rounded-2xl p-4 space-y-3 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-slate-900 text-sm">{r.userName}</p>
                              <p className="text-xs text-slate-400">{r.userEmail}</p>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">Pending</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium">{r.fromPlanName || "None"}</span>
                            <ArrowUpCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                            <span className="px-2 py-0.5 rounded-lg bg-blue-100 text-blue-700 text-xs font-semibold">{r.toPlanName}</span>
                          </div>
                          <p className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</p>
                          <div className="flex gap-2">
                            <Button size="sm" className="flex-1 h-8 rounded-xl gap-1.5 text-xs" onClick={() => approvePlanRequest(r.id)}>
                              <CheckCheck className="h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 h-8 rounded-xl gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => setRejectModal({ id: r.id, note: "" })}>
                              <XIcon className="h-3.5 w-3.5" /> Reject
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                    <p className="text-sm text-emerald-800">No pending upgrade requests.</p>
                  </div>
                );
              })()}

              {/* ── All plan requests history ─────────────────── */}
              {planRequests.filter(r => r.status !== "pending").length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-800">Request History</p>
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-left">
                          {["User", "From", "To", "Status", "Date"].map(h => (
                            <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {planRequests.filter(r => r.status !== "pending").slice(0, 10).map(r => (
                          <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-800 text-xs">{r.userName}</p>
                              <p className="text-slate-400 text-xs">{r.userEmail}</p>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500">{r.fromPlanName || "—"}</td>
                            <td className="px-4 py-2.5 text-xs font-semibold text-slate-700">{r.toPlanName}</td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                r.status === "approved" ? "bg-emerald-100 text-emerald-700"
                                : r.status === "rejected" ? "bg-red-100 text-red-600"
                                : "bg-slate-100 text-slate-500"}`}>{r.status}</span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── User subscriptions ───────────────────────── */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-800">User Subscriptions</p>
                {billingLoading ? (
                  <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
                ) : allSubs.length === 0 ? (
                  <p className="text-sm text-slate-400 py-6 text-center">No active subscriptions yet. Users get subscriptions when they visit Plans & Billing.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-left">
                          {["User", "Plan", "Billing", "Emails Used", "SMTP", "Period Start", "Stripe Sub", "Actions"].map(h => (
                            <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allSubs.map(s => {
                          const unlimited = s.monthlyEmailLimit === -1;
                          const pct = unlimited ? 0 : Math.min((s.emailsSentThisMonth / Math.max(s.monthlyEmailLimit, 1)) * 100, 100);
                          return (
                            <tr key={s.userId} className="border-b border-slate-50 hover:bg-slate-50/60">
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900 text-xs">{s.userName}</p>
                                <p className="text-slate-400 text-xs">{s.userEmail}</p>
                              </td>
                              <td className="px-4 py-3">
                                <PlanBadge plan={s.planSlug} />
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                                  s.billingStatus === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                                  {s.billingStatus}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2 min-w-[80px]">
                                  <span className="text-xs font-semibold text-slate-800">{s.emailsSentThisMonth}</span>
                                  {!unlimited && (
                                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[40px]">
                                      <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-blue-500"}`}
                                        style={{ width: `${pct}%` }} />
                                    </div>
                                  )}
                                  <span className="text-xs text-slate-400">/ {unlimited ? "∞" : s.monthlyEmailLimit}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs font-semibold text-slate-700">{s.smtpAccountsUsed}</td>
                              <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{new Date(s.currentPeriodStart).toLocaleDateString()}</td>
                              <td className="px-4 py-3 text-xs font-mono text-slate-400">{s.stripeSubscriptionId ?? "—"}</td>
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
                <p className="text-sm font-semibold text-slate-800">Plan Configuration</p>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-left">
                        {["Plan", "Emails/mo", "SMTP Accts", "Campaigns", "Batch Size", ""].map(h => (
                          <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allPlans.map(p => (
                        <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <PlanBadge plan={p.slug} />
                            <p className="text-xs text-slate-400 mt-0.5">{p.description}</p>
                          </td>
                          {[p.monthlyEmailLimit, p.smtpAccountsLimit, p.campaignsLimit, p.batchSendLimit].map((v, i) => (
                            <td key={i} className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">
                              {v === -1 ? <span className="text-emerald-600">∞</span> : v.toLocaleString()}
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

        </div>
      </div>

      {/* User edit modal */}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSave={updates => saveUser(editUser.id, updates)}
        />
      )}

      {/* Reject plan request modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setRejectModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 z-10 p-5 space-y-4">
            <h3 className="font-bold text-slate-900">Reject Upgrade Request</h3>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Reason (optional)</label>
              <textarea
                value={rejectModal.note}
                onChange={e => setRejectModal(r => r ? { ...r, note: e.target.value } : null)}
                placeholder="Let the user know why their request was rejected…"
                className="w-full h-24 px-3 py-2 rounded-xl border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 gap-1.5"
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
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 z-10 p-5 space-y-4">
            <div>
              <h3 className="font-bold text-slate-900">Assign Plan</h3>
              <p className="text-xs text-slate-500 mt-0.5">for {assignPlanModal.userName}</p>
            </div>
            <div className="space-y-2">
              {allPlans.map(p => (
                <button key={p.id} onClick={() => doAssignPlan(assignPlanModal.userId, p.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-colors ${
                    p.id === assignPlanModal.currentPlanId
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
                  }`}>
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-slate-500">{p.monthlyEmailLimit === -1 ? "∞" : p.monthlyEmailLimit.toLocaleString()} emails/mo</span>
                  {p.id === assignPlanModal.currentPlanId && <CheckCircle2 className="h-4 w-4 text-blue-600" />}
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
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 z-10 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <CreditCard className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-sm">Edit {editPlan.name} Plan</p>
                <p className="text-xs text-slate-500">Use -1 for unlimited</p>
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
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{f.label}</label>
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
