import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, XCircle, Server, Mail, User, Lock,
  Wifi, Trash2, Save, FlaskConical, ChevronDown, ChevronUp, Eye, EyeOff,
  Shield, Clock, Gauge, AlertTriangle, Zap, RefreshCw, TimerReset,
  Activity, HeartPulse, BarChart3, Ban, PlayCircle, PauseCircle,
} from "lucide-react";

// ─── Shared types ─────────────────────────────────────────────────────────────

interface QuotaStats {
  hourlyLimit: number;
  usedThisHour: number;
  remainingQuota: number;
  deferredCount: number;
  retryQueueCount: number;
  nextReleaseAt: string | null;
  quotaStatus:        string | null;
  quotaReachedAt:     string | null;
  quotaCooldownUntil: string | null;
  quotaSmtpResponse:  string | null;
  quotaProbeCount:    number;
}

interface HealthStats {
  openRate: number;
  bounceRate: number;
  suppressionCount: number;
}

type Secure = "ssl" | "tls" | "none";

interface MailboxForm {
  smtpHost: string; smtpPort: string; smtpUser: string; smtpPass: string; smtpSecure: Secure;
  imapHost: string; imapPort: string; imapUser: string; imapPass: string;
  fromName: string; replyTo: string;
  batchSize: number;
  delaySeconds: number;
  maxPerHour: number;
  cooldownMinutes: number;
  probeRetryMinutes: number;
}

const EMPTY_FORM: MailboxForm = {
  smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", smtpSecure: "tls",
  imapHost: "", imapPort: "993", imapUser: "", imapPass: "",
  fromName: "", replyTo: "",
  batchSize: 10,
  delaySeconds: 15,
  maxPerHour: 50,
  cooldownMinutes: 60,
  probeRetryMinutes: 5,
};

const PRESETS = [
  { name: "Hostinger",       smtp: "smtp.hostinger.com",    smtpPort: "465", secure: "ssl" as Secure, imap: "imap.hostinger.com",    imapPort: "993" },
  { name: "cPanel / WHM",    smtp: "mail.yourdomain.com",   smtpPort: "465", secure: "ssl" as Secure, imap: "mail.yourdomain.com",   imapPort: "993" },
  { name: "Zoho Mail",       smtp: "smtp.zoho.com",         smtpPort: "465", secure: "ssl" as Secure, imap: "imap.zoho.com",         imapPort: "993" },
  { name: "Outlook / 365",   smtp: "smtp.office365.com",    smtpPort: "587", secure: "tls" as Secure, imap: "outlook.office365.com", imapPort: "993" },
  { name: "Gmail SMTP",      smtp: "smtp.gmail.com",        smtpPort: "587", secure: "tls" as Secure, imap: "imap.gmail.com",        imapPort: "993" },
  { name: "Namecheap Email", smtp: "mail.privateemail.com", smtpPort: "465", secure: "ssl" as Secure, imap: "mail.privateemail.com", imapPort: "993" },
];

const DELAY_OPTIONS = [
  { value: 5,  label: "5s",  desc: "Fast" },
  { value: 10, label: "10s", desc: "Normal" },
  { value: 15, label: "15s", desc: "Safe ★" },
  { value: 30, label: "30s", desc: "Careful" },
  { value: 60, label: "60s", desc: "Slow" },
];

const BATCH_OPTIONS = [
  { value: 10,  label: "10" },
  { value: 25,  label: "25" },
  { value: 50,  label: "50" },
  { value: 100, label: "100" },
];

const HOURLY_OPTIONS = [
  { value: 50,  label: "50/hr" },
  { value: 100, label: "100/hr" },
  { value: 200, label: "200/hr" },
  { value: 500, label: "500/hr" },
];

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Small shared UI primitives (all theme-token based) ──────────────────────

function SectionHeader({
  icon: Icon, title, description, badge,
}: { icon: React.ElementType; title: string; description?: string; badge?: React.ReactNode }) {
  return (
    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
          <Icon className="h-4 w-4 text-accent-foreground" />
        </div>
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
      </div>
      {badge}
    </CardHeader>
  );
}

