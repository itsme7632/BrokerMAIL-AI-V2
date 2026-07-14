/**
 * AdminSupport.tsx — Phase 7: Unified Support Center
 * Merges support tickets, bug reports, and feature requests into one page.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  TicketCheck, Bug, Lightbulb, RefreshCw, Search, Send,
  CheckCircle2, XCircle, Loader2, ChevronLeft, ChevronRight,
  Inbox, Tag, AlertTriangle, User, Clock, MessageSquare,
  Globe, Monitor, Zap, Trash2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TicketReply {
  id: string; author: "admin" | "user"; authorName: string;
  message: string; createdAt: string;
}

interface SupportTicket {
  id: number; userId: number | null; userEmail: string; userName: string | null;
  subject: string; category: string; message: string;
  status: string; priority: string; adminNote: string | null;
  assignedTo: string | null; replies: TicketReply[];
  createdAt: string; updatedAt: string; resolvedAt: string | null;
}

interface BugReport {
  id: number; userId: number | null; userName: string | null; userEmail: string | null;
  title: string; description: string; stepsToReproduce: string;
  expectedResult: string; actualResult: string;
  severity: string; status: string;
  currentUrl: string | null; browser: string | null; os: string | null;
  screenshotUrl: string | null; assignedTo: string | null;
  adminReply: string | null; adminReplyAt: string | null;
  createdAt: string; updatedAt: string;
}

interface FeatureRequest {
  id: number; userId: number | null; userName: string | null; userEmail: string | null;
  title: string; description: string; category: string;
  businessImpact: string | null; status: string;
  adminReply: string | null; adminReplyAt: string | null;
  currentPage: string | null; browser: string | null; os: string | null;
  createdAt: string; updatedAt: string;
}

interface PaginatedResult<T> { data: T[]; total: number; page: number; limit: number; }

type SupportTab = "tickets" | "bugs" | "features";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/admin/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...opts?.headers,
    },
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `Error ${res.status}`); }
  return res.json();
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Pill helpers ─────────────────────────────────────────────────────────────

const TICKET_STATUS_CLS: Record<string, string> = {
  open:             "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  in_progress:      "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  waiting_for_user: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  resolved:         "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  closed:           "bg-muted text-muted-foreground",
};
const PRIORITY_CLS: Record<string, string> = {
  low:    "bg-muted text-muted-foreground",
  medium: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  high:   "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  urgent: "bg-red-500/10 text-red-600 dark:text-red-400",
};
const SEVERITY_CLS: Record<string, string> = {
  low:      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  medium:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  high:     "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400",
};
const FEATURE_STATUS_CLS: Record<string, string> = {
  open:        "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  planned:     "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  in_progress: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  completed:   "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  declined:    "bg-muted text-muted-foreground",
};
const BUG_STATUS_CLS: Record<string, string> = {
  open:      "bg-red-500/10 text-red-600 dark:text-red-400",
  fixed:     "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  duplicate: "bg-muted text-muted-foreground",
  closed:    "bg-muted text-muted-foreground",
};

function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize whitespace-nowrap ${cls}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

// ─── MonitorCard ──────────────────────────────────────────────────────────────

function MonitorCard({ icon: Icon, label, value, accent, loading }: {
  icon: React.ElementType; label: string; value: number | string;
  accent: string; loading: boolean;
}) {
  const ACCENTS: Record<string, string> = {
    blue:    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    red:     "bg-red-500/10 text-red-600 dark:text-red-400",
    amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    violet:  "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  };
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ACCENTS[accent]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
        {loading ? <Skeleton className="h-5 w-12 mt-1" /> : <p className="text-lg font-bold text-foreground">{value}</p>}
      </div>
    </Card>
  );
}

// ─── Ticket Detail Sheet ──────────────────────────────────────────────────────

function TicketSheet({ ticket, open, onClose, onUpdate }: {
  ticket: SupportTicket | null; open: boolean;
  onClose: () => void; onUpdate: () => void;
}) {
  const [reply, setReply]   = useState("");
  const [note, setNote]     = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ticket) { setNote(ticket.adminNote ?? ""); setReply(""); }
  }, [ticket]);

  if (!ticket) return null;

  const patch = async (body: object) => {
    await apiFetch(`support/${ticket.id}`, { method: "PATCH", body: JSON.stringify(body) });
    onUpdate();
  };
  const sendReply = async () => {
    if (!reply.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`support/${ticket.id}/reply`, { method: "POST", body: JSON.stringify({ message: reply }) });
      setReply(""); onUpdate();
    } finally { setSaving(false); }
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto flex flex-col">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base flex items-center gap-2">
            <TicketCheck className="h-4 w-4 text-muted-foreground" />
            Ticket #{ticket.id}
          </SheetTitle>
          <div className="flex flex-wrap gap-1.5">
            <Pill label={ticket.status} cls={TICKET_STATUS_CLS[ticket.status] ?? "bg-muted text-muted-foreground"} />
            <Pill label={ticket.priority} cls={PRIORITY_CLS[ticket.priority] ?? PRIORITY_CLS.medium} />
            <Pill label={ticket.category} cls="bg-muted text-muted-foreground" />
          </div>
        </SheetHeader>

        {/* Identity */}
        <div className="rounded-xl border border-border p-3 mb-4 text-xs space-y-1">
          <p className="font-semibold text-foreground text-sm truncate">{ticket.subject}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground mt-1">
            <span><User className="h-3 w-3 inline mr-1" />{ticket.userName ?? ticket.userEmail}</span>
            <span><Clock className="h-3 w-3 inline mr-1" />{timeAgo(ticket.createdAt)}</span>
            {ticket.assignedTo && <span>Assigned: {ticket.assignedTo}</span>}
          </div>
        </div>

        {/* Original message */}
        <div className="bg-muted/40 rounded-xl p-3 text-sm text-foreground whitespace-pre-wrap mb-4">{ticket.message}</div>

        {/* Thread */}
        {(ticket.replies ?? []).length > 0 && (
          <div className="space-y-2 mb-4">
            {ticket.replies.map(r => (
              <div key={r.id} className={`flex ${r.author === "admin" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${r.author === "admin" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                  <p className="text-[10px] font-semibold opacity-70 mb-0.5">{r.author === "admin" ? "Support Team" : "User"} · {timeAgo(r.createdAt)}</p>
                  {r.message}
                </div>
              </div>
            ))}
          </div>
        )}

        <Separator className="my-3" />

        {/* Admin controls */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Status</p>
            <Select value={ticket.status} onValueChange={v => patch({ status: v })}>
              <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["open","in_progress","waiting_for_user","resolved","closed"].map(s => (
                  <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Priority</p>
            <Select value={ticket.priority} onValueChange={v => patch({ priority: v })}>
              <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["low","medium","high","urgent"].map(p => (
                  <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Note */}
        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Admin Note (private)</p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Internal note — not visible to user…"
          />
          <Button size="sm" variant="outline" className="mt-1 h-7 text-xs rounded-lg"
            onClick={() => patch({ adminNote: note })}>
            Save Note
          </Button>
        </div>

        {/* Reply */}
        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Reply to User</p>
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Type your reply…"
          />
          <div className="flex justify-between mt-1">
            <Button size="sm" className="h-8 gap-1.5 rounded-lg" disabled={saving || !reply.trim()} onClick={sendReply}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send Reply
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive rounded-lg"
              onClick={async () => {
                if (!confirm("Delete this ticket?")) return;
                await apiFetch(`support/${ticket.id}`, { method: "DELETE" });
                onClose(); onUpdate();
              }}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Bug Report Sheet ─────────────────────────────────────────────────────────

function BugSheet({ bug, open, onClose, onUpdate }: {
  bug: BugReport | null; open: boolean; onClose: () => void; onUpdate: () => void;
}) {
  const [adminReply, setAdminReply] = useState("");
  const [saving, setSaving]         = useState(false);

  useEffect(() => { if (bug) setAdminReply(bug.adminReply ?? ""); }, [bug]);

  if (!bug) return null;

  const patch = async (body: object) => {
    await apiFetch(`bug-reports/${bug.id}`, { method: "PATCH", body: JSON.stringify(body) });
    onUpdate();
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base flex items-center gap-2">
            <Bug className="h-4 w-4 text-muted-foreground" />
            Bug #{bug.id}
          </SheetTitle>
          <div className="flex flex-wrap gap-1.5">
            <Pill label={bug.status}   cls={BUG_STATUS_CLS[bug.status]   ?? "bg-muted text-muted-foreground"} />
            <Pill label={bug.severity} cls={SEVERITY_CLS[bug.severity]   ?? SEVERITY_CLS.medium} />
          </div>
        </SheetHeader>

        <div className="rounded-xl border border-border p-3 mb-4 text-xs space-y-0.5">
          <p className="font-semibold text-foreground text-sm">{bug.title}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground mt-1">
            {(bug.userName || bug.userEmail) && <span><User className="h-3 w-3 inline mr-1" />{bug.userName ?? bug.userEmail}</span>}
            <span><Clock className="h-3 w-3 inline mr-1" />{timeAgo(bug.createdAt)}</span>
            {bug.browser && <span><Monitor className="h-3 w-3 inline mr-1" />{bug.browser}</span>}
            {bug.currentUrl && <span><Globe className="h-3 w-3 inline mr-1" />{bug.currentUrl.slice(0, 40)}…</span>}
          </div>
        </div>

        {[
          { label: "Description",        value: bug.description },
          { label: "Steps to Reproduce", value: bug.stepsToReproduce },
          { label: "Expected",           value: bug.expectedResult },
          { label: "Actual",             value: bug.actualResult },
        ].map(({ label, value }) => (
          <div key={label} className="mb-3">
            <p className="text-xs font-semibold text-muted-foreground mb-1">{label}</p>
            <div className="bg-muted/40 rounded-xl p-3 text-sm text-foreground whitespace-pre-wrap">{value}</div>
          </div>
        ))}

        {bug.screenshotUrl && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Screenshot</p>
            <a href={bug.screenshotUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View screenshot ↗</a>
          </div>
        )}

        <Separator className="my-3" />

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Status</p>
            <Select value={bug.status} onValueChange={v => patch({ status: v })}>
              <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["open","fixed","duplicate","closed"].map(s => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Severity</p>
            <Select value={bug.severity} onValueChange={v => patch({ severity: v })}>
              <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["low","medium","high","critical"].map(s => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Admin Reply</p>
          <textarea
            value={adminReply}
            onChange={e => setAdminReply(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Reply to this bug report…"
          />
          <Button size="sm" className="mt-1 h-8 rounded-lg gap-1.5" disabled={saving}
            onClick={async () => { setSaving(true); try { await patch({ adminReply }); } finally { setSaving(false); } }}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Save Reply
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Feature Request Sheet ────────────────────────────────────────────────────

function FeatureSheet({ feature, open, onClose, onUpdate }: {
  feature: FeatureRequest | null; open: boolean; onClose: () => void; onUpdate: () => void;
}) {
  const [adminReply, setAdminReply] = useState("");
  const [saving, setSaving]         = useState(false);

  useEffect(() => { if (feature) setAdminReply(feature.adminReply ?? ""); }, [feature]);

  if (!feature) return null;

  const patch = async (body: object) => {
    await apiFetch(`feature-requests/${feature.id}`, { method: "PATCH", body: JSON.stringify(body) });
    onUpdate();
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-muted-foreground" />
            Feature #{feature.id}
          </SheetTitle>
          <div className="flex flex-wrap gap-1.5">
            <Pill label={feature.status}   cls={FEATURE_STATUS_CLS[feature.status] ?? "bg-muted text-muted-foreground"} />
            <Pill label={feature.category} cls="bg-muted text-muted-foreground" />
          </div>
        </SheetHeader>

        <div className="rounded-xl border border-border p-3 mb-4 text-xs">
          <p className="font-semibold text-foreground text-sm">{feature.title}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground mt-1">
            {(feature.userName || feature.userEmail) && <span><User className="h-3 w-3 inline mr-1" />{feature.userName ?? feature.userEmail}</span>}
            <span><Clock className="h-3 w-3 inline mr-1" />{timeAgo(feature.createdAt)}</span>
            {feature.currentPage && <span><Globe className="h-3 w-3 inline mr-1" />{feature.currentPage.slice(0, 40)}</span>}
          </div>
        </div>

        <div className="mb-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Description</p>
          <div className="bg-muted/40 rounded-xl p-3 text-sm text-foreground whitespace-pre-wrap">{feature.description}</div>
        </div>
        {feature.businessImpact && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Business Impact</p>
            <div className="bg-muted/40 rounded-xl p-3 text-sm text-foreground whitespace-pre-wrap">{feature.businessImpact}</div>
          </div>
        )}

        <Separator className="my-3" />

        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Status</p>
          <Select value={feature.status} onValueChange={v => patch({ status: v })}>
            <SelectTrigger className="h-8 rounded-lg text-xs w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["open","planned","in_progress","completed","declined"].map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Admin Reply</p>
          <textarea
            value={adminReply}
            onChange={e => setAdminReply(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Reply to this feature request…"
          />
          <Button size="sm" className="mt-1 h-8 rounded-lg gap-1.5" disabled={saving}
            onClick={async () => { setSaving(true); try { await patch({ adminReply }); } finally { setSaving(false); } }}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Save Reply
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Tickets Panel ────────────────────────────────────────────────────────────

function TicketsPanel() {
  const [items, setItems]             = useState<SupportTicket[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(false);
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatus]     = useState("all");
  const [priorityFilter, setPriority] = useState("all");
  const [selected, setSelected]       = useState<SupportTicket | null>(null);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: String(LIMIT),
        ...(search         && { search }),
        ...(statusFilter   !== "all" && { status:   statusFilter }),
        ...(priorityFilter !== "all" && { priority: priorityFilter }),
      });
      const data = await apiFetch(`support?${params}`);
      // API returns array or paginated; handle both
      const arr  = Array.isArray(data) ? data : (data.data ?? []);
      const tot  = Array.isArray(data) ? arr.length : (data.total ?? arr.length);
      setItems(arr); setTotal(tot);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [page, search, statusFilter, priorityFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter, priorityFilter]);

  const pageCount = Math.max(Math.ceil(total / LIMIT), 1);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search tickets…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 rounded-xl" />
        </div>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="h-9 rounded-xl w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {["all","open","in_progress","waiting_for_user","resolved","closed"].map(s => (
              <SelectItem key={s} value={s} className="text-xs">{s === "all" ? "All Statuses" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriority}>
          <SelectTrigger className="h-9 rounded-xl w-full sm:w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            {["all","low","medium","high","urgent"].map(p => (
              <SelectItem key={p} value={p} className="text-xs capitalize">{p === "all" ? "All Priorities" : p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* List */}
      {loading ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />) :
      items.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <Inbox className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No tickets found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(t => (
            <div key={t.id}
              className="rounded-xl border border-border p-4 cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
              onClick={() => setSelected(t)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="text-xs font-mono text-muted-foreground">#{t.id}</span>
                    <Pill label={t.status}   cls={TICKET_STATUS_CLS[t.status]   ?? "bg-muted text-muted-foreground"} />
                    <Pill label={t.priority} cls={PRIORITY_CLS[t.priority]     ?? PRIORITY_CLS.medium} />
                  </div>
                  <p className="text-sm font-semibold text-foreground truncate">{t.subject}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.userEmail} · {timeAgo(t.createdAt)}
                    {t.replies?.length > 0 && ` · ${t.replies.length} repl${t.replies.length === 1 ? "y" : "ies"}`}
                  </p>
                </div>
                <Tag className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">{total} total · page {page} of {pageCount}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      <TicketSheet ticket={selected} open={!!selected} onClose={() => setSelected(null)} onUpdate={() => { load(); setSelected(null); }} />
    </div>
  );
}

// ─── Bug Reports Panel ────────────────────────────────────────────────────────

function BugsPanel() {
  const [items, setItems]         = useState<BugReport[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatus] = useState("all");
  const [sevFilter, setSev]       = useState("all");
  const [selected, setSelected]   = useState<BugReport | null>(null);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: String(LIMIT),
        ...(search      && { search }),
        ...(statusFilter !== "all" && { status:   statusFilter }),
        ...(sevFilter    !== "all" && { severity: sevFilter }),
      });
      const data = await apiFetch(`bug-reports?${params}`);
      setItems(data.data ?? []); setTotal(data.total ?? 0);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [page, search, statusFilter, sevFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter, sevFilter]);

  const pageCount = Math.max(Math.ceil(total / LIMIT), 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search bug reports…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 rounded-xl" />
        </div>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="h-9 rounded-xl w-full sm:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all","open","fixed","duplicate","closed"].map(s => (
              <SelectItem key={s} value={s} className="text-xs capitalize">{s === "all" ? "All Statuses" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sevFilter} onValueChange={setSev}>
          <SelectTrigger className="h-9 rounded-xl w-full sm:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all","low","medium","high","critical"].map(s => (
              <SelectItem key={s} value={s} className="text-xs capitalize">{s === "all" ? "All Severities" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />) :
      items.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <Bug className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No bug reports found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(b => (
            <div key={b.id}
              className="rounded-xl border border-border p-4 cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
              onClick={() => setSelected(b)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="text-xs font-mono text-muted-foreground">#{b.id}</span>
                    <Pill label={b.status}   cls={BUG_STATUS_CLS[b.status]   ?? "bg-muted text-muted-foreground"} />
                    <Pill label={b.severity} cls={SEVERITY_CLS[b.severity]  ?? SEVERITY_CLS.medium} />
                  </div>
                  <p className="text-sm font-semibold text-foreground truncate">{b.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {b.userName ?? b.userEmail ?? "Anonymous"} · {timeAgo(b.createdAt)}
                    {b.browser && ` · ${b.browser}`}
                  </p>
                </div>
                <Bug className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {total > LIMIT && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">{total} total · page {page} of {pageCount}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      <BugSheet bug={selected} open={!!selected} onClose={() => setSelected(null)} onUpdate={() => { load(); setSelected(null); }} />
    </div>
  );
}

// ─── Feature Requests Panel ───────────────────────────────────────────────────

function FeaturesPanel() {
  const [items, setItems]         = useState<FeatureRequest[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatus] = useState("all");
  const [catFilter, setCat]       = useState("all");
  const [selected, setSelected]   = useState<FeatureRequest | null>(null);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: String(LIMIT),
        ...(search      && { search }),
        ...(statusFilter !== "all" && { status:   statusFilter }),
        ...(catFilter    !== "all" && { category: catFilter }),
      });
      const data = await apiFetch(`feature-requests?${params}`);
      setItems(data.data ?? []); setTotal(data.total ?? 0);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [page, search, statusFilter, catFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter, catFilter]);

  const pageCount = Math.max(Math.ceil(total / LIMIT), 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search feature requests…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 rounded-xl" />
        </div>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="h-9 rounded-xl w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all","open","planned","in_progress","completed","declined"].map(s => (
              <SelectItem key={s} value={s} className="text-xs">{s === "all" ? "All Statuses" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={catFilter} onValueChange={setCat}>
          <SelectTrigger className="h-9 rounded-xl w-full sm:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all","general","ui","performance","integration","security","other"].map(c => (
              <SelectItem key={c} value={c} className="text-xs capitalize">{c === "all" ? "All Categories" : c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />) :
      items.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No feature requests found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(f => (
            <div key={f.id}
              className="rounded-xl border border-border p-4 cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
              onClick={() => setSelected(f)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="text-xs font-mono text-muted-foreground">#{f.id}</span>
                    <Pill label={f.status}   cls={FEATURE_STATUS_CLS[f.status] ?? "bg-muted text-muted-foreground"} />
                    <Pill label={f.category} cls="bg-muted text-muted-foreground" />
                  </div>
                  <p className="text-sm font-semibold text-foreground truncate">{f.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {f.userName ?? f.userEmail ?? "Anonymous"} · {timeAgo(f.createdAt)}
                  </p>
                </div>
                <Lightbulb className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {total > LIMIT && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">{total} total · page {page} of {pageCount}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      <FeatureSheet feature={selected} open={!!selected} onClose={() => setSelected(null)} onUpdate={() => { load(); setSelected(null); }} />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface SupportOverview {
  openTickets: number; openBugs: number; pendingFeatures: number;
}

export function AdminSupport() {
  const [activeTab, setActiveTab] = useState<SupportTab>("tickets");
  const [overview, setOverview]   = useState<SupportOverview | null>(null);
  const [ovLoading, setOvLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    try {
      const ov = await apiFetch("dashboard-overview");
      setOverview({
        openTickets:     (ov.recentActivity?.pendingPlanRequests ?? 0) as number,
        openBugs:        (ov.recentActivity?.openBugReports?.length    ?? 0) as number,
        pendingFeatures: (ov.recentActivity?.openFeatureRequests?.length ?? 0) as number,
      });
    } catch { /* silent */ } finally { setOvLoading(false); }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const TABS = [
    { id: "tickets"  as const, label: "Support Tickets",   icon: TicketCheck },
    { id: "bugs"     as const, label: "Bug Reports",        icon: Bug },
    { id: "features" as const, label: "Feature Requests",  icon: Lightbulb },
  ];

  return (
    <div className="space-y-5">
      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MonitorCard icon={TicketCheck} label="Open Tickets"       value={overview?.openTickets     ?? 0} accent="blue"   loading={ovLoading} />
        <MonitorCard icon={Bug}         label="Open Bug Reports"   value={overview?.openBugs        ?? 0} accent="red"    loading={ovLoading} />
        <MonitorCard icon={Lightbulb}   label="Pending Features"   value={overview?.pendingFeatures ?? 0} accent="amber"  loading={ovLoading} />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-0">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      {activeTab === "tickets"  && <TicketsPanel />}
      {activeTab === "bugs"     && <BugsPanel />}
      {activeTab === "features" && <FeaturesPanel />}
    </div>
  );
}
