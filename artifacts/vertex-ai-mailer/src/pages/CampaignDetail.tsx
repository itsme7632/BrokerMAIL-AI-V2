import { useState, useEffect, useCallback, useRef } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCampaign,
  useGetLeads,
  getGetCampaignQueryKey,
  getGetLeadsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Send, Clock, CheckCircle2, XCircle, Loader2,
  Gauge, RotateCcw, ChevronDown, ChevronUp, Play, Layers,
  Mail, Server, FileText, AlertTriangle, RefreshCw, Inbox,
  Users, Timer, BarChart3, Eye, TrendingUp, ExternalLink,
  Pause, Ban, Zap,
} from "lucide-react";
import { SendProgressPanel } from "@/components/SendProgressPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CampaignProgress {
  total: number;
  sent: number;
  sending: number;
  queued: number;
  failed: number;
  remaining: number;
  sentThisHour: number;
  hourlyLimit: number;
  remainingQuota: number;
  isHourlyLimitReached: boolean;
  cooldownSeconds: number;
  currentJobId: string | null;
  isJobActive: boolean;
  sendMode: string;
  status: string;
  currentlySendingEmail: string | null;
  estimatedCompletionSeconds: number;
}

interface CampaignDiagnostics {
  campaignId: number;
  status: string;
  totalLeads: number;
  sentCount: number;
  failedCount: number;
  isJobActive: boolean;
  currentJobId: string | null;
  cooldownUntil: string | null;
  leadCounts: Record<string, number>;
  queueCounts: Record<string, number>;
  nextDeferred: {
    id: number;
    email: string;
    retryAfter: string | null;
    retryInSeconds: number | null;
    deferredCount: number | null;
    lastError: string | null;
  } | null;
}

interface CampaignBatch {
  id: number;
  jobId: string | null;
  sendMode: string;
  batchSize: number;
  sentCount: number;
  failedCount: number;
  mailboxEmail: string | null;
  createdAt: string;
}

const BATCH_SIZES = [10, 25, 50, 100] as const;

