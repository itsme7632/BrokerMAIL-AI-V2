import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  User, Mail, Shield, Settings, Server, CreditCard,
  CheckCircle2, AlertCircle, Zap, BarChart3, Send,
  ChevronRight, Lock, Globe, Loader2, Activity,
  Megaphone, CalendarDays, Hash, Link as LinkIcon,
  Sun, Moon,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getPlanBadge(planName: string) {
  const n = planName.toLowerCase();
  if (n.includes("enterprise"))
    return { cls: "bg-amber-500/15 border-amber-500/30 text-amber-400", dot: "bg-amber-400" };
  if (n.includes("growth") || n.includes("pro"))
    return { cls: "bg-purple-500/15 border-purple-500/30 text-purple-400", dot: "bg-purple-400" };
  if (n.includes("starter"))
    return { cls: "bg-blue-500/15 border-blue-500/30 text-blue-400", dot: "bg-blue-400" };
  return { cls: "bg-slate-500/15 border-slate-500/30 text-slate-400", dot: "bg-slate-400" };
}

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: "bg-red-500" };
  if (score <= 2) return { score, label: "Fair", color: "bg-orange-500" };
  if (score <= 3) return { score, label: "Good", color: "bg-yellow-500" };
  return { score, label: "Strong", color: "bg-green-500" };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface BillingData {
  plan: { name: string; slug: string; monthlyEmailLimit: number; smtpAccountsLimit: number };
  usage: { emailsSentThisMonth: number; smtpAccountsUsed: number };
}

