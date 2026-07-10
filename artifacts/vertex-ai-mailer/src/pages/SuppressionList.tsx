import { useState, useEffect, useRef } from "react";
import {
  ShieldAlert, Search, Trash2, Plus, Download, RefreshCw,
  AtSign, Calendar, AlertCircle, CheckCircle2, X, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type SuppressionEntry = {
  id: number;
  email: string;
  reason: string;
  bounceCode?: string | null;
  campaignId?: number | null;
  leadId?: number | null;
  source?: string | null;
  createdAt: string;
};

type PageData = {
  data: SuppressionEntry[];
  total: number;
  page: number;
  limit: number;
};

function getAuthHeaders(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const REASON_STYLES: Record<string, string> = {
  bounce:       "bg-red-50 text-red-700 border-red-200",
  hard_bounce:  "bg-red-50 text-red-700 border-red-200",
  spam:         "bg-orange-50 text-orange-700 border-orange-200",
  unsubscribe:  "bg-amber-50 text-amber-700 border-amber-200",
  manual:       "bg-slate-50 text-slate-600 border-slate-200",
  complaint:    "bg-purple-50 text-purple-700 border-purple-200",
};

function ReasonBadge({ reason }: { reason: string }) {
  const style = REASON_STYLES[reason.toLowerCase()] ?? "bg-slate-50 text-slate-600 border-slate-200";
  const label = reason.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${style}`}>
      {label}
    </span>
  );
}

const SOURCE_STYLES: Record<string, string> = {
  bounce:      "bg-red-50 text-red-700 border-red-200",
  manual:      "bg-slate-50 text-slate-600 border-slate-200",
  unsubscribe: "bg-amber-50 text-amber-700 border-amber-200",
  api:         "bg-blue-50 text-blue-700 border-blue-200",
  import:      "bg-violet-50 text-violet-700 border-violet-200",
};

function SourceBadge({ source }: { source: string }) {
  const key = source.toLowerCase();
  const style = SOURCE_STYLES[key] ?? "bg-slate-50 text-slate-600 border-slate-200";
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize whitespace-nowrap ${style}`}>
      {source.replace(/_/g, " ")}
    </span>
  );
}

/**
 * Truncated single-line email cell. Shows the full address in a floating
 * tooltip on hover (desktop) and on tap (mobile, via onClick toggle) — never
 * wraps or breaks the address across lines.
 */
