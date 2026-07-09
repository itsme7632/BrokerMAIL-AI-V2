import { useState, useEffect, useCallback, useRef } from "react";
import { ProductUpdatesCard } from "@/components/product-hub/ProductUpdatesCard";
import { useGetDashboardStats, useGetDashboardActivity, useGetGmailStatus, useGetDrafts, type ActivityItem } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, CheckCircle2, ArrowRight,
  FileText, UploadCloud, Settings,
  Send, TimerReset, Zap,
  PlayCircle, PauseCircle, AlertTriangle, BarChart3,
  Activity, RefreshCw, ChevronRight, Eye,
  CreditCard, Loader2, PenLine, Megaphone,
  Server, Unlink, TicketCheck, LayoutGrid,
  Building2, Users, Rocket, Circle, Sparkles,
} from "lucide-react";
import { Link } from "wouter";

// ─── Animation variants ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show:   (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.25 } }),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpenEvent {
  id: number;
  openedAt: string;
  email: string | null;
  customerName: string | null;
  subject: string | null;
  campaignId: number | null;
  isAppleMail: boolean;
}

interface QuotaData {
  hourlyLimit:      number;
  usedThisHour:     number;
  remainingQuota:   number;
  deferredCount:    number;
  retryQueueCount:  number;
  nextReleaseAt:    string | null;
  smtpConnected:    boolean;
}

interface Campaign {
  id:            string;
  name:          string;
  status:        string;
  sendMode:      string;
  totalLeads:    number;
  sentCount:     number;
  draftedCount:  number;
  failedCount:   number;
  cooldownUntil: string | null;
  createdAt:     string;
  updatedAt:     string;
}

interface BillingData {
  plan:  { name: string; slug: string; monthlyEmailLimit: number };
  usage: { emailsSentThisMonth: number; smtpAccountsUsed: number };
}

interface MailboxData {
  smtpHost:   string;
  smtpPort:   number;
  smtpUser:   string;
  smtpSecure: string;
}

// ─── Circular SVG progress ────────────────────────────────────────────────────

function CircularProgress({ pct, size = 76 }: { pct: number; size?: number }) {
  const sw = 7;
  const r  = (size - sw) / 2;
  const c  = 2 * Math.PI * r;
  const color = pct >= 90 ? "#f87171" : pct >= 70 ? "#fb923c" : "#3b82f6";
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={sw} stroke="#1e293b" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={sw} stroke={color}
        strokeLinecap="round" fill="none"
        strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
    </svg>
  );
}

// ─── Campaign status helpers ──────────────────────────────────────────────────

function getCampaignStatus(campaign: Campaign): { icon: React.ElementType; label: string; dotColor: string; bg: string; text: string } {
  const isCooling = campaign.status === "sending"
    && !!campaign.cooldownUntil
    && new Date(campaign.cooldownUntil) > new Date();
  if (isCooling) return { icon: TimerReset,    label: "Cooling Down", dotColor: "bg-orange-400", bg: "bg-orange-500/10", text: "text-orange-400" };
  switch (campaign.status) {
    case "sending":   return { icon: PlayCircle,    label: "Sending",   dotColor: "bg-blue-400",    bg: "bg-blue-500/10",    text: "text-blue-400"    };
    case "pending":   return { icon: FileText,      label: "Pending",   dotColor: "bg-slate-400",   bg: "bg-muted/60 dark:bg-slate-700/40",   text: "text-slate-400"   };
    case "paused":    return { icon: PauseCircle,   label: "Paused",    dotColor: "bg-amber-400",   bg: "bg-amber-500/10",   text: "text-amber-400"   };
    case "completed": return { icon: CheckCircle2,  label: "Completed", dotColor: "bg-green-400",   bg: "bg-green-500/10",   text: "text-green-400"   };
    case "cancelled": return { icon: AlertTriangle, label: "Cancelled", dotColor: "bg-slate-400",   bg: "bg-muted/60 dark:bg-slate-700/40",   text: "text-slate-400"   };
    case "failed":    return { icon: AlertTriangle, label: "Failed",    dotColor: "bg-red-400",     bg: "bg-red-500/10",     text: "text-red-400"     };
    default:          return { icon: FileText,      label: campaign.status, dotColor: "bg-slate-400", bg: "bg-muted/60 dark:bg-slate-700/40", text: "text-slate-400" };
  }
}

