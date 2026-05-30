import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetCampaigns, useCreateCampaign, getGetCampaignsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Search, Mail, Loader2, Inbox, MoreHorizontal, Play, Pause, Ban,
  Copy, Archive, Send, BarChart3, TrendingUp, CheckCircle2, Clock,
} from "lucide-react";

type EnrichedCampaign = {
  id: number;
  name: string;
  status: string;
  templateId?: number | null;
  templateName?: string | null;
  totalLeads: number;
  draftedCount: number;
  failedCount: number;
  sentCount: number;
  sendMode: string;
  fileName?: string | null;
  cooldownUntil?: string | null;
  createdAt: string;
  updatedAt: string;
};

type CampaignSummary = {
  total: number;
  active: number;
  completed: number;
  paused: number;
  sentToday: number;
};

function timeAgo(isoDate: string): string {
  const diff  = Date.now() - new Date(isoDate).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function getStatusInfo(c: EnrichedCampaign) {
  const isCooling = c.status === "sending" && !!c.cooldownUntil && new Date(c.cooldownUntil) > new Date();
  if (isCooling) return { label: "Cooling Down", cls: "bg-orange-50 text-orange-700 ring-orange-200", dot: "solid" as const };
  switch (c.status) {
    case "pending":   return { label: "Pending",    cls: "bg-slate-50    text-slate-600   ring-slate-200",   dot: undefined };
    case "sending":   return { label: "Sending",    cls: "bg-blue-50     text-blue-700    ring-blue-200",    dot: "pulse" as const };
    case "paused":    return { label: "Paused",     cls: "bg-amber-50    text-amber-700   ring-amber-200",   dot: "solid" as const };
    case "completed": return { label: "Completed",  cls: "bg-emerald-50  text-emerald-700 ring-emerald-200", dot: undefined };
    case "cancelled": return { label: "Cancelled",  cls: "bg-red-50      text-red-700     ring-red-200",     dot: undefined };
    case "failed":    return { label: "Failed",     cls: "bg-rose-100    text-rose-800    ring-rose-300",    dot: undefined };
    default:          return { label: c.status,     cls: "bg-slate-50    text-slate-600   ring-slate-200",   dot: undefined };
  }
}

function lastActivityLabel(c: EnrichedCampaign): string {
  switch (c.status) {
    case "sending":   return `Active · ${timeAgo(c.updatedAt)}`;
    case "paused":    return `Paused ${timeAgo(c.updatedAt)}`;
    case "completed": return `Completed ${timeAgo(c.updatedAt)}`;
    case "cancelled": return `Cancelled ${timeAgo(c.updatedAt)}`;
    default:          return `Created ${timeAgo(c.createdAt)}`;
  }
}

function StatusBadge({ campaign }: { campaign: EnrichedCampaign }) {
  const { label, cls, dot } = getStatusInfo(campaign);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 whitespace-nowrap ${cls}`}>
      {dot === "pulse" && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-600" />
        </span>
      )}
      {dot === "solid" && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70 flex-shrink-0" />}
      {label}
    </span>
  );
}

function SummaryCard({
  label, value, icon: Icon, iconCls,
}: {
  label: string; value: number | string; icon: React.ElementType; iconCls: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3 min-w-0">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconCls}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-slate-900 leading-tight truncate">{value}</p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{label}</p>
      </div>
    </div>
  );
}

async function campaignPost(id: number, action: string): Promise<void> {
  const res = await fetch(`/api/campaigns/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as any).error ?? `Failed to ${action}`);
  }
}

