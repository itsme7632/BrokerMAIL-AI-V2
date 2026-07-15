import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  Server, RefreshCw, Search, MoreHorizontal,
  CheckCircle2, XCircle, AlertTriangle, Loader2,
  Zap, Clock, Mail, Activity, ChevronLeft, ChevronRight,
  Eye, List, Wifi, WifiOff, BarChart3, Inbox,
  History, RotateCcw, PlayCircle, Ban,
  TrendingUp, Users, Database,
  Copy, Check, ShieldAlert, Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminMailbox {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  userPlan: string | null;
  userCompany: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpSecure: string;
  fromName: string | null;
  replyTo: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapUser: string | null;
  isActive: boolean;
  maxPerHour: number;
  batchSize: number;
  quotaStatus: string | null;
  quotaCooldownUntil: string | null;
  quotaProbeCount: number;
  quotaSmtpResponse: string | null;
  quotaReachedAt: string | null;
  cooldownMinutes: number;
  probeRetryMinutes: number;
  createdAt: string;
  updatedAt: string;
  emailsSent: number;
  usedThisHour: number;
  deferredCount: number;
  pendingCount: number;
  failedCount: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  activeCampaigns: number;
  openCount: number;
  suppressed: number;
}

interface MailboxStats {
  totalMailboxes: number;
  connected: number;
  disconnected: number;
  coolingDown: number;
  smtpAccounts: number;
  gmailAccounts: number;
  activeToday: number;
  failedConnections: number;
}

interface QueueItem {
  id: number;
  email: string;
  status: string;
  attempts: number;
  deferredCount: number;
  lastError: string | null;
  sentAt: string | null;
  retryAfter: string | null;
  createdAt: string;
}

interface SmtpUsagePoint {
  hour: string;
  total: number;
  success: number;
  failed: number;
}

interface SmtpHistoryItem {
  id: number;
  email: string;
  subject: string | null;
  status: string;
  attempts: number;
  deferredCount: number;
  lastError: string | null;
  sentAt: string | null;
  firstAttemptAt: string | null;
  createdAt: string;
}