function EmailCell({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block max-w-full">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        className="flex items-center gap-1.5 max-w-full text-left"
        title={email}
      >
        <AtSign className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
        <span className="font-mono text-sm text-slate-800 dark:text-slate-200 truncate">
          {email}
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-mono shadow-lg whitespace-nowrap">
          {email}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SuppressionList() {
  const [page, setPage] = useState(1);
  const LIMIT = 25;
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");

  // Remove state
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [removeMsg, setRemoveMsg] = useState<{ email: string; ok: boolean } | null>(null);

  // Add state
  const [showAdd, setShowAdd] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addReason, setAddReason] = useState("manual");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(p: number, q: string, rf: string) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (q) qs.set("q", q);
      if (rf) qs.set("reason", rf);
      const res = await fetch(`/api/suppressions?${qs}`, { headers: getAuthHeaders() });
      if (res.ok) setPageData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(page, search, reasonFilter); }, [page, search, reasonFilter]);

  function handleSearchChange(v: string) {
    setSearchInput(v);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setSearch(v);
      setPage(1);
    }, 350);
  }

  function handleReasonFilter(v: string) {
    setReasonFilter(v);
    setPage(1);
  }

  async function handleRemove(email: string) {
    setRemoving(prev => new Set(prev).add(email));
    try {
      const res = await fetch("/api/suppressions/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ email }),
      });
      const ok = res.ok;
      setRemoveMsg({ email, ok });
      if (ok) {
        setTimeout(() => setRemoveMsg(null), 4000);
        load(page, search);
      }
    } finally {
      setRemoving(prev => { const s = new Set(prev); s.delete(email); return s; });
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addEmail.trim()) return;
    setAdding(true);
    setAddMsg(null);
    try {
      const res = await fetch("/api/suppressions/add", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ email: addEmail.trim().toLowerCase(), reason: addReason }),
      });
      const json = await res.json();
      if (res.ok) {
        setAddMsg(`${addEmail.trim()} added to suppression list.`);
        setAddEmail("");
        setAddReason("manual");
        setShowAdd(false);
        load(1, search);
        setPage(1);
      } else {
        setAddMsg(json.error ?? "Failed to add email.");
      }
    } finally {
      setAdding(false);
    }
  }

  function handleExport() {
    if (!pageData?.data.length) return;
    const doExport = async () => {
      const qs = new URLSearchParams({ page: "1", limit: "10000" });
      if (search) qs.set("q", search);
      if (reasonFilter) qs.set("reason", reasonFilter);
      const res = await fetch(`/api/suppressions?${qs}`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const all: PageData = await res.json();
      const rows = [
        ["Email", "Reason", "Source", "Bounce Code", "Campaign ID", "Lead ID", "Added At"],
        ...all.data.map(r => [
          r.email, r.reason, r.source ?? "", r.bounceCode ?? "",
          r.campaignId ?? "", r.leadId ?? "", new Date(r.createdAt).toISOString(),
        ]),
      ];
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "suppression-list.csv"; a.click();
      URL.revokeObjectURL(url);
    };
    doExport();
  }

  const entries  = pageData?.data ?? [];
  const total    = pageData?.total ?? 0;
  const pages    = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-500" />
            <h1 className="text-2xl font-bold text-slate-900">Suppression List</h1>
          </div>
          <p className="text-slate-500 mt-1 text-sm">
            Emails blocked from future sends — added automatically on hard bounces or manually.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={handleExport}
            disabled={total === 0}
            className="gap-1.5 rounded-xl"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          <Button
            size="sm"
            onClick={() => { setShowAdd(v => !v); setAddMsg(null); }}
            className="gap-1.5 rounded-xl"
          >
            <Plus className="h-3.5 w-3.5" /> Add Email
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
        <ShieldAlert className="h-4 w-4 text-red-400 flex-shrink-0" />
        <span><strong className="text-slate-900">{total}</strong> email{total !== 1 ? "s" : ""} suppressed</span>
        {total > 0 && (
          <span className="text-slate-400">· Emails on this list are automatically skipped in all future campaigns.</span>
        )}
      </div>

      {/* Add email form */}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 flex flex-col sm:flex-row gap-3 items-end"
        >
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-slate-700">Email address</label>
            <Input
              type="email"
              placeholder="customer@example.com"
              value={addEmail}
              onChange={e => setAddEmail(e.target.value)}
              required
              className="bg-white rounded-lg"
            />
          </div>
          <div className="space-y-1 min-w-[140px]">
            <label className="text-xs font-medium text-slate-700">Reason</label>
            <select
              value={addReason}
              onChange={e => setAddReason(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="manual">Manual</option>
              <option value="unsubscribe">Unsubscribe</option>
              <option value="spam">Spam complaint</option>
              <option value="bounce">Bounce</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={adding} className="rounded-lg gap-1">
              {adding ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {adding ? "Adding…" : "Add"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)} className="rounded-lg">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {addMsg && (
            <p className="text-xs text-slate-600 sm:col-span-full mt-1">{addMsg}</p>
          )}
        </form>
      )}

      {/* Remove feedback */}
      {removeMsg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border ${
          removeMsg.ok
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-red-50 border-red-200 text-red-700"
        }`}>
          {removeMsg.ok
            ? <><CheckCircle2 className="h-4 w-4" /> {removeMsg.email} removed from suppression list.</>
            : <><AlertCircle className="h-4 w-4" /> Could not remove {removeMsg.email}.</>}
        </div>
      )}

      {/* Search + Reason Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            className="pl-9 rounded-xl"
            placeholder="Search by email address…"
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
          />
          {searchInput && (
            <button
              onClick={() => { handleSearchChange(""); setSearchInput(""); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select
          value={reasonFilter}
          onChange={e => handleReasonFilter(e.target.value)}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-[160px]"
        >
          <option value="">All reasons</option>
          <option value="unsubscribe">Unsubscribe</option>
          <option value="hard_bounce">Hard bounce</option>
          <option value="soft_bounce">Soft bounce</option>
          <option value="spam_complaint">Spam complaint</option>
          <option value="manual_block">Manual block</option>
          <option value="invalid_email">Invalid email</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[860px] table-fixed">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[30%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="bg-slate-50/70 dark:bg-slate-800/60">
                <TableHead className="h-11 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                  <span className="flex items-center gap-1"><AtSign className="h-3.5 w-3.5" /> Email</span>
                </TableHead>
                <TableHead className="h-11 font-semibold text-slate-600 text-xs uppercase tracking-wide">Reason</TableHead>
                <TableHead className="h-11 font-semibold text-slate-600 text-xs uppercase tracking-wide text-center hidden md:table-cell">Source</TableHead>
                <TableHead className="h-11 font-semibold text-slate-600 text-xs uppercase tracking-wide text-center hidden sm:table-cell">Bounce Code</TableHead>
                <TableHead className="h-11 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden lg:table-cell">
                  <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Added</span>
                </TableHead>
                <TableHead className="h-11 font-semibold text-slate-600 text-xs uppercase tracking-wide text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {[1, 2, 3, 4, 5, 6].map(j => (
                      <TableCell key={j} className="py-3.5"><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-48 text-slate-400">
                    <div className="flex flex-col items-center gap-3">
                      <ShieldAlert className="h-8 w-8 text-slate-200" />
                      {search
                        ? <p className="text-sm">No results for <strong>"{search}"</strong></p>
                        : <p className="text-sm">No suppressed emails yet — great news!</p>
                      }
                      {!search && (
                        <div className="flex items-start gap-2 text-xs text-slate-400 max-w-xs text-center">
                          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                          Emails are added here automatically when hard bounces are detected.
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                entries.map(entry => (
                  <TableRow key={entry.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <TableCell className="py-3.5 overflow-hidden">
                      <EmailCell email={entry.email} />
                    </TableCell>
                    <TableCell className="py-3.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ReasonBadge reason={entry.reason} />
                        {entry.reason.length > 20 && (
                          <span className="text-xs text-slate-500 leading-snug break-words">
                            {entry.reason.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3.5 text-center hidden md:table-cell">
                      {entry.source ? (
                        <SourceBadge source={entry.source} />
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 text-center hidden sm:table-cell">
                      {entry.bounceCode ? (
                        <span className="inline-flex items-center justify-center min-w-[2.75rem] font-mono text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                          {entry.bounceCode}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 hidden lg:table-cell">
                      <div className="text-sm text-slate-700">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-slate-400">{timeAgo(entry.createdAt)}</div>
                    </TableCell>
                    <TableCell className="py-3.5 text-center">
                      <div className="flex items-center justify-center h-7">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={removing.has(entry.email)}
                          onClick={() => handleRemove(entry.email)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg gap-1 text-xs h-7 px-2 whitespace-nowrap"
                          title="Remove from suppression list — this email will no longer be blocked"
                        >
                          {removing.has(entry.email)
                            ? <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5 flex-shrink-0" />}
                          <span className="hidden sm:inline">{removing.has(entry.email) ? "Removing…" : "Remove"}</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline" size="sm" disabled={page === 1}
            onClick={() => setPage(p => p - 1)} className="rounded-lg"
          >
            Previous
          </Button>
          <span className="text-sm text-slate-500">
            Page {page} of {pages} · {total} entries
          </span>
          <Button
            variant="outline" size="sm" disabled={page >= pages}
            onClick={() => setPage(p => p + 1)} className="rounded-lg"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
