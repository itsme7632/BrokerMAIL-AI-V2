import { useState, useEffect, useCallback } from "react";
import { useGetDashboardStats, useGetDashboardActivity, useGetGmailStatus, useGetDrafts } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, CheckCircle2, AlertCircle, Clock, ArrowRight,
  FileText, UploadCloud, TrendingUp, Wifi, Settings,
  Send, LayoutDashboard, Inbox, TimerReset, Zap,
  PlayCircle, PauseCircle, AlertTriangle, BarChart3,
  Activity, RefreshCw, ChevronRight, Eye,
} from "lucide-react";
import { Link } from "wouter";

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show:   (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.28 } }),
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
  id:          string;
  name:        string;
  status:      string;
  totalCount:  number;
  sentCount:   number;
  failedCount: number;
  createdAt:   string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HeroStatCard({
  label, value, icon: Icon, color, loading, sub,
}: {
  label: string;
  value?: string | number;
  icon: React.ElementType;
  color: "blue" | "emerald" | "violet" | "amber" | "rose";
  loading: boolean;
  sub?: string;
}) {
  const map = {
    blue:    { wrap: "bg-blue-50 ring-blue-100",    icon: "text-blue-600",    val: "text-slate-900" },
    emerald: { wrap: "bg-emerald-50 ring-emerald-100", icon: "text-emerald-600", val: "text-slate-900" },
    violet:  { wrap: "bg-violet-50 ring-violet-100",  icon: "text-violet-600",  val: "text-slate-900" },
    amber:   { wrap: "bg-amber-50 ring-amber-100",    icon: "text-amber-600",   val: "text-slate-900" },
    rose:    { wrap: "bg-rose-50 ring-rose-100",      icon: "text-rose-600",    val: "text-slate-900" },
  };
  const c = map[color];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
      <div className={`h-11 w-11 rounded-xl ${c.wrap} ring-1 flex items-center justify-center flex-shrink-0`}>
        <Icon className={`h-5 w-5 ${c.icon}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-500 mb-1 uppercase tracking-wide">{label}</p>
        {loading
          ? <Skeleton className="h-7 w-16" />
          : <p className={`text-2xl font-bold leading-none ${c.val}`}>{value ?? "—"}</p>
        }
        {sub && !loading && <p className="text-xs text-slate-400 mt-1 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function QuickActionCard({
  label, desc, href, icon: Icon, color, i,
}: {
  label: string;
  desc: string;
  href: string;
  icon: React.ElementType;
  color: string;
  i: number;
}) {
  return (
    <motion.div custom={i} initial="hidden" animate="show" variants={fadeUp}>
      <Link href={href}>
        <div className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-200 transition-all p-5 flex items-center gap-4 cursor-pointer h-full">
          <div className={`h-11 w-11 rounded-xl ${color} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 text-sm">{label}</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
        </div>
      </Link>
    </motion.div>
  );
}

function CampaignStatusRow({ campaign }: { campaign: Campaign }) {
  const pct = campaign.totalCount > 0 ? Math.round((campaign.sentCount / campaign.totalCount) * 100) : 0;

  const statusConfig: Record<string, { icon: React.ElementType; label: string; cls: string }> = {
    active:       { icon: PlayCircle,  label: "Active",       cls: "text-emerald-600 bg-emerald-50" },
    paused:       { icon: PauseCircle, label: "Paused",       cls: "text-amber-600 bg-amber-50" },
    cooling_down: { icon: TimerReset,  label: "Cooling Down", cls: "text-orange-600 bg-orange-50" },
    completed:    { icon: CheckCircle2,label: "Completed",    cls: "text-blue-600 bg-blue-50" },
    failed:       { icon: AlertTriangle,label: "Failed",      cls: "text-red-600 bg-red-50" },
    draft:        { icon: FileText,    label: "Draft",        cls: "text-slate-600 bg-slate-50" },
  };

  const s = statusConfig[campaign.status] ?? statusConfig["draft"];
  const StatusIcon = s.icon;

  return (
    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
      <div className={`h-8 w-8 rounded-lg ${s.cls} flex items-center justify-center flex-shrink-0`}>
        <StatusIcon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-900 text-sm truncate">{campaign.name}</p>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[120px]">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-slate-400">{campaign.sentCount}/{campaign.totalCount} sent</span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {campaign.failedCount > 0 && (
          <span className="text-xs text-red-500 bg-red-50 px-1.5 py-0.5 rounded-md">
            {campaign.failedCount} failed
          </span>
        )}
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>
          {s.label}
        </span>
      </div>
    </div>
  );
}