function activityIcon(type: string): { icon: React.ElementType; color: string; bg: string } {
  switch (type) {
    case "campaign_completed": return { icon: CheckCircle2, color: "text-green-400",  bg: "bg-green-500/10"  };
    case "campaign_started":   return { icon: PlayCircle,   color: "text-blue-400",   bg: "bg-blue-500/10"   };
    case "draft_created":      return { icon: Mail,         color: "text-indigo-400", bg: "bg-indigo-500/10" };
    case "email_opened":       return { icon: Eye,          color: "text-emerald-400",bg: "bg-emerald-500/10"};
    case "bounce_detected":    return { icon: AlertTriangle,color: "text-red-400",    bg: "bg-red-500/10"    };
    default:                   return { icon: Activity,     color: "text-muted-foreground dark:text-slate-400",  bg: "bg-muted/60 dark:bg-slate-700/40"  };
  }
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function SectionCard({ title, subtitle, icon: Icon, iconBg, action, children }: {
  title: string; subtitle?: string; icon?: React.ElementType; iconBg?: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-border dark:border-slate-800 flex items-center gap-3">
        {Icon && (
          <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg ?? "bg-muted dark:bg-slate-700/60"}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground dark:text-slate-100">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Onboarding card ──────────────────────────────────────────────────────────

interface OnboardingStep {
  id:                string;
  icon:              React.ElementType;
  iconBg:            string;
  iconColor:         string;
  title:             string;
  description:       string;
  done:              boolean;
  btnLabel:          string;
  btnHref?:          string;
  btnAction?:        () => void;
  onManualComplete?: () => void;
}

function OnboardingCard({
  steps, completedCount, allDone, seenComplete, dataReady,
}: {
  steps:          OnboardingStep[];
  completedCount: number;
  allDone:        boolean;
  seenComplete:   boolean;
  dataReady:      boolean;
}) {
  const pct = Math.round((completedCount / steps.length) * 100);

  // ── Already seen complete → tiny compact card (skip checklist flash) ─────
  if (seenComplete) {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 flex items-center gap-3">
        <div className="h-8 w-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-300">Everything is ready.</p>
          <p className="text-xs text-muted-foreground dark:text-slate-400 mt-0.5">BrokerMAIL AI is fully configured and ready for sending campaigns.</p>
        </div>
        <Button asChild size="sm"
          className="h-8 px-3 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 flex-shrink-0">
          <Link href="/compose"><PenLine className="h-3.5 w-3.5" /> Compose Email</Link>
        </Button>
      </motion.div>
    );
  }

  // ── All done, first time → celebration state ─────────────────────────────
  if (allDone) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl border border-emerald-500/20 bg-card dark:bg-slate-900 overflow-hidden">
        <div className="px-6 py-8 flex flex-col items-center text-center">
          <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
            <Rocket className="h-7 w-7 text-emerald-400" />
          </div>
          <h3 className="text-lg font-bold text-foreground dark:text-white mb-1">🎉 BrokerMAIL AI is fully configured.</h3>
          <p className="text-sm text-muted-foreground dark:text-slate-400 mb-6 max-w-sm">Your workspace is ready for production. Start sending campaigns and building relationships.</p>
          <div className="flex items-center gap-3">
            <Button asChild size="sm"
              className="h-9 px-4 text-sm rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white gap-2">
              <Link href="/compose"><PenLine className="h-3.5 w-3.5" /> Compose Email</Link>
            </Button>
            <Button asChild variant="outline" size="sm"
              className="h-9 px-4 text-sm rounded-xl border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-foreground dark:text-slate-200 bg-transparent gap-2">
              <Link href="/campaigns"><Megaphone className="h-3.5 w-3.5" /> Start New Campaign</Link>
            </Button>
          </div>
        </div>
        {/* subtle progress bar at top */}
        <div className="h-1 w-full bg-emerald-500/20">
          <motion.div className="h-full bg-emerald-400 rounded-full"
            initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 0.8, ease: "easeOut" }} />
        </div>
      </motion.div>
    );
  }

  // ── Normal checklist ─────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border dark:border-slate-800 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-foreground dark:text-slate-100">Getting Started</p>
            {!dataReady && <Loader2 className="h-3.5 w-3.5 text-slate-500 animate-spin" />}
          </div>
          <p className="text-xs text-slate-500">Complete these steps to unlock the full BrokerMAIL AI experience.</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs font-semibold text-muted-foreground dark:text-slate-300 tabular-nums">{completedCount} of {steps.length} completed</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{pct}% done</p>
        </div>
      </div>

      {/* Animated progress bar */}
      <div className="h-1 w-full bg-secondary dark:bg-slate-800">
        <motion.div className="h-full bg-blue-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      {/* Steps */}
      <div className="divide-y divide-border dark:divide-slate-800/60">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <motion.div key={step.id}
              custom={i} initial="hidden" animate="show" variants={fadeUp}
              className={`flex items-start gap-4 px-5 py-4 transition-colors ${step.done ? "opacity-60" : "hover:bg-secondary/40 dark:hover:bg-slate-800/30"}`}>
              {/* Completion indicator — clickable circle to manually mark done */}
              <div className="flex-shrink-0 w-5 flex items-center justify-center mt-0.5">
                <AnimatePresence mode="wait">
                  {step.done ? (
                    <motion.div key="check"
                      initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    </motion.div>
                  ) : (
                    <motion.div key="circle"
                      initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}>
                      <button
                        onClick={() => step.onManualComplete?.()}
                        title="Mark as done"
                        className="group/circle p-0.5 rounded-full hover:scale-110 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                        <Circle className="h-5 w-5 text-slate-600 group-hover/circle:text-slate-400 transition-colors" />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Step icon */}
              <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 border mt-0.5 ${step.iconBg} ${step.done ? "opacity-50" : ""}`}>
                <Icon className={`h-4 w-4 ${step.iconColor}`} />
              </div>

              {/* Text + responsive button */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${step.done ? "text-slate-400 line-through decoration-slate-600" : "text-foreground dark:text-slate-100"}`}>
                      {step.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{step.description}</p>
                  </div>
                  {/* Action button — stacks below text on mobile, inline on sm+ */}
                  {!step.done && (
                    <div className="flex-shrink-0 mt-2 sm:mt-0">
                      {step.btnHref ? (
                        <Button asChild variant="outline" size="sm"
                          className="h-8 px-3 text-xs rounded-xl border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 hover:border-border/80 dark:hover:border-slate-600 text-foreground dark:text-slate-200 bg-transparent gap-1.5 whitespace-nowrap">
                          <Link href={step.btnHref}>
                            {step.btnLabel} <ArrowRight className="h-3 w-3" />
                          </Link>
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={step.btnAction}
                          className="h-8 px-3 text-xs rounded-xl border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 hover:border-border/80 dark:hover:border-slate-600 text-foreground dark:text-slate-200 bg-transparent gap-1.5 whitespace-nowrap">
                          {step.btnLabel} <ArrowRight className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats,        isLoading: statsLoading }                              = useGetDashboardStats();
  const { data: activity,     isLoading: activityLoading, refetch: refetchActivity } = useGetDashboardActivity({ limit: 10 });
  const { data: gmailStatus,  isLoading: gmailLoading }                              = useGetGmailStatus();
  const { data: recentDrafts, isLoading: draftsLoading }                             = useGetDrafts({ page: 1, limit: 6 });

  const [quota,            setQuota]           = useState<QuotaData | null>(null);
  const [quotaLoading,     setQuotaLoading]    = useState(true);
  const [campaigns,        setCampaigns]       = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading]= useState(true);
  const [connectingGmail,  setConnectingGmail] = useState(false);
  const [liveActivity,     setLiveActivity]    = useState<OpenEvent[]>([]);
  const liveActivityRef = useRef<OpenEvent[]>([]);
  const [liveLoading,      setLiveLoading]     = useState(true);
  const [activityRefreshing, setActivityRefreshing] = useState(false);
  const [refreshNoNew,     setRefreshNoNew]    = useState(false);
  const [suppressionStats, setSuppressionStats]= useState<{
    totalSuppressed: number;
    lastSuppressionAt: string | null;
    topReasons: { reason: string; count: number }[];
  } | null>(null);
  const [billing,   setBilling]   = useState<BillingData | null>(null);
  const [branding,  setBranding]  = useState<{
    companyName?: string | null;
    logoUrl?:     string | null;
    website?:     string | null;
    phone?:       string | null;
  } | null>(null);
  const [mailbox,   setMailbox]   = useState<MailboxData | null>(null);
  const [mailboxLoading, setMailboxLoading] = useState(true);

  // Onboarding: track if user has ever seen the all-complete celebration (per-user)
  const [onboardingSeenComplete, setOnboardingSeenComplete] = useState<boolean>(false);

  // Onboarding: manually-checked steps (per-user localStorage, backend overrides when it reports done)
  const [manuallyCompleted, setManuallyCompleted] = useState<Set<string>>(new Set<string>());

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const token     = () => localStorage.getItem("auth_token") ?? "";

  async function handleConnectGmail() {
    setConnectingGmail(true);
    try {
      const res = await fetch("/api/gmail/connect", { headers: { Authorization: `Bearer ${token()}` } });
      const { authUrl } = await res.json();
      window.location.href = authUrl;
    } catch { setConnectingGmail(false); }
  }

  async function handleDisconnectGmail() {
    try {
      await fetch("/api/gmail/disconnect", { method: "POST", headers: { Authorization: `Bearer ${token()}` } });
      window.location.reload();
    } catch {}
  }

  useEffect(() => {
    async function fetchQuota() {
      setQuotaLoading(true);
      try {
        const res = await fetch("/api/mailbox/quota", { headers: { Authorization: `Bearer ${token()}` } });
        if (res.ok) setQuota(await res.json());
      } catch { /* ignore */ }
      finally { setQuotaLoading(false); }
    }
    fetchQuota();
    const id = setInterval(fetchQuota, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function fetchCampaigns() {
      setCampaignsLoading(true);
      try {
        const res = await fetch("/api/campaigns?page=1&limit=5", { headers: { Authorization: `Bearer ${token()}` } });
        if (res.ok) {
          const data = await res.json();
          setCampaigns(Array.isArray(data) ? data : (data.data ?? []));
        }
      } catch { /* ignore */ }
      finally { setCampaignsLoading(false); }
    }
    fetchCampaigns();
  }, []);

  useEffect(() => {
    async function fetchSuppressionStats() {
      try {
        const res = await fetch("/api/suppressions/stats", { headers: { Authorization: `Bearer ${token()}` } });
        if (res.ok) setSuppressionStats(await res.json());
      } catch { /* ignore */ }
    }
    fetchSuppressionStats();
  }, []);

  useEffect(() => {
    fetch("/api/billing/subscription", { headers: { Authorization: `Bearer ${token()}` } })
      .then(r => r.ok ? r.json() : null).then(d => d && setBilling(d)).catch(() => {});
    fetch("/api/users/branding", { headers: { Authorization: `Bearer ${token()}` } })
      .then(r => r.ok ? r.json() : null).then(d => d && setBranding(d)).catch(() => {});
  }, []);

  // Fetch real SMTP mailbox state (same source as Mailbox settings page)
  useEffect(() => {
    async function fetchMailbox() {
      setMailboxLoading(true);
      try {
        const res = await fetch("/api/mailbox", { headers: { Authorization: `Bearer ${token()}` } });
        if (res.ok) {
          const data = await res.json();
          if (data?.smtpUser) setMailbox(data as MailboxData);
          else setMailbox(null);
        }
      } catch { /* ignore */ }
      finally { setMailboxLoading(false); }
    }
    fetchMailbox();
  }, []);

  // Keep ref in sync with state so fetchLiveActivity can read it synchronously
  useEffect(() => { liveActivityRef.current = liveActivity; }, [liveActivity]);

  const fetchLiveActivity = useCallback(async (): Promise<number> => {
    try {
      const res = await fetch("/api/notifications/live?limit=8", { headers: { Authorization: `Bearer ${token()}` } });
      if (res.ok) {
        const d = await res.json();
        // Deduplicate within the incoming payload itself
        const seenIncoming = new Set<number>();
        const incoming: OpenEvent[] = (d.events ?? [] as OpenEvent[]).filter((e: OpenEvent) => {
          if (seenIncoming.has(e.id)) return false;
          seenIncoming.add(e.id);
          return true;
        });
        // Deduplicate against current state (via ref for synchronous access)
        const existingIds = new Set(liveActivityRef.current.map(e => e.id));
        const newOnes = incoming.filter(e => !existingIds.has(e.id));
        if (newOnes.length > 0) {
          const merged = [...newOnes, ...liveActivityRef.current]
            .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
            .slice(0, 20);
          setLiveActivity(merged);
        }
        return newOnes.length;
      }
    } catch {}
    finally { setLiveLoading(false); }
    return 0;
  }, []);

  useEffect(() => {
    fetchLiveActivity();
    const id = setInterval(fetchLiveActivity, 10_000);
    return () => clearInterval(id);
  }, [fetchLiveActivity]);

  // Functional refresh: reloads both historical activity and live events, shows spinner.
  // Shows "No new activity" message when refresh finds nothing new.
  const handleRefreshActivity = useCallback(async () => {
    if (activityRefreshing) return;
    setActivityRefreshing(true);
    setRefreshNoNew(false);
    try {
      const [, liveNewCount] = await Promise.all([refetchActivity(), fetchLiveActivity()]);
      if ((liveNewCount ?? 0) === 0) {
        setRefreshNoNew(true);
        setTimeout(() => setRefreshNoNew(false), 3000);
      }
    } finally {
      setActivityRefreshing(false);
    }
  }, [activityRefreshing, refetchActivity, fetchLiveActivity]);

  // Per-user onboarding state: load from localStorage once user is known.
  // Always reset both values so state never bleeds between accounts.
  useEffect(() => {
    if (user?.id == null) {
      setOnboardingSeenComplete(false);
      setManuallyCompleted(new Set<string>());
      return;
    }
    setOnboardingSeenComplete(localStorage.getItem(`bm_onboarding_done:${user.id}`) === "1");
    try {
      const stored = localStorage.getItem(`bm_ob_manual:${user.id}`);
      setManuallyCompleted(stored ? new Set<string>(JSON.parse(stored)) : new Set<string>());
    } catch {
      setManuallyCompleted(new Set<string>());
    }
  }, [user?.id]);

  // Manual onboarding step completion — writes to per-user key
  const handleManualComplete = useCallback((id: string) => {
    setManuallyCompleted(prev => {
      const next = new Set(prev);
      next.add(id);
      try {
        if (user?.id != null) {
          localStorage.setItem(`bm_ob_manual:${user.id}`, JSON.stringify([...next]));
        }
      } catch {}
      return next;
    });
  }, [user?.id]);

  // ── Derived values ──────────────────────────────────────────────────────────

  const activeCampaigns  = campaigns.filter(c =>
    c.status === "sending" && !(c.cooldownUntil && new Date(c.cooldownUntil) > new Date())
  ).length;
  const coolingCampaigns = campaigns.filter(c =>
    c.status === "sending" && !!c.cooldownUntil && new Date(c.cooldownUntil) > new Date()
  ).length;
  const quotaPct = quota && quota.hourlyLimit > 0
    ? Math.min(100, Math.round((quota.usedThisHour / quota.hourlyLimit) * 100))
    : 0;
  const emailUsagePct = billing?.plan.monthlyEmailLimit && billing.plan.monthlyEmailLimit > 0
    ? Math.min(100, Math.round((billing.usage.emailsSentThisMonth / billing.plan.monthlyEmailLimit) * 100))
    : null;

  // ── Onboarding completion flags — backend state OR manually-checked ─────────
  const ob_gmail_be    = !gmailLoading && gmailStatus?.connected === true;
  const ob_branding_be = !!(branding && (branding.companyName || branding.logoUrl) && (branding.website || branding.phone || branding.logoUrl));
  const ob_leads_be    = !statsLoading && (stats?.totalLeads ?? 0) > 0;
  const ob_campaign_be = !statsLoading && (stats?.totalCampaigns ?? 0) > 0;
  const ob_email_be    = !!(billing    && billing.usage.emailsSentThisMonth > 0);

  // Backend overrides manual; manual only fills in gaps while backend is falsy
  const ob_gmail    = ob_gmail_be    || manuallyCompleted.has("gmail");
  const ob_branding = ob_branding_be || manuallyCompleted.has("branding");
  const ob_leads    = ob_leads_be    || manuallyCompleted.has("leads");
  const ob_campaign = ob_campaign_be || manuallyCompleted.has("campaign");
  const ob_email    = ob_email_be    || manuallyCompleted.has("email");

  const obSteps     = [ob_gmail, ob_branding, ob_leads, ob_campaign, ob_email];
  const obCompleted = obSteps.filter(Boolean).length;
  const obAllDone   = obCompleted === 5;
  const obDataReady = !gmailLoading && !statsLoading;

  // Persist once user has seen the celebration so we downgrade to mini-card (per-user key)
  useEffect(() => {
    if (!obAllDone || onboardingSeenComplete || user?.id == null) return;
    const t = setTimeout(() => {
      localStorage.setItem(`bm_onboarding_done:${user.id}`, "1");
      setOnboardingSeenComplete(true);
    }, 4500);
    return () => clearTimeout(t);
  }, [obAllDone, onboardingSeenComplete, user?.id]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const initials = user?.name
    ? user.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  // ── Account health chips ────────────────────────────────────────────────────

  const healthChips = [
    {
      label: "Gmail",
      desc: gmailLoading ? "Checking…" : gmailStatus?.connected ? (gmailStatus.email ?? "Connected") : "Not connected",
      status: gmailLoading ? "loading" : gmailStatus?.connected ? "ok" : "warn",
    },
    {
      label: "SMTP",
      desc: mailboxLoading
        ? "Checking…"
        : mailbox?.smtpUser
          ? mailbox.smtpUser
          : "No mailbox",
      status: mailboxLoading ? "loading" : mailbox?.smtpUser ? "ok" : "neutral",
    },
    {
      label: "Campaign Status",
      desc: campaignsLoading
        ? "Checking…"
        : activeCampaigns > 0
          ? `${activeCampaigns} running`
          : coolingCampaigns > 0
            ? `${coolingCampaigns} cooling down`
            : campaigns.some(c => c.status === "paused")
              ? "Paused"
              : campaigns.some(c => c.status === "pending")
                ? "Pending"
                : campaigns.length > 0
                  ? "No active campaigns"
                  : "No campaigns yet",
      status: campaignsLoading
        ? "loading"
        : activeCampaigns > 0
          ? "ok"
          : coolingCampaigns > 0
            ? "warn"
            : "neutral",
    },
    {
      label: "Quota",
      desc: quotaLoading ? "Checking…" : quota ? `${quota.remainingQuota} remaining` : "No data",
      status: quotaLoading ? "loading" : !quota ? "neutral" : quotaPct >= 90 ? "error" : quotaPct >= 70 ? "warn" : "ok",
    },
    {
      label: "Subscription",
      desc: !billing ? "Loading…" : billing.plan.name,
      status: !billing ? "loading" : "ok",
    },
  ] as const;

  type HealthStatus = "ok" | "warn" | "error" | "neutral" | "loading";
  const statusDot: Record<HealthStatus, string> = {
    ok:      "bg-green-400",
    warn:    "bg-amber-400",
    error:   "bg-red-400",
    neutral: "bg-slate-500",
    loading: "bg-slate-600 animate-pulse",
  };
  const statusText: Record<HealthStatus, string> = {
    ok:      "text-green-400",
    warn:    "text-amber-400",
    error:   "text-red-400",
    neutral: "text-muted-foreground dark:text-slate-400",
    loading: "text-slate-500",
  };

  return (
    <div className="space-y-6 pb-10">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground dark:text-white tracking-tight">{greeting}, {firstName}</h1>
          <p className="text-muted-foreground dark:text-slate-400 mt-1 text-sm">Here's everything happening across your BrokerMAIL account today.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="hidden md:block text-xs text-slate-500 mr-1">{today}</span>
          <Button asChild variant="outline" size="sm"
            className="h-8 px-3 text-xs rounded-xl border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-foreground dark:text-slate-200 bg-transparent gap-1.5">
            <Link href="/compose">
              <PenLine className="h-3.5 w-3.5" /> Compose Email
            </Link>
          </Button>
          <Button asChild size="sm"
            className="h-8 px-3 text-xs rounded-xl bg-blue-600 hover:bg-blue-500 text-white gap-1.5 shadow-lg shadow-blue-900/30">
            <Link href="/leads/import">
              <UploadCloud className="h-3.5 w-3.5" /> Upload &amp; Send
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Account Health ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 p-5">
        <div className="flex items-center gap-2 mb-4">
          <p className="text-xs font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider">Account Health</p>
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {healthChips.map((chip) => (
            <div key={chip.label}
              className="flex items-start gap-2.5 rounded-xl border border-border dark:border-slate-700/60 bg-secondary/50 dark:bg-slate-800/40 px-3.5 py-3">
              <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${statusDot[chip.status]}`} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground dark:text-slate-200">{chip.label}</p>
                <p className={`text-[11px] mt-0.5 truncate ${statusText[chip.status]}`}>{chip.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Getting Started / Onboarding ────────────────────────────────────── */}
      {(() => {
        const onboardingStepDefs: OnboardingStep[] = [
          {
            id:               "gmail",
            icon:             Mail,
            iconBg:           "bg-blue-500/10 border-blue-500/20",
            iconColor:        "text-blue-400",
            title:            "Connect Gmail",
            description:      "Connect your Google account to send emails and create Gmail drafts.",
            done:             ob_gmail,
            btnLabel:         "Connect Gmail",
            btnAction:        handleConnectGmail,
            onManualComplete: () => handleManualComplete("gmail"),
          },
          {
            id:               "branding",
            icon:             Building2,
            iconBg:           "bg-purple-500/10 border-purple-500/20",
            iconColor:        "text-purple-400",
            title:            "Complete Company Branding",
            description:      "Upload your company logo and add your business information in Settings.",
            done:             ob_branding,
            btnLabel:         "Open Settings",
            btnHref:          "/settings",
            onManualComplete: () => handleManualComplete("branding"),
          },
          {
            id:               "leads",
            icon:             Users,
            iconBg:           "bg-amber-500/10 border-amber-500/20",
            iconColor:        "text-amber-400",
            title:            "Upload Your First Leads",
            description:      "Import a CSV or Excel file of contacts to start your first campaign.",
            done:             ob_leads,
            btnLabel:         "Upload Leads",
            btnHref:          "/leads/import",
            onManualComplete: () => handleManualComplete("leads"),
          },
          {
            id:               "campaign",
            icon:             Megaphone,
            iconBg:           "bg-indigo-500/10 border-indigo-500/20",
            iconColor:        "text-indigo-400",
            title:            "Create Your First Campaign",
            description:      "Start your first outreach campaign to reach your leads.",
            done:             ob_campaign,
            btnLabel:         "Open Campaigns",
            btnHref:          "/campaigns",
            onManualComplete: () => handleManualComplete("campaign"),
          },
          {
            id:               "email",
            icon:             Send,
            iconBg:           "bg-emerald-500/10 border-emerald-500/20",
            iconColor:        "text-emerald-400",
            title:            "Send Your First Email",
            description:      "Send your first quote or follow-up to a contact.",
            done:             ob_email,
            btnLabel:         "Compose Email",
            btnHref:          "/compose",
            onManualComplete: () => handleManualComplete("email"),
          },
        ];

        return (
          <OnboardingCard
            steps={onboardingStepDefs}
            completedCount={obCompleted}
            allDone={obAllDone}
            seenComplete={onboardingSeenComplete}
            dataReady={obDataReady}
          />
        );
      })()}

      {/* ── Metric cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Emails Sent */}
        <motion.div custom={0} initial="hidden" animate="show" variants={fadeUp}>
          <div className="group rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 p-5 hover:border-border dark:hover:border-slate-700 hover:shadow-xl hover:shadow-black/20 transition-all duration-200 cursor-default">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Send className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Emails Sent</p>
            </div>
            {!billing ? (
              <Skeleton className="h-8 w-16 bg-muted dark:bg-slate-800" />
            ) : (
              <p className="text-3xl font-bold text-foreground dark:text-white tabular-nums">
                {billing.usage.emailsSentThisMonth.toLocaleString()}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">This billing period</p>
            {emailUsagePct !== null && (
              <div className="mt-3 h-1 w-full rounded-full bg-secondary dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${emailUsagePct}%`, backgroundColor: emailUsagePct >= 90 ? "#f87171" : emailUsagePct >= 70 ? "#fb923c" : "#3b82f6" }} />
              </div>
            )}
          </div>
        </motion.div>

        {/* Drafts Created */}
        <motion.div custom={1} initial="hidden" animate="show" variants={fadeUp}>
          <div className="group rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 p-5 hover:border-border dark:hover:border-slate-700 hover:shadow-xl hover:shadow-black/20 transition-all duration-200 cursor-default">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                <Mail className="h-3.5 w-3.5 text-violet-400" />
              </div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Drafts Created</p>
            </div>
            {statsLoading ? (
              <Skeleton className="h-8 w-16 bg-muted dark:bg-slate-800" />
            ) : (
              <p className="text-3xl font-bold text-foreground dark:text-white tabular-nums">
                {(stats?.totalDraftsCreated ?? 0).toLocaleString()}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">All time</p>
            {!statsLoading && (stats?.draftSuccessRate ?? 0) > 0 && (
              <div className="mt-3 h-1 w-full rounded-full bg-secondary dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-violet-500 transition-all duration-700"
                  style={{ width: `${Math.round((stats?.draftSuccessRate ?? 0) * 100)}%` }} />
              </div>
            )}
          </div>
        </motion.div>

        {/* Active Campaigns */}
        <motion.div custom={2} initial="hidden" animate="show" variants={fadeUp}>
          <div className="group rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 p-5 hover:border-border dark:hover:border-slate-700 hover:shadow-xl hover:shadow-black/20 transition-all duration-200 cursor-default">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <Zap className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Active Campaigns</p>
            </div>
            {campaignsLoading ? (
              <Skeleton className="h-8 w-16 bg-muted dark:bg-slate-800" />
            ) : (
              <p className="text-3xl font-bold text-foreground dark:text-white tabular-nums">{activeCampaigns}</p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              {coolingCampaigns > 0 ? `${coolingCampaigns} cooling down` : "Running now"}
            </p>
            <div className="mt-3 h-1 w-full rounded-full bg-secondary dark:bg-slate-800 overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700 ${activeCampaigns > 0 ? "bg-emerald-500" : "bg-slate-700"}`}
                style={{ width: activeCampaigns > 0 ? "100%" : "0%" }} />
            </div>
          </div>
        </motion.div>

        {/* Quota Used */}
        <motion.div custom={3} initial="hidden" animate="show" variants={fadeUp}>
          <div className="group rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 p-5 hover:border-border dark:hover:border-slate-700 hover:shadow-xl hover:shadow-black/20 transition-all duration-200 cursor-default">
            <div className="flex items-center gap-2 mb-3">
              <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${quotaPct >= 80 ? "bg-red-500/10 border border-red-500/20" : "bg-amber-500/10 border border-amber-500/20"}`}>
                <BarChart3 className={`h-3.5 w-3.5 ${quotaPct >= 80 ? "text-red-400" : "text-amber-400"}`} />
              </div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Quota Used</p>
            </div>
            {quotaLoading ? (
              <Skeleton className="h-8 w-16 bg-muted dark:bg-slate-800" />
            ) : (
              <p className="text-3xl font-bold text-foreground dark:text-white tabular-nums">
                {quota ? `${quotaPct}%` : "—"}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              {quota ? `${quota.usedThisHour}/${quota.hourlyLimit} this hour` : "No mailbox configured"}
            </p>
            <div className="mt-3 h-1 w-full rounded-full bg-secondary dark:bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${quotaPct}%`, backgroundColor: quotaPct >= 90 ? "#f87171" : quotaPct >= 70 ? "#fb923c" : "#f59e0b" }} />
            </div>
          </div>
        </motion.div>

      </div>

      {/* ── Main 65/35 grid ─────────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="space-y-5 min-w-0">

          {/* Campaign Activity */}
          <SectionCard
            title="Campaign Activity"
            subtitle="Recent outreach campaigns"
            icon={Zap}
            iconBg="bg-violet-500/10 border border-violet-500/20 text-violet-400"
            action={
              <Button variant="ghost" size="sm" asChild className="text-xs text-slate-500 hover:text-slate-200 rounded-lg gap-1 h-7">
                <Link href="/campaigns">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            }
          >
            {campaignsLoading ? (
              <div className="p-5 space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl bg-muted dark:bg-slate-800" />)}
              </div>
            ) : campaigns.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border dark:border-slate-800">
                      <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Campaign</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Progress</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Recipients</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Created</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border dark:divide-slate-800/60">
                    {campaigns.map(c => {
                      const s = getCampaignStatus(c);
                      const done = (c.sentCount ?? 0) + (c.draftedCount ?? 0);
                      const pct  = c.totalLeads > 0 ? Math.round((done / c.totalLeads) * 100) : 0;
                      return (
                        <tr key={c.id} className="hover:bg-secondary/40 dark:hover:bg-slate-800/30 transition-colors">
                          <td className="px-5 py-3.5">
                            <p className="font-medium text-foreground dark:text-slate-100 text-sm truncate max-w-[160px]">{c.name}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">{c.sendMode === "smtp" ? "SMTP" : "Gmail"}</p>
                          </td>
                          <td className="px-3 py-3.5 hidden sm:table-cell">
                            <div className="w-24">
                              <div className="h-1.5 bg-secondary dark:bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <p className="text-[10px] text-slate-500 mt-1">{done}/{c.totalLeads}</p>
                            </div>
                          </td>
                          <td className="px-3 py-3.5 hidden md:table-cell">
                            <p className="text-sm text-muted-foreground dark:text-slate-300 tabular-nums">{c.totalLeads.toLocaleString()}</p>
                          </td>
                          <td className="px-3 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.bg} ${s.text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${s.dotColor}`} />
                              {s.label}
                            </span>
                          </td>
                          <td className="px-3 py-3.5 hidden lg:table-cell">
                            <p className="text-xs text-slate-500">
                              {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </p>
                          </td>
                          <td className="px-3 py-3.5 text-right">
                            <Link href={`/campaigns/${c.id}`}>
                              <Button variant="ghost" size="sm"
                                className="h-7 px-2.5 text-xs text-slate-500 hover:text-slate-200 rounded-lg">
                                View
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-14 text-slate-500">
                <div className="h-12 w-12 rounded-2xl bg-secondary dark:bg-slate-800 flex items-center justify-center mb-3">
                  <Zap className="h-6 w-6 opacity-30" />
                </div>
                <p className="text-sm font-medium text-muted-foreground dark:text-slate-400">No campaigns yet</p>
                <p className="text-xs mt-1 mb-4 text-slate-500">Upload leads to create your first campaign</p>
                <Button asChild variant="outline" size="sm"
                  className="rounded-xl gap-1.5 text-xs border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-muted-foreground dark:text-slate-300 bg-transparent">
                  <Link href="/leads/import"><UploadCloud className="h-3.5 w-3.5" /> Upload Leads</Link>
                </Button>
              </div>
            )}
          </SectionCard>

          {/* Recent Drafts */}
          <SectionCard
            title="Recent Drafts"
            subtitle="Latest Gmail drafts created"
            icon={Mail}
            iconBg="bg-blue-500/10 border border-blue-500/20 text-blue-400"
            action={
              <Button variant="ghost" size="sm" asChild className="text-xs text-slate-500 hover:text-slate-200 rounded-lg gap-1 h-7">
                <Link href="/drafts">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            }
          >
            <div className="divide-y divide-border dark:divide-slate-800/50">
              {draftsLoading ? (
                <div className="p-5 space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-xl bg-muted dark:bg-slate-800" />)}
                </div>
              ) : recentDrafts?.data?.length ? (
                recentDrafts.data.map(draft => {
                  const isSuccess = draft.status === "success";
                  const isFailed  = draft.status === "failed";
                  return (
                    <div key={draft.id}
                      className="px-5 py-3.5 flex items-center gap-4 hover:bg-secondary/40 dark:hover:bg-slate-800/30 transition-colors">
                      <div className={`h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        isSuccess ? "bg-green-500/10" : isFailed ? "bg-red-500/10" : "bg-muted dark:bg-slate-700/60"
                      }`}>
                        <Mail className={`h-3.5 w-3.5 ${
                          isSuccess ? "text-green-400" : isFailed ? "text-red-400" : "text-muted-foreground dark:text-slate-400"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground dark:text-slate-100 text-sm truncate">{draft.subject || <span className="italic text-slate-500">No subject</span>}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{fmtTime(draft.createdAt)}</p>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
                        isSuccess ? "bg-green-500/10 text-green-400" : isFailed ? "bg-red-500/10 text-red-400" : "bg-muted dark:bg-slate-700/60 text-muted-foreground dark:text-slate-400"
                      }`}>
                        {draft.status}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-14 text-slate-500">
                  <Mail className="h-10 w-10 mb-3 opacity-20" />
                  <p className="text-sm font-medium text-muted-foreground dark:text-slate-400">No drafts yet</p>
                  <Button asChild variant="ghost" size="sm" className="mt-3 text-blue-400 hover:text-blue-300 text-xs gap-1">
                    <Link href="/leads/import">Upload leads to create drafts →</Link>
                  </Button>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Quick Actions */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Quick Actions</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {[
                { label: "Compose Email",    href: "/compose",        icon: PenLine,       desc: "One-off email"          },
                { label: "Upload CSV",       href: "/leads/import",   icon: UploadCloud,   desc: "Import leads & send"    },
                { label: "Template Gallery", href: "/templates",      icon: LayoutGrid,    desc: "Browse templates"       },
                { label: "Campaigns",        href: "/campaigns",      icon: Megaphone,     desc: "Manage campaigns"       },
                { label: "Mailbox",          href: "/mailbox",        icon: Server,        desc: "SMTP & quota settings"  },
                { label: "Support",          href: "/support",        icon: TicketCheck,   desc: "Open a ticket"          },
              ].map((a, i) => (
                <motion.div key={a.label} custom={i} initial="hidden" animate="show" variants={fadeUp}>
                  <Link href={a.href}>
                    <div className="group flex items-center gap-3 rounded-xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 px-4 py-3 hover:border-border dark:hover:border-slate-700 hover:bg-secondary/80 dark:hover:bg-slate-800/60 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 transition-all duration-150 cursor-pointer">
                      <a.icon className="h-4 w-4 text-slate-400 group-hover:text-slate-200 transition-colors flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground dark:text-slate-200 leading-tight">{a.label}</p>
                        <p className="text-[11px] text-slate-500 truncate">{a.desc}</p>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all ml-auto flex-shrink-0" />
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>

        </div>
        {/* end left column */}

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-4">

          {/* Account Overview */}
          <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-border dark:border-slate-800">
              <p className="text-xs font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider">Account Overview</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="h-11 w-11 rounded-full object-cover ring-2 ring-border dark:ring-slate-700 flex-shrink-0" />
                ) : (
                  <div className="h-11 w-11 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold flex-shrink-0 ring-2 ring-border dark:ring-slate-700">
                    {initials}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground dark:text-white text-sm leading-tight">{user?.name}</p>
                  <p className="text-xs text-muted-foreground dark:text-slate-400 mt-0.5 truncate">{user?.email}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 border border-blue-500/20 text-blue-400">
                      <Zap className="h-2.5 w-2.5" />
                      {user?.role === "admin" ? "Admin" : "Agent"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-secondary/60 dark:bg-slate-800/50 border border-border dark:border-slate-700/60 px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Company</p>
                  <p className="text-xs text-foreground dark:text-slate-200 font-medium mt-0.5 truncate">
                    {branding?.companyName || <span className="text-slate-500 italic">Not set</span>}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/60 dark:bg-slate-800/50 border border-border dark:border-slate-700/60 px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Current Plan</p>
                  <p className="text-xs text-foreground dark:text-slate-200 font-medium mt-0.5 truncate">
                    {billing?.plan.name ?? <span className="text-slate-500">—</span>}
                  </p>
                </div>
              </div>

              <Link href="/settings">
                <Button variant="outline" size="sm"
                  className="w-full h-8 text-xs rounded-xl border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-muted-foreground dark:text-slate-300 bg-transparent transition-all duration-200">
                  Manage Profile
                </Button>
              </Link>
            </div>
          </div>

          {/* Sending Account */}
          <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-border dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/5 border border-border dark:border-slate-700 flex-shrink-0">
                  <svg viewBox="0 0 24 24" className="h-[13px] w-[13px]" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                </div>
                <p className="text-sm font-semibold text-foreground dark:text-slate-100">Gmail</p>
              </div>
              {gmailLoading ? null : gmailStatus?.connected ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 border border-green-500/20 text-green-400 flex-shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted dark:bg-slate-700/60 border border-border/80 dark:border-slate-600 text-muted-foreground dark:text-slate-400 flex-shrink-0">
                  Not connected
                </span>
              )}
            </div>
            <div className="px-5 py-4 space-y-3">
              {gmailLoading ? (
                <Skeleton className="h-8 w-full bg-muted dark:bg-slate-800" />
              ) : gmailStatus?.connected ? (
                <>
                  <p className="text-sm text-foreground dark:text-slate-200 truncate">{gmailStatus.email}</p>
                  <p className="text-[11px] text-slate-500">Authenticated with Google OAuth</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleDisconnectGmail}
                      className="flex-1 h-8 text-xs rounded-xl border-red-900/50 text-red-400 hover:bg-red-950/30 hover:border-red-800 bg-transparent transition-all duration-200">
                      <Unlink className="h-3.5 w-3.5 mr-1.5" />Disconnect
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleConnectGmail} disabled={connectingGmail}
                      className="flex-1 h-8 text-xs rounded-xl border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-foreground dark:text-slate-200 bg-transparent transition-all duration-200">
                      {connectingGmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reconnect"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500">Connect Gmail to create drafts and send campaigns.</p>
                  <Button size="sm" onClick={handleConnectGmail} disabled={connectingGmail}
                    className="w-full h-8 text-xs rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-all duration-200">
                    {connectingGmail ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Connecting…</> : "Connect Gmail"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Usage */}
          <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-border dark:border-slate-800">
              <p className="text-xs font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider">Usage</p>
            </div>
            <div className="p-5">
              {!billing ? (
                <div className="flex items-center gap-4">
                  <Skeleton className="h-[76px] w-[76px] rounded-full bg-muted dark:bg-slate-800 flex-shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-24 bg-muted dark:bg-slate-800" />
                    <Skeleton className="h-3 w-20 bg-muted dark:bg-slate-800" />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative flex-shrink-0">
                    <CircularProgress pct={emailUsagePct ?? 0} size={76} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-bold text-foreground dark:text-white">{emailUsagePct ?? 0}%</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground dark:text-slate-400">Emails used</span>
                      <span className="text-foreground dark:text-slate-200 font-semibold tabular-nums">
                        {billing.usage.emailsSentThisMonth.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground dark:text-slate-400">Monthly limit</span>
                      <span className="text-foreground dark:text-slate-200 font-semibold tabular-nums">
                        {billing.plan.monthlyEmailLimit === -1 ? "∞" : billing.plan.monthlyEmailLimit.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground dark:text-slate-400">Remaining</span>
                      <span className="text-foreground dark:text-slate-200 font-semibold tabular-nums">
                        {billing.plan.monthlyEmailLimit === -1
                          ? "∞"
                          : Math.max(0, billing.plan.monthlyEmailLimit - billing.usage.emailsSentThisMonth).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <Link href="/plans">
                <Button variant="outline" size="sm"
                  className="w-full h-8 text-xs rounded-xl border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-foreground dark:text-slate-200 bg-transparent transition-all duration-200">
                  <CreditCard className="h-3.5 w-3.5 mr-1.5" />Manage Plan
                </Button>
              </Link>
            </div>
          </div>

          {/* Live Activity Feed */}
          <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-border dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground dark:text-slate-100">Activity Feed</p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
                  </span>
                </div>
                <AnimatePresence mode="wait">
                  {refreshNoNew ? (
                    <motion.p key="no-new"
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                      className="text-[11px] text-slate-500 mt-0.5 italic">
                      No new activity
                    </motion.p>
                  ) : (
                    <motion.p key="subtitle"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="text-xs text-slate-500 mt-0.5">
                      Recent account events
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
              <button
                onClick={handleRefreshActivity}
                disabled={activityRefreshing}
                title="Refresh activity"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-secondary dark:hover:bg-slate-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                <RefreshCw className={`h-3.5 w-3.5 transition-transform duration-500 ${activityRefreshing ? "animate-spin" : ""}`} />
              </button>
            </div>

            {(() => {
              // Merge historical activity items and live email-open events into one unified timeline
              type FeedItem =
                | { kind: "activity"; id: number; ts: number; item: ActivityItem }
                | { kind: "open";     id: number; ts: number; event: OpenEvent };

              const merged: FeedItem[] = [
                ...(activity ?? []).map((item): FeedItem => ({
                  kind: "activity", id: item.id, ts: new Date(item.createdAt).getTime(), item,
                })),
                ...liveActivity.map((e): FeedItem => ({
                  kind: "open", id: e.id, ts: new Date(e.openedAt).getTime(), event: e,
                })),
              ].sort((a, b) => b.ts - a.ts).slice(0, 12);

              const isLoading = activityLoading && liveLoading;

              return (
                <div className="p-4 max-h-72 overflow-auto">
                  {isLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg bg-muted dark:bg-slate-800" />)}
                    </div>
                  ) : merged.length > 0 ? (
                    <AnimatePresence initial={false}>
                      <div className="space-y-1">
                        {merged.map(entry => {
                          if (entry.kind === "activity") {
                            const { item } = entry;
                            const ai = activityIcon(item.type);
                            const Icon = ai.icon;
                            return (
                              <motion.div key={`a-${item.id}`}
                                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                                className="flex items-start gap-3 px-2 py-2 rounded-xl hover:bg-secondary/50 dark:hover:bg-slate-800/40 transition-colors">
                                <div className={`h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${ai.bg}`}>
                                  <Icon className={`h-3 w-3 ${ai.color}`} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs text-foreground dark:text-slate-200 leading-tight">{item.description}</p>
                                  <p className="text-[10px] text-slate-500 mt-0.5">{timeAgo(item.createdAt)}</p>
                                </div>
                                <p className="text-[10px] text-slate-600 flex-shrink-0 mt-0.5">{fmtTime(item.createdAt)}</p>
                              </motion.div>
                            );
                          }
                          const { event } = entry;
                          return (
                            <motion.div key={`o-${event.id}`}
                              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                              className="flex items-start gap-3 px-2 py-2 rounded-xl hover:bg-secondary/50 dark:hover:bg-slate-800/40 transition-colors">
                              <div className={`h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                event.isAppleMail ? "bg-muted dark:bg-slate-700/60" : "bg-emerald-500/10"
                              }`}>
                                <Eye className={`h-3 w-3 ${event.isAppleMail ? "text-muted-foreground dark:text-slate-400" : "text-emerald-400"}`} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-foreground dark:text-slate-200 truncate">
                                  {event.customerName ?? event.email ?? "Recipient"} opened email
                                </p>
                                <p className="text-[10px] text-slate-500 mt-0.5">{timeAgo(event.openedAt)}</p>
                              </div>
                              <p className="text-[10px] text-slate-600 flex-shrink-0 mt-0.5">{fmtTime(event.openedAt)}</p>
                            </motion.div>
                          );
                        })}
                      </div>
                    </AnimatePresence>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                      <Activity className="h-8 w-8 mb-2 opacity-20" />
                      <p className="text-xs font-medium text-muted-foreground dark:text-slate-400">No recent activity</p>
                      <p className="text-[11px] mt-1 text-center">Events appear here as your campaigns run.</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Product Updates */}
          <ProductUpdatesCard />

        </div>
        {/* end right column */}

      </div>
    </div>
  );
}