function formatSeconds(secs: number): string {
  if (secs <= 0) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function StatCard({
  label, value, sub, color, icon,
}: {
  label: string; value: number | string; sub?: string; color: string; icon?: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${color}`}>
      {icon && <div className="mb-1 opacity-70">{icon}</div>}
      <p className="text-2xl font-bold leading-none">{value}</p>
      <p className="text-xs font-semibold opacity-80">{label}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Countdown timer hook ─────────────────────────────────────────────────────
function useCooldownTimer(initialSeconds: number) {
  const [secs, setSecs] = useState(initialSeconds);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setSecs(initialSeconds);
    if (initialSeconds <= 0) return;
    ref.current = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [initialSeconds]);
  return secs;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CampaignDetail() {
  const [, params]    = useRoute("/campaigns/:id");
  const campaignId    = Number(params?.id);
  const { toast }     = useToast();
  const queryClient   = useQueryClient();

  const [leadsPage, setLeadsPage]         = useState(1);
  const [batchSize, setBatchSize]         = useState<number>(25);
  const [isSending, setIsSending]         = useState(false);
  const [progress, setProgress]           = useState<CampaignProgress | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [batches, setBatches]             = useState<CampaignBatch[]>([]);
  const [showBatches, setShowBatches]     = useState(false);
  const [showLeads, setShowLeads]         = useState(true);
  const [activeJobId, setActiveJobId]     = useState<string | null>(null);
  const [jobDelay, setJobDelay]           = useState(15);
  const [delaySettings, setDelaySettings] = useState(15);
  const [isStarting, setIsStarting]       = useState(false);
  const [isPausing, setIsPausing]         = useState(false);
  const [isCancelling, setIsCancelling]   = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics]     = useState<CampaignDiagnostics | null>(null);

  const cooldownLeft = useCooldownTimer(progress?.cooldownSeconds ?? 0);

  const { data: campaign, isLoading: isCampaignLoading } = useGetCampaign(campaignId, {
    query: { enabled: !!campaignId, queryKey: getGetCampaignQueryKey(campaignId) }
  });

  const { data: leadsData, isLoading: isLeadsLoading } = useGetLeads(
    { campaignId, page: leadsPage, limit: 10 },
    { query: { enabled: !!campaignId && showLeads } }
  );

  const { data: analytics } = useQuery({
    queryKey: ["campaign-analytics", campaignId],
    enabled: !!campaignId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`/api/campaigns/${campaignId}/analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json() as Promise<{
        total: number; sent: number; failed: number; remaining: number;
        totalOpens: number; uniqueOpens: number;
        deliveryRate: number; failedRate: number; openRate: number;
        totalClicks: number; uniqueClicks: number; clickRate: number; ctr: number;
        topClickedLinks: Array<{ url: string; label: string | null; clicks: number }>;
        sendMode: string;
        opensTimeline: Array<{ date: string; opens: number }>;
        mostEngaged: Array<{
          email: string | null; name: string | null;
          opens: number; firstOpenAt: string | null; lastOpenAt: string | null;
        }>;
      }>;
    },
  });

  // ─── Fetch progress ──────────────────────────────────────────────────────────
  const fetchProgress = useCallback(async () => {
    if (!campaignId) return;
    try {
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`/api/campaigns/${campaignId}/progress`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load progress");
      const data: CampaignProgress = await res.json();
      setProgress(data);
      setProgressError(null);
      if (data.currentJobId) setActiveJobId(data.currentJobId);
    } catch (err: any) {
      setProgressError(err.message);
    }
  }, [campaignId]);

  // ─── Fetch batch history ─────────────────────────────────────────────────────
  const fetchBatches = useCallback(async () => {
    if (!campaignId) return;
    try {
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`/api/campaigns/${campaignId}/batches`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setBatches(data.data ?? []);
    } catch { /* silent */ }
  }, [campaignId]);

  // ─── Fetch diagnostics ───────────────────────────────────────────────────────
  const fetchDiagnostics = useCallback(async () => {
    if (!campaignId) return;
    try {
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`/api/campaigns/${campaignId}/diagnostics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: CampaignDiagnostics = await res.json();
      setDiagnostics(data);
    } catch { /* silent */ }
  }, [campaignId]);

  // ─── Load mailbox delay setting ──────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch("/api/mailbox", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d?.delaySeconds) setDelaySettings(d.delaySeconds); })
      .catch(() => {});
  }, []);

  // ─── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!campaignId) return;
    fetchProgress();
    fetchBatches();
  }, [campaignId, fetchProgress, fetchBatches]);

  useEffect(() => {
    if (!campaignId || !showDiagnostics) return;
    fetchDiagnostics();
  }, [campaignId, showDiagnostics, fetchDiagnostics]);

  // ─── Poll progress while job active ─────────────────────────────────────────
  useEffect(() => {
    if (!campaignId) return;
    const interval = setInterval(() => {
      fetchProgress();
    }, 3000);
    return () => clearInterval(interval);
  }, [campaignId, fetchProgress]);

  // ─── Gmail: send next batch (drafts mode only) ───────────────────────────────
  async function handleSendBatch(size: number) {
    setIsSending(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`/api/campaigns/${campaignId}/send-batch`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ batchSize: size }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send batch");

      if (data.jobId) {
        setActiveJobId(data.jobId);
        setJobDelay(data.delaySeconds ?? delaySettings);
        toast({
          title: `${data.total} email${data.total !== 1 ? "s" : ""} queued`,
          description: `SMTP sending started with ${data.delaySeconds ?? delaySettings}s delay.`,
        });
      } else {
        toast({
          title: `${data.succeeded ?? 0} draft${(data.succeeded ?? 0) !== 1 ? "s" : ""} created`,
          description: data.failed > 0 ? `${data.failed} failed.` : "Open Gmail Drafts to review.",
        });
      }

      await Promise.all([fetchProgress(), fetchBatches()]);
      queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey({ campaignId, page: leadsPage, limit: 10 }) });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Send Error", description: err.message });
    } finally {
      setIsSending(false);
    }
  }

  // ─── SMTP: fully automated start / pause / resume / cancel ──────────────────
  async function safeJson(res: Response): Promise<any> {
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      const text = await res.text();
      throw new Error(`Server returned non-JSON response (HTTP ${res.status}). Check server logs for details.`);
    }
    return res.json();
  }

  async function handleStartCampaign() {
    setIsStarting(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`/api/campaigns/${campaignId}/start-campaign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await safeJson(res);
      if (!res.ok) {
        // Build detailed error message from PG fields if available
        const parts: string[] = [];
        if (data.error)        parts.push(data.error);
        if (data.pgDetail)     parts.push(`Detail: ${data.pgDetail}`);
        if (data.pgConstraint) parts.push(`Constraint: ${data.pgConstraint}`);
        if (data.pgCode)       parts.push(`PG code: ${data.pgCode}`);
        throw new Error(parts.join(" | ") || "Failed to start campaign");
      }
      toast({
        title: "Campaign started",
        description: `Sending ${data.total} emails automatically with ${data.delaySeconds}s delay.`,
      });
      await Promise.all([fetchProgress(), fetchBatches()]);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Start Error", description: err.message });
    } finally {
      setIsStarting(false);
    }
  }

  async function handlePauseCampaign() {
    setIsPausing(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`/api/campaigns/${campaignId}/pause`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to pause");
      toast({ title: "Campaign paused", description: "Sending will stop after the current email." });
      await fetchProgress();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Pause Error", description: err.message });
    } finally {
      setIsPausing(false);
    }
  }

  async function handleResumeCampaign() {
    setIsStarting(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`/api/campaigns/${campaignId}/resume`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to resume");
      toast({ title: "Campaign resumed", description: "Automated sending has resumed." });
      await fetchProgress();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Resume Error", description: err.message });
    } finally {
      setIsStarting(false);
    }
  }

  async function handleCancelCampaign() {
    setIsCancelling(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`/api/campaigns/${campaignId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel");
      toast({ title: "Campaign cancelled", description: "The campaign has been cancelled." });
      await Promise.all([fetchProgress(), fetchBatches()]);
      queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Cancel Error", description: err.message });
    } finally {
      setIsCancelling(false);
    }
  }

  // ─── Job complete callback ────────────────────────────────────────────────────
  function handleJobComplete() {
    fetchProgress();
    fetchBatches();
    queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey({ campaignId, page: leadsPage, limit: 10 }) });
    queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
  }

  // ─── Loading state ────────────────────────────────────────────────────────────
  if (isCampaignLoading) {
    return (
      <div className="space-y-5 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Campaign not found.</p>
        <Button asChild variant="outline" className="mt-4 rounded-xl">
          <Link href="/campaigns"><ArrowLeft className="h-4 w-4 mr-2" /> Back to Campaigns</Link>
        </Button>
      </div>
    );
  }

  // ── Single source of truth for progress ──────────────────────────────────
  // Processed = leads that are DONE (sent/drafted + failed). Queued/sending
  // leads are still in-flight and must NOT count toward completion.
  // Rule: never show 100% unless processed === total.
  const processed = (progress?.sent ?? 0) + (progress?.failed ?? 0);
  const pct       = progress && progress.total > 0
    ? (processed >= progress.total
        ? 100
        : Math.floor((processed / progress.total) * 100))
    : 0;
  const isSmtp    = (progress?.sendMode ?? campaign.sendMode) === "smtp";
  const isDone    = progress?.status === "completed" || progress?.status === "cancelled" ||
    (progress?.remaining === 0 && (progress?.queued ?? 0) === 0 && !progress?.isJobActive);
  const isActive  = progress?.isJobActive ?? false;
  const isCooling = progress?.status === "cooling_down";
  const isPaused  = progress?.status === "paused";
  const isCancelledStatus = progress?.status === "cancelled";

  const statusColors: Record<string, string> = {
    pending:      "bg-amber-100 text-amber-800",
    sending:      "bg-blue-100 text-blue-800",
    cooling_down: "bg-orange-100 text-orange-800",
    paused:       "bg-slate-100 text-slate-600",
    completed:    "bg-emerald-100 text-emerald-800",
    failed:       "bg-red-100 text-red-800",
    drafted:      "bg-violet-100 text-violet-800",
    cancelled:    "bg-slate-100 text-slate-500",
  };

  const statusLabels: Record<string, string> = {
    cooling_down: "Cooling Down",
    cancelled:    "Cancelled",
  };

  const sendModeLabel = isSmtp ? "SMTP Direct" : "Gmail Drafts";
  const sendModeIcon  = isSmtp
    ? <Server className="h-3.5 w-3.5" />
    : <Mail className="h-3.5 w-3.5" />;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* ─── Header ──────────────────────────────────────────────────────────── */}
      <div>
        <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors mb-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Campaigns
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 truncate">{campaign.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${statusColors[progress?.status ?? campaign.status] ?? "bg-slate-100 text-slate-600"}`}>
                {statusLabels[progress?.status ?? campaign.status] ?? (progress?.status ?? campaign.status)}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                {sendModeIcon} {sendModeLabel}
              </span>
              {campaign.fileName && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                  <FileText className="h-3 w-3" /> {campaign.fileName}
                </span>
              )}
              <span className="text-xs text-slate-400">
                {new Date(campaign.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Gmail open button */}
          {!isSmtp && (
            <Button variant="outline" size="sm" className="rounded-xl gap-1.5 text-xs flex-shrink-0" asChild>
              <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer">
                <Inbox className="h-3.5 w-3.5" /> Open Gmail Drafts
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* ─── Progress Bar ─────────────────────────────────────────────────────── */}
      {progress && progress.total > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-600">{pct}% complete</span>
            <span className="text-xs text-slate-400">{processed} / {progress.total} processed</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${isDone ? "bg-emerald-500" : isActive ? "bg-blue-500" : "bg-blue-400"}`}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        </div>
      )}

      {/* ─── Stat Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Leads"
          value={progress?.total ?? campaign.totalLeads}
          color="bg-slate-50 border-slate-200 text-slate-800"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label={isSmtp ? "Sent" : "Drafted"}
          value={progress?.sent ?? 0}
          sub={(progress?.sending ?? 0) > 0 ? `${progress?.sending} sending now` : undefined}
          color="bg-emerald-50 border-emerald-100 text-emerald-800"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <StatCard
          label="Remaining"
          value={(progress?.remaining ?? 0) + (progress?.queued ?? 0)}
          sub={(progress?.queued ?? 0) > 0 ? `${progress?.queued} queued` : undefined}
          color="bg-blue-50 border-blue-100 text-blue-800"
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Failed"
          value={progress?.failed ?? 0}
          color={
            (progress?.failed ?? 0) > 0
              ? "bg-red-50 border-red-100 text-red-800"
              : "bg-slate-50 border-slate-100 text-slate-500"
          }
          icon={<XCircle className="h-4 w-4" />}
        />
      </div>

      {/* ─── Hourly rate card (SMTP only) ─────────────────────────────────────── */}
      {isSmtp && progress && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-violet-700">
            <Gauge className="h-4 w-4" />
            <span className="text-sm font-semibold">Hourly Rate</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600 flex-wrap">
            <span>{progress.sentThisHour} / {progress.hourlyLimit} sent this hour</span>
            <span className="h-3 w-px bg-slate-200" />
            <span>{progress.remainingQuota} remaining quota</span>
          </div>

          {cooldownLeft > 0 && (
            <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200">
              <Timer className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-xs font-semibold text-amber-800">
                Cooldown: {formatSeconds(cooldownLeft)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ─── Cooldown warning ─────────────────────────────────────────────────── */}
      {(isCooling || cooldownLeft > 0) && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <Timer className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">Cooling down — hourly limit reached</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Sending is paused automatically.{" "}
              {cooldownLeft > 0
                ? <>Resuming in <span className="font-bold">{formatSeconds(cooldownLeft)}</span> — no action needed.</>
                : "Resuming shortly…"}
            </p>
          </div>
          {cooldownLeft > 0 && (
            <div className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-amber-100 border border-amber-200">
              <span className="text-sm font-bold text-amber-800">{formatSeconds(cooldownLeft)}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Active SMTP Job ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isSmtp && activeJobId && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            key={activeJobId}
          >
            <SendProgressPanel
              jobId={activeJobId}
              delaySeconds={jobDelay}
              onComplete={handleJobComplete}
              onReset={() => {
                setActiveJobId(null);
                fetchProgress();
                fetchBatches();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── SMTP: Automated Campaign Controls ───────────────────────────────── */}
      {isSmtp && !isCancelledStatus && progress?.status !== "completed" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isActive || isCooling ? "bg-blue-100" : isPaused ? "bg-amber-100" : "bg-slate-100"
              }`}>
                {isActive || isCooling
                  ? <Zap className="h-4 w-4 text-blue-600" />
                  : isPaused
                    ? <Pause className="h-4 w-4 text-amber-600" />
                    : <Play className="h-4 w-4 text-slate-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900">
                  {isActive && !isCooling ? "Campaign Running" :
                   isCooling ? "Cooling Down" :
                   isPaused ? "Campaign Paused" : "Ready to Send"}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {isCooling
                    ? `Resuming automatically in ${formatSeconds(cooldownLeft)}`
                    : isActive
                      ? progress?.currentlySendingEmail
                        ? `Sending to ${progress.currentlySendingEmail}…`
                        : `${progress?.remaining ?? 0} leads remaining`
                      : `${progress?.remaining ?? 0} leads remaining · ${sendModeLabel}`}
                </p>
              </div>
              {progress?.estimatedCompletionSeconds != null && progress.estimatedCompletionSeconds > 0 && isActive && (
                <div className="flex-shrink-0 text-right">
                  <p className="text-xs text-slate-400">Est. completion</p>
                  <p className="text-xs font-semibold text-slate-700">{formatSeconds(progress.estimatedCompletionSeconds)}</p>
                </div>
              )}
            </div>
          </div>

          <div className="px-5 py-4 flex gap-3 flex-wrap">
            {/* Start Campaign (pending state) */}
            {!isActive && !isCooling && !isPaused && (progress?.remaining ?? 0) > 0 && (
              <Button
                onClick={handleStartCampaign}
                disabled={isStarting}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2"
              >
                {isStarting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</>
                  : <><Send className="h-4 w-4" /> Start Campaign</>}
              </Button>
            )}

            {/* Resume Campaign (paused state) */}
            {isPaused && (
              <Button
                onClick={handleResumeCampaign}
                disabled={isStarting}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2"
              >
                {isStarting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Resuming…</>
                  : <><Play className="h-4 w-4" /> Resume Campaign</>}
              </Button>
            )}

            {/* Pause Campaign (running/cooling state) */}
            {(isActive || isCooling) && (
              <Button
                onClick={handlePauseCampaign}
                disabled={isPausing}
                variant="outline"
                className="flex-1 rounded-xl gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
              >
                {isPausing
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Pausing…</>
                  : <><Pause className="h-4 w-4" /> Pause Campaign</>}
              </Button>
            )}

            {/* Cancel Campaign (always available unless done) */}
            <Button
              onClick={handleCancelCampaign}
              disabled={isCancelling}
              variant="outline"
              className="rounded-xl gap-2 border-red-200 text-red-700 hover:bg-red-50"
            >
              {isCancelling
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Cancelling…</>
                : <><Ban className="h-4 w-4" /> Cancel</>}
            </Button>
          </div>
        </div>
      )}

      {/* ─── Gmail: Send Next Batch (drafts mode only) ────────────────────────── */}
      {!isSmtp && !isDone && (progress?.remaining ?? 0) > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                <Play className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Create Next Batch of Drafts</p>
                <p className="text-xs text-slate-500">
                  {progress?.remaining ?? 0} leads remaining · {sendModeLabel}
                </p>
              </div>
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="mb-4">
              <label className="text-xs font-semibold text-slate-600 mb-2 block">Batch Size</label>
              <div className="flex gap-2 flex-wrap">
                {BATCH_SIZES.map(n => (
                  <button
                    key={n}
                    onClick={() => setBatchSize(n)}
                    disabled={n > (progress?.remaining ?? 0)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                      batchSize === n
                        ? "border-violet-500 bg-violet-50 text-violet-800"
                        : n > (progress?.remaining ?? 0)
                          ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                          : "border-slate-200 text-slate-600 hover:border-violet-300 hover:bg-violet-50"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setBatchSize(progress?.remaining ?? 0)}
                  disabled={(progress?.remaining ?? 0) === 0}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                    batchSize === (progress?.remaining ?? 0)
                      ? "border-violet-500 bg-violet-50 text-violet-800"
                      : "border-slate-200 text-slate-600 hover:border-violet-300 hover:bg-violet-50"
                  }`}
                >
                  All ({progress?.remaining ?? 0})
                </button>
              </div>
            </div>

            <Button
              onClick={() => handleSendBatch(batchSize)}
              disabled={isSending}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-xl gap-2"
            >
              {isSending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating Drafts…</>
                : <><Mail className="h-4 w-4" /> Create {batchSize} Draft{batchSize !== 1 ? "s" : ""}</>}
            </Button>
          </div>
        </div>
      )}

      {/* ─── Deferred warning banner ──────────────────────────────────────────── */}
      {progress?.status === "paused" && !isActive && (progress?.queued ?? 0) > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {progress.queued} lead{progress.queued !== 1 ? "s" : ""} pending — some emails may be deferred
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              SMTP send failures are retried automatically. Resume the campaign to continue processing.
            </p>
          </div>
        </div>
      )}

      {/* ─── Done banner ──────────────────────────────────────────────────────── */}
      {isDone && progress && progress.total > 0 && (progress.sent > 0 || progress.failed > 0) && (
        <div className={`rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center gap-4 ${
          (progress.failed ?? 0) > 0
            ? "bg-amber-50 border-amber-200"
            : "bg-emerald-50 border-emerald-200"
        }`}>
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {(progress.failed ?? 0) > 0
              ? <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0 mt-0.5" />
              : <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0 mt-0.5" />}
            <div>
              <p className={`font-bold text-sm ${(progress.failed ?? 0) > 0 ? "text-amber-900" : "text-emerald-900"}`}>
                {(progress.failed ?? 0) > 0
                  ? `Campaign complete — ${progress.sent} sent, ${progress.failed} failed`
                  : `All ${progress.sent} ${isSmtp ? "emails sent" : "drafts created"} successfully!`}
              </p>
              <p className={`text-xs mt-0.5 ${(progress.failed ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                {(progress.failed ?? 0) > 0
                  ? "Use the Sent Emails page to retry or ignore failed emails."
                  : isSmtp ? "Check your Sent folder for delivery confirmations." : "Review your Gmail Drafts folder."}
              </p>
            </div>
          </div>
          {(progress.failed ?? 0) > 0 && (
            <Button asChild size="sm" variant="outline" className="rounded-xl gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100 flex-shrink-0">
              <Link href="/sent-emails">
                <ExternalLink className="h-3.5 w-3.5" /> Retry Failed Emails
              </Link>
            </Button>
          )}
        </div>
      )}

      {/* ─── Batch History ────────────────────────────────────────────────────── */}
      {batches.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowBatches(b => !b)}
            className="w-full px-5 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
          >
            <div className="h-8 w-8 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
              <Layers className="h-4 w-4 text-violet-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-900">Batch History</p>
              <p className="text-xs text-slate-500">{batches.length} batch{batches.length !== 1 ? "es" : ""}</p>
            </div>
            {showBatches
              ? <ChevronUp className="h-4 w-4 text-slate-400" />
              : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </button>

          <AnimatePresence>
            {showBatches && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {batches.map((batch, i) => (
                    <div key={batch.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
                      <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0">
                        {batches.length - i}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            batch.sendMode === "smtp"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-violet-50 text-violet-700"
                          }`}>
                            {batch.sendMode === "smtp" ? "SMTP" : "Gmail"}
                          </span>
                          <span className="text-xs text-slate-600">
                            Batch of <span className="font-semibold">{batch.batchSize}</span>
                          </span>
                          {(batch.sentCount + batch.failedCount < batch.batchSize) && batch.batchSize > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700">
                              In Progress
                            </span>
                          )}
                          {batch.sentCount > 0 && (
                            <span className="text-xs text-emerald-700 font-medium">
                              ✓ {batch.sentCount} sent
                            </span>
                          )}
                          {batch.failedCount > 0 && (
                            <span className="text-xs text-red-700 font-medium">
                              ✗ {batch.failedCount} failed
                            </span>
                          )}
                          {batch.mailboxEmail && (
                            <span className="text-xs text-slate-400 truncate">{batch.mailboxEmail}</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(batch.createdAt).toLocaleString([], {
                            month: "short", day: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ─── Leads Table ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowLeads(b => !b)}
          className="w-full px-5 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="h-8 w-8 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Users className="h-4 w-4 text-slate-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-900">Campaign Leads</p>
            <p className="text-xs text-slate-500">{leadsData?.total ?? 0} total</p>
          </div>
          <Button
            variant="ghost" size="sm"
            onClick={e => { e.stopPropagation(); fetchProgress(); fetchBatches(); }}
            className="text-slate-400 hover:text-slate-600 h-7 w-7 p-0 rounded-xl"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {showLeads
            ? <ChevronUp className="h-4 w-4 text-slate-400" />
            : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>

        <AnimatePresence>
          {showLeads && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="border-t border-slate-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 hidden sm:table-cell">Vehicle</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 hidden md:table-cell">Route</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {isLeadsLoading ? (
                      Array(5).fill(0).map((_, i) => (
                        <tr key={i}>
                          {[...Array(6)].map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <Skeleton className="h-4 w-full" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : leadsData?.data?.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-400">
                          No leads in this campaign yet.
                        </td>
                      </tr>
                    ) : (
                      leadsData?.data?.map(lead => {
                        const statusBadge: Record<string, string> = {
                          new:     "bg-slate-100 text-slate-600",
                          queued:  "bg-blue-100 text-blue-700",
                          sending: "bg-indigo-100 text-indigo-700",
                          sent:    "bg-emerald-100 text-emerald-700",
                          drafted: "bg-violet-100 text-violet-700",
                          failed:  "bg-red-100 text-red-700",
                        };
                        return (
                          <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 text-xs font-medium text-slate-800 truncate max-w-[120px]">
                              {lead.name || "—"}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 truncate max-w-[160px]">
                              {lead.email}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500 hidden sm:table-cell truncate max-w-[120px]">
                              {lead.vehicle || "—"}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500 hidden md:table-cell truncate max-w-[140px]">
                              {lead.pickup && lead.delivery
                                ? `${lead.pickup} → ${lead.delivery}`
                                : lead.route || "—"}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusBadge[lead.status] ?? "bg-slate-100 text-slate-600"}`}>
                                {lead.status}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {lead.status === "failed" && (
                                <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-xs rounded-lg text-red-600 hover:bg-red-50 gap-1">
                                  <Link href="/sent-emails">
                                    <RotateCcw className="h-3 w-3" /> Retry
                                  </Link>
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-5 py-3 flex items-center justify-between border-t border-slate-100">
                <Button
                  variant="outline" size="sm"
                  disabled={leadsPage === 1}
                  onClick={() => setLeadsPage(p => p - 1)}
                  className="rounded-xl text-xs"
                >
                  Previous
                </Button>
                <span className="text-xs text-slate-400">
                  Page {leadsData?.page ?? 1} of {Math.max(1, Math.ceil((leadsData?.total ?? 0) / 10))}
                </span>
                <Button
                  variant="outline" size="sm"
                  disabled={leadsPage >= Math.ceil((leadsData?.total ?? 0) / 10)}
                  onClick={() => setLeadsPage(p => p + 1)}
                  className="rounded-xl text-xs"
                >
                  Next
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Campaign Analytics ─────────────────────────────────────────────── */}
        {analytics && campaign?.sendMode === "smtp" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50/60 transition-colors"
              onClick={() => {}}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <BarChart3 className="h-4 w-4 text-slate-500" />
                Campaign Analytics
              </div>
            </button>
            <div className="border-t border-slate-100 px-5 py-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: "Delivery Rate",
                    value: `${analytics.deliveryRate}%`,
                    sub: `${analytics.sent} of ${analytics.total} sent`,
                    color: "emerald",
                    icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
                  },
                  {
                    label: "Open Rate",
                    value: `${analytics.openRate}%`,
                    sub: `${analytics.uniqueOpens} unique opens`,
                    color: "blue",
                    icon: <Eye className="h-4 w-4 text-blue-500" />,
                  },
                  {
                    label: "Total Opens",
                    value: analytics.totalOpens,
                    sub: analytics.totalOpens !== analytics.uniqueOpens
                      ? `${analytics.totalOpens - analytics.uniqueOpens} re-opens`
                      : "all unique",
                    color: "violet",
                    icon: <TrendingUp className="h-4 w-4 text-violet-500" />,
                  },
                  {
                    label: "Failed Rate",
                    value: `${analytics.failedRate}%`,
                    sub: `${analytics.failed} failed`,
                    color: analytics.failed > 0 ? "red" : "slate",
                    icon: <XCircle className={`h-4 w-4 ${analytics.failed > 0 ? "text-red-500" : "text-slate-400"}`} />,
                  },
                ].map(s => (
                  <div key={s.label} className="bg-slate-50 rounded-xl p-3.5">
                    <div className="mb-1.5">{s.icon}</div>
                    <div className="text-xl font-bold text-slate-900">{s.value}</div>
                    <div className="text-xs font-medium text-slate-600 mt-0.5">{s.label}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{s.sub}</div>
                  </div>
                ))}
              </div>
              {analytics.sent > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                    <span>Delivery</span>
                    <span>{analytics.deliveryRate}%</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                      style={{ width: `${analytics.deliveryRate}%` }}
                    />
                  </div>
                  {analytics.uniqueOpens > 0 && (
                    <>
                      <div className="flex justify-between text-xs text-slate-500 mb-1.5 mt-2">
                        <span>Opens</span>
                        <span>{analytics.openRate}%</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-700"
                          style={{ width: `${analytics.openRate}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* Opens Timeline */}
              {analytics.opensTimeline && analytics.opensTimeline.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-600 mb-3">Opens per Day (last 14 days)</p>
                  <div className="flex items-end gap-1 h-16">
                    {(() => {
                      const maxOpens = Math.max(...analytics.opensTimeline.map(r => r.opens), 1);
                      return analytics.opensTimeline.map((r, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group">
                          <div
                            className="w-full bg-blue-500 rounded-sm transition-all duration-300 group-hover:bg-blue-600"
                            style={{ height: `${Math.max(4, Math.round((r.opens / maxOpens) * 56))}px` }}
                            title={`${new Date(r.date).toLocaleDateString([], { month: "short", day: "numeric" })}: ${r.opens} open${r.opens !== 1 ? "s" : ""}`}
                          />
                          <span className="text-[9px] text-slate-400 rotate-[-45deg] origin-center" style={{ display: "none" }}>
                            {new Date(r.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                          </span>
                        </div>
                      ));
                    })()}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                    <span>{new Date(analytics.opensTimeline[0].date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                    <span>{new Date(analytics.opensTimeline[analytics.opensTimeline.length - 1].date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                  </div>
                </div>
              )}

              {/* Click Metrics */}
              {analytics.totalClicks > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-600 mb-3">CTA Button Clicks</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    {[
                      {
                        label: "Total Clicks",
                        value: analytics.totalClicks,
                        sub: `${analytics.uniqueClicks} unique`,
                        icon: <ExternalLink className="h-4 w-4 text-green-500" />,
                      },
                      {
                        label: "Click Rate",
                        value: `${analytics.clickRate}%`,
                        sub: "of delivered emails",
                        icon: <TrendingUp className="h-4 w-4 text-blue-500" />,
                      },
                      {
                        label: "CTR",
                        value: `${analytics.ctr}%`,
                        sub: "of openers clicked",
                        icon: <TrendingUp className="h-4 w-4 text-violet-500" />,
                      },
                      {
                        label: "Links Clicked",
                        value: analytics.topClickedLinks?.length ?? 0,
                        sub: "unique destinations",
                        icon: <ExternalLink className="h-4 w-4 text-slate-400" />,
                      },
                    ].map(s => (
                      <div key={s.label} className="bg-slate-50 rounded-xl p-3.5">
                        <div className="mb-1.5">{s.icon}</div>
                        <div className="text-xl font-bold text-slate-900">{s.value}</div>
                        <div className="text-xs font-medium text-slate-600 mt-0.5">{s.label}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{s.sub}</div>
                      </div>
                    ))}
                  </div>
                  {analytics.topClickedLinks && analytics.topClickedLinks.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-500 mb-2">Top Clicked Links</p>
                      {analytics.topClickedLinks.map((link, i) => (
                        <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3.5 py-2.5">
                          <div className="h-6 w-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-green-700">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {link.label ?? link.url}
                            </p>
                            {link.label && (
                              <p className="text-xs text-slate-400 truncate" title={link.url}>{link.url}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <ExternalLink className="h-3 w-3 text-green-500" />
                            <span className="text-xs font-bold text-slate-800">{link.clicks}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Most Engaged Leads */}
              {analytics.mostEngaged && analytics.mostEngaged.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-600 mb-3">Most Engaged Leads</p>
                  <div className="space-y-2">
                    {analytics.mostEngaged.map((lead, i) => (
                      <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3.5 py-2.5">
                        <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-700">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {lead.name ?? lead.email ?? "Unknown"}
                          </p>
                          {lead.name && (
                            <p className="text-xs text-slate-400 truncate">{lead.email}</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="flex items-center gap-1 justify-end">
                            <Eye className="h-3 w-3 text-blue-500" />
                            <span className="text-xs font-bold text-slate-800">{lead.opens}</span>
                          </div>
                          {lead.lastOpenAt && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {(() => {
                                const ts = lead.lastOpenAt.endsWith("Z") || lead.lastOpenAt.includes("+")
                                  ? lead.lastOpenAt : lead.lastOpenAt + "Z";
                                const diff = Math.max(0, Date.now() - new Date(ts).getTime());
                                const m = Math.floor(diff / 60000);
                                if (m < 1)  return "just now";
                                if (m < 60) return `${m}m ago`;
                                const h = Math.floor(m / 60);
                                if (h < 24) return `${h}h ago`;
                                return `${Math.floor(h / 24)}d ago`;
                              })()}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 flex justify-end">
                <Link href="/sent-emails" className="text-xs text-primary hover:underline flex items-center gap-1">
                  View all sent emails →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* ─── Diagnostics Panel ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => { setShowDiagnostics(b => !b); if (!showDiagnostics) fetchDiagnostics(); }}
            className="w-full px-5 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
          >
            <div className="h-8 w-8 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
              <Gauge className="h-4 w-4 text-slate-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-900">Diagnostics</p>
              <p className="text-xs text-slate-500">Raw campaign &amp; queue state</p>
            </div>
            {showDiagnostics
              ? <ChevronUp className="h-4 w-4 text-slate-400" />
              : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </button>
          <AnimatePresence>
            {showDiagnostics && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="border-t border-slate-100 px-5 py-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-700">Campaign State</p>
                    <button
                      onClick={fetchDiagnostics}
                      className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                    >
                      <RefreshCw className="h-3 w-3" /> Refresh
                    </button>
                  </div>

                  {diagnostics ? (
                    <>
                      {/* ── Progress Calculation Debug ─────────────────────── */}
                      <div className="bg-slate-900 rounded-xl px-4 py-3 text-xs font-mono space-y-1">
                        <p className="text-slate-400 text-[10px] uppercase tracking-widest font-semibold mb-2">Progress Calculation</p>
                        {(() => {
                          const diagSent    = (diagnostics.leadCounts?.sent    ?? 0) + (diagnostics.leadCounts?.drafted ?? 0);
                          const diagFailed  = diagnostics.leadCounts?.failed   ?? 0;
                          const diagQueued  = diagnostics.leadCounts?.queued   ?? 0;
                          const diagSending = diagnostics.leadCounts?.sending  ?? 0;
                          const diagNew     = diagnostics.leadCounts?.new      ?? 0;
                          const diagTotal   = diagnostics.totalLeads           ?? 0;
                          const diagDeferred = diagnostics.queueCounts?.deferred ?? 0;
                          const diagProcessed = diagSent + diagFailed;
                          const diagPct = diagTotal > 0
                            ? (diagProcessed >= diagTotal ? 100 : Math.floor((diagProcessed / diagTotal) * 100))
                            : 0;
                          return (
                            <>
                              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                                <span className="text-slate-400">Total Leads</span>
                                <span className="text-white font-bold">{diagTotal}</span>
                                <span className="text-emerald-400">Sent / Drafted</span>
                                <span className="text-emerald-300 font-bold">{diagSent}</span>
                                <span className="text-red-400">Failed</span>
                                <span className="text-red-300 font-bold">{diagFailed}</span>
                                <span className="text-blue-400">Queued</span>
                                <span className="text-blue-300 font-bold">{diagQueued}</span>
                                <span className="text-blue-400">Sending Now</span>
                                <span className="text-blue-300 font-bold">{diagSending}</span>
                                <span className="text-amber-400">Deferred</span>
                                <span className="text-amber-300 font-bold">{diagDeferred}</span>
                                <span className="text-slate-400">Not Started</span>
                                <span className="text-slate-300 font-bold">{diagNew}</span>
                              </div>
                              <div className="border-t border-slate-700 mt-2 pt-2 flex items-center justify-between">
                                <span className="text-slate-400">Calculated Progress</span>
                                <span className={`font-bold text-sm ${diagPct === 100 ? "text-emerald-400" : "text-white"}`}>
                                  ({diagSent} + {diagFailed}) / {diagTotal} = <span className="text-yellow-300">{diagPct}%</span>
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                        {[
                          { label: "Campaign Status", value: diagnostics.status },
                          { label: "Total Leads", value: diagnostics.totalLeads },
                          { label: "Job Active", value: diagnostics.isJobActive ? "Yes" : "No" },
                          { label: "sentCount (DB)", value: diagnostics.sentCount },
                          { label: "failedCount (DB)", value: diagnostics.failedCount },
                          { label: "Cooldown Until", value: diagnostics.cooldownUntil
                            ? new Date(diagnostics.cooldownUntil).toLocaleTimeString()
                            : "—" },
                        ].map(r => (
                          <div key={r.label} className="bg-slate-50 rounded-xl px-3 py-2">
                            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{r.label}</p>
                            <p className="font-bold text-slate-800 mt-0.5">{String(r.value)}</p>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-600 mb-2">Lead Status Counts</p>
                          <div className="space-y-1">
                            {Object.entries(diagnostics.leadCounts).map(([status, count]) => (
                              <div key={status} className="flex items-center justify-between text-xs px-3 py-1.5 bg-slate-50 rounded-lg">
                                <span className="capitalize text-slate-600">{status}</span>
                                <span className="font-bold text-slate-800">{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-600 mb-2">Queue Status Counts</p>
                          <div className="space-y-1">
                            {Object.entries(diagnostics.queueCounts).map(([status, count]) => (
                              <div key={status} className="flex items-center justify-between text-xs px-3 py-1.5 bg-slate-50 rounded-lg">
                                <span className="capitalize text-slate-600">{status}</span>
                                <span className="font-bold text-slate-800">{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {diagnostics.nextDeferred && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs">
                          <p className="font-semibold text-amber-900 mb-1">Next Deferred Item</p>
                          <p className="text-amber-700">{diagnostics.nextDeferred.email}</p>
                          <p className="text-amber-600 mt-0.5">
                            Retries: {diagnostics.nextDeferred.deferredCount ?? 0} ·
                            {diagnostics.nextDeferred.retryInSeconds != null
                              ? ` Ready in ${formatSeconds(diagnostics.nextDeferred.retryInSeconds)}`
                              : " Ready now"}
                          </p>
                          {diagnostics.nextDeferred.lastError && (
                            <p className="text-amber-600 mt-0.5 truncate" title={diagnostics.nextDeferred.lastError}>
                              Error: {diagnostics.nextDeferred.lastError}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">Loading diagnostics…</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