function SmtpHealthCard({ quota, loading }: { quota: QuotaData | null; loading: boolean }) {
  const pct = quota && quota.hourlyLimit > 0
    ? Math.min(100, Math.round((quota.usedThisHour / quota.hourlyLimit) * 100))
    : 0;

  const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
          <Activity className="h-4 w-4 text-blue-600" />
        </div>
        <div>
          <h2 className="font-semibold text-slate-900 text-sm">SMTP Health</h2>
          <p className="text-xs text-slate-400 mt-0.5">Live mailbox status</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
          </div>
        ) : quota ? (
          <>
            {/* Connection status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${quota.smtpConnected ? "bg-emerald-500" : "bg-slate-300"}`} />
                <span className="text-sm text-slate-700">SMTP</span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                quota.smtpConnected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}>
                {quota.smtpConnected ? "Connected" : "Not connected"}
              </span>
            </div>

            {/* Hourly quota bar */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600">Hourly Quota</span>
                <span className="text-xs text-slate-500">{quota.usedThisHour} / {quota.hourlyLimit}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-slate-400 mt-1">{quota.remainingQuota} slots remaining this hour</p>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-1">Deferred</p>
                <p className="text-lg font-bold text-amber-600">{quota.deferredCount}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-1">Retry Queue</p>
                <p className="text-lg font-bold text-blue-600">{quota.retryQueueCount}</p>
              </div>
            </div>

            {/* Next release */}
            {quota.nextReleaseAt && (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-xl p-3">
                <TimerReset className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                <span>Next slot releases at {new Date(quota.nextReleaseAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            )}

            <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 text-xs">
              <Link href="/mailbox">
                <Settings className="h-3.5 w-3.5" /> Mailbox Settings
              </Link>
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <Wifi className="h-5 w-5 text-slate-400" />
            </div>
            <p className="text-sm text-slate-500 mb-1">No mailbox connected</p>
            <p className="text-xs text-slate-400 mb-3">Configure SMTP to track quota</p>
            <Button asChild variant="outline" size="sm" className="rounded-xl gap-1.5 text-xs">
              <Link href="/mailbox"><Settings className="h-3 w-3" /> Connect Mailbox</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats,        isLoading: statsLoading }    = useGetDashboardStats();
  const { data: activity,     isLoading: activityLoading } = useGetDashboardActivity({ limit: 8 });
  const { data: gmailStatus,  isLoading: gmailLoading }    = useGetGmailStatus();
  const { data: recentDrafts, isLoading: draftsLoading }   = useGetDrafts({ page: 1, limit: 6 });

  const [quota,            setQuota]           = useState<QuotaData | null>(null);
  const [quotaLoading,     setQuotaLoading]    = useState(true);
  const [campaigns,        setCampaigns]       = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading]= useState(true);
  const [connectingGmail,  setConnectingGmail] = useState(false);
  const [liveActivity,     setLiveActivity]    = useState<OpenEvent[]>([]);
  const [liveLoading,      setLiveLoading]     = useState(true);

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
        const res = await fetch("/api/campaigns?page=1&limit=4", { headers: { Authorization: `Bearer ${token()}` } });
        if (res.ok) {
          const data = await res.json();
          setCampaigns(Array.isArray(data) ? data : (data.data ?? []));
        }
      } catch { /* ignore */ }
      finally { setCampaignsLoading(false); }
    }
    fetchCampaigns();
  }, []);

  const fetchLiveActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/live?limit=8", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (res.ok) {
        const d = await res.json();
        setLiveActivity(d.events ?? []);
      }
    } catch {}
    finally { setLiveLoading(false); }
  }, []);

  useEffect(() => {
    fetchLiveActivity();
    const id = setInterval(fetchLiveActivity, 10_000);
    return () => clearInterval(id);
  }, [fetchLiveActivity]);

  const activeCampaigns   = campaigns.filter(c => c.status === "active").length;
  const coolingCampaigns  = campaigns.filter(c => c.status === "cooling_down").length;
  const quotaPct = quota && quota.hourlyLimit > 0
    ? Math.min(100, Math.round((quota.usedThisHour / quota.hourlyLimit) * 100))
    : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6 pb-8">

      {/* ── Gmail warning banner ─────────────────────────────────────────── */}
      {!gmailLoading && !gmailStatus?.connected && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl"
        >
          <div className="h-9 w-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="h-4.5 w-4.5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-900 text-sm">Connect Gmail to start creating drafts</p>
            <p className="text-amber-700 text-xs mt-0.5">Your emails will be saved as Gmail drafts — never auto-sent.</p>
          </div>
          <Button size="sm" onClick={handleConnectGmail} disabled={connectingGmail}
            className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg flex-shrink-0 text-xs">
            {connectingGmail ? "Connecting…" : "Connect Gmail"}
          </Button>
        </motion.div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{greeting}, {firstName}</h1>
          <p className="text-slate-500 mt-1 text-sm">Here's your BrokerMail overview for today.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2 rounded-xl border-slate-200 text-xs text-slate-600">
            <Link href="/campaigns">
              <BarChart3 className="h-3.5 w-3.5" /> Campaigns
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-2 rounded-xl shadow-sm text-xs">
            <Link href="/leads/import">
              <UploadCloud className="h-3.5 w-3.5" /> Upload &amp; Send
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Hero stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Drafts Created", icon: Mail, color: "blue" as const,
            value: statsLoading ? undefined : (stats?.totalDraftsCreated ?? 0),
            loading: statsLoading,
            sub: "All time",
          },
          {
            label: "Success Rate", icon: TrendingUp, color: "emerald" as const,
            value: statsLoading ? undefined : (stats?.draftSuccessRate ? `${stats.draftSuccessRate}%` : "—"),
            loading: statsLoading,
            sub: "Draft creation",
          },
          {
            label: "Active Campaigns", icon: Zap, color: "violet" as const,
            value: campaignsLoading ? undefined : activeCampaigns,
            loading: campaignsLoading,
            sub: coolingCampaigns > 0 ? `${coolingCampaigns} cooling down` : "Running now",
          },
          {
            label: "Quota Used", icon: BarChart3, color: quotaPct >= 80 ? "rose" as const : "amber" as const,
            value: quotaLoading ? undefined : (quota ? `${quotaPct}%` : "—"),
            loading: quotaLoading,
            sub: quota ? `${quota.usedThisHour}/${quota.hourlyLimit} this hour` : "No mailbox",
          },
        ].map((card, i) => (
          <motion.div key={card.label} custom={i} initial="hidden" animate="show" variants={fadeUp}>
            <HeroStatCard {...card} />
          </motion.div>
        ))}
      </div>

      {/* ── Quick Actions ────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { label: "Upload & Send",      desc: "Import CSV/XLSX and send personalized quotes",  href: "/leads/import",    icon: UploadCloud,      color: "bg-blue-50 text-blue-600",    i: 0 },
            { label: "Template Gallery",   desc: "Browse 10 professional email templates",         href: "/templates",       icon: FileText,         color: "bg-violet-50 text-violet-600", i: 1 },
            { label: "View Campaigns",     desc: "Manage your SMTP outreach campaigns",            href: "/campaigns",       icon: LayoutDashboard,  color: "bg-emerald-50 text-emerald-600",i: 2 },
            { label: "Sent Emails",        desc: "Track delivery, opens, and retry status",        href: "/sent-emails",     icon: Send,             color: "bg-orange-50 text-orange-600", i: 3 },
            { label: "Gmail Drafts",       desc: "View all created Gmail drafts",                  href: "/drafts",          icon: Inbox,            color: "bg-sky-50 text-sky-600",       i: 4 },
            { label: "Mailbox Settings",   desc: "Configure SMTP, IMAP, and quota limits",        href: "/mailbox",         icon: Settings,         color: "bg-slate-100 text-slate-600",  i: 5 },
          ].map(action => (
            <QuickActionCard key={action.label} {...action} />
          ))}
        </div>
      </div>

      {/* ── Main content: 2-col ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Left column (2/3) ─────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Campaign Status */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900 text-sm">Campaign Status</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Live outreach campaigns</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" asChild className="text-xs text-slate-500 hover:text-slate-900 rounded-lg gap-1">
                <Link href="/campaigns">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>

            {campaignsLoading ? (
              <div className="p-5 space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
              </div>
            ) : campaigns.length ? (
              <div className="divide-y divide-slate-50">
                {campaigns.map(c => <CampaignStatusRow key={c.id} campaign={c} />)}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-14 text-slate-400">
                <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                  <Zap className="h-6 w-6 opacity-30" />
                </div>
                <p className="text-sm font-medium">No campaigns yet</p>
                <p className="text-xs mt-1 mb-4">Upload leads to create your first campaign</p>
                <Button asChild variant="outline" size="sm" className="rounded-xl gap-1.5 text-xs">
                  <Link href="/leads/import"><UploadCloud className="h-3.5 w-3.5" /> Upload Leads</Link>
                </Button>
              </div>
            )}
          </div>

          {/* Recent Emails / Drafts */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Mail className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900 text-sm">Recent Drafts</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Latest Gmail drafts created</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" asChild className="text-xs text-slate-500 hover:text-slate-900 rounded-lg gap-1">
                <Link href="/drafts">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>

            <div className="divide-y divide-slate-50">
              {draftsLoading ? (
                <div className="p-5 space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
                </div>
              ) : recentDrafts?.data?.length ? (
                recentDrafts.data.map(draft => {
                  const statusCls =
                    draft.status === "success" ? "bg-emerald-50 text-emerald-700"
                    : draft.status === "failed" ? "bg-red-50 text-red-700"
                    : "bg-slate-100 text-slate-600";
                  const iconCls =
                    draft.status === "success" ? "bg-emerald-50 text-emerald-600"
                    : draft.status === "failed" ? "bg-red-50 text-red-500"
                    : "bg-slate-50 text-slate-400";
                  return (
                    <div key={draft.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50/70 transition-colors">
                      <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconCls}`}>
                        <Mail className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm truncate">{draft.subject}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(draft.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${statusCls}`}>
                        {draft.status}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-14 text-slate-400">
                  <Mail className="h-10 w-10 mb-3 opacity-25" />
                  <p className="text-sm font-medium">No drafts yet</p>
                  <Button asChild variant="ghost" size="sm" className="mt-3 text-blue-600 hover:text-blue-700 text-xs gap-1">
                    <Link href="/leads/import">Upload leads to create drafts →</Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right column (1/3) ────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Gmail + SMTP Health */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className={`h-9 w-9 rounded-xl ring-1 flex items-center justify-center flex-shrink-0 ${
                gmailStatus?.connected ? "bg-emerald-50 ring-emerald-100" : "bg-amber-50 ring-amber-100"
              }`}>
                {gmailStatus?.connected
                  ? <Wifi className="h-4 w-4 text-emerald-600" />
                  : <Mail className="h-4 w-4 text-amber-600" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">Gmail</p>
                  {!gmailLoading && gmailStatus?.connected && (
                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 flex-shrink-0">
                      Connected
                    </span>
                  )}
                </div>
                {gmailLoading ? <Skeleton className="h-4 w-32 mt-1" /> : gmailStatus?.connected && gmailStatus.email ? (
                  <p className="text-xs text-slate-500 truncate mt-0.5">{gmailStatus.email}</p>
                ) : (
                  <Button size="sm" onClick={handleConnectGmail} disabled={connectingGmail}
                    className="mt-1.5 h-7 px-3 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-lg">
                    {connectingGmail ? "Connecting…" : "Connect Gmail"}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* SMTP Health */}
          <SmtpHealthCard quota={quota} loading={quotaLoading} />

          {/* Live Lead Activity */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Eye className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                    Live Lead Activity
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Email opens in real time</p>
                </div>
              </div>
              <Button
                variant="ghost" size="sm"
                onClick={fetchLiveActivity}
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1.5 h-auto"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="p-3 space-y-0.5 max-h-72 overflow-auto">
              {liveLoading ? (
                <div className="space-y-2 p-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}
                </div>
              ) : liveActivity.length > 0 ? (
                <AnimatePresence initial={false}>
                  {liveActivity.map(event => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      <div className={`h-7 w-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        event.isAppleMail ? "bg-slate-50" : "bg-emerald-50"
                      }`}>
                        <Eye className={`h-3.5 w-3.5 ${event.isAppleMail ? "text-slate-400" : "text-emerald-600"}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {event.customerName ?? event.email ?? "Unknown"}
                        </p>
                        {event.email && event.customerName && (
                          <p className="text-xs text-slate-400 truncate">{event.email}</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-slate-400">{timeAgo(event.openedAt)}</span>
                          {event.isAppleMail && (
                            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                              Apple Mail
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <Eye className="h-8 w-8 mb-2 opacity-25" />
                  <p className="text-xs font-medium">No opens tracked yet</p>
                  <p className="text-xs mt-1 text-center px-4">
                    Opens appear here once a lead reads your email.
                  </p>
                </div>
              )}
            </div>
            {liveActivity.length > 0 && (
              <div className="px-5 py-2.5 border-t border-slate-50">
                <Link href="/sent-emails" className="text-xs text-primary hover:underline">
                  View all sent emails →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