export default function Campaigns() {
  const [page, setPage]               = useState(1);
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [cancelTarget, setCancelTarget]   = useState<EnrichedCampaign | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<EnrichedCampaign | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const queryClient  = useQueryClient();
  const { toast }    = useToast();
  const createCampaign = useCreateCampaign();

  const campaignsQuery = useGetCampaigns({
    page,
    limit: 15,
    ...(statusFilter !== "all" ? { status: statusFilter as any } : {}),
  });

  const summaryQuery = useQuery<CampaignSummary>({
    queryKey: ["campaigns-summary"],
    queryFn: async () => {
      const res = await fetch("/api/campaigns/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json();
    },
    staleTime: 30_000,
  });

  const campaigns = (campaignsQuery.data?.data ?? []) as unknown as EnrichedCampaign[];
  const summary   = summaryQuery.data;
  const total     = campaignsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  const filtered = useMemo(() => {
    if (!search.trim()) return campaigns;
    const q = search.toLowerCase();
    return campaigns.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.templateName ?? "").toLowerCase().includes(q)
    );
  }, [campaigns, search]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetCampaignsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["campaigns-summary"] });
  };

  const handleCreate = async () => {
    if (!newCampaignName.trim()) return;
    createCampaign.mutate({ data: { name: newCampaignName } }, {
      onSuccess: () => {
        toast({ title: "Campaign created" });
        setIsCreateOpen(false);
        setNewCampaignName("");
        invalidate();
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Error", description: err.message });
      },
    });
  };

  const doAction = async (id: number, action: string, label: string) => {
    const key = `${id}:${action}`;
    setLoadingAction(key);
    try {
      await campaignPost(id, action);
      toast({ title: `Campaign ${label}` });
      invalidate();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setLoadingAction(null);
    }
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    const id = cancelTarget.id;
    setLoadingAction(`${id}:cancel`);
    try {
      await campaignPost(id, "cancel");
      toast({ title: "Campaign cancelled" });
      setCancelTarget(null);
      invalidate();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setLoadingAction(null);
    }
  };

  const doArchive = async () => {
    if (!archiveTarget) return;
    const id = archiveTarget.id;
    setLoadingAction(`${id}:archive`);
    try {
      await campaignPost(id, "archive");
      toast({ title: "Campaign archived" });
      setArchiveTarget(null);
      invalidate();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
          <p className="text-slate-500 mt-0.5 text-sm">Manage your email outreach campaigns.</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 rounded-xl shadow-sm flex-shrink-0">
              <Plus className="h-4 w-4" />New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl">
            <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Campaign Name</label>
                <Input
                  placeholder="e.g. Q3 Dealership Outreach"
                  value={newCampaignName}
                  onChange={e => setNewCampaignName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
                  className="rounded-xl border-slate-200"
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={handleCreate} disabled={createCampaign.isPending || !newCampaignName.trim()} className="rounded-xl">
                {createCampaign.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Campaign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-2xl" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard label="Total Campaigns" value={summary.total}     icon={BarChart3}    iconCls="bg-slate-100 text-slate-600" />
          <SummaryCard label="Active"          value={summary.active}    icon={TrendingUp}   iconCls="bg-blue-50 text-blue-600" />
          <SummaryCard label="Completed"       value={summary.completed} icon={CheckCircle2} iconCls="bg-emerald-50 text-emerald-600" />
          <SummaryCard label="Paused"          value={summary.paused}    icon={Clock}        iconCls="bg-amber-50 text-amber-600" />
          <SummaryCard label="Sent Today"      value={summary.sentToday} icon={Send}         iconCls="bg-purple-50 text-purple-600" />
        </div>
      ) : null}

      {/* Filter row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Search campaigns…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 rounded-xl border-slate-200 bg-white h-9 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-44 h-9 rounded-xl border-slate-200 bg-white text-sm">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="sending">Sending</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Campaign list */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {campaignsQuery.isLoading ? (
          <div className="divide-y divide-slate-50">
            {Array(5).fill(0).map((_, i) => (
              <div key={i} className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-9 w-9 rounded-lg flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-44" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <Skeleton className="h-1.5 w-full rounded-full ml-12" />
              </div>
            ))}
          </div>
        ) : campaignsQuery.isError ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Inbox className="h-12 w-12 mb-3 opacity-30" />
            <p className="font-medium text-red-500 text-sm">Failed to load campaigns</p>
            <p className="text-xs mt-1 text-slate-400">{(campaignsQuery.error as any)?.message ?? "Unknown error"}</p>
            <Button variant="outline" size="sm" onClick={() => campaignsQuery.refetch()} className="mt-4 rounded-xl gap-1.5">
              Retry
            </Button>
          </div>
        ) : !filtered.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Inbox className="h-12 w-12 mb-3 opacity-30" />
            <p className="font-medium text-slate-500 text-sm">
              {search || statusFilter !== "all" ? "No matching campaigns" : "No campaigns yet"}
            </p>
            <p className="text-xs mt-1 mb-4 text-slate-400">
              {search || statusFilter !== "all"
                ? "Try clearing your search or filter."
                : "Create your first campaign to get started."}
            </p>
            {!search && statusFilter === "all" && (
              <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(true)} className="rounded-xl gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Campaign
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(campaign => {
              const sent  = campaign.sentCount ?? 0;
              const ttl   = campaign.totalLeads ?? 0;
              const pct   = ttl > 0 ? Math.round((sent / ttl) * 100) : 0;
              const isActive  = campaign.status === "sending";
              const isCooling = isActive && !!campaign.cooldownUntil && new Date(campaign.cooldownUntil) > new Date();
              const isPaused  = campaign.status === "paused";
              const isDone    = ["completed", "cancelled", "failed"].includes(campaign.status);
              const canCancel = !isDone;

              const iconBg = isActive || isCooling
                ? "bg-blue-50"
                : isPaused ? "bg-amber-50"
                : campaign.status === "completed" ? "bg-emerald-50"
                : "bg-slate-100";
              const iconColor = isActive || isCooling
                ? "text-blue-600"
                : isPaused ? "text-amber-600"
                : campaign.status === "completed" ? "text-emerald-600"
                : "text-slate-500";

              const barColor = campaign.status === "completed"
                ? "bg-emerald-500"
                : campaign.status === "cancelled" ? "bg-slate-400"
                : isActive ? "bg-blue-500"
                : "bg-slate-400";

              return (
                <div key={campaign.id} className="p-4 hover:bg-slate-50/60 transition-colors">
                  {/* Top row */}
                  <div className="flex items-start gap-3">
                    {/* Status icon */}
                    <div className={`mt-0.5 h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                      <Mail className={`h-4 w-4 ${iconColor}`} />
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/campaigns/${campaign.id}`}
                          className="font-semibold text-slate-900 hover:text-blue-600 transition-colors text-sm truncate max-w-[14rem] sm:max-w-xs"
                        >
                          {campaign.name}
                        </Link>
                        <StatusBadge campaign={campaign} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {campaign.templateName && (
                          <span className="text-xs text-slate-400">
                            Template: <span className="text-slate-600 font-medium">{campaign.templateName}</span>
                          </span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          campaign.sendMode === "smtp"
                            ? "bg-violet-50 text-violet-700"
                            : "bg-sky-50 text-sky-700"
                        }`}>
                          {campaign.sendMode === "smtp" ? "SMTP Direct" : "Gmail"}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        variant="ghost" size="sm" asChild
                        className="hidden sm:flex h-8 px-3 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                      >
                        <Link href={`/campaigns/${campaign.id}`}>Open →</Link>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg hover:bg-slate-100">
                            <MoreHorizontal className="h-4 w-4 text-slate-500" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem asChild>
                            <Link href={`/campaigns/${campaign.id}`} className="flex items-center gap-2 cursor-pointer w-full">
                              <Mail className="h-3.5 w-3.5" /> Open Campaign
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {(isActive || isCooling) && (
                            <DropdownMenuItem
                              onClick={() => doAction(campaign.id, "pause", "paused")}
                              disabled={!!loadingAction}
                              className="gap-2"
                            >
                              <Pause className="h-3.5 w-3.5" /> Pause
                            </DropdownMenuItem>
                          )}
                          {isPaused && (
                            <DropdownMenuItem
                              onClick={() => doAction(campaign.id, "resume", "resumed")}
                              disabled={!!loadingAction}
                              className="gap-2"
                            >
                              <Play className="h-3.5 w-3.5" /> Resume
                            </DropdownMenuItem>
                          )}
                          {canCancel && (
                            <DropdownMenuItem
                              onClick={() => setCancelTarget(campaign)}
                              className="gap-2 text-red-600 focus:text-red-600"
                            >
                              <Ban className="h-3.5 w-3.5" /> Cancel
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => doAction(campaign.id, "duplicate", "duplicated")}
                            disabled={!!loadingAction}
                            className="gap-2"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {loadingAction === `${campaign.id}:duplicate`
                              ? <><Loader2 className="h-3 w-3 animate-spin" /> Duplicating…</>
                              : "Duplicate"}
                          </DropdownMenuItem>
                          {isDone && (
                            <DropdownMenuItem
                              onClick={() => setArchiveTarget(campaign)}
                              className="gap-2 text-slate-500"
                            >
                              <Archive className="h-3.5 w-3.5" /> Archive
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Progress + stats */}
                  <div className="mt-3 pl-12 space-y-1.5">
                    {ttl > 0 && (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-600 font-medium">
                            {sent} <span className="text-slate-400 font-normal">/ {ttl} sent</span>
                          </span>
                          <span className="text-slate-400">{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-0.5">
                      <div className="flex items-center gap-3 text-xs">
                        {(campaign.failedCount ?? 0) > 0 && (
                          <span className="text-rose-500 font-medium">✕ {campaign.failedCount} failed</span>
                        )}
                        {ttl > 0 && sent === 0 && campaign.status === "pending" && (
                          <span className="text-slate-400">{ttl} leads ready</span>
                        )}
                        {ttl === 0 && (
                          <span className="text-slate-400 italic">No leads uploaded</span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">{lastActivityLabel(campaign)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Page {page} of {totalPages} · {total} campaigns
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg h-8 text-xs"
              >Prev</Button>
              <Button
                variant="outline" size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= totalPages}
                className="rounded-lg h-8 text-xs"
              >Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Cancel confirmation */}
      <AlertDialog open={!!cancelTarget} onOpenChange={open => !open && setCancelTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold text-slate-800">{cancelTarget?.name}</span> will be
              stopped and marked as cancelled. Emails already sent will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Keep Running</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-red-600 hover:bg-red-700"
              onClick={doCancel}
              disabled={!!loadingAction}
            >
              {loadingAction === `${cancelTarget?.id}:cancel` && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Cancel Campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive confirmation */}
      <AlertDialog open={!!archiveTarget} onOpenChange={open => !open && setArchiveTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold text-slate-800">{archiveTarget?.name}</span> will be
              hidden from your campaigns list. You can restore it by filtering for archived campaigns.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Keep</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-slate-700 hover:bg-slate-800"
              onClick={doArchive}
              disabled={!!loadingAction}
            >
              {loadingAction === `${archiveTarget?.id}:archive` && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