interface UserLite {
  id: number;
  name: string | null;
  email: string;
}

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
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `Error ${res.status}`);
  }
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtHour(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? "am" : "pm"}`;
}

function bounceRate(m: AdminMailbox): string {
  const total = m.emailsSent + m.deferredCount;
  if (total === 0) return "—";
  return `${Math.round((m.deferredCount / total) * 100)}%`;
}

function openRate(m: AdminMailbox): string {
  if (m.emailsSent === 0) return "—";
  return `${Math.round((m.openCount / m.emailsSent) * 100)}%`;
}

// Parse the SMTP error JSON stored in lastError field
interface ParsedSmtpError {
  friendly: string | null;
  rawCode: string | null;
  responseCode: number | null;
  response: string | null;
  command: string | null;
  stack: string | null;
}

function parseSmtpError(raw: string | null): ParsedSmtpError {
  const empty: ParsedSmtpError = { friendly: null, rawCode: null, responseCode: null, response: null, command: null, stack: null };
  if (!raw) return empty;
  try {
    const obj = JSON.parse(raw);
    return {
      friendly:     obj.friendly     ?? null,
      rawCode:      obj.rawCode      ?? obj.code       ?? null,
      responseCode: obj.responseCode ?? obj.smtpCode   ?? null,
      response:     obj.response     ?? obj.smtpResponse ?? null,
      command:      obj.command      ?? null,
      stack:        obj.stack        ?? null,
    };
  } catch {
    return { ...empty, friendly: raw };
  }
}

function smtpDisplayError(raw: string | null): string {
  if (!raw) return "";
  const p = parseSmtpError(raw);
  // Prefer raw SMTP provider response (e.g. "535 5.7.8 Authentication failed")
  if (p.response) return p.response;
  if (p.responseCode && p.friendly) return `${p.responseCode} ${p.friendly}`;
  if (p.rawCode && p.friendly) return `${p.rawCode}: ${p.friendly}`;
  return p.friendly ?? raw;
}

// ─── Health derivation ────────────────────────────────────────────────────────

type HealthState =
  | "healthy"
  | "auth_failed"
  | "connection_timeout"
  | "smtp_auth_error"
  | "provider_rejected"
  | "mailbox_disabled"
  | "tls_error"
  | "cooling_down"
  | "recovering"
  | "smtp_unreachable"
  | "invalid_credentials"
  | "mailbox_offline";

function deriveHealth(m: AdminMailbox): HealthState {
  if (!m.isActive) {
    return m.lastError ? "mailbox_offline" : "mailbox_disabled";
  }

  const p = parseSmtpError(m.lastError);
  const rc   = p.rawCode?.toUpperCase()   ?? "";
  const resp = (p.response ?? "").toLowerCase();
  const msg  = (p.friendly ?? m.lastError ?? "").toLowerCase();

  // TLS / SSL errors
  if (rc === "ESOCKET" || msg.includes("tls") || msg.includes("ssl") || msg.includes("certificate")) {
    return "tls_error";
  }

  // Unreachable / DNS
  if (rc === "ECONNREFUSED" || rc === "ENOTFOUND" || msg.includes("dns") || msg.includes("getaddrinfo")) {
    return "smtp_unreachable";
  }

  // Timeout / reset
  if (rc === "ETIMEDOUT" || rc === "ECONNRESET" || msg.includes("timed out") || msg.includes("connection reset")) {
    return "connection_timeout";
  }

  // Auth / credentials
  if (rc === "EAUTH" || resp.includes("535") || resp.includes("534") || resp.includes("454 4.7") ||
      msg.includes("invalid login") || msg.includes("authentication failed") || msg.includes("invalid credentials")) {
    // If the mailbox has never sent anything successfully, it's truly invalid credentials
    if (m.emailsSent === 0 && m.deferredCount > 0) return "invalid_credentials";
    // Check responseCode
    if (p.responseCode === 535 || resp.includes("535")) return "smtp_auth_error";
    // Provider-specific rejection
    if (resp.includes("provider") || resp.includes("blocked") || resp.includes("policy")) return "provider_rejected";
    return "auth_failed";
  }

  // Provider rejected (550, 554, etc.)
  if (resp.includes("550") || resp.includes("554") || resp.includes("rejected") || resp.includes("not permitted")) {
    return "provider_rejected";
  }

  // Quota / cooling down
  if (m.quotaStatus === "quota_reached") {
    return (m.quotaProbeCount ?? 0) > 2 ? "recovering" : "cooling_down";
  }

  // No errors, recently active
  if (m.usedThisHour > 0 || m.emailsSent > 0) return "healthy";
  return "healthy";
}

interface HealthInfo {
  label: string;
  emoji: string;
  cls: string;
  dotCls: string;
  severity: "green" | "yellow" | "orange" | "red";
}

function getHealthInfo(state: HealthState): HealthInfo {
  const map: Record<HealthState, HealthInfo> = {
    healthy:            { label: "Healthy",                 emoji: "🟢", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",  dotCls: "bg-emerald-500 animate-pulse", severity: "green"  },
    auth_failed:        { label: "Authentication Failed",   emoji: "🟡", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",        dotCls: "bg-amber-500",                 severity: "yellow" },
    connection_timeout: { label: "Connection Timeout",      emoji: "🟡", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",        dotCls: "bg-amber-500",                 severity: "yellow" },
    smtp_auth_error:    { label: "SMTP Auth Error",         emoji: "🟡", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",        dotCls: "bg-amber-500",                 severity: "yellow" },
    provider_rejected:  { label: "Provider Rejected Login", emoji: "🟡", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",        dotCls: "bg-amber-500",                 severity: "yellow" },
    mailbox_disabled:   { label: "Mailbox Disabled",        emoji: "🟡", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",        dotCls: "bg-amber-500",                 severity: "yellow" },
    tls_error:          { label: "TLS/SSL Error",           emoji: "🟡", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",        dotCls: "bg-amber-500",                 severity: "yellow" },
    cooling_down:       { label: "Cooling Down",            emoji: "🟠", cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400",     dotCls: "bg-orange-500",                severity: "orange" },
    recovering:         { label: "Recovering",              emoji: "🟠", cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400",     dotCls: "bg-violet-500 animate-pulse",  severity: "orange" },
    smtp_unreachable:   { label: "SMTP Unreachable",        emoji: "🔴", cls: "bg-red-500/10 text-red-600 dark:text-red-400",             dotCls: "bg-red-500",                   severity: "red"    },
    invalid_credentials:{ label: "Invalid Credentials",     emoji: "🔴", cls: "bg-red-500/10 text-red-600 dark:text-red-400",             dotCls: "bg-red-500",                   severity: "red"    },
    mailbox_offline:    { label: "Mailbox Offline",         emoji: "🔴", cls: "bg-red-500/10 text-red-600 dark:text-red-400",             dotCls: "bg-red-500",                   severity: "red"    },
  };
  return map[state];
}

function getWarningReason(m: AdminMailbox): string | null {
  const p = parseSmtpError(m.lastError);
  if (!m.isActive) return m.lastError ? smtpDisplayError(m.lastError) : "Mailbox manually disabled";

  const resp = (p.response ?? "").trim();
  if (resp) return resp;

  // Fall back to quota response
  if (m.quotaSmtpResponse) return m.quotaSmtpResponse;
  if (p.rawCode && p.friendly) return `${p.rawCode}: ${p.friendly}`;
  return p.friendly ?? null;
}

function inferProvider(host: string): string {
  const h = host.toLowerCase();
  if (h.includes("gmail") || h.includes("google")) return "Google";
  if (h.includes("outlook") || h.includes("office365") || h.includes("hotmail")) return "Microsoft";
  if (h.includes("sendgrid")) return "SendGrid";
  if (h.includes("mailgun")) return "Mailgun";
  if (h.includes("amazonaws")) return "Amazon SES";
  if (h.includes("zoho")) return "Zoho";
  if (h.includes("yahoo")) return "Yahoo";
  if (h.includes("fastmail")) return "Fastmail";
  if (h.includes("protonmail")) return "Proton";
  return host;
}

// ─── Overview card ────────────────────────────────────────────────────────────

const CARD_ACCENTS: Record<string, string> = {
  blue:    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  red:     "bg-red-500/10 text-red-600 dark:text-red-400",
  orange:  "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  violet:  "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  teal:    "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  indigo:  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
};

function MonitorCard({ icon: Icon, label, value, accent, loading }: {
  icon: React.ElementType; label: string; value: number | string; accent: string; loading: boolean;
}) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${CARD_ACCENTS[accent]}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
        {loading
          ? <Skeleton className="h-5 w-12 mt-1" />
          : <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
        }
      </div>
    </Card>
  );
}

// ─── Health badge with optional reason tooltip ────────────────────────────────

function HealthBadge({ m }: { m: AdminMailbox }) {
  const state = deriveHealth(m);
  const { label, cls, dotCls, severity } = getHealthInfo(state);
  const reason = severity !== "green" ? getWarningReason(m) : null;

  const badge = (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap cursor-default ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dotCls}`} />
      {label}
    </span>
  );

  if (!reason) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs break-words">
          <p className="font-semibold mb-0.5">Reason:</p>
          <p>{reason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Reason badge column ──────────────────────────────────────────────────────

function ReasonBadge({ m }: { m: AdminMailbox }) {
  const state = deriveHealth(m);
  if (state === "healthy") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const reason = getWarningReason(m);
  if (!reason) {
    const info = getHealthInfo(state);
    return <span className={`text-xs font-medium ${info.cls}`}>{info.label}</span>;
  }

  // Classify reason
  const r = reason.toLowerCase();
  let label = "Unknown";
  if (r.includes("auth") || r.includes("535") || r.includes("534") || r.includes("eauth")) label = "Authentication Failed";
  else if (r.includes("quota") || r.includes("limit") || r.includes("554") || r.includes("421")) label = "Mailbox Quota";
  else if (r.includes("timeout") || r.includes("etimedout")) label = "SMTP Timeout";
  else if (r.includes("econnrefused") || r.includes("econnreset")) label = "Network Error";
  else if (r.includes("dns") || r.includes("getaddrinfo") || r.includes("enotfound")) label = "DNS Failure";
  else if (r.includes("provider") || r.includes("policy") || r.includes("block")) label = "Provider Error";
  else if (r.includes("disabled") || r.includes("inactive")) label = "Disabled";
  else label = "Unknown";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium cursor-default underline decoration-dotted">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs break-words">
          {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Error cell with tooltip + modal ─────────────────────────────────────────

function ErrorCell({ raw, onOpenModal }: { raw: string | null; onOpenModal: () => void }) {
  if (!raw) return <span className="text-xs text-muted-foreground">—</span>;
  const display = smtpDisplayError(raw);
  const truncated = display.length > 60 ? display.slice(0, 60) + "…" : display;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={e => { e.stopPropagation(); onOpenModal(); }}
            className="text-xs text-red-600 dark:text-red-400 text-left hover:underline cursor-pointer max-w-[160px] truncate block"
          >
            {truncated}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs break-words">
          {display}
          <p className="mt-1 text-muted-foreground">Click to view full error</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Error modal ──────────────────────────────────────────────────────────────

function ErrorModal({ raw, open, onClose, timestamp }: {
  raw: string | null;
  open: boolean;
  onClose: () => void;
  timestamp?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!raw) return null;

  const p = parseSmtpError(raw);
  const displayMsg = p.response ?? p.friendly ?? raw;

  const copyAll = () => {
    const text = [
      timestamp && `Timestamp: ${new Date(timestamp).toLocaleString()}`,
      displayMsg && `Error: ${displayMsg}`,
      p.rawCode && `Code: ${p.rawCode}`,
      p.responseCode && `SMTP Response Code: ${p.responseCode}`,
      p.response && `Provider Response: ${p.response}`,
      p.command && `Command: ${p.command}`,
      p.stack && `\nStack Trace:\n${p.stack}`,
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <ShieldAlert className="h-4 w-4" /> SMTP Error Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {timestamp && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Timestamp</p>
              <p className="text-foreground">{new Date(timestamp).toLocaleString()}</p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Error Message</p>
            <p className="text-red-600 dark:text-red-400 break-words font-mono text-xs bg-red-50 dark:bg-red-900/10 rounded-lg p-3 border border-red-200 dark:border-red-800/40">
              {displayMsg || raw}
            </p>
          </div>

          {p.response && p.response !== displayMsg && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">SMTP Provider Response</p>
              <p className="font-mono text-xs bg-muted rounded-lg p-3 break-words text-foreground">{p.response}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {p.rawCode && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Error Code</p>
                <p className="font-mono text-xs text-foreground">{p.rawCode}</p>
              </div>
            )}
            {p.responseCode && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Response Code</p>
                <p className="font-mono text-xs text-foreground">{p.responseCode}</p>
              </div>
            )}
            {p.command && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">SMTP Command</p>
                <p className="font-mono text-xs text-foreground">{p.command}</p>
              </div>
            )}
          </div>

          {p.stack && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Stack Trace</p>
              <pre className="text-[10px] text-muted-foreground bg-muted rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">{p.stack}</pre>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-xl gap-2"
            onClick={copyAll}
          >
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy Error to Clipboard"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cooldown timer ───────────────────────────────────────────────────────────

function CooldownRemaining({ until }: { until: string | null }) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    if (!until) { setRemaining("—"); return; }
    const tick = () => {
      const ms = new Date(until).getTime() - Date.now();
      if (ms <= 0) { setRemaining("Expired"); return; }
      const m = Math.floor(ms / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setRemaining(`${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [until]);
  return <span>{remaining}</span>;
}

// ─── Queue drawer with actions ────────────────────────────────────────────────

const QUEUE_VIEWS = [
  { value: "all",      label: "All" },
  { value: "retry",    label: "Retry Queue" },
  { value: "deferred", label: "Deferred" },
];

function QueueDrawer({ mailboxId, mailboxEmail, open, onClose, onRefreshParent }: {
  mailboxId: number; mailboxEmail: string; open: boolean; onClose: () => void; onRefreshParent: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems]     = useState<QueueItem[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [view, setView]       = useState("all");
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const data = await apiFetch(`mailboxes/${mailboxId}/queue?page=${page}&limit=30&view=${view}`);
      setItems(data.data);
      setTotal(data.total);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [mailboxId, open, page, view]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [view]);
  useEffect(() => { if (!open) setView("all"); }, [open]);

  const pageCount = Math.max(Math.ceil(total / 30), 1);

  const doAction = async (action: string, status?: string) => {
    const key = status ? `${action}-${status}` : action;
    setActionBusy(key);
    try {
      let res: any;
      if (action === "retry-deferred") {
        res = await apiFetch(`mailboxes/${mailboxId}/retry-deferred`, { method: "POST" });
        toast({ title: `Retried ${res.retried} deferred item(s)` });
      } else if (action === "clear-queue" && status) {
        res = await apiFetch(`mailboxes/${mailboxId}/clear-queue`, {
          method: "POST",
          body: JSON.stringify({ status }),
        });
        toast({ title: `Removed ${res.removed} ${status} item(s)` });
      }
      setConfirmClear(null);
      await load();
      onRefreshParent();
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    } finally { setActionBusy(null); }
  };

  const STATUS_CLS: Record<string, string> = {
    pending:  "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    success:  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    failed:   "bg-red-500/10 text-red-600 dark:text-red-400",
    deferred: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    sending:  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <List className="h-4 w-4 text-muted-foreground" />
            Email Queue
          </SheetTitle>
          <p className="text-xs text-muted-foreground truncate">{mailboxEmail} · {total} items</p>
        </SheetHeader>

        {/* View tabs */}
        <div className="flex items-center gap-1 mb-3">
          {QUEUE_VIEWS.map(v => (
            <button
              key={v.value}
              onClick={() => setView(v.value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
                ${view === v.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-border">
          <Button
            variant="outline" size="sm" className="h-7 rounded-lg gap-1.5 text-xs"
            onClick={() => doAction("retry-deferred")}
            disabled={actionBusy === "retry-deferred"}
          >
            {actionBusy === "retry-deferred" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Retry Deferred
          </Button>
          {["pending","deferred","failed"].map(s => (
            <Button
              key={s}
              variant="outline" size="sm" className="h-7 rounded-lg gap-1.5 text-xs text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/40 hover:bg-red-50 dark:hover:bg-red-900/10"
              onClick={() => setConfirmClear(s)}
              disabled={actionBusy === `clear-queue-${s}`}
            >
              <Trash2 className="h-3 w-3" />
              Clear {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>

        {/* Confirm clear dialog */}
        {confirmClear && (
          <div className="mb-3 rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 p-3">
            <p className="text-xs text-red-600 dark:text-red-400 font-semibold mb-2">
              Clear all <strong>{confirmClear}</strong> items for this mailbox?
            </p>
            <div className="flex gap-2">
              <Button
                size="sm" className="h-7 rounded-lg gap-1.5 text-xs bg-red-600 hover:bg-red-700 text-white"
                onClick={() => doAction("clear-queue", confirmClear)}
                disabled={!!actionBusy}
              >
                {actionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Confirm Clear
              </Button>
              <Button variant="outline" size="sm" className="h-7 rounded-lg text-xs" onClick={() => setConfirmClear(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Items list */}
        <div className="space-y-2">
          {loading ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />) :
          items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No queue items found.
            </div>
          ) : items.map(item => (
            <div key={item.id} className="rounded-xl border border-border p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground truncate">{item.email}</p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize flex-shrink-0 ${STATUS_CLS[item.status] ?? "bg-muted text-muted-foreground"}`}>{item.status}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>Attempts: <span className="text-foreground font-medium">{item.attempts}</span></span>
                {item.deferredCount > 0 && <span>Deferred: <span className="text-amber-600 dark:text-amber-400 font-medium">{item.deferredCount}×</span></span>}
                {item.sentAt && <span>Sent: {timeAgo(item.sentAt)}</span>}
                {item.retryAfter && new Date(item.retryAfter) > new Date() && (
                  <span className="text-amber-600 dark:text-amber-400">Retry: {timeAgo(item.retryAfter)}</span>
                )}
              </div>
              {item.lastError && (
                <p className="text-xs text-red-600 dark:text-red-400 truncate font-mono">
                  {smtpDisplayError(item.lastError)}
                </p>
              )}
            </div>
          ))}
        </div>
        {total > 30 && (
          <div className="flex items-center justify-between pt-4">
            <span className="text-xs text-muted-foreground">{page} / {pageCount}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── SMTP Usage drawer ────────────────────────────────────────────────────────

function SmtpUsageDrawer({ mailboxId, mailboxEmail, open, onClose }: {
  mailboxId: number; mailboxEmail: string; open: boolean; onClose: () => void;
}) {
  const [data, setData]   = useState<SmtpUsagePoint[]>([]);
  const [peak, setPeak]   = useState(0);
  const [avg, setAvg]     = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch(`mailboxes/${mailboxId}/smtp-usage`)
      .then(r => { setData(r.data); setPeak(r.peak); setAvg(r.avg); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [mailboxId, open]);

  const chartData = data.map(d => ({ ...d, label: fmtHour(d.hour) }));
  const last24Total   = data.reduce((s, d) => s + Number(d.total),   0);
  const last24Success = data.reduce((s, d) => s + Number(d.success), 0);

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" /> SMTP Usage
          </SheetTitle>
          <p className="text-xs text-muted-foreground truncate">{mailboxEmail} · Last 24 hours</p>
        </SheetHeader>
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[{ label: "Last 24h", value: last24Total }, { label: "Peak / hr", value: peak }, { label: "Avg / hr", value: avg }].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-border p-3 text-center">
              <p className="text-xs text-muted-foreground">{label}</p>
              {loading ? <Skeleton className="h-5 w-8 mx-auto mt-1" /> : <p className="text-base font-bold text-foreground">{value}</p>}
            </div>
          ))}
        </div>
        {loading ? <Skeleton className="h-48 w-full rounded-xl" /> :
         data.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No send activity in the last 24 hours.
          </div>
        ) : (
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-3">Emails sent per hour</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <ReTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }} />
                <Bar dataKey="success" name="Success" stackId="a" fill="hsl(142 76% 36%)" radius={[0,0,0,0]} />
                <Bar dataKey="failed"  name="Failed"  stackId="a" fill="hsl(0 84% 60%)"   radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {last24Success > 0 && (
          <p className="text-xs text-muted-foreground mt-3 text-center">
            {last24Success} of {last24Total} sends succeeded in the last 24 hours
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── SMTP Events drawer (Part 9) ──────────────────────────────────────────────

const SMTP_EVENT_TABS = [
  { value: "all",      label: "All" },
  { value: "success",  label: "Success" },
  { value: "failed",   label: "Failed" },
  { value: "deferred", label: "Deferred" },
];

function SmtpEventsDrawer({ mailboxId, mailboxEmail, open, onClose }: {
  mailboxId: number; mailboxEmail: string; open: boolean; onClose: () => void;
}) {
  const [items, setItems]     = useState<SmtpHistoryItem[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [status, setStatus]   = useState("all");
  const [loading, setLoading] = useState(false);
  const [errorModal, setErrorModal] = useState<SmtpHistoryItem | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const data = await apiFetch(`mailboxes/${mailboxId}/smtp-history?page=${page}&limit=30&status=${status}`);
      setItems(data.data);
      setTotal(data.total);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [mailboxId, open, page, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status]);
  useEffect(() => { if (!open) setStatus("all"); }, [open]);

  const pageCount = Math.max(Math.ceil(total / 30), 1);

  const STATUS_CLS: Record<string, string> = {
    pending:  "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    success:  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    failed:   "bg-red-500/10 text-red-600 dark:text-red-400",
    deferred: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    sending:  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  };

  // Classify event type for display
  function eventType(item: SmtpHistoryItem): string {
    if (item.status === "success") return "✓ Send Success";
    if (item.status === "failed") {
      const p = parseSmtpError(item.lastError);
      const rc = (p.rawCode ?? "").toUpperCase();
      if (rc === "EAUTH" || (p.responseCode ?? 0) === 535) return "✗ Authentication";
      if (rc === "ECONNREFUSED" || rc === "ENOTFOUND")       return "✗ Connection";
      if (item.attempts > 1) return "✗ Failure";
      return "✗ Send Failed";
    }
    if (item.status === "deferred") return "↻ Deferred";
    if (item.deferredCount > 0)     return "↻ Retry";
    return item.status;
  }

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" /> SMTP Event History
          </SheetTitle>
          <p className="text-xs text-muted-foreground truncate">{mailboxEmail} · {total} events · newest first</p>
        </SheetHeader>
        <div className="flex items-center gap-1 mb-3 overflow-x-auto">
          {SMTP_EVENT_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setStatus(t.value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
                ${status === t.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {loading ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />) :
          items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <History className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No SMTP events found.
            </div>
          ) : items.map(item => (
            <div key={item.id} className="rounded-xl border border-border p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] text-muted-foreground font-medium">{eventType(item)}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize flex-shrink-0 ${STATUS_CLS[item.status] ?? "bg-muted text-muted-foreground"}`}>{item.status}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{item.email}</p>
                  {item.subject && <p className="text-xs text-muted-foreground truncate">{item.subject}</p>}
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                  {item.sentAt ? timeAgo(item.sentAt) : timeAgo(item.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>Attempts: <span className="text-foreground font-medium">{item.attempts}</span></span>
                {item.deferredCount > 0 && <span>Deferred: <span className="text-amber-600 dark:text-amber-400 font-medium">{item.deferredCount}×</span></span>}
                {item.firstAttemptAt && <span>First: {timeAgo(item.firstAttemptAt)}</span>}
              </div>
              {item.lastError && (
                <button
                  onClick={() => setErrorModal(item)}
                  className="text-xs text-red-600 dark:text-red-400 text-left hover:underline truncate block max-w-full font-mono"
                >
                  {smtpDisplayError(item.lastError).slice(0, 80)}{smtpDisplayError(item.lastError).length > 80 ? "…" : ""}
                </button>
              )}
            </div>
          ))}
        </div>
        {total > 30 && (
          <div className="flex items-center justify-between pt-4">
            <span className="text-xs text-muted-foreground">{page} / {pageCount}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </SheetContent>
      <ErrorModal
        raw={errorModal?.lastError ?? null}
        open={!!errorModal}
        onClose={() => setErrorModal(null)}
        timestamp={errorModal?.sentAt ?? errorModal?.createdAt}
      />
    </Sheet>
  );
}

// ─── Mailbox Detail drawer ────────────────────────────────────────────────────

function DetailDrawer({ mailbox, open, onClose, onAction, onOpenHistory, onOpenQueue }: {
  mailbox: AdminMailbox | null;
  open: boolean;
  onClose: () => void;
  onAction: (action: string, id: number) => Promise<void>;
  onOpenHistory: (m: AdminMailbox) => void;
  onOpenQueue: (m: AdminMailbox) => void;
}) {
  const { toast } = useToast();
  const [testResult,  setTestResult]  = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing,     setTesting]     = useState(false);
  const [imapResult,  setImapResult]  = useState<{ ok: boolean; msg: string } | null>(null);
  const [testingImap, setTestingImap] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [copiedSMTP,  setCopiedSMTP]  = useState(false);
  const [actionBusy,  setActionBusy]  = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTestResult(null); setImapResult(null);
      setCopiedSMTP(false); setConfirmClear(null);
    }
  }, [open]);

  if (!mailbox) return null;

  const health   = deriveHealth(mailbox);
  const { label: healthLabel, cls: healthCls } = getHealthInfo(health);
  const provider = inferProvider(mailbox.smtpHost);
  const quotaUsedPct = mailbox.maxPerHour > 0 ? Math.min((mailbox.usedThisHour / mailbox.maxPerHour) * 100, 100) : 0;
  const hasImap  = !!(mailbox.imapHost && mailbox.imapUser);
  const reason   = getWarningReason(mailbox);
  const smtpError = smtpDisplayError(mailbox.lastError);

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await apiFetch(`mailboxes/${mailbox.id}/test-connection`, { method: "POST" });
      setTestResult({ ok: r.ok, msg: r.message ?? "Connection verified" });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : "Test failed" });
    } finally { setTesting(false); }
  };

  const handleTestImap = async () => {
    setTestingImap(true); setImapResult(null);
    try {
      const r = await apiFetch(`mailboxes/${mailbox.id}/test-imap`, { method: "POST" });
      setImapResult({ ok: r.ok, msg: r.message ?? r.error ?? "IMAP checked" });
    } catch (e) {
      setImapResult({ ok: false, msg: e instanceof Error ? e.message : "Test failed" });
    } finally { setTestingImap(false); }
  };

  const handleQuickAction = async (action: string, status?: string) => {
    const key = status ? `${action}-${status}` : action;
    setActionBusy(key);
    try {
      let res: any;
      if (action === "retry-deferred") {
        res = await apiFetch(`mailboxes/${mailbox.id}/retry-deferred`, { method: "POST" });
        toast({ title: `Retried ${res.retried} deferred item(s)` });
      } else if (action === "clear-queue" && status) {
        res = await apiFetch(`mailboxes/${mailbox.id}/clear-queue`, {
          method: "POST",
          body: JSON.stringify({ status }),
        });
        toast({ title: `Removed ${res.removed} ${status} queue item(s)` });
      } else {
        await onAction(action, mailbox.id);
      }
      setConfirmClear(null);
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    } finally { setActionBusy(null); }
  };

  const copySMTPError = () => {
    navigator.clipboard.writeText(smtpError || mailbox.lastError || "").then(() => {
      setCopiedSMTP(true);
      setTimeout(() => setCopiedSMTP(false), 2000);
    });
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" /> Mailbox Details
          </SheetTitle>
        </SheetHeader>

        {/* Header identity */}
        <div className="rounded-xl border border-border p-4 mb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{mailbox.smtpUser}</p>
              {mailbox.fromName && <p className="text-xs text-muted-foreground">{mailbox.fromName}</p>}
            </div>
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${healthCls}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {healthLabel}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">{provider}</span>
            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold">SMTP</span>
            {!mailbox.isActive && <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">Disabled</span>}
          </div>
        </div>

        {/* Owner info (Part 5) */}
        <div className="rounded-xl border border-border p-4 mb-4">
          <p className="text-xs font-semibold text-foreground mb-2">Owner</p>
          <div className="grid grid-cols-2 gap-y-1.5 text-xs">
            <span className="text-muted-foreground">Name</span>
            <span className="text-foreground font-medium truncate">{mailbox.userName ?? "—"}</span>
            <span className="text-muted-foreground">Email</span>
            <span className="text-foreground font-medium truncate">{mailbox.userEmail ?? "—"}</span>
            {mailbox.userCompany && <>
              <span className="text-muted-foreground">Company</span>
              <span className="text-foreground font-medium truncate">{mailbox.userCompany}</span>
            </>}
            <span className="text-muted-foreground">Plan</span>
            <span className="text-foreground font-medium capitalize">{mailbox.userPlan ?? "free"}</span>
            <span className="text-muted-foreground">Active Campaigns</span>
            <span className="text-foreground font-medium">{mailbox.activeCampaigns}</span>
          </div>
        </div>

        {/* Queue breakdown (Part 7) */}
        <div className="rounded-xl border border-border p-4 mb-4">
          <p className="text-xs font-semibold text-foreground mb-2">Queue Status</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Pending",  value: mailbox.pendingCount,  cls: "text-blue-600 dark:text-blue-400"   },
              { label: "Deferred", value: mailbox.deferredCount, cls: "text-amber-600 dark:text-amber-400" },
              { label: "Failed",   value: mailbox.failedCount,   cls: "text-red-600 dark:text-red-400"     },
              { label: "Success",  value: mailbox.emailsSent,    cls: "text-emerald-600 dark:text-emerald-400" },
            ].map(({ label, value, cls }) => (
              <div key={label} className="rounded-lg border border-border p-2.5 text-center">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-sm font-bold ${cls}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: "Total Sent",  value: mailbox.emailsSent.toLocaleString() },
            { label: "Opens",       value: mailbox.openCount.toLocaleString() },
            { label: "Open Rate",   value: openRate(mailbox) },
            { label: "Bounce Rate", value: bounceRate(mailbox) },
            { label: "Used / hr",   value: `${mailbox.usedThisHour}/${mailbox.maxPerHour}` },
            { label: "Suppressed",  value: mailbox.suppressed.toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-border p-2.5 text-center">
              <p className="text-xs text-muted-foreground leading-tight">{label}</p>
              <p className="text-sm font-bold text-foreground mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* Hourly quota */}
        <div className="rounded-xl border border-border p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-foreground">Hourly Quota</p>
            <p className="text-xs text-muted-foreground">{mailbox.usedThisHour} / {mailbox.maxPerHour}</p>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${quotaUsedPct >= 90 ? "bg-red-500" : quotaUsedPct >= 70 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${quotaUsedPct}%` }} />
          </div>
          {mailbox.quotaStatus === "quota_reached" && (
            <div className="mt-3 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cooldown until</span>
                <span className="text-foreground font-medium">{mailbox.quotaCooldownUntil ? <CooldownRemaining until={mailbox.quotaCooldownUntil} /> : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Probe attempts</span>
                <span className="text-foreground font-medium">{mailbox.quotaProbeCount}</span>
              </div>
              {mailbox.quotaSmtpResponse && (
                <p className="text-red-600 dark:text-red-400 font-mono text-xs truncate" title={mailbox.quotaSmtpResponse}>
                  {mailbox.quotaSmtpResponse}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Warning reason (Part 3, 6) */}
        {reason && health !== "healthy" && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 p-3 mb-4">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">Warning Reason</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-mono break-words">{reason}</p>
          </div>
        )}

        {/* Last error (Part 4, 12) */}
        {mailbox.lastError && (
          <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 p-3 mb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400">Last SMTP Error</p>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-red-600 dark:text-red-400" onClick={copySMTPError}>
                  {copiedSMTP ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-red-600 dark:text-red-400" onClick={() => setErrorModalOpen(true)}>
                  <Eye className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-red-600 dark:text-red-400 break-words font-mono">
              {smtpError.slice(0, 120)}{smtpError.length > 120 ? "…" : ""}
            </p>
          </div>
        )}

        {/* Connection Tests */}
        <div className="rounded-xl border border-border p-4 mb-4 space-y-3">
          <p className="text-xs font-semibold text-foreground">Connection Tests</p>
          <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2" disabled={testing} onClick={handleTest}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
            {testing ? "Testing…" : "Test SMTP Connection"}
          </Button>
          {testResult && (
            <div className={`rounded-lg p-2.5 text-xs flex items-center gap-2 ${testResult.ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
              {testResult.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <XCircle className="h-4 w-4 flex-shrink-0" />}
              {testResult.msg}
            </div>
          )}
          {hasImap && (
            <>
              <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2" disabled={testingImap} onClick={handleTestImap}>
                {testingImap ? <Loader2 className="h-4 w-4 animate-spin" /> : <Inbox className="h-4 w-4" />}
                {testingImap ? "Testing…" : "Test IMAP Connection"}
              </Button>
              {imapResult && (
                <div className={`rounded-lg p-2.5 text-xs flex items-center gap-2 ${imapResult.ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                  {imapResult.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <XCircle className="h-4 w-4 flex-shrink-0" />}
                  {imapResult.msg}
                </div>
              )}
            </>
          )}
        </div>

        {/* Quick Fix Actions (Part 8) */}
        <div className="space-y-2 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quick Fix Actions</p>

          <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2" onClick={() => onOpenHistory(mailbox)}>
            <History className="h-4 w-4" /> View SMTP Event History
          </Button>
          <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2" onClick={() => onOpenQueue(mailbox)}>
            <List className="h-4 w-4" /> View Queue
          </Button>
          <Button
            variant="outline" size="sm"
            className="w-full rounded-xl h-9 gap-2 text-blue-600 dark:text-blue-400"
            onClick={() => handleQuickAction("force-reconnect")}
            disabled={actionBusy === "force-reconnect"}
          >
            {actionBusy === "force-reconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Force Reconnect
          </Button>
          <Button
            variant="outline" size="sm"
            className="w-full rounded-xl h-9 gap-2 text-amber-600 dark:text-amber-400"
            onClick={() => handleQuickAction("retry-deferred")}
            disabled={actionBusy === "retry-deferred" || mailbox.deferredCount === 0}
          >
            {actionBusy === "retry-deferred" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Retry Deferred ({mailbox.deferredCount})
          </Button>

          {/* Clear queue actions */}
          {(["deferred","pending","failed"] as const).map(s => {
            const count = s === "deferred" ? mailbox.deferredCount : s === "pending" ? mailbox.pendingCount : mailbox.failedCount;
            if (count === 0) return null;
            return confirmClear === s ? (
              <div key={s} className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 p-3">
                <p className="text-xs text-red-600 dark:text-red-400 font-semibold mb-2">
                  Remove {count} {s} item(s)?
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm" className="h-7 rounded-lg text-xs bg-red-600 hover:bg-red-700 text-white gap-1.5"
                    onClick={() => handleQuickAction("clear-queue", s)}
                    disabled={!!actionBusy}
                  >
                    {actionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Confirm
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 rounded-lg text-xs" onClick={() => setConfirmClear(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                key={s}
                variant="outline" size="sm"
                className="w-full rounded-xl h-9 gap-2 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/40 hover:bg-red-50 dark:hover:bg-red-900/10"
                onClick={() => setConfirmClear(s)}
                disabled={!!actionBusy}
              >
                <Trash2 className="h-4 w-4" />
                Clear {s.charAt(0).toUpperCase() + s.slice(1)} Queue ({count})
              </Button>
            );
          })}

          {mailbox.lastError && (
            <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2 text-muted-foreground" onClick={copySMTPError}>
              {copiedSMTP ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedSMTP ? "Copied!" : "Copy SMTP Error"}
            </Button>
          )}

          <Separator />

          {mailbox.isActive ? (
            <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2 text-muted-foreground" onClick={() => onAction("disable", mailbox.id)}>
              <Ban className="h-4 w-4" /> Disable Mailbox
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2 text-emerald-600 dark:text-emerald-400" onClick={() => onAction("enable", mailbox.id)}>
              <PlayCircle className="h-4 w-4" /> Enable Mailbox
            </Button>
          )}
          {mailbox.quotaStatus && (
            <Button variant="outline" size="sm" className="w-full rounded-xl h-9 gap-2 text-violet-600 dark:text-violet-400" onClick={() => onAction("force-quota-reset", mailbox.id)}>
              <RotateCcw className="h-4 w-4" /> Force Quota Reset
            </Button>
          )}
        </div>
      </SheetContent>

      <ErrorModal
        raw={mailbox.lastError}
        open={errorModalOpen}
        onClose={() => setErrorModalOpen(false)}
        timestamp={mailbox.updatedAt}
      />
    </Sheet>
  );
}

// ─── Status / Connection filter tabs ──────────────────────────────────────────

const STATUS_TABS = [
  { value: "all",          label: "All" },
  { value: "active",       label: "Connected" },
  { value: "cooling_down", label: "Cooling Down" },
  { value: "recovering",   label: "Recovering" },
  { value: "inactive",     label: "Disabled" },
];

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(mailboxes: AdminMailbox[]) {
  const headers = [
    "ID","Owner","Email","Company","Plan","SMTP User","Host","Port","Security","Provider",
    "Health","Reason","Pending","Deferred","Failed","Sent","Open Rate","Active Campaigns","Created",
  ];
  const rows = mailboxes.map(m => [
    m.id, m.userName ?? "", m.userEmail ?? "", m.userCompany ?? "", m.userPlan ?? "free",
    m.smtpUser, m.smtpHost, m.smtpPort, m.smtpSecure,
    inferProvider(m.smtpHost),
    getHealthInfo(deriveHealth(m)).label,
    getWarningReason(m) ?? "",
    m.pendingCount, m.deferredCount, m.failedCount, m.emailsSent,
    openRate(m), m.activeCampaigns,
    fmtDate(m.createdAt),
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: "mailboxes.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminMailboxes() {
  const { toast } = useToast();

  const [stats, setStats]                   = useState<MailboxStats | null>(null);
  const [statsLoading, setStatsLoading]     = useState(true);
  const [mailboxes, setMailboxes]           = useState<AdminMailbox[]>([]);
  const [total, setTotal]                   = useState(0);
  const [page, setPage]                     = useState(1);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [search, setSearch]                 = useState("");
  const [statusFilter, setStatusFilter]     = useState("all");
  const [providerFilter, setProviderFilter] = useState("");
  const [userFilter, setUserFilter]         = useState("");
  const [dateFrom, setDateFrom]             = useState("");
  const [dateTo, setDateTo]                 = useState("");
  const [users, setUsers]                   = useState<UserLite[]>([]);
  const [actionLoading, setActionLoading]   = useState<number | null>(null);
  const [detailMailbox, setDetailMailbox]   = useState<AdminMailbox | null>(null);
  const [queueMailbox, setQueueMailbox]     = useState<AdminMailbox | null>(null);
  const [usageMailbox, setUsageMailbox]     = useState<AdminMailbox | null>(null);
  const [historyMailbox, setHistoryMailbox] = useState<AdminMailbox | null>(null);
  const [errorModal, setErrorModal]         = useState<{ raw: string; ts?: string } | null>(null);

  const pageCount        = Math.max(Math.ceil(total / 25), 1);
  const refreshTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const overview = await apiFetch("dashboard-overview");
      setStats(overview.mailboxMonitor ?? null);
    } catch { /* silent */ }
    finally { setStatsLoading(false); }
  }, []);

  const loadMailboxes = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: "25",
        ...(search                 && { search }),
        ...(statusFilter !== "all" && { status: statusFilter }),
        ...(providerFilter         && { provider: providerFilter }),
        ...(userFilter             && { userId: userFilter }),
        ...(dateFrom               && { dateFrom }),
        ...(dateTo                 && { dateTo }),
      });
      const data = await apiFetch(`mailboxes?${params}`);
      setMailboxes(data.data);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mailboxes");
    } finally { setLoading(false); }
  }, [page, search, statusFilter, providerFilter, userFilter, dateFrom, dateTo]);

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiFetch("users?limit=100");
      setUsers(data.data.map((u: any) => ({ id: u.id, name: u.name, email: u.email })));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadStats(); loadMailboxes(); }, [loadStats, loadMailboxes]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  // Auto-refresh every 30s when mailboxes are active (Part 7)
  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(() => { loadStats(); loadMailboxes(); }, 30_000);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [loadStats, loadMailboxes]);

  useEffect(() => { setPage(1); }, [search, statusFilter, providerFilter, userFilter, dateFrom, dateTo]);

  const handleAction = async (action: string, id: number) => {
    setActionLoading(id);
    try {
      await apiFetch(`mailboxes/${id}/${action}`, { method: "POST" });
      await Promise.all([loadMailboxes(), loadStats()]);
      // Refresh detail drawer if open
      if (detailMailbox?.id === id) {
        const updated = mailboxes.find(m => m.id === id);
        if (updated) setDetailMailbox(updated);
      }
      toast({ title: "Action completed" });
    } catch (e) {
      toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
    } finally { setActionLoading(null); }
  };

  // Refresh everything after queue actions (Part 11)
  const refreshAll = useCallback(() => {
    loadStats();
    loadMailboxes();
  }, [loadStats, loadMailboxes]);

  const clearFilters = () => {
    setSearch(""); setStatusFilter("all"); setProviderFilter(""); setUserFilter("");
    setDateFrom(""); setDateTo("");
  };
  const hasFilters = search || statusFilter !== "all" || providerFilter || userFilter || dateFrom || dateTo;

  return (
    <div className="space-y-5">

      {/* ── Overview Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <MonitorCard icon={Server}        label="Total Mailboxes"     value={stats?.totalMailboxes   ?? 0} accent="blue"    loading={statsLoading} />
        <MonitorCard icon={Wifi}          label="Connected"           value={stats?.connected        ?? 0} accent="emerald" loading={statsLoading} />
        <MonitorCard icon={WifiOff}       label="Disconnected"        value={stats?.disconnected     ?? 0} accent="amber"   loading={statsLoading} />
        <MonitorCard icon={Clock}         label="Cooling Down"        value={stats?.coolingDown      ?? 0} accent="orange"  loading={statsLoading} />
        <MonitorCard icon={Database}      label="SMTP Accounts"       value={stats?.smtpAccounts     ?? 0} accent="indigo"  loading={statsLoading} />
        <MonitorCard icon={Mail}          label="Gmail Accounts"      value={stats?.gmailAccounts    ?? 0} accent="violet"  loading={statsLoading} />
        <MonitorCard icon={Activity}      label="Active Today"        value={stats?.activeToday      ?? 0} accent="teal"    loading={statsLoading} />
        <MonitorCard icon={AlertTriangle} label="Failed Connections"  value={stats?.failedConnections ?? 0} accent="red"   loading={statsLoading} />
      </div>

      {/* ── Status tabs ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
              ${statusFilter === tab.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search mailbox, user, host…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 rounded-xl"
          />
        </div>
        <Select value={providerFilter || "all"} onValueChange={v => setProviderFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 rounded-xl w-full sm:w-40"><SelectValue placeholder="Provider" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Providers</SelectItem>
            <SelectItem value="google">Google</SelectItem>
            <SelectItem value="microsoft">Microsoft</SelectItem>
            <SelectItem value="sendgrid">SendGrid</SelectItem>
            <SelectItem value="mailgun">Mailgun</SelectItem>
            <SelectItem value="amazon">Amazon SES</SelectItem>
          </SelectContent>
        </Select>
        <Select value={userFilter || "all"} onValueChange={v => setUserFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 rounded-xl w-full sm:w-44"><SelectValue placeholder="User" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            {users.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name ?? u.email}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 rounded-xl w-full sm:w-36" />
        <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="h-9 rounded-xl w-full sm:w-36" />
        <div className="flex gap-2">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-3 rounded-xl text-muted-foreground">Clear</Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { loadMailboxes(); loadStats(); }} disabled={loading} className="h-9 px-3 rounded-xl gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportCSV(mailboxes)} disabled={mailboxes.length === 0} className="h-9 px-3 rounded-xl gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${total.toLocaleString()} mailbox${total !== 1 ? "es" : ""}`}
        </p>
        {total > 25 && <p className="text-xs text-muted-foreground">Page {page} of {pageCount}</p>}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 p-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* ── Desktop table ──────────────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-left">
              {["Mailbox", "Owner", "Provider", "Health", "Reason", "Queue (P/D/F)", "Used / Limit", "Last Send", "Last Error", "Actions"].map(h => (
                <th key={h} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? Array(5).fill(0).map((_, i) => (
              <tr key={i} className="border-b border-border">
                {Array(10).fill(0).map((__, j) => <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-full" /></td>)}
              </tr>
            )) : mailboxes.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-16 text-center text-muted-foreground text-sm">
                  <Server className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  No mailboxes found.
                </td>
              </tr>
            ) : mailboxes.map(m => {
              const quotaUsedPct = m.maxPerHour > 0 ? Math.min((m.usedThisHour / m.maxPerHour) * 100, 100) : 0;
              const isBusy = actionLoading === m.id;
              return (
                <tr key={m.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  {/* Mailbox */}
                  <td className="px-3 py-3 max-w-[160px]">
                    <p className="font-mono text-xs font-medium text-foreground truncate">{m.smtpUser}</p>
                    {m.fromName && <p className="text-xs text-muted-foreground truncate">{m.fromName}</p>}
                    <p className="text-[10px] text-muted-foreground"># {m.id}</p>
                  </td>
                  {/* Owner (Part 5) */}
                  <td className="px-3 py-3 max-w-[150px]">
                    <p className="text-xs font-medium text-foreground truncate">{m.userName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.userEmail ?? ""}</p>
                    {m.userCompany && <p className="text-[10px] text-muted-foreground truncate">{m.userCompany}</p>}
                    <span className="inline-flex mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground capitalize">{m.userPlan ?? "free"}</span>
                  </td>
                  {/* Provider */}
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{inferProvider(m.smtpHost)}</td>
                  {/* Health (Part 2) */}
                  <td className="px-3 py-3"><HealthBadge m={m} /></td>
                  {/* Reason (Part 6) */}
                  <td className="px-3 py-3"><ReasonBadge m={m} /></td>
                  {/* Queue counts (Part 7) */}
                  <td className="px-3 py-3 text-xs tabular-nums whitespace-nowrap">
                    <span className="text-blue-600 dark:text-blue-400">{m.pendingCount}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-amber-600 dark:text-amber-400">{m.deferredCount}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-red-600 dark:text-red-400">{m.failedCount}</span>
                  </td>
                  {/* Usage bar */}
                  <td className="px-3 py-3 min-w-[100px]">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[50px]">
                        <div className={`h-full rounded-full transition-all ${quotaUsedPct >= 90 ? "bg-red-500" : quotaUsedPct >= 70 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${quotaUsedPct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{m.usedThisHour}/{m.maxPerHour}</span>
                    </div>
                  </td>
                  {/* Last success */}
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.lastSuccessAt ? timeAgo(m.lastSuccessAt) : "Never"}</td>
                  {/* Last error (Part 4, 12) */}
                  <td className="px-3 py-3 max-w-[160px]">
                    <ErrorCell raw={m.lastError} onOpenModal={() => setErrorModal({ raw: m.lastError!, ts: m.updatedAt })} />
                  </td>
                  {/* Actions */}
                  <td className="px-3 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" disabled={isBusy}>
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl">
                        <DropdownMenuItem onClick={() => setDetailMailbox(m)}><Eye className="h-4 w-4 mr-2" /> View Mailbox</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setQueueMailbox(m)}><List className="h-4 w-4 mr-2" /> View Queue</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setUsageMailbox(m)}><BarChart3 className="h-4 w-4 mr-2" /> View SMTP Usage</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setHistoryMailbox(m)}><History className="h-4 w-4 mr-2" /> SMTP Event History</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleAction("test-connection", m.id)}><Wifi className="h-4 w-4 mr-2" /> Test SMTP</DropdownMenuItem>
                        {m.imapHost && <DropdownMenuItem onClick={() => handleAction("test-imap", m.id)}><Inbox className="h-4 w-4 mr-2" /> Test IMAP</DropdownMenuItem>}
                        <DropdownMenuItem onClick={() => handleAction("force-reconnect", m.id)} className="text-blue-600 dark:text-blue-400"><Zap className="h-4 w-4 mr-2" /> Force Reconnect</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {m.isActive
                          ? <DropdownMenuItem onClick={() => handleAction("disable", m.id)} className="text-muted-foreground"><Ban className="h-4 w-4 mr-2" /> Disable</DropdownMenuItem>
                          : <DropdownMenuItem onClick={() => handleAction("enable",  m.id)} className="text-emerald-600 dark:text-emerald-400"><PlayCircle className="h-4 w-4 mr-2" /> Enable</DropdownMenuItem>}
                        {m.quotaStatus && (
                          <DropdownMenuItem onClick={() => handleAction("force-quota-reset", m.id)} className="text-violet-600 dark:text-violet-400"><RotateCcw className="h-4 w-4 mr-2" /> Force Quota Reset</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ───────────────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {loading ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />) :
        mailboxes.length === 0 ? (
          <div className="py-16 text-center"><Server className="h-10 w-10 mx-auto text-muted-foreground/20 mb-3" /><p className="text-sm text-muted-foreground">No mailboxes found.</p></div>
        ) : mailboxes.map(m => {
          const isBusy = actionLoading === m.id;
          return (
            <Card key={m.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-foreground truncate">{m.smtpUser}</p>
                  <p className="text-xs text-muted-foreground">{m.userName ?? "—"} · {m.userPlan ?? "free"} · {inferProvider(m.smtpHost)}</p>
                  {m.userCompany && <p className="text-xs text-muted-foreground">{m.userCompany}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <HealthBadge m={m} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" disabled={isBusy}>
                        {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 rounded-xl">
                      <DropdownMenuItem onClick={() => setDetailMailbox(m)}><Eye className="h-4 w-4 mr-2" /> View Mailbox</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setQueueMailbox(m)}><List className="h-4 w-4 mr-2" /> View Queue</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setHistoryMailbox(m)}><History className="h-4 w-4 mr-2" /> SMTP Events</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleAction("force-reconnect", m.id)} className="text-blue-600 dark:text-blue-400"><Zap className="h-4 w-4 mr-2" /> Force Reconnect</DropdownMenuItem>
                      {m.isActive
                        ? <DropdownMenuItem onClick={() => handleAction("disable", m.id)} className="text-muted-foreground"><Ban className="h-4 w-4 mr-2" /> Disable</DropdownMenuItem>
                        : <DropdownMenuItem onClick={() => handleAction("enable",  m.id)} className="text-emerald-600 dark:text-emerald-400"><PlayCircle className="h-4 w-4 mr-2" /> Enable</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Sent",   value: m.emailsSent.toLocaleString() },
                  { label: "Pend",   value: m.pendingCount  },
                  { label: "Defer",  value: m.deferredCount },
                  { label: "Failed", value: m.failedCount   },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-muted/50 p-2 text-center">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-bold text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              {m.quotaStatus && (
                <div className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400">
                  <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                  {m.quotaCooldownUntil ? <><CooldownRemaining until={m.quotaCooldownUntil} /> remaining</> : "Quota reached"}
                </div>
              )}

              {m.lastError && (
                <button
                  onClick={() => setErrorModal({ raw: m.lastError!, ts: m.updatedAt })}
                  className="text-xs text-red-600 dark:text-red-400 truncate block text-left hover:underline font-mono"
                >
                  {smtpDisplayError(m.lastError).slice(0, 80)}
                </button>
              )}
            </Card>
          );
        })}
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {total > 25 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Page {page} of {pageCount} · {total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-lg" disabled={page >= pageCount || loading} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Drawers ────────────────────────────────────────────────────────── */}
      <DetailDrawer
        mailbox={detailMailbox}
        open={!!detailMailbox}
        onClose={() => setDetailMailbox(null)}
        onAction={handleAction}
        onOpenHistory={setHistoryMailbox}
        onOpenQueue={setQueueMailbox}
      />
      <QueueDrawer
        mailboxId={queueMailbox?.id ?? 0}
        mailboxEmail={queueMailbox?.smtpUser ?? ""}
        open={!!queueMailbox}
        onClose={() => setQueueMailbox(null)}
        onRefreshParent={refreshAll}
      />
      <SmtpUsageDrawer
        mailboxId={usageMailbox?.id ?? 0}
        mailboxEmail={usageMailbox?.smtpUser ?? ""}
        open={!!usageMailbox}
        onClose={() => setUsageMailbox(null)}
      />
      <SmtpEventsDrawer
        mailboxId={historyMailbox?.id ?? 0}
        mailboxEmail={historyMailbox?.smtpUser ?? ""}
        open={!!historyMailbox}
        onClose={() => setHistoryMailbox(null)}
      />
      <ErrorModal
        raw={errorModal?.raw ?? null}
        open={!!errorModal}
        onClose={() => setErrorModal(null)}
        timestamp={errorModal?.ts}
      />
    </div>
  );
}