function Field({
  label, icon: Icon, type = "text", value, onChange, placeholder, hint, revealable,
}: {
  label: string; icon: React.ElementType; type?: string;
  value: string; onChange: (v: string) => void; placeholder?: string; hint?: string;
  revealable?: boolean;
}) {
  const [show, setShow] = useState(false);
  const resolvedType = revealable ? (show ? "text" : "password") : type;
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium flex items-center gap-1.5 text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {label}
      </label>
      <div className="relative">
        <Input
          type={resolvedType} value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="rounded-xl font-mono text-sm pr-10"
          autoComplete="off"
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TestBadge({ state }: { state: "idle" | "testing" | "ok" | "fail" }) {
  if (state === "testing") return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…</span>;
  if (state === "ok")      return <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Connected</span>;
  if (state === "fail")    return <span className="flex items-center gap-1 text-xs text-destructive"><XCircle className="h-3.5 w-3.5" /> Failed</span>;
  return null;
}

function ChipRow<T extends number>({
  options, value, onChange,
}: {
  options: { value: T; label: string; desc?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex flex-col items-center px-4 py-2 rounded-xl border-2 text-xs font-semibold transition-colors min-w-[56px] ${
            value === opt.value
              ? "border-primary bg-accent text-accent-foreground"
              : "border-border text-muted-foreground hover:border-primary/40 bg-card"
          }`}
        >
          {opt.label}
          {opt.desc && <span className="text-xs font-normal opacity-60 mt-0.5">{opt.desc}</span>}
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; dot: string }> = {
    connected:    { label: "Connected",     className: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
    sending:      { label: "Sending",       className: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
    cooling_down: { label: "Cooling Down",  className: "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/50 text-orange-700 dark:text-orange-400", dot: "bg-orange-500" },
    quota_reached:{ label: "Quota Reached", className: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400", dot: "bg-red-500" },
    disabled:     { label: "Disabled",      className: "bg-muted border-border text-muted-foreground", dot: "bg-muted-foreground" },
    disconnected: { label: "Not Connected", className: "bg-muted border-border text-muted-foreground", dot: "bg-muted-foreground" },
  };
  const s = map[status] ?? map.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${s.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

function HealthCard({
  icon: Icon, label, value, level,
}: { icon: React.ElementType; label: string; value: string; level: "good" | "warn" | "bad" | "neutral" }) {
  const colors = {
    good:    "text-emerald-600 dark:text-emerald-400",
    warn:    "text-amber-600 dark:text-amber-400",
    bad:     "text-destructive",
    neutral: "text-foreground",
  } as const;
  const dot = {
    good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-destructive", neutral: "bg-muted-foreground",
  } as const;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3.5 space-y-1.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{label}</span>
        <span className={`ml-auto h-1.5 w-1.5 rounded-full ${dot[level]}`} />
      </div>
      <p className={`text-lg font-bold ${colors[level]}`}>{value}</p>
    </div>
  );
}

// ─── Live SMTP Status widget (single source of truth — no duplicates) ────────

function LiveStatusWidget({ visible, form }: { visible: boolean; form: MailboxForm }) {
  const [quota, setQuota]     = useState<QuotaStats | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchQuota = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const res = await fetch("/api/mailbox/quota", { headers: authHeaders() });
      if (res.ok) setQuota(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    fetchQuota();
    const id = setInterval(fetchQuota, 15_000);
    return () => clearInterval(id);
  }, [fetchQuota]);

  function QuotaCooldown({ until }: { until: string | null }) {
    const calc = (iso: string | null) =>
      Math.max(0, Math.ceil((new Date(iso ?? 0).getTime() - Date.now()) / 1000));
    const [secs, setSecs] = useState(() => calc(until));
    useEffect(() => {
      setSecs(calc(until));
      if (!until) return;
      const id = setInterval(() => setSecs(calc(until)), 1_000);
      return () => clearInterval(id);
    }, [until]);
    if (!until || secs <= 0) return <span className="font-semibold">Checking…</span>;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return <span className="font-mono font-semibold">{String(m).padStart(2, "0")}m {String(s).padStart(2, "0")}s</span>;
  }

  if (!visible) {
    return (
      <Card>
        <SectionHeader icon={Activity} title="Live SMTP Status" />
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground text-center py-4">Connect a mailbox to see live sending status.</p>
        </CardContent>
      </Card>
    );
  }

  const pct = quota ? Math.round((quota.usedThisHour / Math.max(quota.hourlyLimit, 1)) * 100) : 0;
  const barColor = pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  const isCooling = quota?.quotaStatus === "quota_reached";
  const currentStatus = isCooling ? "cooling_down" : quota ? "connected" : "disconnected";

  function Row({ label, value, valueClassName }: { label: string; value: React.ReactNode; valueClassName?: string }) {
    return (
      <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-xs font-semibold text-foreground ${valueClassName ?? ""}`}>{value}</span>
      </div>
    );
  }

  return (
    <Card>
      <SectionHeader
        icon={Activity}
        title="Live SMTP Status"
        badge={
          <button type="button" onClick={fetchQuota} className="text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        }
      />
      <CardContent className="pt-0 space-y-3">
        {!quota ? (
          <p className="text-xs text-muted-foreground text-center py-2">Loading…</p>
        ) : (
          <>
            <StatusBadge status={currentStatus} />

            {isCooling && quota.quotaSmtpResponse && (
              <div className="rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 p-2.5">
                <p className="text-xs text-red-600 dark:text-red-400 font-mono break-all line-clamp-2">
                  {quota.quotaSmtpResponse.slice(0, 140)}
                </p>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">Hourly Usage</span>
                <span className="font-mono font-semibold text-foreground">{quota.usedThisHour} / {quota.hourlyLimit}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>

            <div>
              <Row label="Cooldown" value={isCooling ? <QuotaCooldown until={quota.quotaCooldownUntil} /> : "None"} valueClassName={isCooling ? "text-amber-600 dark:text-amber-400" : ""} />
              <Row label="Retry Queue" value={`${quota.retryQueueCount} email${quota.retryQueueCount === 1 ? "" : "s"}`} valueClassName={quota.retryQueueCount > 0 ? "text-amber-600 dark:text-amber-400" : ""} />
              <Row label="Deferred" value={String(quota.deferredCount)} valueClassName={quota.deferredCount > 0 ? "text-amber-600 dark:text-amber-400" : ""} />
              <Row
                label="Next Probe"
                value={quota.quotaCooldownUntil && isCooling ? new Date(quota.quotaCooldownUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
              />
              <Row label="Sending Pace" value={`${form.delaySeconds}s · ${form.batchSize}/batch`} />
              <Row
                label="Last Error"
                value={<span className="truncate max-w-[140px] inline-block align-bottom">{quota.quotaSmtpResponse ? quota.quotaSmtpResponse.slice(0, 24) + "…" : "None"}</span>}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Recent SMTP Events (derived honestly from real quota/mailbox state) ─────

function RecentEvents({ visible, isConnected, quotaReachedAt, quotaCooldownUntil, quotaSmtpResponse }: {
  visible: boolean; isConnected: boolean;
  quotaReachedAt: string | null; quotaCooldownUntil: string | null; quotaSmtpResponse: string | null;
}) {
  type Ev = { icon: React.ElementType; text: string; time: string | null; tone: "ok" | "warn" | "info" };
  const events: Ev[] = [];

  if (isConnected) events.push({ icon: CheckCircle2, text: "Mailbox connected", time: null, tone: "ok" });
  if (quotaReachedAt) {
    events.push({ icon: AlertTriangle, text: "SMTP quota reached — campaigns paused", time: quotaReachedAt, tone: "warn" });
    if (quotaSmtpResponse) {
      events.push({ icon: Server, text: `Provider response: ${quotaSmtpResponse.slice(0, 60)}`, time: quotaReachedAt, tone: "warn" });
    }
  }
  if (quotaCooldownUntil && new Date(quotaCooldownUntil) > new Date()) {
    events.push({ icon: Clock, text: "Cooling down — next probe scheduled", time: quotaCooldownUntil, tone: "info" });
  } else if (quotaReachedAt) {
    events.push({ icon: PlayCircle, text: "Cooldown complete — probing to resume", time: null, tone: "ok" });
  }

  const sorted = events.sort((a, b) => (b.time ? new Date(b.time).getTime() : 0) - (a.time ? new Date(a.time).getTime() : 0));
  const shown = sorted.slice(0, 5);

  return (
    <Card>
      <SectionHeader icon={BarChart3} title="Recent SMTP Events" description="Newest first" />
      <CardContent className="pt-0">
        {!visible || shown.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No recent events.</p>
        ) : (
          <ul className="space-y-2.5">
            {shown.map((e, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <div className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  e.tone === "ok" ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                  : e.tone === "warn" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                  : "bg-accent text-accent-foreground"
                }`}>
                  <e.icon className="h-3 w-3" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-foreground leading-snug">{e.text}</p>
                  {e.time && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(e.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {visible && sorted.length > 0 && (
        <CardFooter className="pt-0">
          <Button variant="ghost" size="sm" className="rounded-xl text-xs w-full text-muted-foreground hover:text-foreground" disabled>
            View History
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

// ─── Mailbox Health (real data from sent-emails/stats + suppressions/stats) ──

function MailboxHealth({ visible, quotaPct, deferredCount }: { visible: boolean; quotaPct: number; deferredCount: number }) {
  const [health, setHealth] = useState<HealthStats | null>(null);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const [statsRes, suppRes] = await Promise.all([
          fetch("/api/sent-emails/stats", { headers: authHeaders() }),
          fetch("/api/suppressions/stats", { headers: authHeaders() }),
        ]);
        const stats = statsRes.ok ? await statsRes.json() : null;
        const supp  = suppRes.ok  ? await suppRes.json()  : null;
        setHealth({
          openRate: stats?.openRate ?? 0,
          bounceRate: stats?.bounceRate ?? 0,
          suppressionCount: supp?.total ?? 0,
        });
      } catch { /* ignore */ }
    })();
  }, [visible]);

  if (!visible) return null;

  const bounceLevel = (health?.bounceRate ?? 0) >= 5 ? "bad" : (health?.bounceRate ?? 0) >= 2 ? "warn" : "good";
  const quotaLevel  = quotaPct >= 90 ? "bad" : quotaPct >= 70 ? "warn" : "good";
  const connLevel   = deferredCount > 0 ? "warn" : "good";

  return (
    <Card>
      <SectionHeader icon={HeartPulse} title="Mailbox Health" />
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <HealthCard icon={Wifi}       label="Connection"     value={deferredCount > 0 ? "Retrying" : "Stable"} level={connLevel} />
          <HealthCard icon={XCircle}    label="Bounce Rate"    value={`${health?.bounceRate ?? 0}%`} level={bounceLevel} />
          <HealthCard icon={Mail}       label="Open Rate"      value={`${health?.openRate ?? 0}%`} level="neutral" />
          <HealthCard icon={Gauge}      label="Quota Usage"    value={`${quotaPct}%`} level={quotaLevel} />
          <HealthCard icon={Ban}        label="Suppressed"     value={String(health?.suppressionCount ?? 0)} level="neutral" />
          <HealthCard icon={TimerReset} label="Deferred Items" value={String(deferredCount)} level={deferredCount > 0 ? "warn" : "good"} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MailboxSettings() {
  const { toast } = useToast();
  const [form, setForm]               = useState<MailboxForm>(EMPTY_FORM);
  const [isLoading, setIsLoading]     = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [lastVerified, setLastVerified] = useState<string | null>(null);

  const [savingSection, setSavingSection] = useState<null | "info" | "smtp" | "imap" | "sending" | "recovery">(null);

  const [smtpTest, setSmtpTest] = useState<"idle"|"testing"|"ok"|"fail">("idle");
  const [imapTest, setImapTest] = useState<"idle"|"testing"|"ok"|"fail">("idle");
  const [smtpErr, setSmtpErr]   = useState("");
  const [imapErr, setImapErr]   = useState("");
  const [showImap, setShowImap] = useState(false);
  const [customDelay, setCustomDelay]   = useState("");
  const [customHourly, setCustomHourly] = useState("");

  const [quotaSnapshot, setQuotaSnapshot] = useState<QuotaStats | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof MailboxForm>(key: K, val: MailboxForm[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  useEffect(() => { loadMailbox(); }, []);

  useEffect(() => {
    if (!isConnected) return;
    const load = async () => {
      try {
        const res = await fetch("/api/mailbox/quota", { headers: authHeaders() });
        if (res.ok) setQuotaSnapshot(await res.json());
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [isConnected]);

  async function loadMailbox() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/mailbox", { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setIsConnected(true);
          setShowImap(!!data.imapHost);
          setLastVerified(data.updatedAt ?? null);
          setForm({
            smtpHost: data.smtpHost ?? "",
            smtpPort: String(data.smtpPort ?? "587"),
            smtpUser: data.smtpUser ?? "",
            smtpPass: "",
            smtpSecure: (data.smtpSecure ?? "tls") as Secure,
            imapHost: data.imapHost ?? "",
            imapPort: String(data.imapPort ?? "993"),
            imapUser: data.imapUser ?? "",
            imapPass: "",
            fromName: data.fromName ?? "",
            replyTo:  data.replyTo  ?? "",
            batchSize:         data.batchSize         ?? 10,
            delaySeconds:      data.delaySeconds      ?? 15,
            maxPerHour:        data.maxPerHour        ?? 50,
            cooldownMinutes:   data.cooldownMinutes   ?? 60,
            probeRetryMinutes: data.probeRetryMinutes ?? 5,
          });
        }
      }
    } finally {
      setIsLoading(false);
    }
  }

  function applyPreset(p: typeof PRESETS[0]) {
    setForm(f => ({
      ...f,
      smtpHost: p.smtp, smtpPort: p.smtpPort, smtpSecure: p.secure,
      imapHost: p.imap, imapPort: p.imapPort,
    }));
    setShowImap(true);
  }

  async function handleTestSmtp() {
    setSmtpTest("testing"); setSmtpErr("");
    try {
      const res = await fetch("/api/mailbox/test-smtp", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ smtpHost: form.smtpHost, smtpPort: Number(form.smtpPort), smtpUser: form.smtpUser, smtpPass: form.smtpPass, smtpSecure: form.smtpSecure }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setSmtpTest("ok");
    } catch (err: any) {
      setSmtpTest("fail"); setSmtpErr(err.message);
    }
  }

  async function handleTestImap() {
    setImapTest("testing"); setImapErr("");
    try {
      const res = await fetch("/api/mailbox/test-imap", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ imapHost: form.imapHost, imapPort: Number(form.imapPort), imapUser: form.imapUser, imapPass: form.imapPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setImapTest("ok");
    } catch (err: any) {
      setImapTest("fail"); setImapErr(err.message);
    }
  }

  // Every section save sends the full current form (required by the single
  // /api/mailbox/save endpoint) but only the fields belonging to THAT section
  // are ever edited by the user before clicking its button — smtpPass/imapPass
  // stay blank unless explicitly changed, so saving Sending/Recovery settings
  // never requires re-entering SMTP/IMAP credentials.
  async function saveSection(section: "info" | "smtp" | "imap" | "sending" | "recovery", successMsg: string) {
    setSavingSection(section);
    try {
      const res = await fetch("/api/mailbox/save", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpHost: form.smtpHost, smtpPort: Number(form.smtpPort),
          smtpUser: form.smtpUser, smtpPass: form.smtpPass || undefined,
          smtpSecure: form.smtpSecure,
          imapHost: form.imapHost || undefined, imapPort: Number(form.imapPort) || 993,
          imapUser: form.imapUser || undefined, imapPass: form.imapPass || undefined,
          fromName: form.fromName || undefined,
          replyTo:  form.replyTo  || undefined,
          batchSize:         form.batchSize,
          delaySeconds:      form.delaySeconds,
          maxPerHour:        form.maxPerHour,
          cooldownMinutes:   form.cooldownMinutes,
          probeRetryMinutes: form.probeRetryMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setIsConnected(true);
      setForm(f => ({ ...f, smtpPass: "", imapPass: "" }));
      setLastVerified(new Date().toISOString());
      toast({ title: successMsg });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    } finally {
      setSavingSection(null);
    }
  }

  async function handleDelete() {
    try {
      await fetch("/api/mailbox/remove", { method: "POST", headers: authHeaders() });
      setIsConnected(false);
      setForm(EMPTY_FORM);
      setSmtpTest("idle"); setImapTest("idle");
      setConfirmDelete(false);
      toast({ title: "Mailbox deleted" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not delete mailbox." });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isCustomDelay  = !DELAY_OPTIONS.some(o => o.value === form.delaySeconds);
  const isCustomHourly = !HOURLY_OPTIONS.some(o => o.value === form.maxPerHour);
  const mailboxStatus = !isConnected ? "disconnected" : quotaSnapshot?.quotaStatus === "quota_reached" ? "cooling_down" : "connected";
  const quotaPct = quotaSnapshot ? Math.round((quotaSnapshot.usedThisHour / Math.max(quotaSnapshot.hourlyLimit, 1)) * 100) : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Mailbox Settings</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect your business email and configure sending protection to maximize deliverability.
        </p>
      </div>

      <div className="grid lg:grid-cols-[73%_25%] lg:justify-between gap-x-6 gap-y-6 items-start">
        {/* ─── LEFT COLUMN — Configuration ─────────────────────────────────── */}
        <div className="space-y-5 min-w-0">

          {/* Section 1 — Mailbox Configuration */}
          <Card>
            <SectionHeader
              icon={Mail}
              title="Mailbox Configuration"
              badge={<StatusBadge status={mailboxStatus} />}
            />
            <CardContent className="pt-0 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Mailbox Name" icon={User} value={form.fromName}
                  onChange={v => set("fromName", v)} placeholder="e.g. Your Company Name" />
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5 text-foreground">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email Address
                  </label>
                  <Input value={form.smtpUser} disabled className="rounded-xl font-mono text-sm bg-muted/40" />
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1">
                <span>Last verified: {lastVerified ? new Date(lastVerified).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                {form.smtpHost && <span>Provider host: {form.smtpHost}</span>}
              </div>

              {!isConnected && (
                <div className="space-y-2 pt-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick setup — select your provider</p>
                  <div className="flex flex-wrap gap-2">
                    {PRESETS.map(p => (
                      <button
                        key={p.name} type="button" onClick={() => applyPreset(p)}
                        className="px-3 py-1.5 text-xs font-medium bg-card border border-border rounded-lg hover:border-primary/40 hover:bg-accent hover:text-accent-foreground transition-colors text-muted-foreground"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => saveSection("info", "Mailbox name saved.")} disabled={savingSection === "info"} size="sm" className="rounded-xl gap-2">
                {savingSection === "info" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Mailbox Name
              </Button>
            </CardFooter>
          </Card>

          {/* Section 2 — SMTP Settings */}
          <Card>
            <SectionHeader icon={Server} title="SMTP Settings" description="Used for sending outbound email" />
            <CardContent className="pt-0 grid sm:grid-cols-2 gap-x-5 gap-y-4">
              <Field label="SMTP Host" icon={Server} value={form.smtpHost}
                onChange={v => set("smtpHost", v)} placeholder="smtp.hostinger.com"
                hint={
                  form.smtpHost && !form.smtpHost.startsWith("mail.") && !form.smtpHost.includes("smtp.") && !form.smtpHost.includes("office365") && !form.smtpHost.includes("gmail")
                    ? "⚠ cPanel/Hostinger tip: use mail.yourdomain.com, not yourdomain.com"
                    : undefined
                }
              />
              <Field label="SMTP Port" icon={Wifi} value={form.smtpPort}
                onChange={v => set("smtpPort", v)} placeholder="587" />
              <Field label="Username / Email" icon={User} value={form.smtpUser}
                onChange={v => set("smtpUser", v)} placeholder="sales@yourcompany.com" />
              <Field label="Password" icon={Lock} value={form.smtpPass} revealable
                onChange={v => set("smtpPass", v)}
                placeholder={isConnected ? "Leave blank to keep current" : "SMTP password"}
                hint={isConnected ? "Only fill to change the saved password" : undefined} />
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5 text-foreground">
                  <Wifi className="h-3.5 w-3.5 text-muted-foreground" /> Encryption
                </label>
                <div className="flex gap-2">
                  {(["ssl","tls","none"] as Secure[]).map(s => (
                    <button
                      key={s} type="button" onClick={() => set("smtpSecure", s)}
                      className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                        form.smtpSecure === s ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-primary/40 bg-card"
                      }`}
                    >
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">SSL=465, TLS=587, None=25</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5 text-foreground opacity-0 select-none">Test</label>
                <Button type="button" variant="outline" size="sm"
                  onClick={handleTestSmtp}
                  disabled={smtpTest === "testing" || !form.smtpHost || !form.smtpUser || !form.smtpPass}
                  className="rounded-xl gap-1.5 w-full"
                >
                  {smtpTest === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                  Test Connection
                </Button>
                <div className="flex items-center gap-2">
                  <TestBadge state={smtpTest} />
                  {smtpErr && <span className="text-xs text-destructive truncate">{smtpErr}</span>}
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => saveSection("smtp", "SMTP settings saved.")} disabled={savingSection === "smtp" || !form.smtpHost || !form.smtpUser} size="sm" className="rounded-xl gap-2">
                {savingSection === "smtp" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save SMTP
              </Button>
            </CardFooter>
          </Card>

          {/* Section 3 — IMAP Settings */}
          <Card>
            <button type="button" onClick={() => setShowImap(s => !s)} className="w-full text-left">
              <SectionHeader
                icon={Mail}
                title="IMAP Settings"
                description="Optional — copies sent emails to your Sent folder"
                badge={showImap ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              />
            </button>
            {showImap && (
              <>
                <CardContent className="pt-0 grid sm:grid-cols-2 gap-x-5 gap-y-4">
                  <Field label="IMAP Host" icon={Server} value={form.imapHost}
                    onChange={v => set("imapHost", v)} placeholder="imap.hostinger.com" />
                  <Field label="IMAP Port" icon={Wifi} value={form.imapPort}
                    onChange={v => set("imapPort", v)} placeholder="993" />
                  <Field label="Username" icon={User} value={form.imapUser}
                    onChange={v => set("imapUser", v)} placeholder="sales@yourcompany.com" />
                  <Field label="Password" icon={Lock} value={form.imapPass} revealable
                    onChange={v => set("imapPass", v)}
                    placeholder={isConnected && form.imapHost ? "Leave blank to keep current" : "IMAP password"} />
                </CardContent>
                <CardFooter className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="outline" size="sm"
                    onClick={handleTestImap}
                    disabled={imapTest === "testing" || !form.imapHost || !form.imapUser || !form.imapPass}
                    className="rounded-xl gap-1.5"
                  >
                    {imapTest === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                    Test IMAP
                  </Button>
                  <TestBadge state={imapTest} />
                  {imapErr && <span className="text-xs text-destructive truncate">{imapErr}</span>}
                  <Button onClick={() => saveSection("imap", "IMAP settings saved.")} disabled={savingSection === "imap"} size="sm" className="rounded-xl gap-2 ml-auto">
                    {savingSection === "imap" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save IMAP
                  </Button>
                </CardFooter>
              </>
            )}
          </Card>

          {/* Section 4 — Sending Settings */}
          <Card>
            <SectionHeader icon={Zap} title="Sending Settings" description="Batch size, delay, and hourly rate limits" />
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  <span className="font-semibold">Lower send speeds improve deliverability.</span> 15s delay with batches of 10 is the recommended default.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-x-5 gap-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-xs font-semibold text-foreground">Delay Between Emails</label>
                    <span className="ml-auto text-xs text-accent-foreground font-semibold bg-accent px-2 py-0.5 rounded-full">{form.delaySeconds}s</span>
                  </div>
                  <ChipRow
                    options={DELAY_OPTIONS}
                    value={DELAY_OPTIONS.find(o => o.value === form.delaySeconds)?.value ?? (isCustomDelay ? -1 as any : 15)}
                    onChange={v => { set("delaySeconds", v); setCustomDelay(""); }}
                  />
                  <Input type="number" min={1} max={3600} value={customDelay}
                    onChange={e => { setCustomDelay(e.target.value); const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) set("delaySeconds", v); }}
                    placeholder={`Custom seconds (currently ${form.delaySeconds})`} className="h-8 rounded-lg text-xs font-mono" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-xs font-semibold text-foreground">Batch Size</label>
                    <span className="ml-auto text-xs text-accent-foreground font-semibold bg-accent px-2 py-0.5 rounded-full">{form.batchSize}</span>
                  </div>
                  <ChipRow options={BATCH_OPTIONS} value={form.batchSize} onChange={v => set("batchSize", v)} />
                  <p className="text-xs text-muted-foreground">Emails queued per campaign batch.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-xs font-semibold text-foreground">Emails / Hour</label>
                    <span className="ml-auto text-xs text-accent-foreground font-semibold bg-accent px-2 py-0.5 rounded-full">{form.maxPerHour}/hr</span>
                  </div>
                  <ChipRow
                    options={HOURLY_OPTIONS}
                    value={HOURLY_OPTIONS.find(o => o.value === form.maxPerHour)?.value ?? (isCustomHourly ? -1 as any : 100)}
                    onChange={v => { set("maxPerHour", v); setCustomHourly(""); }}
                  />
                  <p className="text-xs text-muted-foreground">Sending pauses automatically once reached.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-xs font-semibold text-foreground">Custom Limit</label>
                  </div>
                  <Input type="number" min={1} max={10000} value={customHourly}
                    onChange={e => { setCustomHourly(e.target.value); const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) set("maxPerHour", v); }}
                    placeholder={`Custom per hour (currently ${form.maxPerHour})`} className="h-8 rounded-lg text-xs font-mono" />
                  <p className="text-xs text-muted-foreground">Overrides the preset above.</p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => saveSection("sending", "Sending settings saved.")} disabled={savingSection === "sending"} size="sm" className="rounded-xl gap-2">
                {savingSection === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Sending Settings
              </Button>
            </CardFooter>
          </Card>

          {/* Section 5 — Quota Recovery Settings */}
          <Card>
            <SectionHeader icon={TimerReset} title="Quota Recovery Settings" description="How BrokerMAIL AI reacts to provider rate limits" />
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                When a quota error is detected, sending pauses, waits, probes, and resumes automatically — no manual action required.
              </p>
              <div className="grid sm:grid-cols-2 gap-x-5 gap-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Initial Cooldown (min)
                  </label>
                  <Input type="number" min={1} max={1440} value={form.cooldownMinutes}
                    onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) set("cooldownMinutes", v); }}
                    className="h-9 rounded-xl font-mono text-sm" />
                  <p className="text-xs text-muted-foreground">Wait time before the first probe. Default: 60.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" /> Probe Interval (min)
                  </label>
                  <Input type="number" min={1} max={120} value={form.probeRetryMinutes}
                    onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) set("probeRetryMinutes", v); }}
                    className="h-9 rounded-xl font-mono text-sm" />
                  <p className="text-xs text-muted-foreground">Extra wait after each failed probe. Default: 5.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" /> Auto Resume
                  </label>
                  <div className="h-9 flex items-center px-3 rounded-xl border border-border bg-muted/40 text-xs font-medium text-foreground">
                    Always on
                  </div>
                  <p className="text-xs text-muted-foreground">Resumes automatically after a successful probe.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" /> Notifications
                  </label>
                  <div className="h-9 flex items-center px-3 rounded-xl border border-border bg-muted/40 text-xs font-medium text-foreground">
                    Shown in Live SMTP Status
                  </div>
                  <p className="text-xs text-muted-foreground">Cooldowns and probes appear in the sidebar.</p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => saveSection("recovery", "Recovery settings saved.")} disabled={savingSection === "recovery"} size="sm" className="rounded-xl gap-2">
                {savingSection === "recovery" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Recovery Settings
              </Button>
            </CardFooter>
          </Card>

          {/* Section 9 — Danger Zone */}
          {isConnected && (
            <Card className="border-destructive/40">
              <SectionHeader icon={AlertTriangle} title="Danger Zone" description="Irreversible actions" />
              <CardContent className="pt-0">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Delete Mailbox</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Removes all SMTP/IMAP credentials and sending settings permanently.</p>
                  </div>
                  {!confirmDelete ? (
                    <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}
                      className="rounded-xl gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 flex-shrink-0">
                      <Trash2 className="h-3.5 w-3.5" /> Delete Mailbox
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">Are you sure?</span>
                      <Button variant="destructive" size="sm" onClick={handleDelete} className="rounded-xl">Confirm Delete</Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="rounded-xl">Cancel</Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ─── RIGHT COLUMN — Live Status ───────────────────────────────────── */}
        <div className="space-y-5 min-w-0 lg:sticky lg:top-6 lg:self-start">
          <LiveStatusWidget visible={isConnected} form={form} />
          <RecentEvents
            visible={isConnected}
            isConnected={isConnected}
            quotaReachedAt={quotaSnapshot?.quotaReachedAt ?? null}
            quotaCooldownUntil={quotaSnapshot?.quotaCooldownUntil ?? null}
            quotaSmtpResponse={quotaSnapshot?.quotaSmtpResponse ?? null}
          />
          <MailboxHealth visible={isConnected} quotaPct={quotaPct} deferredCount={quotaSnapshot?.deferredCount ?? 0} />
        </div>
      </div>
    </div>
  );
}
