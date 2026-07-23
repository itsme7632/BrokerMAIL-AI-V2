import { useState, useEffect, useRef, useCallback } from "react";
import { useGetDrafts, GetDraftsStatus } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useLocation } from "wouter";
import {
  UploadCloud, Eye, MousePointerClick, AtSign, Clock, Mail,
  RefreshCw, CheckCircle2, Search, RotateCcw, AlertTriangle,
  Loader2, XCircle, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type DraftWithTracking = {
  id: number;
  subject: string;
  email?: string | null;
  status: string;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt: string;
  opens: number;
  clicks: number;
  campaignId?: number | null;
  leadId?: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function isGmailAuthErrorMessage(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("invalid_grant") ||
    m.includes("token has been expired") ||
    m.includes("invalid credentials") ||
    m.includes("gmail authorization") ||
    m.includes("reconnect your gmail") ||
    m.includes("auth_gmail")
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed:  "bg-red-50 text-red-600 border-red-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
      {status}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { label: "All",     value: undefined },
  { label: "Success", value: "success" },
  { label: "Failed",  value: "failed"  },
  { label: "Pending", value: "pending" },
] as const;

async function syncSent(): Promise<{ autoMarked: number; checked: number }> {
  const res = await fetch("/api/drafts/sync-sent", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
  });
  if (!res.ok) return { autoMarked: 0, checked: 0 };
  return res.json();
}

export default function Drafts() {
  const [, navigate]        = useLocation();
  const { toast }           = useToast();
  const [page, setPage]     = useState(1);
  const [statusFilter, setStatusFilter] = useState<GetDraftsStatus | undefined>(undefined);
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch } = useGetDrafts({
    page,
    limit: 20,
    ...(statusFilter ? { status: statusFilter } : {}),
  });

  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState<{ autoMarked: number; checked: number } | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [authError, setAuthError]   = useState<string | null>(null);
  const didAutoSync = useRef(false);

  // Auto-sync once on first load
  useEffect(() => {
    if (isLoading || didAutoSync.current) return;
    didAutoSync.current = true;
    (async () => {
      const result = await syncSent();
      if (result.autoMarked > 0) {
        setSyncResult(result);
        refetch();
        setTimeout(() => setSyncResult(null), 6000);
      }
    })();
  }, [isLoading]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [statusFilter]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncSent();
      setSyncResult(result);
      if (result.autoMarked > 0) refetch();
      setTimeout(() => setSyncResult(null), 6000);
    } finally {
      setSyncing(false);
    }
  }

  // ── Single draft retry ──────────────────────────────────────────────────────
  const handleRetry = useCallback(async (draft: DraftWithTracking) => {
    setRetryingId(draft.id);
    setAuthError(null);
    try {
      // First try the draft retry endpoint
      const res = await fetch(`/api/drafts/${draft.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      });
      const data = await res.json();

      // If backend says we need the campaign retry (no stored content), delegate
      if (data.requiresCampaignRetry && draft.campaignId && draft.leadId) {
        const r2 = await fetch(`/api/campaigns/${draft.campaignId}/leads/${draft.leadId}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        });
        const d2 = await r2.json();
        if (!r2.ok) throw new Error(d2.error ?? "Retry failed");
        toast({ title: "Draft retried", description: "Gmail draft recreated successfully." });
        refetch();
        return;
      }

      if (!res.ok) throw new Error(data.error ?? "Retry failed");
      toast({ title: "Draft retried", description: "Gmail draft recreated successfully." });
      refetch();
    } catch (e: any) {
      const msg = e.message ?? "Retry failed";
      if (isGmailAuthErrorMessage(msg)) {
        setAuthError("Gmail authorization has expired. Please reconnect your Gmail account from Settings → Brand Settings.");
      } else {
        toast({ title: "Retry failed", description: msg, variant: "destructive" });
      }
    } finally {
      setRetryingId(null);
    }
  }, [refetch, toast]);

  // ── Bulk retry all failed drafts ────────────────────────────────────────────
  const handleRetryAllFailed = useCallback(async () => {
    setRetryingAll(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/drafts/retry-all-failed", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      });
      const data = await res.json();

      if (!res.ok) {
        const msg = data.error ?? "Retry failed";
        if (isGmailAuthErrorMessage(msg) || data.errorCategory === "auth_gmail") {
          setAuthError("Gmail authorization has expired. Please reconnect your Gmail account from Settings → Brand Settings.");
        } else {
          toast({ title: "Retry failed", description: msg, variant: "destructive" });
        }
        return;
      }

      if (data.errors?.length && isGmailAuthErrorMessage(data.errors[0])) {
        setAuthError("Gmail authorization has expired. Please reconnect your Gmail account from Settings → Brand Settings.");
      } else if (data.succeeded > 0) {
        toast({
          title: `${data.succeeded} draft${data.succeeded !== 1 ? "s" : ""} retried`,
          description: data.failed > 0 ? `${data.failed} failed. ${data.skipped > 0 ? `${data.skipped} skipped (retry from campaign page).` : ""}` : "All failed drafts recreated successfully.",
        });
      } else {
        toast({
          title: "Retry completed",
          description: data.skipped > 0
            ? `${data.skipped} draft${data.skipped !== 1 ? "s" : ""} require retrying from the campaign page (no stored content).`
            : "No drafts were successfully retried.",
          variant: "destructive",
        });
      }
      refetch();
    } finally {
      setRetryingAll(false);
    }
  }, [refetch, toast]);

  const allDrafts = (data?.data ?? []) as unknown as DraftWithTracking[];
  const total     = data?.total ?? 0;
  const pages     = Math.max(1, Math.ceil(total / 20));

  // Client-side search (email + subject)
  const drafts = search.trim()
    ? allDrafts.filter(d =>
        d.email?.toLowerCase().includes(search.toLowerCase()) ||
        d.subject?.toLowerCase().includes(search.toLowerCase())
      )
    : allDrafts;

  const failedCount = allDrafts.filter(d => d.status === "failed").length;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Gmail Drafts</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
            All drafts created from your templates. Find them in your Gmail Drafts folder.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {failedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetryAllFailed}
              disabled={retryingAll}
              className="gap-1.5 rounded-xl text-sm border-red-200 text-red-700 hover:bg-red-50"
            >
              {retryingAll
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RotateCcw className="h-3.5 w-3.5" />}
              {retryingAll ? "Retrying…" : `Retry All Failed (${failedCount})`}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="gap-1.5 rounded-xl text-sm"
            title="Check Gmail for drafts you've already sent and activate their tracking"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? "Checking Gmail…" : "Sync from Gmail"}
          </Button>
          <Button asChild className="gap-2 rounded-xl shadow-sm">
            <Link href="/leads/import">
              <UploadCloud className="h-4 w-4" />
              Upload &amp; Send
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Auth error banner ───────────────────────────────────────────────── */}
      {authError && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Gmail Authorization Expired</p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{authError}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100 text-xs"
              onClick={() => navigate("/settings")}
            >
              <Settings className="h-3.5 w-3.5" /> Reconnect Gmail
            </Button>
            <button onClick={() => setAuthError(null)} className="text-amber-500 hover:text-amber-700">
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Sync result banner ──────────────────────────────────────────────── */}
      {syncResult && (
        <div className={cn(
          "flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border",
          syncResult.autoMarked > 0
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-slate-50 border-slate-200 text-slate-600"
        )}>
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {syncResult.autoMarked > 0
            ? `${syncResult.autoMarked} draft${syncResult.autoMarked > 1 ? "s" : ""} auto-marked as sent — tracking is now live!`
            : `Checked ${syncResult.checked} draft${syncResult.checked !== 1 ? "s" : ""} — none sent yet.`}
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Status tabs */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={String(f.value)}
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                statusFilter === f.value
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email or subject…"
            className="pl-8 h-9 rounded-xl text-sm"
          />
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/70 dark:bg-slate-800/50">
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wide">Status</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wide">Recipient</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wide hidden sm:table-cell">Subject</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wide text-center hidden md:table-cell">
                  <span className="flex items-center justify-center gap-1"><Eye className="h-3.5 w-3.5" /> Opens</span>
                </TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wide text-center hidden md:table-cell">
                  <span className="flex items-center justify-center gap-1"><MousePointerClick className="h-3.5 w-3.5" /> Clicks</span>
                </TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wide hidden lg:table-cell">Created</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wide hidden md:table-cell">Tracking</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wide">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(j => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : drafts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center h-40 text-slate-400">
                    <div className="flex flex-col items-center gap-3">
                      <Mail className="h-8 w-8 text-slate-200" />
                      <p className="text-sm">
                        {search
                          ? `No drafts match "${search}"`
                          : statusFilter
                            ? `No ${statusFilter} drafts.`
                            : "No drafts created yet."}
                      </p>
                      {!search && !statusFilter && (
                        <Button asChild variant="outline" size="sm" className="rounded-xl gap-1.5">
                          <Link href="/leads/import">
                            <UploadCloud className="h-3.5 w-3.5" /> Upload leads to create drafts
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                drafts.map(draft => (
                  <TableRow key={draft.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <TableCell>
                      <StatusBadge status={draft.status} />
                    </TableCell>

                    <TableCell>
                      {draft.email ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                          <AtSign className="h-3 w-3 text-slate-400 flex-shrink-0" />
                          <span className="truncate max-w-[160px]">{draft.email}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">—</span>
                      )}
                    </TableCell>

                    <TableCell className="hidden sm:table-cell">
                      <div className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-xs text-sm">{draft.subject || <span className="text-slate-400 italic">No subject</span>}</div>
                      {draft.errorMessage && (
                        <div className="text-xs mt-0.5 max-w-xs">
                          {isGmailAuthErrorMessage(draft.errorMessage) ? (
                            <span className="text-amber-600 font-medium flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Gmail authorization expired
                            </span>
                          ) : (
                            <span className="text-red-500 truncate block">{draft.errorMessage}</span>
                          )}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="text-center hidden md:table-cell">
                      {draft.opens > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                          <Eye className="h-3 w-3" />{draft.opens}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-center hidden md:table-cell">
                      {draft.clicks > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-xs font-medium">
                          <MousePointerClick className="h-3 w-3" />{draft.clicks}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </TableCell>

                    <TableCell className="hidden lg:table-cell">
                      <div className="text-sm text-slate-700 dark:text-slate-300">{new Date(draft.createdAt).toLocaleDateString()}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {new Date(draft.createdAt).toLocaleTimeString()}
                      </div>
                    </TableCell>

                    <TableCell className="hidden md:table-cell">
                      {draft.status === "success" && (
                        draft.sentAt ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
                            <CheckCircle2 className="h-3 w-3" /> Sent
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Pending send…</span>
                        )
                      )}
                    </TableCell>

                    <TableCell>
                      {draft.status === "failed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-lg gap-1.5 text-xs h-7 border-red-200 text-red-700 hover:bg-red-50"
                          disabled={retryingId === draft.id}
                          onClick={() => handleRetry(draft)}
                        >
                          {retryingId === draft.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <RotateCcw className="h-3 w-3" />}
                          {retryingId === draft.id ? "Retrying…" : "Retry"}
                        </Button>
                      )}
                      {draft.status === "success" && draft.campaignId && (
                        <Link href={`/campaigns/${draft.campaignId}`}>
                          <span className="text-xs text-blue-600 hover:underline cursor-pointer">View Campaign</span>
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline" size="sm" disabled={page === 1}
          onClick={() => setPage(p => p - 1)} className="rounded-lg"
        >
          Previous
        </Button>
        <span className="text-sm text-slate-500">
          Page {page} of {pages} · {total} draft{total !== 1 ? "s" : ""}
          {search && drafts.length !== allDrafts.length && ` (${drafts.length} shown)`}
        </span>
        <Button
          variant="outline" size="sm" disabled={page >= pages}
          onClick={() => setPage(p => p + 1)} className="rounded-lg"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