interface DashStats {
  totalCampaigns: number;
  totalDraftsCreated: number;
  draftSuccessRate: number;
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function SectionCard({
  iconColor,
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  iconColor: string;
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
      <div className="px-6 py-4 border-b border-border dark:border-slate-800 flex items-center gap-3">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 ${iconColor}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground dark:text-slate-100">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MyProfile() {
  const { user, refreshUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

  // Remote data
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [dashStats, setDashStats] = useState<DashStats | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // Profile form
  const [profileForm, setProfileForm] = useState({ name: "", timezone: "UTC" });
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form
  const [pwForm, setPwForm] = useState({ current: "", newPw: "", confirm: "" });
  const [savingPw, setSavingPw] = useState(false);

  // Sync form from user
  useEffect(() => {
    if (user) {
      setProfileForm({
        name: user.name ?? "",
        timezone: (user as any).timezone ?? "UTC",
      });
    }
  }, [user]);

  // Fetch billing + stats
  useEffect(() => {
    const headers = getAuthHeaders();
    Promise.all([
      fetch("/api/billing/subscription", { headers }).then(r => r.ok ? r.json() : null),
      fetch("/api/dashboard/stats", { headers }).then(r => r.ok ? r.json() : null),
    ])
      .then(([billingData, statsData]) => {
        if (billingData) setBilling(billingData);
        if (statsData) setDashStats(statsData);
      })
      .finally(() => setLoadingData(false));
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profileForm.name.trim()) {
      toast({ variant: "destructive", title: "Name is required" });
      return;
    }
    setSavingProfile(true);
    try {
      const res = await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileForm.name.trim(), timezone: profileForm.timezone }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error ?? "Save failed");
      }
      await refreshUser();
      toast({ title: "Profile updated ✓", description: "Your changes have been saved." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwForm.newPw.length < 8) {
      toast({ variant: "destructive", title: "Password too short", description: "Minimum 8 characters required." });
      return;
    }
    if (pwForm.newPw !== pwForm.confirm) {
      toast({ variant: "destructive", title: "Passwords do not match" });
      return;
    }
    setSavingPw(true);
    try {
      const res = await fetch("/api/users/password", {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.newPw }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error ?? "Failed to change password");
      }
      setPwForm({ current: "", newPw: "", confirm: "" });
      toast({ title: "Password changed ✓", description: "A confirmation email has been sent." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Change failed", description: err.message });
    } finally {
      setSavingPw(false);
    }
  }

  // ── Derived values ───────────────────────────────────────────────────────────

  if (!user) return null;

  const initials = user.name
    ?.split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() ?? "?";

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "—";

  const planName = billing?.plan?.name ?? "Free";
  const planBadge = getPlanBadge(planName);
  const pwStrength = getPasswordStrength(pwForm.newPw);

  const smtpCount = billing?.usage?.smtpAccountsUsed ?? 0;

  const healthChecks = [
    {
      label: "Email Verified",
      ok: !!user.emailVerified,
      detail: user.emailVerified ? "Your email address is verified" : "Verify your email to unlock all features",
    },
    {
      label: "Google Connected",
      ok: !!user.gmailConnected,
      detail: user.gmailConnected
        ? `Connected as ${user.gmailEmail ?? "Google Account"}`
        : "Connect Gmail to create and manage drafts",
    },
    {
      label: "SMTP Connected",
      ok: smtpCount > 0,
      detail: smtpCount > 0 ? `${smtpCount} mailbox(es) connected` : "Add an SMTP mailbox to start sending campaigns",
    },
    {
      label: "Subscription Active",
      ok: !!billing?.plan,
      detail: billing?.plan ? `${billing.plan.name} plan is active` : "No active plan found",
    },
    {
      label: "Profile Completed",
      ok: !!(user.name && user.name !== user.email),
      detail:
        user.name && user.name !== user.email
          ? "Profile looks good"
          : "Complete your name and profile information",
    },
  ];

  const healthScore = healthChecks.filter(c => c.ok).length;
  const allHealthy = healthScore === healthChecks.length;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl pb-16 space-y-6">

      {/* Page header */}
      <div className="pb-5 border-b border-border dark:border-slate-800">
        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">My Profile</h1>
        <p className="text-muted-foreground dark:text-slate-400 mt-1.5 text-sm">
          Manage your personal account, security and preferences.
        </p>
      </div>

      {/* ── Hero card ──────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600" />

        <div className="p-6 lg:p-8">
          <div className="flex flex-col xl:flex-row xl:items-start gap-8">

            {/* LEFT: Identity */}
            <div className="flex items-start gap-5 flex-1 min-w-0">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <Avatar className="h-20 w-20 border-2 border-border dark:border-slate-700 shadow-xl">
                  {user.avatarUrl
                    ? <AvatarImage src={user.avatarUrl} alt={user.name} />
                    : <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-2xl font-bold">
                        {initials}
                      </AvatarFallback>}
                </Avatar>
                <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-green-500 border-2 border-card dark:border-slate-900 shadow" />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-xl font-bold text-foreground dark:text-white leading-tight">{user.name}</h2>
                    <p className="text-sm text-muted-foreground dark:text-slate-400 mt-0.5">{user.email}</p>
                  </div>
                  {/* Account status */}
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/10 border border-green-500/25 text-green-400 flex-shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                    Active Account
                  </span>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${planBadge.cls}`}>
                    <Zap className="h-3 w-3" />
                    {planName} Plan
                  </span>
                  {user.emailVerified && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 border border-blue-500/25 text-blue-400">
                      <CheckCircle2 className="h-3 w-3" /> Verified
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-secondary dark:bg-slate-700/60 border border-border/80 dark:border-slate-600 text-muted-foreground dark:text-slate-300">
                    {user.role === "admin" ? "⚙ Administrator" : "👤 Agent"}
                  </span>
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground dark:text-slate-400">
                    <CalendarDays className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                    Member since {memberSince}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground dark:text-slate-400">
                    <Hash className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                    User #{user.id}
                  </span>
                  {(user as any).timezone && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground dark:text-slate-400">
                      <Globe className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                      {(user as any).timezone}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT: Stats grid */}
            <div className="grid grid-cols-2 gap-3 xl:w-[280px] flex-shrink-0">
              {([
                {
                  icon: Megaphone,
                  label: "Campaigns",
                  value: dashStats ? String(dashStats.totalCampaigns) : null,
                  color: "text-blue-400",
                  bg: "bg-blue-500/10 border-blue-500/20",
                },
                {
                  icon: Send,
                  label: "Emails Sent",
                  value: billing ? String(billing.usage.emailsSentThisMonth) : null,
                  color: "text-green-400",
                  bg: "bg-green-500/10 border-green-500/20",
                },
                {
                  icon: BarChart3,
                  label: "Success Rate",
                  value: dashStats ? `${Math.round(dashStats.draftSuccessRate * 100)}%` : null,
                  color: "text-purple-400",
                  bg: "bg-purple-500/10 border-purple-500/20",
                },
                {
                  icon: Server,
                  label: "Mailboxes",
                  value: billing ? String(billing.usage.smtpAccountsUsed) : null,
                  color: "text-amber-400",
                  bg: "bg-amber-500/10 border-amber-500/20",
                },
              ] as const).map(stat => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-border dark:border-slate-700/60 bg-secondary/50 dark:bg-slate-800/40 p-4 flex flex-col items-center text-center"
                >
                  <div className={`h-8 w-8 rounded-lg border ${stat.bg} flex items-center justify-center mb-2`}>
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                  {loadingData ? (
                    <Skeleton className="h-6 w-10 mb-1" />
                  ) : (
                    <p className={`text-2xl font-bold leading-none ${stat.color}`}>{stat.value ?? "—"}</p>
                  )}
                  <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main two-column grid ────────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-[1fr_292px] gap-6 items-start">

        {/* LEFT column */}
        <div className="space-y-6 min-w-0">

          {/* Personal Information */}
          <SectionCard
            icon={User}
            iconColor="bg-blue-500/15 border border-blue-500/20 text-blue-400"
            title="Personal Information"
            subtitle="Update your display name and timezone"
          >
            <form onSubmit={handleSaveProfile} className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    <User className="h-3 w-3" /> Full Name
                  </label>
                  <Input
                    value={profileForm.name}
                    onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Your full name"
                    required
                    className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    <Mail className="h-3 w-3" /> Email Address
                  </label>
                  <Input
                    value={user.email}
                    disabled
                    className="rounded-xl h-9 text-sm bg-secondary/40 dark:bg-slate-800/30 border-border dark:border-slate-700 opacity-60 cursor-not-allowed"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Email cannot be changed</p>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  <Globe className="h-3 w-3" /> Timezone
                </label>
                <Input
                  value={profileForm.timezone}
                  onChange={e => setProfileForm(f => ({ ...f, timezone: e.target.value }))}
                  placeholder="e.g. America/New_York"
                  className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors"
                />
                <p className="text-[10px] text-slate-500 mt-1">IANA timezone identifier, e.g. America/Chicago</p>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Button type="submit" disabled={savingProfile} className="h-9 rounded-xl text-sm">
                  {savingProfile
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</>
                    : "Save Changes"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={savingProfile}
                  onClick={() =>
                    setProfileForm({
                      name: user.name ?? "",
                      timezone: (user as any).timezone ?? "UTC",
                    })
                  }
                  className="h-9 rounded-xl text-sm bg-transparent border-border dark:border-slate-700"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </SectionCard>

          {/* Security */}
          <SectionCard
            icon={Lock}
            iconColor="bg-violet-500/15 border border-violet-500/20 text-violet-400"
            title="Security"
            subtitle="Update your password"
          >
            <form onSubmit={handleChangePassword} className="p-6 space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  <Lock className="h-3 w-3" /> Current Password
                </label>
                <Input
                  type="password"
                  value={pwForm.current}
                  onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                  placeholder="Enter your current password"
                  autoComplete="current-password"
                  className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-violet-500/60 transition-colors"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  <Shield className="h-3 w-3" /> New Password
                </label>
                <Input
                  type="password"
                  value={pwForm.newPw}
                  onChange={e => setPwForm(f => ({ ...f, newPw: e.target.value }))}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-violet-500/60 transition-colors"
                />
                {pwForm.newPw && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map(i => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                            i <= pwStrength.score ? pwStrength.color : "bg-slate-200 dark:bg-slate-700"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500">{pwStrength.label} password</p>
                  </div>
                )}
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  <Shield className="h-3 w-3" /> Confirm New Password
                </label>
                <Input
                  type="password"
                  value={pwForm.confirm}
                  onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                  placeholder="Repeat new password"
                  autoComplete="new-password"
                  className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-violet-500/60 transition-colors"
                />
                {pwForm.confirm && pwForm.newPw !== pwForm.confirm && (
                  <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Passwords do not match
                  </p>
                )}
              </div>
              <Button
                type="submit"
                disabled={savingPw || !pwForm.current || !pwForm.newPw || !pwForm.confirm}
                className="h-9 rounded-xl text-sm"
              >
                {savingPw
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Changing…</>
                  : "Change Password"}
              </Button>
            </form>
          </SectionCard>

          {/* Connected Accounts */}
          <SectionCard
            icon={LinkIcon}
            iconColor="bg-green-500/15 border border-green-500/20 text-green-400"
            title="Connected Accounts"
            subtitle="Manage your linked services and integrations"
          >
            <div className="divide-y divide-border dark:divide-slate-800">
              {[
                {
                  label: "Google Account",
                  icon: (
                    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                  ),
                  statusText: user.gmailConnected ? "Connected" : "Not connected",
                  detail: user.gmailConnected
                    ? user.gmailEmail ?? "Google Account"
                    : "Connect to create Gmail drafts",
                  ok: !!user.gmailConnected,
                  href: "/settings",
                },
                {
                  label: "SMTP Mailboxes",
                  icon: <Server className="h-4 w-4 text-blue-400" />,
                  statusText: `${smtpCount} Connected`,
                  detail: "Manage your sending accounts",
                  ok: smtpCount > 0,
                  href: "/mailbox",
                },
                {
                  label: "Login Session",
                  icon: <Activity className="h-4 w-4 text-purple-400" />,
                  statusText: "1 Active",
                  detail: "Current browser session",
                  ok: true,
                  href: null as string | null,
                },
              ].map(item => (
                <div
                  key={item.label}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-secondary/40 dark:hover:bg-slate-800/30 transition-colors group"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary dark:bg-slate-800/60 border border-border dark:border-slate-700/60 flex-shrink-0">
                    {item.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground dark:text-slate-200">{item.label}</p>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${item.ok ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-slate-500/10 border-slate-500/20 text-slate-400"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${item.ok ? "bg-green-400" : "bg-slate-400"}`} />
                        {item.statusText}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{item.detail}</p>
                  </div>
                  {item.href && (
                    <Link href={item.href} className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-secondary dark:hover:bg-slate-700/60">
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* RIGHT column */}
        <div className="space-y-6">

          {/* Account Health */}
          <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-border dark:border-slate-800 flex items-center gap-3">
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 border ${allHealthy ? "bg-green-500/15 border-green-500/20" : "bg-amber-500/15 border-amber-500/20"}`}>
                <Activity className={`h-3.5 w-3.5 ${allHealthy ? "text-green-400" : "text-amber-400"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground dark:text-slate-100">Account Health</p>
                <p className="text-xs text-slate-500">{healthScore}/{healthChecks.length} checks passed</p>
              </div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${allHealthy ? "bg-green-500/10 text-green-400" : "bg-amber-500/10 text-amber-400"}`}>
                {Math.round((healthScore / healthChecks.length) * 100)}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="px-5 pt-4 pb-3">
              <div className="h-1.5 w-full rounded-full bg-secondary dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    allHealthy ? "bg-green-500" : healthScore >= 3 ? "bg-amber-500" : "bg-red-500"
                  }`}
                  style={{ width: `${(healthScore / healthChecks.length) * 100}%` }}
                />
              </div>
            </div>

            <div className="px-5 pb-3 space-y-3">
              {healthChecks.map(check => (
                <div key={check.label} className="flex items-start gap-2.5">
                  <div className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full flex-shrink-0 border ${check.ok ? "bg-green-500/15 border-green-500/25" : "bg-slate-500/10 border-slate-500/20"}`}>
                    {check.ok
                      ? <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />
                      : <AlertCircle className="h-2.5 w-2.5 text-slate-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-medium ${check.ok ? "text-foreground dark:text-slate-200" : "text-muted-foreground dark:text-slate-400"}`}>
                      {check.label}
                    </p>
                    <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className={`mx-5 mb-5 p-3 rounded-xl text-xs font-medium flex items-start gap-2 ${allHealthy ? "bg-green-950/40 border border-green-900/50 text-green-400" : "bg-amber-950/30 border border-amber-900/50 text-amber-400"}`}>
              {allHealthy
                ? <><CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />Your account is fully configured and ready to send campaigns.</>
                : <><AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />Complete your setup to unlock full campaign capability.</>}
            </div>
          </div>

          {/* Preferences */}
          <SectionCard
            icon={Settings}
            iconColor="bg-slate-500/15 border border-slate-500/20 text-slate-400"
            title="Preferences"
          >
            <div className="p-5 space-y-1">
              {/* Theme */}
              <div className="flex items-center justify-between py-3 border-b border-border/60 dark:border-slate-800/60">
                <div>
                  <p className="text-sm font-medium text-foreground dark:text-slate-200">Theme</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {theme === "dark" ? "Dark mode" : "Light mode"}
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary dark:bg-slate-800/60 border border-border dark:border-slate-700">
                  {(["light", "dark"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => theme !== t && toggleTheme()}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        theme === t
                          ? "bg-white dark:bg-slate-700 text-foreground dark:text-slate-100 shadow-sm"
                          : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      }`}
                    >
                      {t === "light" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick links */}
              <div className="pt-2 space-y-0.5">
                {[
                  { label: "Brand Settings", href: "/settings", icon: Settings, desc: "Logo, colors & signature" },
                  { label: "Billing & Plans", href: "/plans", icon: CreditCard, desc: "Subscription & usage" },
                  { label: "Mailbox Settings", href: "/mailbox", icon: Server, desc: "SMTP accounts" },
                ].map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-secondary dark:hover:bg-slate-800/60 transition-colors group"
                  >
                    <item.icon className="h-4 w-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 flex-shrink-0 transition-colors" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground dark:text-slate-300 group-hover:text-foreground dark:group-hover:text-slate-100 transition-colors leading-tight">
                        {item.label}
                      </p>
                      <p className="text-[10px] text-slate-500">{item.desc}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          </SectionCard>

          {/* Account Information (read-only) */}
          <SectionCard
            icon={Hash}
            iconColor="bg-amber-500/15 border border-amber-500/20 text-amber-400"
            title="Account Information"
          >
            <div className="p-5 space-y-3.5">
              {[
                { label: "User ID", value: `#${user.id}` },
                { label: "Current Plan", value: planName },
                { label: "Member Since", value: memberSince },
                { label: "Account Status", value: "Active" },
                { label: "Email Verified", value: user.emailVerified ? "Yes ✓" : "No" },
                { label: "Role", value: user.role === "admin" ? "Administrator" : "Agent" },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between gap-4">
                  <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium flex-shrink-0">
                    {item.label}
                  </span>
                  <span className="text-xs font-semibold text-foreground dark:text-slate-200 text-right truncate">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>

        </div>
      </div>
    </div>
  );
}
