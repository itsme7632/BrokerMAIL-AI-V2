import { useState, useEffect, useRef } from "react";
import { useGetDrafts } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { UploadCloud, Eye, MousePointerClick, AtSign, Clock, Mail, RefreshCw, CheckCircle2 } from "lucide-react";

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
};

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

function getAuthHeaders(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function syncSent(): Promise<{ autoMarked: number; checked: number }> {
  const res = await fetch("/api/drafts/sync-sent", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
  });
  if (!res.ok) return { autoMarked: 0, checked: 0 };
  return res.json();
}

export default function Drafts() {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useGetDrafts({ page, limit: 20 });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ autoMarked: number; checked: number } | null>(null);
  const didAutoSync = useRef(false);

  // Auto-sync once on first load (after data arrives)
  useEffect(() => {
    if (isLoading || didAutoSync.current) return;
    didAutoSync.current = true;
    (async () => {
      const result = await syncSent();
      if (result.autoMarked > 0) {
        setSyncResult(result);
        refetch();
        // Clear the banner after 6 s
        setTimeout(() => setSyncResult(null), 6000);
      }
    })();
  }, [isLoading]);

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

  const drafts = (data?.data ?? []) as unknown as DraftWithTracking[];
  const total  = data?.total ?? 0;
  const pages  = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gmail Drafts</h1>
          <p className="text-slate-500 mt-1 text-sm">
            All drafts created from your templates. Find them in your Gmail Drafts folder.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="gap-1.5 rounded-xl text-sm"
            title="Check Gmail for drafts you've already sent and activate their tracking"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
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

      {syncResult && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border ${
          syncResult.autoMarked > 0
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-slate-50 border-slate-200 text-slate-600"
        }`}>
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {syncResult.autoMarked > 0
            ? `${syncResult.autoMarked} draft${syncResult.autoMarked > 1 ? "s" : ""} auto-marked as sent — tracking is now live!`
            : `Checked ${syncResult.checked} draft${syncResult.checked !== 1 ? "s" : ""} — none sent yet.`}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/70">
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide">Status</TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide">Recipient</TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide hidden sm:table-cell">Subject</TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide text-center hidden md:table-cell">
                  <span className="flex items-center justify-center gap-1"><Eye className="h-3.5 w-3.5" /> Opens</span>
                </TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide text-center hidden md:table-cell">
                  <span className="flex items-center justify-center gap-1"><MousePointerClick className="h-3.5 w-3.5" /> Clicks</span>
                </TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide hidden lg:table-cell">Created</TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide hidden md:table-cell">Tracking</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {[1, 2, 3, 4, 5, 6, 7].map(j => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : drafts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-40 text-slate-400">
                    <div className="flex flex-col items-center gap-3">
                      <Mail className="h-8 w-8 text-slate-200" />
                      <p className="text-sm">No drafts created yet.</p>
                      <Button asChild variant="outline" size="sm" className="rounded-xl gap-1.5">
                        <Link href="/leads/import">
                          <UploadCloud className="h-3.5 w-3.5" /> Upload leads to create drafts
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                drafts.map(draft => (
                  <TableRow key={draft.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/40">
                    <TableCell>
                      <StatusBadge status={draft.status} />
                    </TableCell>
                    <TableCell>
                      {draft.email ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          <AtSign className="h-3 w-3 text-slate-400 flex-shrink-0" />
                          <span className="truncate max-w-[160px]">{draft.email}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="font-medium text-slate-900 truncate max-w-xs text-sm">{draft.subject}</div>
                      {draft.errorMessage && (
                        <div className="text-xs text-red-500 mt-0.5 truncate max-w-xs">{draft.errorMessage}</div>
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
                      <div className="text-sm text-slate-700">{new Date(draft.createdAt).toLocaleDateString()}</div>
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="outline" size="sm" disabled={page === 1}
          onClick={() => setPage(p => p - 1)} className="rounded-lg"
        >
          Previous
        </Button>
        <span className="text-sm text-slate-500">Page {page} of {pages} · {total} drafts</span>
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
