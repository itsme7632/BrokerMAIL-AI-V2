/**
 * AdminCommMonitor.tsx — Communications Inbox Sync Monitor
 *
 * Shows real-time sync status, live browser connections, mailbox health,
 * last-sync results, and cron-job state for the commSync loop.
 */
import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, Loader2, RefreshCw,
  Wifi, Clock, Activity, MessageSquare,
  Mail, AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncStatus {
  isSyncing: boolean;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  liveConnections: number;
  mailboxes: Array<{
    email: string;
    type: "gmail" | "smtp";
    connected: boolean;
    lastSyncAt: string | null;
  }>;
  lastSyncResults: Array<{
    mailbox: string;
    imported: number;
    error?: string;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token") ?? "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  === 1) return "Yesterday";
  return `${days}d ago`;
}

function timeIn(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const mins = Math.ceil(diff / 60_000);
  return `in ${mins}m`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdminCommMonitor() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: syncStatus, isLoading, refetch } = useQuery<SyncStatus>({
    queryKey: ["admin-comm-sync-status"],
    queryFn:  () => apiFetch("/api/communications/sync-status"),
    refetchInterval: 15_000,
  });

  const handleForceSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await apiFetch<{ totalImported: number }>("/api/communications/sync", { method: "POST" });
      toast({
        title: "Sync complete",
        description: result.totalImported > 0
          ? `Imported ${result.totalImported} new message${result.totalImported === 1 ? "" : "s"}`
          : "Inbox is already up to date",
      });
      setTimeout(() => { refetch(); queryClient.invalidateQueries({ queryKey: ["admin-comm-sync-status"] }); }, 1_500);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Sync failed", description: e.message });
    } finally {
      setSyncing(false);
    }
  }, [syncing, toast, refetch, queryClient]);

  // ── Status cards ──────────────────────────────────────────────────────────

  const statCards = [
    {
      icon: Activity,
      label: "Sync Status",
      value: isLoading ? "—" : syncStatus?.isSyncing ? "Syncing…" : "Idle",
      color: syncStatus?.isSyncing
        ? "text-blue-600 dark:text-blue-400"
        : "text-emerald-600 dark:text-emerald-400",
    },
    {
      icon: Clock,
      label: "Last Sync",
      value: isLoading ? "—" : syncStatus?.lastSyncAt ? timeAgo(syncStatus.lastSyncAt) : "Never",
      color: "text-slate-700 dark:text-slate-300",
    },
    {
      icon: RefreshCw,
      label: "Next Auto-Sync",
      value: isLoading ? "—" : syncStatus?.nextSyncAt ? timeIn(syncStatus.nextSyncAt) : "—",
      color: "text-slate-700 dark:text-slate-300",
    },
    {
      icon: Wifi,
      label: "Live Tabs",
      value: isLoading ? "—" : String(syncStatus?.liveConnections ?? 0),
      color: (syncStatus?.liveConnections ?? 0) > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-slate-400",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Communications Monitor
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Real-time inbox sync · live connection tracking · mailbox health
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5 text-xs h-8"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleForceSync}
            disabled={syncing || syncStatus?.isSyncing}
            className="gap-1.5 text-xs h-8"
          >
            {syncing || syncStatus?.isSyncing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Mail className="h-3.5 w-3.5" />
            }
            Force Sync
          </Button>
        </div>
      </div>

      {/* ── Status cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(({ icon: Icon, label, value, color }) => (
          <Card key={label} className="p-4 dark:bg-slate-800/60">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[10px] text-slate-400 uppercase tracking-wide font-medium">
                {label}
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <p className={cn("text-xl font-bold", color)}>{value}</p>
            )}
          </Card>
        ))}
      </div>

      {/* ── Mailbox health ─────────────────────────────────────────────────── */}
      <Card className="dark:bg-slate-800/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Mailbox Health</h3>
          <span className="text-[10px] text-slate-400">
            {isLoading ? "…" : `${syncStatus?.mailboxes.length ?? 0} mailbox${(syncStatus?.mailboxes.length ?? 0) !== 1 ? "es" : ""}`}
          </span>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : !syncStatus?.mailboxes.length ? (
          <div className="py-10 text-center">
            <Mail className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No mailboxes connected</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Users can connect Gmail or SMTP from their Mailbox Settings
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/40">
            {syncStatus.mailboxes.map(mb => (
              <div key={mb.email} className="px-4 py-3 flex items-center gap-3">
                <div className={cn(
                  "h-2.5 w-2.5 rounded-full flex-shrink-0 ring-2 ring-offset-1",
                  mb.connected
                    ? "bg-emerald-500 ring-emerald-200 dark:ring-emerald-900"
                    : "bg-red-500 ring-red-200 dark:ring-red-900",
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                    {mb.email}
                  </p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">{mb.type}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={cn(
                    "text-xs font-medium",
                    mb.connected ? "text-emerald-600 dark:text-emerald-400" : "text-red-500",
                  )}>
                    {mb.connected ? "Connected" : "Disconnected"}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {mb.lastSyncAt ? `Synced ${timeAgo(mb.lastSyncAt)}` : "Never synced"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Last sync results ──────────────────────────────────────────────── */}
      {(syncStatus?.lastSyncResults.length ?? 0) > 0 && (
        <Card className="dark:bg-slate-800/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Last Sync Results
            </h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700/40">
            {syncStatus!.lastSyncResults.map((r, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                {r.error ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 dark:text-slate-200 truncate">{r.mailbox}</p>
                  {r.error && (
                    <p className="text-[10px] text-red-500 truncate">{r.error}</p>
                  )}
                </div>
                <span className={cn(
                  "text-sm font-semibold flex-shrink-0",
                  r.imported > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400",
                )}>
                  {r.imported === 0 ? "No new msgs" : `+${r.imported} imported`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Info note ──────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 text-xs text-blue-700 dark:text-blue-400">
        <Wifi className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span>
          <strong>Live Tabs</strong> shows active SSE connections across all users.
          Each browser tab on the Communications page maintains a persistent connection
          and receives real-time updates without polling.
          Sync runs every 5 minutes automatically for all connected mailboxes.
          "Force Sync" runs for your own account only.
        </span>
      </div>
    </div>
  );
}
