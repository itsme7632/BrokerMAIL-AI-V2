import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, RefreshCw, ChevronLeft, ChevronRight, Eye, AlertCircle,
  Megaphone, AlertTriangle, Mail, Server,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AdminCampaign {
  id: number; name: string; status: string; sendMode: string;
  totalLeads: number; sentCount: number; draftedCount: number; failedCount: number;
  pauseReason: string | null; cooldownUntil: string | null;
  createdAt: string; updatedAt: string;
  userId: number; userName: string | null; userEmail: string | null;
  mailboxHost: string | null; mailboxQuotaStatus: string | null;
  recentErrorsCount: number;
}

interface CampaignDetail extends AdminCampaign {
  currentJobId: string | null;
  leadCounts: Record<string, number>;
  recentFailures: { id: number; name: string; email: string; errorMessage: string | null; updatedAt: string }[];
  recentQueueErrors: { id: number; email: string; lastError: string | null; attempts: number; status: string; createdAt: string }[];
}

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

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function getStatusInfo(c: Pick<AdminCampaign, "status" | "pauseReason" | "cooldownUntil">) {
  const isCooling = c.status === "cooling_down" ||
    (c.status === "sending" && !!c.cooldownUntil && new Date(c.cooldownUntil) > new Date());
  if (isCooling) return { label: "Cooling Down", cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400" };
  if (c.status === "paused" && c.pauseReason === "SMTP_QUOTA_REACHED") {
    return { label: "Paused (SMTP Quota)", cls: "bg-red-500/10 text-red-600 dark:text-red-400" };
  }
  switch (c.status) {
    case "pending":      return { label: "Pending",      cls: "bg-muted text-muted-foreground" };
    case "sending":      return { label: "Running",      cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" };
    case "testing_smtp": return { label: "Testing SMTP", cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400" };
    case "paused":       return { label: "Paused",       cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" };
    case "completed":    return { label: "Completed",    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
    case "cancelled":    return { label: "Cancelled",    cls: "bg-red-500/10 text-red-600 dark:text-red-400" };
    case "failed":       return { label: "Failed",       cls: "bg-red-500/10 text-red-600 dark:text-red-400" };
    default:             return { label: c.status,       cls: "bg-muted text-muted-foreground" };
  }
}

function StatusBadge({ c }: { c: Pick<AdminCampaign, "status" | "pauseReason" | "cooldownUntil"> }) {
  const { label, cls } = getStatusInfo(c);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cls}`}>{label}</span>;
}

function ProgressBar({ c }: { c: AdminCampaign }) {
  const done = c.sentCount + c.draftedCount + c.failedCount;
  const pct  = c.totalLeads > 0 ? Math.min((done / c.totalLeads) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[60px]">
        <div className={`h-full rounded-full ${c.failedCount > 0 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{done}/{c.totalLeads}</span>
    </div>
  );
}

const STATUS_OPTIONS = ["all", "active", "pending", "sending", "paused", "completed", "cancelled", "failed"];
const SEND_MODE_OPTIONS = ["all", "gmail", "smtp"];

// ─── Detail modal ───────────────────────────────────────────────────────────

function CampaignDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch(`campaigns/${id}`)
      .then(d => { if (active) setDetail(d); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative w-full max-w-lg z-10 p-5 max-h-[85vh] overflow-y-auto space-y-4">
        {loading ? (
          <div className="space-y-2">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : detail ? (
          <>
            <div>
              <p className="font-semibold text-foreground text-sm">{detail.name}</p>
              <p className="text-xs text-muted-foreground">{detail.userName} · {detail.userEmail}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge c={detail} />
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground capitalize">{detail.sendMode}</span>
              {detail.pauseReason && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400">{detail.pauseReason}</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Total", detail.totalLeads],
                ["Sent", detail.sentCount + detail.draftedCount],
                ["Failed", detail.failedCount],
              ].map(([label, val]) => (
                <div key={label as string} className="rounded-xl border border-border p-2.5 text-center">
                  <p className="text-lg font-bold text-foreground">{val}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lead breakdown</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(detail.leadCounts).map(([status, cnt]) => (
                  <span key={status} className="px-2 py-0.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium capitalize">{status}: {cnt}</span>
                ))}
              </div>
            </div>
            {detail.recentFailures.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> Recent lead failures
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {detail.recentFailures.map(f => (
                    <div key={f.id} className="rounded-lg border border-border p-2 text-xs">
                      <p className="font-medium text-foreground">{f.name} <span className="text-muted-foreground">· {f.email}</span></p>
                      <p className="text-muted-foreground mt-0.5">{f.errorMessage ?? "No error message"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detail.recentQueueErrors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-red-500" /> Recent send errors
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {detail.recentQueueErrors.map(f => (
                    <div key={f.id} className="rounded-lg border border-border p-2 text-xs">
                      <p className="font-medium text-foreground">{f.email} <span className="text-muted-foreground">· attempt {f.attempts}</span></p>
                      <p className="text-muted-foreground mt-0.5">{f.lastError ?? "No error message"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
        <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
      </Card>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AdminCampaigns() {
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sendModeFilter, setSendModeFilter] = useState("all");
  const [detailId, setDetailId] = useState<number | null>(null);

  const pageCount = Math.max(Math.ceil(total / 20), 1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: "20",
        ...(search && { search }),
        ...(statusFilter   !== "all" && { status: statusFilter }),
        ...(sendModeFilter !== "all" && { sendMode: sendModeFilter }),
      });
      const data = await apiFetch(`campaigns?${params}`);
      setCampaigns(data.data); setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, sendModeFilter]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm font-medium text-foreground">Couldn't load campaigns</p>
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
          <Input placeholder="Search campaign or user…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 h-9 rounded-xl text-sm" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="h-9 px-3 rounded-xl border border-input text-sm bg-background text-foreground">
          {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o === "all" ? "All Statuses" : o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
        <select value={sendModeFilter} onChange={e => { setSendModeFilter(e.target.value); setPage(1); }}
          className="h-9 px-3 rounded-xl border border-input text-sm bg-background text-foreground">
          {SEND_MODE_OPTIONS.map(o => <option key={o} value={o}>{o === "all" ? "All Send Modes" : o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={load} className="h-9 rounded-xl gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Table — desktop */}
      <div className="hidden lg:block overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left border-b border-border">
              {["Campaign", "User", "Mode", "Status", "Progress", "Failed", "Mailbox", "Updated", ""].map(h => (
                <th key={h} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? Array(5).fill(0).map((_, i) => (
              <tr key={i} className="border-b border-border/60">
                {Array(9).fill(0).map((_, j) => <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-16" /></td>)}
              </tr>
            )) : campaigns.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-sm">
                <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No campaigns found.
              </td></tr>
            ) : campaigns.map(c => (
              <tr key={c.id} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                <td className="px-3 py-3">
                  <p className="font-medium text-foreground text-sm truncate max-w-[180px]">{c.name}</p>
                </td>
                <td className="px-3 py-3">
                  <p className="text-xs text-foreground truncate max-w-[140px]">{c.userName ?? "—"}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-[140px]">{c.userEmail ?? ""}</p>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground capitalize">{c.sendMode}</td>
                <td className="px-3 py-3"><StatusBadge c={c} /></td>
                <td className="px-3 py-3"><ProgressBar c={c} /></td>
                <td className="px-3 py-3">
                  {c.failedCount > 0 ? (
                    <span className="text-xs font-semibold text-red-600 dark:text-red-400">{c.failedCount}</span>
                  ) : <span className="text-xs text-muted-foreground">0</span>}
                </td>
                <td className="px-3 py-3">
                  {c.mailboxHost ? (
                    <div className="flex items-center gap-1.5">
                      <Server className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs text-muted-foreground truncate max-w-[100px]">{c.mailboxHost}</span>
                      {c.mailboxQuotaStatus === "quota_reached" && (
                        <span className="px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-semibold whitespace-nowrap">Quota</span>
                      )}
                    </div>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(c.updatedAt)}</td>
                <td className="px-3 py-3">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" onClick={() => setDetailId(c.id)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards — mobile/tablet */}
      <div className="lg:hidden space-y-3">
        {loading ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />) :
          campaigns.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-40" />No campaigns found.
            </div>
          ) : campaigns.map(c => (
            <Card key={c.id} className="p-4 space-y-2" onClick={() => setDetailId(c.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground text-sm truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.userName} · {c.userEmail}</p>
                </div>
                <StatusBadge c={c} />
              </div>
              <ProgressBar c={c} />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="capitalize">{c.sendMode}{c.mailboxHost ? ` · ${c.mailboxHost}` : ""}</span>
                <span>{timeAgo(c.updatedAt)}</span>
              </div>
              {c.failedCount > 0 && (
                <p className="text-xs font-medium text-red-600 dark:text-red-400">{c.failedCount} failed</p>
              )}
            </Card>
          ))
        }
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <p className="text-xs text-muted-foreground">{total} campaign{total !== 1 ? "s" : ""} total</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground min-w-[60px] text-center">{page} / {pageCount}</span>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {detailId !== null && <CampaignDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
