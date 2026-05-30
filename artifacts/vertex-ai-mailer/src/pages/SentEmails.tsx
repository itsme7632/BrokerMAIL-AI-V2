import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Eye, Mail, CheckCircle2, Clock, AlertCircle, ChevronRight,
  User, AtSign, Calendar, Server, BarChart3, Search, Hash, X,
  RefreshCw, Ban, Edit3, AlertTriangle, Filter, MousePointerClick,
} from "lucide-react";

type SentEmail = {
  id: number;
  email: string;
  customerName: string | null;
  quoteId: string | null;
  subject: string;
  sentAt: string | null;
  mailboxEmail: string | null;
  mailboxFromName: string | null;
  status: string;
  lastError: string | null;
  errorLabel: string | null;
  retryAfter: string | null;
  retryMinutes: number | null;
  deferredCount: number;
  trackingId: string | null;
  openCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  campaignId: number | null;
};

type TimelineEvent = { type: string; timestamp: string; detail?: string };
type StatusFilter = "all" | "delivered" | "failed" | "opened" | "unopened";

function formatRelativeTime(iso: string): string {
  const ts = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 0) return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as any).errorLabel ?? (d as any).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function apiPatch(path: string): Promise<void> {
  const res = await fetch(path, { method: "PATCH", headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
}

function TrackingBadge({ status, trackingId, openCount, errorLabel, retryMinutes, deferredCount }: {
  status: string; trackingId: string | null; openCount: number; errorLabel: string | null;
  retryMinutes?: number | null; deferredCount?: number;
}) {
  if (status === "deferred") {
    return (
      <div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="h-3 w-3" /> Deferred
        </span>
        {errorLabel && (
          <p className="text-xs text-amber-600 mt-1 max-w-[160px] leading-tight">{errorLabel}</p>
        )}
        {retryMinutes != null && retryMinutes > 0 && (
          <p className="text-xs text-amber-500 mt-0.5">Next retry: {retryMinutes} min</p>
        )}
        {retryMinutes === 0 && (
          <p className="text-xs text-amber-500 mt-0.5">Retrying soon…</p>
        )}
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
          <AlertCircle className="h-3 w-3" /> Failed
        </span>
        {errorLabel && (
          <p className="text-xs text-red-500 mt-1 max-w-[160px] leading-tight">{errorLabel}</p>
        )}
      </div>
    );
  }
  if (!trackingId) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200">
        <CheckCircle2 className="h-3 w-3" /> Sent
      </span>
    );
  }
  if (openCount === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
        <CheckCircle2 className="h-3 w-3" /> Delivered
      </span>
    );
  }
  if (openCount === 1) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <Eye className="h-3 w-3" /> Opened
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
      <Eye className="h-3 w-3" /> Opened {openCount}×
    </span>
  );
}

// ─── Edit & Retry Modal ───────────────────────────────────────────────────────

