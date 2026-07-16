import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search, RefreshCw, ChevronLeft, ChevronRight, MoreVertical, Eye, LogIn,
  Ban, CheckCircle2, XCircle, KeyRound, RotateCcw, ArrowUpCircle, Trash2,
  Crown, ShieldOff, Users as UsersIcon, AlertCircle, Download,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AdminUser {
  id: number; name: string; email: string;
  avatarUrl: string | null; companyName: string | null;
  role: string; plan: string; credits: number; status: string;
  gmailConnected: boolean; smtpConnected: boolean;
  emailsSent: number; campaignsCount: number;
  subscriptionPlanName: string | null; subscriptionBillingStatus: string | null;
  createdAt: string; lastActiveAt: string | null;
}

interface PlanOption { id: number; name: string; slug: string; }

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

function Avatar({ user }: { user: AdminUser }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt={user.name} className="h-8 w-8 rounded-full object-cover flex-shrink-0" />;
  }
  return (
    <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
      {initials(user.name || user.email)}
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  return <Badge variant="outline" className="capitalize">{plan}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  return status === "active"
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400"><Ban className="h-3 w-3" />Suspended</span>;
}

const FILTERS = [
  { key: "role" as const,   label: "Role",   options: ["all", "user", "admin"] },
  { key: "plan" as const,   label: "Plan",   options: ["all", "free", "pro", "enterprise"] },
  { key: "status" as const, label: "Status", options: ["all", "active", "suspended"] },
];

// ─── Change plan modal ──────────────────────────────────────────────────────

