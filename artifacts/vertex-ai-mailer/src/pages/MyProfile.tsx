import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  User, Mail, Shield, Settings, Server, CreditCard,
  CheckCircle2, AlertCircle, Zap, BarChart3, Send,
  ChevronRight, Lock, Globe, Loader2, Activity,
  Megaphone, CalendarDays, Hash, Link as LinkIcon,
  Sun, Moon, Eye, EyeOff, Camera, Trash2,
  Clipboard, ClipboardCheck, Key, Clock, LogIn,
  Bell, HelpCircle, ArrowUpRight, Info, Star,
} from "lucide-react";

// ─── Auth headers ──────────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────

/** Returns the UTC offset string for an IANA timezone name, e.g. "UTC−05:00" */
function getUtcOffset(tz: string): string {
  try {
    const now = new Date();
    const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate  = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const diffMin = Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
    const sign    = diffMin >= 0 ? "+" : "−";
    const abs     = Math.abs(diffMin);
    const hh      = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm      = String(abs % 60).padStart(2, "0");
    return `UTC${sign}${hh}:${mm}`;
  } catch {
    return "UTC+00:00";
  }
}

/** Detect the browser IANA timezone, falling back to "UTC". */
function detectBrowserTz(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

// ─── Plan badge ───────────────────────────────────────────────────────────────

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

// ─── Health info ──────────────────────────────────────────────────────────────

function getHealthInfo(score: number, total: number) {
  const pct = Math.round((score / total) * 100);
  if (score === total)  return { label: "Excellent",       color: "text-green-400",  barColor: "bg-green-500",  bg: "bg-green-500/10",  border: "border-green-500/20"  };
  if (score / total >= 0.8) return { label: "Good",        color: "text-blue-400",   barColor: "bg-blue-500",   bg: "bg-blue-500/10",   border: "border-blue-500/20"   };
  if (score / total >= 0.6) return { label: "Good",        color: "text-amber-400",  barColor: "bg-amber-500",  bg: "bg-amber-500/10",  border: "border-amber-500/20"  };
  if (score / total >= 0.4) return { label: "Fair",        color: "text-orange-400", barColor: "bg-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" };
  return                          { label: "Needs Setup",  color: "text-red-400",    barColor: "bg-red-500",    bg: "bg-red-500/10",    border: "border-red-500/20"    };
}

// ─── Password requirements ────────────────────────────────────────────────────

function getPasswordRequirements(pw: string) {
  return [
    { label: "Minimum 8 characters",    met: pw.length >= 8             },
    { label: "Uppercase letter (A–Z)",  met: /[A-Z]/.test(pw)           },
    { label: "Lowercase letter (a–z)",  met: /[a-z]/.test(pw)           },
    { label: "Number (0–9)",            met: /[0-9]/.test(pw)           },
    { label: "Special character (!@#…)",met: /[^A-Za-z0-9]/.test(pw)   },
  ];
}

function getStrength(metCount: number) {
  if (metCount === 0) return { label: "",          color: "bg-slate-700" };
  if (metCount <= 1)  return { label: "Weak",      color: "bg-red-500"   };
  if (metCount <= 2)  return { label: "Fair",      color: "bg-orange-500"};
  if (metCount <= 3)  return { label: "Good",      color: "bg-yellow-500"};
  if (metCount <= 4)  return { label: "Strong",    color: "bg-blue-500"  };
  return                    { label: "Excellent",  color: "bg-green-500" };
}

// ─── Image resize ─────────────────────────────────────────────────────────────

async function resizeImage(file: File, maxSize = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = ev.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Activity helpers ─────────────────────────────────────────────────────────

interface ActivityItem {
  id: string;
  type: "profile_update" | "password_change" | "avatar_change" | "session_start";
  label: string;
  detail?: string;
  timestamp: string;
}

function activityKey(uid: number) { return `bm_activity_${uid}`; }
function pwChangedKey(uid: number) { return `bm_pw_changed_${uid}`; }

function loadActivity(uid: number): ActivityItem[] {
  try { return JSON.parse(localStorage.getItem(activityKey(uid)) ?? "[]"); }
  catch { return []; }
}

function pushActivity(uid: number, item: Omit<ActivityItem, "id">): ActivityItem {
  const entry: ActivityItem = { id: Math.random().toString(36).slice(2), ...item };
  const prev = loadActivity(uid);
  localStorage.setItem(activityKey(uid), JSON.stringify([entry, ...prev].slice(0, 15)));
  return entry;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ACTIVITY_ICONS: Record<ActivityItem["type"], React.ElementType> = {
  profile_update:  User,
  password_change: Key,
  avatar_change:   Camera,
  session_start:   LogIn,
};

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

// ─── PasswordField ─────────────────────────────────────────────────────────────

function PasswordField({
  value, onChange, placeholder, autoComplete, disabled, className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className={cn("pr-10 rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-violet-500/60 transition-colors", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(s => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors focus:outline-none"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ─── ChangeEmailModal ─────────────────────────────────────────────────────────

function ChangeEmailModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/20">
              <Mail className="h-3.5 w-3.5 text-blue-400" />
            </div>
            Change Email Address
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed pt-1">
            Changing your email address requires identity verification and confirmation from both your old and new email inbox. This feature is coming soon.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/8 border border-amber-500/20 text-sm text-amber-400">
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span className="leading-relaxed">
            Your current email address is the primary identifier for your account and is used for security alerts and login. Email changes will be available in a future update.
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── SectionCard ──────────────────────────────────────────────────────────────

function SectionCard({
  iconColor, icon: Icon, title, subtitle, children, action,
}: {
  iconColor: string;
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
      <div className="px-6 py-4 border-b border-border dark:border-slate-800 flex items-center gap-3">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 ${iconColor}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground dark:text-slate-100">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, color, bg, loading, emptyHint,
}: {
  icon: React.ElementType; label: string; value: string | null;
  color: string; bg: string; loading: boolean; emptyHint?: string;
}) {
  const isEmpty = value === "0" || value === "0%";
  return (
    <div className="rounded-xl border border-border dark:border-slate-700/60 bg-secondary/50 dark:bg-slate-800/40 p-4 flex flex-col items-center text-center">
      <div className={`h-8 w-8 rounded-lg border ${bg} flex items-center justify-center mb-2`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      {loading ? (
        <Skeleton className="h-6 w-10 mb-1" />
      ) : isEmpty ? (
        <p className="text-lg font-bold leading-none text-slate-500 dark:text-slate-600">—</p>
      ) : (
        <p className={`text-2xl font-bold leading-none ${color}`}>{value ?? "—"}</p>
      )}
      <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-1">{label}</p>
      {!loading && isEmpty && emptyHint && (
        <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">{emptyHint}</p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MyProfile() {
  const { user, refreshUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

  // Remote data
  const [billing, setBilling]     = useState<BillingData | null>(null);
  const [dashStats, setDashStats] = useState<DashStats | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // Profile form
  const [profileForm, setProfileForm]       = useState({ name: "" });
  const [profileInitial, setProfileInitial] = useState({ name: "" });
  const [savingProfile, setSavingProfile]   = useState(false);

  // Timezone (read-only, auto-detected)
  const [detectedTz, setDetectedTz]   = useState("UTC");
  const [tzOffset,   setTzOffset]     = useState("UTC+00:00");
  const [tzAutoSaved, setTzAutoSaved] = useState(false); // true when we pushed to DB on load

  // Password form
  const [pwForm, setPwForm]     = useState({ current: "", newPw: "", confirm: "" });
  const [savingPw, setSavingPw] = useState(false);

  // Avatar
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview]     = useState<string | null>(null);

  // Email modal
  const [showEmailModal, setShowEmailModal] = useState(false);

  // Copy user ID
  const [copiedId, setCopiedId] = useState(false);

  // Activity
  const [activity, setActivity]             = useState<ActivityItem[]>([]);
  const [lastPwChanged, setLastPwChanged]   = useState<string | null>(null);

  // ── Initialise forms & detect timezone ──────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    const init = { name: user.name ?? "" };
    setProfileForm(init);
    setProfileInitial(init);

    // Timezone: prefer DB value, then browser, then "UTC"
    const saved = ((user as any).timezone as string | undefined)?.trim();
    const tz = saved || detectBrowserTz();
    setDetectedTz(tz);
    setTzOffset(getUtcOffset(tz));

    // Auto-save detected timezone to DB if the user has none stored yet
    if (!saved) {
      fetch("/api/users/profile", {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: user.name ?? "", timezone: tz }),
      })
        .then(r => { if (r.ok) setTzAutoSaved(true); })
        .catch(() => { /* non-fatal */ });
    }

    // Load activity + last pw change from localStorage
    setActivity(loadActivity(user.id));
    const pwDate = localStorage.getItem(pwChangedKey(user.id));
    setLastPwChanged(pwDate ?? null);
  }, [user]);

  // ── Fetch billing + stats ────────────────────────────────────────────────────

  useEffect(() => {
    const h = getAuthHeaders();
    Promise.all([
      fetch("/api/billing/subscription", { headers: h }).then(r => r.ok ? r.json() : null),
      fetch("/api/dashboard/stats",       { headers: h }).then(r => r.ok ? r.json() : null),
    ]).then(([b, s]) => {
      if (b) setBilling(b);
      if (s) setDashStats(s);
    }).finally(() => setLoadingData(false));
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const profileDirty =
    profileForm.name !== profileInitial.name;

  const pwFilled = pwForm.current && pwForm.newPw && pwForm.confirm;
  const pwReqs   = getPasswordRequirements(pwForm.newPw);
  const pwMetCount = pwReqs.filter(r => r.met).length;
  const strength = getStrength(pwMetCount);

  const smtpCount = billing?.usage?.smtpAccountsUsed ?? 0;
  const planName  = billing?.plan?.name ?? "Free";
  const planBadge = getPlanBadge(planName);

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "—";

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleSaveProfile = useCallback(async (e: React.FormEvent) => {
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
        body: JSON.stringify({ name: profileForm.name.trim(), timezone: detectedTz }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      await refreshUser();
      const next = { name: profileForm.name.trim() };
      setProfileInitial(next);
      // Track activity
      if (user) {
        const entry = pushActivity(user.id, { type: "profile_update", label: "Profile updated", detail: "Name or timezone changed", timestamp: new Date().toISOString() });
        setActivity(a => [entry, ...a]);
      }
      toast({ title: "Profile updated ✓", description: "Your changes have been saved." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    } finally { setSavingProfile(false); }
  }, [profileForm, user, refreshUser, toast]);

  const handleChangePassword = useCallback(async (e: React.FormEvent) => {
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to change password");
      setPwForm({ current: "", newPw: "", confirm: "" });
      const now = new Date().toISOString();
      if (user) {
        localStorage.setItem(pwChangedKey(user.id), now);
        setLastPwChanged(now);
        const entry = pushActivity(user.id, { type: "password_change", label: "Password changed", detail: "Password updated successfully", timestamp: now });
        setActivity(a => [entry, ...a]);
      }
      toast({ title: "Password changed ✓", description: "A confirmation email has been sent." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Change failed", description: err.message });
    } finally { setSavingPw(false); }
  }, [pwForm, user, toast]);

  const handleAvatarSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: "destructive", title: "File too large", description: "Please choose an image under 5 MB." });
      return;
    }
    setUploadingAvatar(true);
    try {
      const dataUrl = await resizeImage(file, 200);
      setAvatarPreview(dataUrl);
      const res = await fetch("/api/users/avatar", {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: dataUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed");
      await refreshUser();
      if (user) {
        const entry = pushActivity(user.id, { type: "avatar_change", label: "Profile picture updated", timestamp: new Date().toISOString() });
        setActivity(a => [entry, ...a]);
      }
      toast({ title: "Profile picture updated ✓" });
    } catch (err: any) {
      setAvatarPreview(null);
      toast({ variant: "destructive", title: "Upload failed", description: err.message });
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }, [user, refreshUser, toast]);

  const handleAvatarRemove = useCallback(async () => {
    setUploadingAvatar(true);
    try {
      const res = await fetch("/api/users/avatar", {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Remove failed");
      setAvatarPreview(null);
      await refreshUser();
      toast({ title: "Profile picture removed" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Remove failed", description: err.message });
    } finally { setUploadingAvatar(false); }
  }, [refreshUser, toast]);

  const handleCopyId = useCallback(() => {
    if (!user) return;
    navigator.clipboard.writeText(String(user.id)).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    });
  }, [user]);

  // ── Guard ────────────────────────────────────────────────────────────────────

  if (!user) return null;

  const initials = user.name?.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase() ?? "?";
  const currentAvatar = avatarPreview ?? user.avatarUrl ?? null;
  const hasAvatar = !!currentAvatar;

  // ── Health checks ────────────────────────────────────────────────────────────

  const healthChecks: {
    label: string; ok: boolean; detail: string;
    fixLabel?: string; fixHref?: string;
  }[] = [
    {
      label: "Email Verified",
      ok: !!user.emailVerified,
      detail: user.emailVerified ? "Your email address is verified" : "Verify your email to receive alerts",
      fixLabel: "Resend link",
      fixHref: "/settings",
    },
    {
      label: "Google Connected",
      ok: !!user.gmailConnected,
      detail: user.gmailConnected ? `Connected as ${user.gmailEmail ?? "Google Account"}` : "Connect Gmail to create drafts",
      fixLabel: "Connect →",
      fixHref: "/settings",
    },
    {
      label: "SMTP Connected",
      ok: smtpCount > 0,
      detail: smtpCount > 0 ? `${smtpCount} mailbox(es) connected` : "Add a mailbox to start sending",
      fixLabel: "Add mailbox",
      fixHref: "/mailbox",
    },
    {
      label: "Active Subscription",
      ok: !!billing?.plan,
      detail: billing?.plan ? `${billing.plan.name} plan is active` : "No active plan",
      fixLabel: "View plans",
      fixHref: "/plans",
    },
    {
      label: "Profile Completed",
      ok: !!(user.name && user.name !== user.email),
      detail: user.name && user.name !== user.email ? "Profile looks good" : "Add your full name below",
    },
  ];

  const healthScore = healthChecks.filter(c => c.ok).length;
  const healthInfo  = getHealthInfo(healthScore, healthChecks.length);

  // ── Activity: derive + merge ──────────────────────────────────────────────────

  const derivedActivity: ActivityItem[] = [
    {
      id: "session_current",
      type: "session_start",
      label: "Session started",
      detail: "Current browser session",
      timestamp: new Date(Date.now() - 60_000 * 2).toISOString(),
    },
  ];
  if (user.createdAt) {
    derivedActivity.push({
      id: "account_created",
      type: "session_start",
      label: "Account created",
      detail: "Welcome to BrokerMAIL AI",
      timestamp: user.createdAt,
    });
  }
  const mergedActivity = [...activity, ...derivedActivity]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 6);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <ChangeEmailModal open={showEmailModal} onClose={() => setShowEmailModal(false)} />

      {/* Hidden avatar file input */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleAvatarSelect}
      />

      <div className="max-w-6xl pb-16 space-y-6">

        {/* ── Page header ──────────────────────────────────────────────────────── */}
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

              {/* LEFT: identity */}
              <div className="flex items-start gap-5 flex-1 min-w-0">

                {/* ── Avatar with upload overlay ── */}
                <div className="relative flex-shrink-0 group">
                  <Avatar className="h-20 w-20 border-2 border-border dark:border-slate-700 shadow-xl">
                    {currentAvatar
                      ? <AvatarImage src={currentAvatar} alt={user.name} />
                      : <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-2xl font-bold">{initials}</AvatarFallback>}
                  </Avatar>

                  {/* Upload overlay */}
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-200 focus:outline-none"
                    title="Change profile picture"
                  >
                    {uploadingAvatar
                      ? <Loader2 className="h-5 w-5 text-white animate-spin" />
                      : <Camera className="h-5 w-5 text-white" />}
                  </button>

                  {/* Remove button */}
                  {hasAvatar && !uploadingAvatar && (
                    <button
                      type="button"
                      onClick={handleAvatarRemove}
                      className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 border-2 border-card dark:border-slate-900 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 focus:outline-none hover:bg-red-600"
                      title="Remove photo"
                    >
                      <Trash2 className="h-2.5 w-2.5 text-white" />
                    </button>
                  )}

                  {/* Status dot */}
                  <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-green-500 border-2 border-card dark:border-slate-900 shadow group-hover:opacity-0 transition-opacity" />
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h2 className="text-xl font-bold text-foreground dark:text-white leading-tight">{user.name}</h2>
                      <p className="text-sm text-muted-foreground dark:text-slate-400 mt-0.5">{user.email}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/10 border border-green-500/25 text-green-400 flex-shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                      Active Account
                    </span>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${planBadge.cls}`}>
                      <Zap className="h-3 w-3" /> {planName} Plan
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

                  {/* Meta */}
                  <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground dark:text-slate-400">
                      <CalendarDays className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                      Member since {memberSince}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground dark:text-slate-400">
                      <Hash className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                      User #{user.id}
                    </span>
                    {detectedTz && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground dark:text-slate-400">
                        <Globe className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                        {detectedTz} ({tzOffset})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT: stats */}
              <div className="grid grid-cols-2 gap-3 xl:w-[280px] flex-shrink-0">
                <StatCard icon={Megaphone}  label="Campaigns"   loading={loadingData} value={dashStats ? String(dashStats.totalCampaigns) : null}                         color="text-blue-400"   bg="bg-blue-500/10 border-blue-500/20"   emptyHint="Start first campaign" />
                <StatCard icon={Send}        label="Emails Sent" loading={loadingData} value={billing  ? String(billing.usage.emailsSentThisMonth) : null}                  color="text-green-400"  bg="bg-green-500/10 border-green-500/20"  emptyHint="Send your first email" />
                <StatCard icon={BarChart3}   label="Success Rate" loading={loadingData} value={dashStats ? `${Math.round(dashStats.draftSuccessRate * 100)}%` : null}       color="text-purple-400" bg="bg-purple-500/10 border-purple-500/20" emptyHint="No data yet" />
                <StatCard icon={Server}      label="Mailboxes"   loading={loadingData} value={billing  ? String(billing.usage.smtpAccountsUsed) : null}                    color="text-amber-400"  bg="bg-amber-500/10 border-amber-500/20"  emptyHint="Add a mailbox" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Main two-column grid ─────────────────────────────────────────────── */}
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

                  {/* Name */}
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

                  {/* Email — styled display, not an input */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                      <Mail className="h-3 w-3" /> Email Address
                    </label>
                    <div className="flex items-center h-9 px-3 rounded-xl bg-secondary/40 dark:bg-slate-800/30 border border-border dark:border-slate-700 gap-2 overflow-hidden">
                      <span className="text-sm text-foreground dark:text-slate-300 truncate flex-1">{user.email}</span>
                      {user.emailVerified
                        ? <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-500/15 border border-blue-500/25 text-blue-400 flex-shrink-0">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Verified
                          </span>
                        : <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 border border-amber-500/25 text-amber-400 flex-shrink-0">
                            <AlertCircle className="h-2.5 w-2.5" /> Unverified
                          </span>
                      }
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowEmailModal(true)}
                      className="mt-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 focus:outline-none"
                    >
                      <ArrowUpRight className="h-3 w-3" /> Change email address
                    </button>
                  </div>
                </div>

                {/* Timezone — read-only, auto-detected */}
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    <Globe className="h-3 w-3" /> Timezone
                  </p>
                  <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 bg-secondary/70 dark:bg-slate-800/60 border border-border dark:border-slate-700 min-h-[36px]">
                    <Globe className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    <span className="text-sm text-foreground dark:text-slate-200 font-medium flex-1">
                      {detectedTz}
                      <span className="ml-2 text-slate-500 dark:text-slate-400 font-normal">({tzOffset})</span>
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-medium text-green-500 dark:text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5 flex-shrink-0">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Auto Detected
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Automatically detected from your device · not editable
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    type="submit"
                    disabled={!profileDirty || savingProfile}
                    className={cn("h-9 rounded-xl text-sm transition-all", !profileDirty && "opacity-50")}
                  >
                    {savingProfile
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</>
                      : "Save Changes"}
                  </Button>
                  <Button
                    type="button" variant="outline" disabled={!profileDirty || savingProfile}
                    onClick={() => setProfileForm({ name: user.name ?? "" })}
                    className={cn("h-9 rounded-xl text-sm bg-transparent border-border dark:border-slate-700", !profileDirty && "opacity-50")}
                  >
                    Cancel
                  </Button>
                  {profileDirty && (
                    <span className="text-xs text-amber-400 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> Unsaved changes
                    </span>
                  )}
                </div>
              </form>
            </SectionCard>

            {/* Security */}
            <SectionCard
              icon={Lock}
              iconColor="bg-violet-500/15 border border-violet-500/20 text-violet-400"
              title="Security"
              subtitle="Change your account password"
            >
              <form onSubmit={handleChangePassword} className="p-6 space-y-4">

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    <Lock className="h-3 w-3" /> Current Password
                  </label>
                  <PasswordField
                    value={pwForm.current}
                    onChange={v => setPwForm(f => ({ ...f, current: v }))}
                    placeholder="Enter your current password"
                    autoComplete="current-password"
                    disabled={savingPw}
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    <Shield className="h-3 w-3" /> New Password
                  </label>
                  <PasswordField
                    value={pwForm.newPw}
                    onChange={v => setPwForm(f => ({ ...f, newPw: v }))}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                    disabled={savingPw}
                  />

                  {/* Strength meter */}
                  {pwForm.newPw && (
                    <div className="mt-3 space-y-2">
                      {/* Bar */}
                      <div className="flex gap-1 items-center">
                        <div className="flex gap-1 flex-1">
                          {[1, 2, 3, 4, 5].map(i => (
                            <div
                              key={i}
                              className={cn(
                                "h-1.5 flex-1 rounded-full transition-all duration-300",
                                i <= pwMetCount ? strength.color : "bg-slate-200 dark:bg-slate-700"
                              )}
                            />
                          ))}
                        </div>
                        {strength.label && (
                          <span className={cn("text-[10px] font-semibold ml-2 w-16 text-right", {
                            "text-red-400":    strength.label === "Weak",
                            "text-orange-400": strength.label === "Fair",
                            "text-yellow-400": strength.label === "Good",
                            "text-blue-400":   strength.label === "Strong",
                            "text-green-400":  strength.label === "Excellent",
                          })}>
                            {strength.label}
                          </span>
                        )}
                      </div>

                      {/* Requirements checklist */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {pwReqs.map(req => (
                          <div key={req.label} className={cn(
                            "flex items-center gap-1.5 text-[11px] transition-colors",
                            req.met ? "text-green-400" : "text-slate-500"
                          )}>
                            {req.met
                              ? <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                              : <div className="h-3 w-3 rounded-full border border-slate-600 flex-shrink-0" />}
                            {req.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    <Shield className="h-3 w-3" /> Confirm New Password
                  </label>
                  <PasswordField
                    value={pwForm.confirm}
                    onChange={v => setPwForm(f => ({ ...f, confirm: v }))}
                    placeholder="Repeat new password"
                    autoComplete="new-password"
                    disabled={savingPw}
                  />
                  {pwForm.confirm && pwForm.newPw !== pwForm.confirm && (
                    <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Passwords do not match
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={savingPw || !pwFilled || pwMetCount < 1}
                  className={cn("h-9 rounded-xl text-sm", (!pwFilled || pwMetCount < 1) && "opacity-50")}
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
                {([
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
                    status: user.gmailConnected ? "connected" as const : "disconnected" as const,
                    statusLabel: user.gmailConnected ? "Connected" : "Not Connected",
                    detail: user.gmailConnected ? (user.gmailEmail ?? "Google Account") : "Connect to create Gmail drafts",
                    href: "/settings",
                  },
                  {
                    label: "SMTP Mailboxes",
                    icon: <Server className="h-4 w-4 text-blue-400" />,
                    status: smtpCount > 0 ? "connected" as const : "disconnected" as const,
                    statusLabel: smtpCount > 0 ? `${smtpCount} Connected` : "Not Connected",
                    detail: smtpCount > 0 ? "Managing sending accounts" : "Add an SMTP mailbox to start sending",
                    href: "/mailbox",
                  },
                  {
                    label: "Login Session",
                    icon: <Activity className="h-4 w-4 text-purple-400" />,
                    status: "connected" as const,
                    statusLabel: "Active",
                    detail: "Current browser session",
                    href: null as string | null,
                  },
                ] as const).map(item => {
                  const badgeStyle = {
                    connected:    "bg-green-500/10 border-green-500/20 text-green-400",
                    disconnected: "bg-slate-500/10 border-slate-500/20 text-slate-400",
                    attention:    "bg-amber-500/10 border-amber-500/20 text-amber-400",
                  }[item.status];
                  const dotStyle = {
                    connected:    "bg-green-400",
                    disconnected: "bg-slate-400",
                    attention:    "bg-amber-400 animate-pulse",
                  }[item.status];

                  return (
                    <div key={item.label} className="flex items-center gap-4 px-6 py-4 hover:bg-secondary/40 dark:hover:bg-slate-800/30 transition-colors group">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary dark:bg-slate-800/60 border border-border dark:border-slate-700/60 flex-shrink-0">
                        {item.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground dark:text-slate-200">{item.label}</p>
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${badgeStyle}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${dotStyle}`} />
                            {item.statusLabel}
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
                  );
                })}
              </div>
            </SectionCard>
          </div>

          {/* RIGHT column */}
          <div className="space-y-6">

            {/* Account Health */}
            <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden shadow-sm">
              <div className={`px-5 py-4 border-b border-border dark:border-slate-800 flex items-center gap-3 ${healthInfo.bg} bg-opacity-50`}>
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 border ${healthInfo.border} ${healthInfo.bg}`}>
                  <Activity className={`h-3.5 w-3.5 ${healthInfo.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground dark:text-slate-100">Account Health</p>
                  <p className="text-xs text-slate-500">{healthScore}/{healthChecks.length} checks passed</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-lg font-bold leading-none ${healthInfo.color}`}>
                    {Math.round((healthScore / healthChecks.length) * 100)}%
                  </p>
                  <p className={`text-[10px] font-semibold mt-0.5 ${healthInfo.color}`}>{healthInfo.label}</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="px-5 pt-4 pb-3">
                <div className="h-2 w-full rounded-full bg-secondary dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${healthInfo.barColor}`}
                    style={{ width: `${(healthScore / healthChecks.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Checklist */}
              <div className="px-5 pb-4 space-y-2">
                {healthChecks.map(check => (
                  <div key={check.label} className={cn(
                    "flex items-start gap-2.5 p-2.5 rounded-xl transition-colors",
                    !check.ok && check.fixHref && "hover:bg-secondary/50 dark:hover:bg-slate-800/40 cursor-default"
                  )}>
                    <div className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full flex-shrink-0 border ${check.ok ? "bg-green-500/15 border-green-500/25" : "bg-slate-500/10 border-slate-500/20"}`}>
                      {check.ok
                        ? <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />
                        : <AlertCircle className="h-2.5 w-2.5 text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-medium ${check.ok ? "text-foreground dark:text-slate-200" : "text-muted-foreground dark:text-slate-400"}`}>
                        {check.label}
                      </p>
                      <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">{check.detail}</p>
                    </div>
                    {!check.ok && check.fixHref && (
                      <Link href={check.fixHref} className="flex-shrink-0 text-[10px] font-semibold text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-0.5 mt-0.5">
                        {check.fixLabel ?? "Fix →"}
                        <ArrowUpRight className="h-2.5 w-2.5" />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
              <div className="px-5 py-4 border-b border-border dark:border-slate-800 flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/15 border border-indigo-500/20 flex-shrink-0">
                  <Star className="h-3.5 w-3.5 text-indigo-400" />
                </div>
                <p className="text-sm font-semibold text-foreground dark:text-slate-100">Quick Actions</p>
              </div>
              <div className="p-3 space-y-1">
                {([
                  { href: "/settings",      icon: Settings,    label: "Brand Settings",  desc: "Logo, colors & sender name", color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20"   },
                  { href: "/mailbox",       icon: Server,      label: "Mailboxes",       desc: "Manage SMTP accounts",       color: "text-green-400",  bg: "bg-green-500/10 border-green-500/20"  },
                  { href: "/plans",         icon: CreditCard,  label: "Billing & Plans", desc: "Subscription & usage",       color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20"},
                  { href: "/notifications", icon: Bell,        label: "Notifications",   desc: "Activity & alerts",          color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20"  },
                  { href: "/support",       icon: HelpCircle,  label: "Help & Support",  desc: "Get assistance",             color: "text-slate-400",  bg: "bg-slate-500/10 border-slate-500/20"  },
                ] as const).map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-secondary dark:hover:bg-slate-800/60 transition-all duration-150 group/q"
                  >
                    <div className={`flex h-7 w-7 items-center justify-center rounded-lg border flex-shrink-0 ${item.bg} transition-transform group-hover/q:scale-110`}>
                      <item.icon className={`h-3.5 w-3.5 ${item.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground dark:text-slate-200 leading-tight group-hover/q:text-foreground dark:group-hover/q:text-white transition-colors">
                        {item.label}
                      </p>
                      <p className="text-[10px] text-slate-500">{item.desc}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 opacity-0 group-hover/q:opacity-100 transition-opacity flex-shrink-0" />
                  </Link>
                ))}
              </div>

              {/* Theme toggle at bottom */}
              <div className="mx-4 mb-4 mt-1 flex items-center justify-between px-3 py-2.5 rounded-xl bg-secondary/60 dark:bg-slate-800/40 border border-border dark:border-slate-700/60">
                <div>
                  <p className="text-sm font-medium text-foreground dark:text-slate-200">Appearance</p>
                  <p className="text-[10px] text-slate-500">{theme === "dark" ? "Dark mode" : "Light mode"}</p>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-secondary dark:bg-slate-800 border border-border dark:border-slate-700">
                  {(["light", "dark"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => theme !== t && toggleTheme()}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all",
                        theme === t
                          ? "bg-white dark:bg-slate-700 text-foreground dark:text-slate-100 shadow-sm"
                          : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      )}
                    >
                      {t === "light" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
              <div className="px-5 py-4 border-b border-border dark:border-slate-800 flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-500/15 border border-slate-500/20 flex-shrink-0">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                </div>
                <p className="text-sm font-semibold text-foreground dark:text-slate-100">Recent Activity</p>
              </div>
              <div className="divide-y divide-border/60 dark:divide-slate-800/60">
                {mergedActivity.length === 0 ? (
                  <div className="px-5 py-6 text-center">
                    <Clock className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">No activity recorded yet</p>
                  </div>
                ) : (
                  mergedActivity.map(item => {
                    const Icon = ACTIVITY_ICONS[item.type];
                    return (
                      <div key={item.id} className="flex items-start gap-3 px-5 py-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-secondary dark:bg-slate-800/60 border border-border dark:border-slate-700/60 flex-shrink-0 mt-0.5">
                          <Icon className="h-3 w-3 text-slate-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground dark:text-slate-200 leading-tight">{item.label}</p>
                          {item.detail && <p className="text-[10px] text-slate-500 mt-0.5">{item.detail}</p>}
                        </div>
                        <span className="text-[10px] text-slate-500 flex-shrink-0 mt-0.5">{formatRelative(item.timestamp)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Account Information */}
            <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
              <div className="px-5 py-4 border-b border-border dark:border-slate-800 flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/20 flex-shrink-0">
                  <Hash className="h-3.5 w-3.5 text-amber-400" />
                </div>
                <p className="text-sm font-semibold text-foreground dark:text-slate-100">Account Information</p>
              </div>
              <div className="p-5 space-y-3.5">
                {/* User ID with copy */}
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium flex-shrink-0">User ID</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground dark:text-slate-200">#{user.id}</span>
                    <button
                      type="button"
                      onClick={handleCopyId}
                      title={copiedId ? "Copied!" : "Copy user ID"}
                      className="p-1 rounded-lg hover:bg-secondary dark:hover:bg-slate-700/60 transition-colors focus:outline-none"
                    >
                      {copiedId
                        ? <ClipboardCheck className="h-3 w-3 text-green-400" />
                        : <Clipboard className="h-3 w-3 text-slate-400" />}
                    </button>
                  </div>
                </div>

                {[
                  { label: "Current Plan",     value: planName },
                  { label: "Member Since",     value: memberSince },
                  { label: "Account Status",   value: "Active" },
                  { label: "Email Verified",   value: user.emailVerified ? "Yes ✓" : "No" },
                  { label: "Role",             value: user.role === "admin" ? "Administrator" : "Agent" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between gap-4">
                    <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium flex-shrink-0">{item.label}</span>
                    <span className="text-xs font-semibold text-foreground dark:text-slate-200 text-right truncate">{item.value}</span>
                  </div>
                ))}

                {/* Last password changed */}
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium flex-shrink-0 flex items-center gap-1">
                    <Key className="h-2.5 w-2.5" /> Last Pw Change
                  </span>
                  <span className="text-xs font-semibold text-foreground dark:text-slate-200 text-right">
                    {lastPwChanged
                      ? new Date(lastPwChanged).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : <span className="text-slate-500">Not recorded</span>}
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