function EditRetryModal({
  email,
  open,
  onClose,
  onSent,
}: {
  email: SentEmail | null;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const { toast }   = useToast();
  const [toEmail, setToEmail]   = useState("");
  const [subject, setSubject]   = useState("");
  const [note, setNote]         = useState("");
  const [sending, setSending]   = useState(false);

  // Pre-fill when modal opens
  useEffect(() => {
    if (email && open) {
      setToEmail(email.email);
      setSubject(email.subject);
      setNote("");
    }
  }, [email?.id, open]);

  if (!email) return null;

  async function handleSend() {
    if (!toEmail.trim() || !email) return;
    setSending(true);
    try {
      await apiPost(`/api/sent-emails/${email.id}/edit-resend`, {
        toEmail: toEmail.trim(), subject: subject.trim(), note: note.trim(),
      });
      toast({ title: "Email resent successfully" });
      onSent();
      onClose();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to resend", description: err.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Edit3 className="h-4 w-4 text-blue-500" /> Edit &amp; Resend
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {email.errorLabel && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-800">Failure reason</p>
                <p className="text-xs text-red-700 mt-0.5">{email.errorLabel}</p>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">Recipient Email</label>
            <Input
              value={toEmail}
              onChange={e => setToEmail(e.target.value)}
              placeholder="recipient@example.com"
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">Subject</label>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">
              Prepend a note <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Hi, following up on our previous quote…"
              className="rounded-xl resize-none"
              rows={3}
            />
            <p className="text-xs text-slate-400">This note will appear at the top of the email body.</p>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="rounded-xl flex-1">Cancel</Button>
            <Button
              onClick={handleSend}
              disabled={!toEmail.trim() || sending}
              className="rounded-xl flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-2"
            >
              {sending ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Sending…</>
              ) : (
                <><Mail className="h-4 w-4" /> Send</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Email preview + timeline modal ──────────────────────────────────────────

function EmailPreviewModal({ emailId, open, onClose }: { emailId: number | null; open: boolean; onClose: () => void }) {
  const { data: preview, isLoading: loadingPreview } = useQuery({
    queryKey: ["sent-email-preview", emailId],
    enabled: !!emailId && open,
    queryFn: () => apiFetch<{ html: string; subject: string; to: string; sentAt: string | null; customerName: string | null }>(
      `/api/sent-emails/${emailId}/preview`
    ),
  });

  const { data: timeline, isLoading: loadingTimeline } = useQuery({
    queryKey: ["sent-email-timeline", emailId],
    enabled: !!emailId && open,
    queryFn: () => apiFetch<{ events: TimelineEvent[]; email: string; subject: string }>(
      `/api/sent-emails/${emailId}/timeline`
    ),
  });

  const timelineIcons: Record<string, React.ReactNode> = {
    sent:      <CheckCircle2 className="h-4 w-4 text-blue-500" />,
    delivered: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    opened:    <Eye className="h-4 w-4 text-violet-500" />,
    clicked:   <MousePointerClick className="h-4 w-4 text-green-500" />,
    failed:    <AlertCircle className="h-4 w-4 text-red-500" />,
  };
  const timelineLabels: Record<string, string> = {
    sent:      "Email sent via SMTP", delivered: "Delivered to inbox",
    opened:    "Recipient opened email", failed: "Delivery failed",
    clicked:   "Clicked a CTA button",
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold text-slate-900 truncate">
              {loadingPreview ? <Skeleton className="h-5 w-64" /> : (preview?.subject ?? "Email Preview")}
            </DialogTitle>
            {preview && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                <span className="text-xs text-slate-500 flex items-center gap-1"><AtSign className="h-3 w-3" /> {preview.to}</span>
                {preview.customerName && <span className="text-xs text-slate-500 flex items-center gap-1"><User className="h-3 w-3" /> {preview.customerName}</span>}
                {preview.sentAt && <span className="text-xs text-slate-500 flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(preview.sentAt).toLocaleString()}</span>}
              </div>
            )}
          </div>
        </DialogHeader>
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="flex-1 overflow-auto bg-slate-50">
            {loadingPreview ? (
              <div className="p-6 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-40 w-full" /></div>
            ) : preview?.html ? (
              <iframe srcDoc={preview.html} className="w-full h-full border-0 min-h-[400px]" title="Email Preview" sandbox="allow-same-origin" />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">Preview not available</div>
            )}
          </div>
          <div className="w-64 flex-shrink-0 overflow-y-auto p-4 bg-white border-l border-slate-200">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Activity Timeline
            </h3>
            {loadingTimeline ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
            ) : (timeline?.events.length ?? 0) === 0 ? (
              <p className="text-xs text-slate-400">No activity recorded yet.</p>
            ) : (
              <ol className="space-y-0">
                {timeline!.events.map((ev, i) => (
                  <li key={i} className="flex gap-3 pb-4 relative">
                    <div className="flex flex-col items-center">
                      <div className="flex-shrink-0 mt-0.5">{timelineIcons[ev.type] ?? <CheckCircle2 className="h-4 w-4 text-slate-400" />}</div>
                      {i < timeline!.events.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1 min-h-[12px]" />}
                    </div>
                    <div className="min-w-0 pb-1">
                      <p className="text-xs font-medium text-slate-800">{timelineLabels[ev.type] ?? ev.type}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{new Date(ev.timestamp).toLocaleString()}</p>
                      {ev.detail && <p className="text-xs text-slate-400 truncate mt-0.5" title={ev.detail}>{ev.detail.length > 40 ? ev.detail.slice(0, 40) + "…" : ev.detail}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_TABS: { value: StatusFilter; label: string; icon: React.ReactNode }[] = [
  { value: "all",       label: "All",       icon: <Filter className="h-3 w-3" /> },
  { value: "delivered", label: "Delivered", icon: <CheckCircle2 className="h-3 w-3" /> },
  { value: "failed",    label: "Failed",    icon: <AlertCircle className="h-3 w-3" /> },
  { value: "opened",    label: "Opened",    icon: <Eye className="h-3 w-3" /> },
  { value: "unopened",  label: "Unopened",  icon: <Mail className="h-3 w-3" /> },
];

export default function SentEmails() {
  const [page, setPage]             = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchInput, setSearchInput]   = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("delivered");
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [ignoringId, setIgnoringId] = useState<number | null>(null);
  const [editEmail, setEditEmail]   = useState<SentEmail | null>(null);

  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const queryKey = ["sent-emails", page, activeSearch, statusFilter];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: "25", statusFilter });
      if (activeSearch) params.set("search", activeSearch);
      return apiFetch<{ data: SentEmail[]; total: number; page: number; limit: number }>(
        `/api/sent-emails?${params}`
      );
    },
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setActiveSearch(searchInput.trim());
  }

  function handleClearSearch() {
    setSearchInput(""); setActiveSearch(""); setPage(1);
  }

  function handleTabChange(tab: StatusFilter) {
    setStatusFilter(tab); setPage(1); setActiveSearch(""); setSearchInput("");
  }

  async function handleRetry(email: SentEmail) {
    setRetryingId(email.id);
    try {
      await apiPost(`/api/sent-emails/${email.id}/retry`);
      toast({ title: "Resent successfully", description: `Email delivered to ${email.email}` });
      queryClient.invalidateQueries({ queryKey: ["sent-emails"] });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Retry failed", description: err.message });
    } finally { setRetryingId(null); }
  }

  async function handleIgnore(email: SentEmail) {
    setIgnoringId(email.id);
    try {
      await apiPatch(`/api/sent-emails/${email.id}/ignore`);
      toast({ title: "Marked as ignored" });
      queryClient.invalidateQueries({ queryKey: ["sent-emails"] });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    } finally { setIgnoringId(null); }
  }

  const emails   = data?.data ?? [];
  const total    = data?.total ?? 0;
  const pages    = Math.max(1, Math.ceil(total / 25));
  const failedCount = emails.filter(e => e.status === "failed").length;
  const opened   = emails.filter(e => e.openCount > 0).length;
  const tracked  = emails.filter(e => e.trackingId && e.status !== "failed").length;
  const openRate = tracked > 0 ? Math.round((opened / tracked) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sent Emails</h1>
          <p className="text-slate-500 mt-1 text-sm">All SMTP emails sent via your mailbox — with open tracking and failure recovery.</p>
        </div>
        <div className="flex items-center gap-2 text-sm bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm">
          <BarChart3 className="h-4 w-4 text-slate-400" />
          <span className="font-medium text-slate-800">{total}</span>
          <span className="text-slate-400">{statusFilter === "all" ? "total" : statusFilter}</span>
          {statusFilter !== "failed" && (
            <>
              <span className="text-slate-300 mx-1">·</span>
              <Eye className="h-3.5 w-3.5 text-violet-500" />
              <span className="font-medium text-violet-700">{opened}</span>
              <span className="text-slate-400">opened</span>
            </>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total",      value: total,                                         icon: <Mail className="h-4 w-4 text-blue-500" /> },
          { label: "Opened",     value: opened,                                        icon: <Eye className="h-4 w-4 text-emerald-500" /> },
          { label: "Failed",     value: statusFilter === "all" || statusFilter === "failed" ? failedCount : "—",
                                                                                        icon: <AlertCircle className="h-4 w-4 text-red-500" /> },
          { label: "Open Rate",  value: total > 0 ? `${openRate}%` : "—",             icon: <BarChart3 className="h-4 w-4 text-amber-500" /> },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div className="mb-2">{s.icon}</div>
            <div className="text-2xl font-bold text-slate-900">{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit shadow-sm">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => handleTabChange(tab.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              statusFilter === tab.value
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search by email, name, or quote ID…"
            className="pl-9 rounded-xl border-slate-200"
          />
          {searchInput && (
            <button type="button" onClick={handleClearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button type="submit" variant="outline" className="rounded-xl gap-1.5 shrink-0">
          <Search className="h-3.5 w-3.5" /> Search
        </Button>
        {activeSearch && (
          <Button type="button" variant="ghost" onClick={handleClearSearch} className="rounded-xl text-slate-500 text-sm shrink-0">Clear</Button>
        )}
      </form>
      {activeSearch && (
        <p className="text-xs text-slate-500 -mt-3">Showing results for <strong>"{activeSearch}"</strong> — {total} match{total !== 1 ? "es" : ""}</p>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/70">
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide">Recipient</TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide hidden xl:table-cell">Quote ID</TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide hidden sm:table-cell">Subject</TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide hidden md:table-cell">Mailbox</TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide hidden lg:table-cell">Sent</TableHead>
                <TableHead className="font-semibold text-slate-600 text-xs uppercase tracking-wide">Status</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(6).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {[1,2,3,4,5,6].map(j => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                    <TableCell />
                  </TableRow>
                ))
              ) : emails.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-40 text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      {statusFilter === "failed"
                        ? <CheckCircle2 className="h-8 w-8 text-emerald-200" />
                        : <Mail className="h-8 w-8 text-slate-200" />}
                      <p className="text-sm font-medium">
                        {statusFilter === "failed" ? "No failed emails" :
                         activeSearch ? "No emails match your search" : "No emails yet"}
                      </p>
                      <p className="text-xs">
                        {statusFilter === "failed" ? "All your emails delivered successfully." :
                         activeSearch ? "Try a different search term" : "Emails sent via SMTP campaigns will appear here."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                emails.map(email => (
                  <TableRow
                    key={email.id}
                    className={`group transition-colors ${
                      email.status === "failed"
                        ? "bg-red-50/30 hover:bg-red-50/60"
                        : "hover:bg-slate-50/60 cursor-pointer"
                    }`}
                    onClick={email.status !== "failed" ? () => setSelectedId(email.id) : undefined}
                  >
                    <TableCell>
                      <div className="font-medium text-slate-900 text-sm">
                        {email.customerName || <span className="text-slate-400 italic text-xs">Unknown</span>}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <AtSign className="h-2.5 w-2.5 flex-shrink-0 text-slate-400" />
                        <span className="truncate max-w-[160px]">{email.email}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {email.quoteId ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-violet-50 border border-violet-100 text-xs font-mono text-violet-700">
                          <Hash className="h-2.5 w-2.5" />{email.quoteId}
                        </span>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="text-sm text-slate-800 truncate max-w-xs">{email.subject}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Server className="h-3 w-3 flex-shrink-0 text-slate-400" />
                        <span className="truncate max-w-[140px]">
                          {email.mailboxFromName ? `${email.mailboxFromName} <${email.mailboxEmail}>` : (email.mailboxEmail ?? "—")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {email.sentAt ? (
                        <div>
                          <div className="text-sm text-slate-700">{new Date(email.sentAt).toLocaleDateString()}</div>
                          <div className="text-xs text-slate-400">{new Date(email.sentAt).toLocaleTimeString()}</div>
                        </div>
                      ) : <span className="text-slate-400 text-sm">—</span>}
                    </TableCell>
                    <TableCell>
                      <TrackingBadge status={email.status} trackingId={email.trackingId} openCount={email.openCount} errorLabel={email.errorLabel} retryMinutes={email.retryMinutes} deferredCount={email.deferredCount} />
                      {email.openCount > 0 && email.lastOpenedAt && (
                        <div className="text-xs text-slate-400 mt-1 leading-tight">
                          {email.openCount > 1 && email.firstOpenedAt
                            ? `First ${formatRelativeTime(email.firstOpenedAt)} · Last ${formatRelativeTime(email.lastOpenedAt)}`
                            : `Opened ${formatRelativeTime(email.lastOpenedAt)}`
                          }
                        </div>
                      )}
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      {email.status === "failed" ? (
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={retryingId === email.id}
                            onClick={() => handleRetry(email)}
                            className="h-6 text-xs px-2 rounded-lg gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                          >
                            {retryingId === email.id
                              ? <RefreshCw className="h-3 w-3 animate-spin" />
                              : <RefreshCw className="h-3 w-3" />}
                            Retry
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setEditEmail(email); }}
                            className="h-6 text-xs px-2 rounded-lg gap-1 text-slate-600 hover:bg-slate-100"
                          >
                            <Edit3 className="h-3 w-3" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={ignoringId === email.id}
                            onClick={() => handleIgnore(email)}
                            className="h-6 text-xs px-2 rounded-lg gap-1 text-slate-400 hover:text-slate-600"
                          >
                            {ignoringId === email.id
                              ? <RefreshCw className="h-3 w-3 animate-spin" />
                              : <Ban className="h-3 w-3" />}
                            Ignore
                          </Button>
                        </div>
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg">Previous</Button>
        <span className="text-sm text-slate-500">Page {page} of {pages} · {total.toLocaleString()} emails</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="rounded-lg">Next</Button>
      </div>

      <EmailPreviewModal emailId={selectedId} open={!!selectedId} onClose={() => setSelectedId(null)} />
      <EditRetryModal
        email={editEmail}
        open={!!editEmail}
        onClose={() => setEditEmail(null)}
        onSent={() => queryClient.invalidateQueries({ queryKey: ["sent-emails"] })}
      />
    </div>
  );
}
