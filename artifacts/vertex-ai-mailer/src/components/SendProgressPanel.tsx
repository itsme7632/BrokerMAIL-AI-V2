import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle,
  Clock, Send, Ban, ChevronDown, ChevronUp, Gauge,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface JobStatus {
  jobId: string;
  status: "running" | "paused" | "completed";
  total: number;
  sent: number;
  failed: number;
  queued: number;
  remaining: number;
  etaSeconds: number;
  sentThisHour: number;
  hourlyLimit: number;
  remainingQuota: number;
  isHourlyLimitReached: boolean;
  results: {
    email: string;
    subject: string;
    status: string;
    error?: string;
    sentAt?: string | null;
    attempts: number;
  }[];
}

interface Props {
  jobId: string;
  delaySeconds: number;
  onComplete?: (status: JobStatus) => void;
  onReset?: () => void;
}

function formatEta(secs: number): string {
  if (secs <= 0) return "finishing…";
  if (secs < 60) return `~${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
}

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: number | string; sub?: string; color: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${color}`}>
      <p className="text-2xl font-bold leading-none">{value}</p>
      <p className="text-xs font-semibold opacity-80">{label}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

export function SendProgressPanel({ jobId, delaySeconds, onComplete, onReset }: Props) {
  const [status, setStatus]         = useState<JobStatus | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying]   = useState(false);
  const [completed, setCompleted]     = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/mailbox/send/status/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Status fetch failed"); }
      const data: JobStatus = await res.json();
      setStatus(data);
      setError(null);

      if (data.status === "completed" && !completed) {
        setCompleted(true);
        onComplete?.(data);
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, [jobId, completed, onComplete]);

  // Poll every 2 seconds while running
  useEffect(() => {
    fetchStatus();
    const id = setInterval(async () => {
      const data = await fetchStatus();
      if (data?.status === "completed") clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  async function handleCancel() {
    setIsCancelling(true);
    try {
      const token = localStorage.getItem("auth_token");
      await fetch(`/api/mailbox/send/cancel/${jobId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchStatus();
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleRetry() {
    setIsRetrying(true);
    setCompleted(false);
    try {
      const token = localStorage.getItem("auth_token");
      await fetch(`/api/mailbox/send/retry/${jobId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchStatus();
    } finally {
      setIsRetrying(false);
    }
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-center gap-3">
        <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-900">Could not fetch send status</p>
          <p className="text-xs text-red-600 mt-0.5">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStatus} className="rounded-xl flex-shrink-0">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
        </Button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        <p className="text-sm text-slate-500">Initializing send queue…</p>
      </div>
    );
  }

  const pct = status.total > 0 ? Math.round(((status.sent + status.failed) / status.total) * 100) : 0;
  const isRunning   = status.status === "running";
  const isDone      = status.status === "completed";
  const failedItems = status.results.filter(r => r.status === "failed");
  const successItems = status.results.filter(r => r.status === "success");

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className={`px-6 py-4 border-b border-slate-100 flex items-center gap-3 ${
        isDone && status.failed === 0 ? "bg-emerald-50 border-emerald-100" :
        isDone && status.failed > 0   ? "bg-amber-50 border-amber-100" :
        "bg-blue-50 border-blue-100"
      }`}>
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isDone && status.failed === 0 ? "bg-emerald-100" :
          isDone && status.failed > 0   ? "bg-amber-100" :
          "bg-blue-100"
        }`}>
          {isDone
            ? status.failed === 0
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              : <AlertTriangle className="h-5 w-5 text-amber-600" />
            : <Send className="h-5 w-5 text-blue-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-bold text-sm ${
            isDone && status.failed === 0 ? "text-emerald-900" :
            isDone && status.failed > 0   ? "text-amber-900" :
            "text-blue-900"
          }`}>
            {isDone
              ? status.failed === 0
                ? `${status.sent} email${status.sent !== 1 ? "s" : ""} delivered successfully`
                : `${status.sent} sent · ${status.failed} failed`
              : isRunning
                ? "Sending in progress…"
                : "Send paused"}
          </p>
          <p className={`text-xs mt-0.5 ${
            isDone && status.failed === 0 ? "text-emerald-700" :
            isDone && status.failed > 0   ? "text-amber-700" :
            "text-blue-700"
          }`}>
            {isDone
              ? "Your campaign has completed."
              : isRunning
                ? `${delaySeconds}s delay between emails · ETA ${formatEta(status.etaSeconds)}`
                : "Click retry to resume sending."}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isDone && isRunning && (
            <Button
              variant="ghost" size="sm"
              onClick={handleCancel}
              disabled={isCancelling}
              className="text-slate-500 hover:text-red-600 hover:bg-red-50 gap-1.5 rounded-xl text-xs"
            >
              {isCancelling
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Ban className="h-3.5 w-3.5" />}
              Cancel
            </Button>
          )}
          {(isDone || !isRunning) && status.failed > 0 && (
            <Button
              variant="outline" size="sm"
              onClick={handleRetry}
              disabled={isRetrying}
              className="rounded-xl gap-1.5 text-xs"
            >
              {isRetrying
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Retry Failed
            </Button>
          )}
          {isDone && onReset && (
            <Button variant="outline" size="sm" onClick={onReset} className="rounded-xl gap-1.5 text-xs">
              New Upload
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-6 pt-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-600">{pct}% complete</span>
          <span className="text-xs text-slate-400">{status.sent + status.failed} / {status.total}</span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              isDone && status.failed === 0 ? "bg-emerald-500" :
              isDone && status.failed > 0   ? "bg-amber-500" :
              "bg-blue-500"
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Stat cards */}
      <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Sent"
          value={status.sent}
          color="bg-emerald-50 border-emerald-100 text-emerald-800"
        />
        <StatCard
          label="Queued"
          value={status.remaining}
          sub={status.remaining > 0 ? formatEta(status.etaSeconds) : undefined}
          color="bg-blue-50 border-blue-100 text-blue-800"
        />
        <StatCard
          label="Failed"
          value={status.failed}
          color={status.failed > 0 ? "bg-red-50 border-red-100 text-red-800" : "bg-slate-50 border-slate-100 text-slate-500"}
        />
        <StatCard
          label="This Hour"
          value={`${status.sentThisHour} / ${status.hourlyLimit}`}
          sub={`${status.remainingQuota} remaining`}
          color="bg-violet-50 border-violet-100 text-violet-800"
        />
      </div>

      {/* Hourly limit warning */}
      {status.isHourlyLimitReached && !isDone && (
        <div className="px-6 pb-3">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
            <Gauge className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <p className="text-xs text-amber-800 font-medium">
              Hourly limit reached ({status.hourlyLimit}/hr). Sending will resume automatically once the window resets.
            </p>
          </div>
        </div>
      )}

      {/* Delivery settings summary */}
      {isRunning && (
        <div className="px-6 pb-3">
          <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs text-slate-600">{delaySeconds}s delay</span>
            </div>
            <div className="h-3 w-px bg-slate-200" />
            <div className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs text-slate-600">{status.hourlyLimit}/hr limit</span>
            </div>
            {status.remaining > 0 && (
              <>
                <div className="h-3 w-px bg-slate-200" />
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs text-slate-600">ETA {formatEta(status.etaSeconds)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Per-email details toggle */}
      {status.results.length > 0 && (
        <div className="border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowDetails(d => !d)}
            className="w-full px-6 py-3 flex items-center gap-2 hover:bg-slate-50 transition-colors text-left"
          >
            <span className="text-xs font-semibold text-slate-600">
              Email details
              {failedItems.length > 0 && (
                <span className="ml-2 text-red-600">· {failedItems.length} failed</span>
              )}
            </span>
            {showDetails
              ? <ChevronUp className="h-3.5 w-3.5 text-slate-400 ml-auto" />
              : <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-auto" />}
          </button>

          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-6 pb-5 space-y-2 max-h-64 overflow-y-auto">
                  {/* Failed items first */}
                  {failedItems.map((r, i) => (
                    <div key={`f-${i}`} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-red-50 border border-red-100">
                      <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-800 truncate">{r.email}</p>
                        <p className="text-xs text-red-600 mt-0.5 truncate">{r.error ?? "Send failed"}</p>
                        {r.attempts > 1 && (
                          <p className="text-xs text-slate-400 mt-0.5">{r.attempts} attempt{r.attempts !== 1 ? "s" : ""}</p>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Success items */}
                  {successItems.slice(0, 50).map((r, i) => (
                    <div key={`s-${i}`} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                      <p className="text-xs text-slate-700 truncate">{r.email}</p>
                      {r.sentAt && (
                        <p className="text-xs text-slate-400 ml-auto flex-shrink-0">
                          {new Date(r.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>
                  ))}
                  {successItems.length > 50 && (
                    <p className="text-xs text-slate-400 text-center py-1">
                      +{successItems.length - 50} more delivered
                    </p>
                  )}

                  {/* Pending / sending items */}
                  {status.results.filter(r => r.status === "pending" || r.status === "sending").slice(0, 10).map((r, i) => (
                    <div key={`q-${i}`} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-blue-50 border border-blue-100">
                      {r.status === "sending"
                        ? <Loader2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 animate-spin" />
                        : <Clock className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />}
                      <p className="text-xs text-blue-800 truncate">{r.email}</p>
                      <span className="text-xs text-blue-500 ml-auto flex-shrink-0">
                        {r.status === "sending" ? "sending…" : "queued"}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