function ChangePlanModal({ user, planOptions, onClose, onAssign }: {
  user: AdminUser; planOptions: PlanOption[]; onClose: () => void;
  onAssign: (planId: number) => Promise<void>;
}) {
  const [planId, setPlanId] = useState<number | null>(planOptions[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative w-full max-w-sm z-10 p-5">
        <p className="font-semibold text-foreground text-sm mb-1">Change plan</p>
        <p className="text-xs text-muted-foreground mb-4">{user.name} · {user.email}</p>
        <select value={planId ?? ""} onChange={e => setPlanId(Number(e.target.value))}
          className="w-full h-9 px-3 rounded-lg border border-input text-sm bg-background text-foreground mb-4">
          {planOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!planId || saving} onClick={async () => {
            if (!planId) return;
            setSaving(true);
            try { await onAssign(planId); onClose(); } finally { setSaving(false); }
          }}>
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Assign plan"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

// ─── View user drawer ───────────────────────────────────────────────────────

function ViewUserModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Company", user.companyName ?? "—"],
    ["Email", user.email],
    ["Plan", user.plan],
    ["Subscription", user.subscriptionPlanName ? `${user.subscriptionPlanName} (${user.subscriptionBillingStatus ?? "—"})` : "No active subscription"],
    ["Status", user.status],
    ["Role", user.role],
    ["Credits", String(user.credits)],
    ["Campaigns", String(user.campaignsCount)],
    ["Emails sent", String(user.emailsSent)],
    ["Gmail connected", user.gmailConnected ? "Yes" : "No"],
    ["SMTP connected", user.smtpConnected ? "Yes" : "No"],
    ["Created", new Date(user.createdAt).toLocaleString()],
    ["Last active", relativeTime(user.lastActiveAt)],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative w-full max-w-md z-10 p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <Avatar user={user} />
          <div>
            <p className="font-semibold text-foreground text-sm">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-xs font-medium text-foreground text-right">{value}</span>
            </div>
          ))}
        </div>
        <Button variant="outline" className="w-full mt-4" onClick={onClose}>Close</Button>
      </Card>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AdminUsers() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ role: "all", plan: "all", status: "all" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [viewUser, setViewUser] = useState<AdminUser | null>(null);
  const [planUser, setPlanUser] = useState<AdminUser | null>(null);
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const pageCount = Math.max(Math.ceil(total / 20), 1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: "20",
        ...(search && { search }),
        ...(filters.role   !== "all" && { role: filters.role }),
        ...(filters.plan   !== "all" && { plan: filters.plan }),
        ...(filters.status !== "all" && { status: filters.status }),
      });
      const data = await apiFetch(`users?${params}`);
      setUsers(data.data); setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, search, filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiFetch("plans").then((p: PlanOption[]) => setPlanOptions(p)).catch(() => {}); }, []);
  useEffect(() => { setSelected(new Set()); }, [users]);

  const allSelected = users.length > 0 && users.every(u => selected.has(u.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(users.map(u => u.id)));
  }
  function toggleOne(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function saveUser(id: number, updates: Record<string, unknown>) {
    await apiFetch("users/save", { method: "POST", body: JSON.stringify({ id, ...updates }) });
    toast({ title: "User updated" });
    load();
  }

  async function toggleSuspend(u: AdminUser) {
    await saveUser(u.id, { status: u.status === "active" ? "suspended" : "active" });
  }

  async function toggleAdmin(u: AdminUser) {
    await saveUser(u.id, { role: u.role === "admin" ? "user" : "admin" });
  }

  async function deleteUser(u: AdminUser) {
    if (!confirm(`Delete "${u.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch("users/remove", { method: "POST", body: JSON.stringify({ id: u.id }) });
      toast({ title: "User deleted" });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function loginAsUser(u: AdminUser) {
    try {
      const { token: impersonationToken } = await apiFetch(`users/${u.id}/login-as`, { method: "POST" });
      window.open(`/auth/callback?token=${encodeURIComponent(impersonationToken)}`, "_blank");
      toast({ title: `Opened a new session as ${u.name}` });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function sendResetEmail(u: AdminUser) {
    try {
      const r = await apiFetch(`users/${u.id}/send-reset-email`, { method: "POST" });
      toast({ title: "Reset email sent", description: r.message });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function setTempPassword(u: AdminUser) {
    if (!confirm(`Generate a temporary password for ${u.name}?`)) return;
    try {
      const r = await apiFetch(`users/${u.id}/set-temp-password`, { method: "POST" });
      alert(`Temporary password for ${u.email}:\n\n${r.temporaryPassword}\n\nShare this with the user securely.`);
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function resetUsage(u: AdminUser) {
    try {
      await apiFetch(`users/${u.id}/reset-usage`, { method: "POST" });
      toast({ title: "Usage period reset", description: `${u.name}'s billing period has been restarted.` });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function assignPlan(userId: number, planId: number) {
    await apiFetch(`users/${userId}/assign-plan`, { method: "POST", body: JSON.stringify({ planId }) });
    toast({ title: "Plan assigned" });
    load();
  }

  async function runBulk(action: string, extra?: Record<string, unknown>) {
    if (selected.size === 0) return;
    const labels: Record<string, string> = {
      suspend: "suspend", activate: "activate", delete: "permanently delete", upgrade: "upgrade",
    };
    if ((action === "delete" || action === "suspend") &&
      !confirm(`${action === "delete" ? "Permanently delete" : "Suspend"} ${selected.size} user(s)? ${action === "delete" ? "This cannot be undone." : ""}`)) return;

    setBusyAction(action);
    try {
      await apiFetch("users/bulk", { method: "POST", body: JSON.stringify({ action, ids: Array.from(selected), ...extra }) });
      toast({ title: `Bulk ${labels[action] ?? action} complete`, description: `${selected.size} user(s) affected.` });
      setSelected(new Set());
      load();
    } catch (e) {
      toast({ variant: "destructive", title: "Bulk action failed", description: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusyAction(null);
    }
  }

  function exportSelected() {
    const rows = users.filter(u => selected.has(u.id));
    const header = ["Name", "Email", "Company", "Plan", "Status", "Created"];
    const csv = [header.join(","), ...rows.map(u => [u.name, u.email, u.companyName ?? "", u.plan, u.status, u.createdAt].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "users-export.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm font-medium text-foreground">Couldn't load users</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search name or email…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 h-9 rounded-xl text-sm" />
        </div>
        {FILTERS.map(f => (
          <select key={f.key} value={filters[f.key]}
            onChange={e => { setFilters(v => ({ ...v, [f.key]: e.target.value })); setPage(1); }}
            className="h-9 px-3 rounded-xl border border-input text-sm bg-background text-foreground">
            {f.options.map(o => <option key={o} value={o}>{o === "all" ? `All ${f.label}s` : o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
          </select>
        ))}
        <Button size="sm" variant="outline" onClick={load} aria-label="Refresh" className="h-9 rounded-xl gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <p className="text-xs font-medium text-foreground">{selected.size} selected</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!!busyAction} onClick={() => runBulk("activate")}><CheckCircle2 className="h-3 w-3" />Activate</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!!busyAction} onClick={() => runBulk("suspend")}><Ban className="h-3 w-3" />Suspend</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!!busyAction} onClick={exportSelected}><Download className="h-3 w-3" />Export</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" disabled={!!busyAction} onClick={() => runBulk("delete")}><Trash2 className="h-3 w-3" />Delete</Button>
          </div>
        </div>
      )}

      {/* Table — desktop */}
      <div className="hidden lg:block overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left border-b border-border">
              <th className="px-3 py-2.5 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-input" />
              </th>
              {["User", "Company", "Plan", "Subscription", "Status", "Campaigns", "Emails", "Gmail", "SMTP", "Created", "Last Login", ""].map(h => (
                <th key={h} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? Array(5).fill(0).map((_, i) => (
              <tr key={i} className="border-b border-border/60">
                {Array(12).fill(0).map((_, j) => <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-16" /></td>)}
              </tr>
            )) : users.length === 0 ? (
              <tr><td colSpan={12} className="px-4 py-12 text-center text-muted-foreground text-sm">
                <UsersIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No users found.
              </td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                <td className="px-3 py-3">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)} className="rounded border-input" />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar user={u} />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground text-sm truncate">{u.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">{u.companyName ?? "—"}</td>
                <td className="px-3 py-3"><PlanBadge plan={u.plan} /></td>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{u.subscriptionPlanName ?? "—"}</td>
                <td className="px-3 py-3"><StatusBadge status={u.status} /></td>
                <td className="px-3 py-3 text-xs font-semibold text-foreground">{u.campaignsCount}</td>
                <td className="px-3 py-3 text-xs font-semibold text-foreground">{u.emailsSent.toLocaleString()}</td>
                <td className="px-3 py-3">{u.gmailConnected ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-muted-foreground/40" />}</td>
                <td className="px-3 py-3">{u.smtpConnected ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-muted-foreground/40" />}</td>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{relativeTime(u.lastActiveAt)}</td>
                <td className="px-3 py-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label="User actions" className="h-7 w-7 p-0 rounded-lg"><MoreVertical className="h-3.5 w-3.5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => setViewUser(u)} className="gap-2 text-sm"><Eye className="h-3.5 w-3.5" /> View</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => loginAsUser(u)} className="gap-2 text-sm"><LogIn className="h-3.5 w-3.5" /> Login as user</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => toggleSuspend(u)} className="gap-2 text-sm">
                        {u.status === "active" ? <><Ban className="h-3.5 w-3.5 text-amber-500" /> Suspend</> : <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Activate</>}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleAdmin(u)} className="gap-2 text-sm">
                        {u.role === "admin" ? <><ShieldOff className="h-3.5 w-3.5" /> Remove admin</> : <><Crown className="h-3.5 w-3.5" /> Make admin</>}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => sendResetEmail(u)} className="gap-2 text-sm"><KeyRound className="h-3.5 w-3.5" /> Send reset email</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTempPassword(u)} className="gap-2 text-sm"><KeyRound className="h-3.5 w-3.5" /> Set temp password</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => resetUsage(u)} className="gap-2 text-sm"><RotateCcw className="h-3.5 w-3.5" /> Reset usage</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPlanUser(u)} className="gap-2 text-sm"><ArrowUpCircle className="h-3.5 w-3.5" /> Change plan</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => deleteUser(u)} className="gap-2 text-sm text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5" /> Delete user</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards — mobile/tablet */}
      <div className="lg:hidden space-y-3">
        {loading ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />) :
          users.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <UsersIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />No users found.
            </div>
          ) : users.map(u => (
            <Card key={u.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)} className="rounded border-input flex-shrink-0" />
                  <Avatar user={u} />
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <StatusBadge status={u.status} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label="User actions" className="h-7 w-7 p-0 rounded-lg"><MoreVertical className="h-3.5 w-3.5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => setViewUser(u)} className="gap-2 text-sm"><Eye className="h-3.5 w-3.5" /> View</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => loginAsUser(u)} className="gap-2 text-sm"><LogIn className="h-3.5 w-3.5" /> Login as user</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleSuspend(u)} className="gap-2 text-sm">{u.status === "active" ? <><Ban className="h-3.5 w-3.5" />Suspend</> : <><CheckCircle2 className="h-3.5 w-3.5" />Activate</>}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => sendResetEmail(u)} className="gap-2 text-sm"><KeyRound className="h-3.5 w-3.5" />Send reset email</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => resetUsage(u)} className="gap-2 text-sm"><RotateCcw className="h-3.5 w-3.5" />Reset usage</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPlanUser(u)} className="gap-2 text-sm"><ArrowUpCircle className="h-3.5 w-3.5" />Change plan</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => deleteUser(u)} className="gap-2 text-sm text-destructive"><Trash2 className="h-3.5 w-3.5" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <PlanBadge plan={u.plan} />
                {u.role === "admin" && <Badge className="gap-1"><Crown className="h-3 w-3" />Admin</Badge>}
                {u.gmailConnected && <Badge variant="outline">Gmail</Badge>}
                {u.smtpConnected && <Badge variant="outline">SMTP</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{u.companyName ?? "No company"} · {u.campaignsCount} campaigns · {u.emailsSent} emails</p>
              <p className="text-xs text-muted-foreground">Joined {new Date(u.createdAt).toLocaleDateString()} · Last active {relativeTime(u.lastActiveAt)}</p>
            </Card>
          ))
        }
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <p className="text-xs text-muted-foreground">{total} user{total !== 1 ? "s" : ""} total</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" aria-label="Previous page" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground min-w-[60px] text-center">{page} / {pageCount}</span>
          <Button variant="outline" size="sm" aria-label="Next page" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {viewUser && <ViewUserModal user={viewUser} onClose={() => setViewUser(null)} />}
      {planUser && (
        <ChangePlanModal user={planUser} planOptions={planOptions} onClose={() => setPlanUser(null)}
          onAssign={(planId) => assignPlan(planUser.id, planId)} />
      )}
    </div>
  );
}
