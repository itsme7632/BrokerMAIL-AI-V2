import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, XCircle, Server, Mail, User, Lock,
  Wifi, Trash2, Save, FlaskConical, ChevronDown, ChevronUp, FolderSync,
  Shield, Clock, Gauge, AlertTriangle, Zap, BarChart2, RefreshCw, TimerReset,
} from "lucide-react";

interface QuotaStats {
  hourlyLimit: number;
  usedThisHour: number;
  remainingQuota: number;
  deferredCount: number;
  retryQueueCount: number;
  nextReleaseAt: string | null;
}

function QuotaWidget({ visible }: { visible: boolean }) {
  const [quota, setQuota]       = useState<QuotaStats | null>(null);
  const [loading, setLoading]   = useState(false);

  const fetch_ = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/mailbox/quota", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setQuota(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => clearInterval(id);
  }, [fetch_]);

  if (!visible) return null;

  const pct = quota ? Math.round((quota.usedThisHour / Math.max(quota.hourlyLimit, 1)) * 100) : 0;
  const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500";

  function formatRelease(iso: string | null): string {
    if (!iso) return "—";
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return "now";
    const mins = Math.ceil(diff / 60_000);
    return mins >= 60 ? `${Math.ceil(mins / 60)}h` : `${mins}m`;
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
        <BarChart2 className="h-4 w-4 text-blue-500" />
        <h3 className="font-semibold text-slate-800 text-sm">SMTP Usage — Rolling Hour</h3>
        <button type="button" onClick={fetch_} className="ml-auto text-slate-400 hover:text-slate-600 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="p-6 space-y-4">
        {!quota ? (
          <p className="text-xs text-slate-400 text-center py-2">Loading…</p>
        ) : (
          <>
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">
                  {quota.usedThisHour} / {quota.hourlyLimit} sent this hour
                </span>
                <span className={`font-semibold ${pct >= 90 ? "text-red-600" : pct >= 70 ? "text-amber-600" : "text-emerald-600"}`}>
                  {pct}%
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <p className="text-xs text-slate-400">{quota.remainingQuota} slots remaining</p>
            </div>

            {/* Stat grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Gauge,      label: "Hourly limit",  value: String(quota.hourlyLimit) },
                { icon: Clock,      label: "Used this hour", value: String(quota.usedThisHour) },
                { icon: TimerReset, label: "Deferred",       value: String(quota.deferredCount),
                  highlight: quota.deferredCount > 0 },
                { icon: RefreshCw,  label: "Retry queue",    value: String(quota.retryQueueCount),
                  highlight: quota.retryQueueCount > 0 },
              ].map(({ icon: Icon, label, value, highlight }) => (
                <div key={label} className={`flex items-center gap-2 p-3 rounded-xl border ${
                  highlight ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-100"
                }`}>
                  <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${highlight ? "text-amber-500" : "text-slate-400"}`} />
                  <div>
                    <p className={`text-sm font-bold leading-none ${highlight ? "text-amber-800" : "text-slate-800"}`}>{value}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Next release */}
            {quota.nextReleaseAt && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-100">
                <Clock className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                <p className="text-xs text-blue-700">
                  Next quota slot opens in <span className="font-semibold">{formatRelease(quota.nextReleaseAt)}</span>
                  {" "}— {new Date(quota.nextReleaseAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type Secure = "ssl" | "tls" | "none";

interface MailboxForm {
  smtpHost: string; smtpPort: string; smtpUser: string; smtpPass: string; smtpSecure: Secure;
  imapHost: string; imapPort: string; imapUser: string; imapPass: string;
  fromName: string; replyTo: string;
  batchSize: number;
  delaySeconds: number;
  maxPerHour: number;
}

const EMPTY_FORM: MailboxForm = {
  smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", smtpSecure: "tls",
  imapHost: "", imapPort: "993", imapUser: "", imapPass: "",
  fromName: "", replyTo: "",
  batchSize: 10,
  delaySeconds: 15,
  maxPerHour: 100,
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

function StatusPill({
  icon: Icon, label, active, inactiveLabel,
}: {
  icon: React.ElementType; label: string; active: boolean; inactiveLabel?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
      active
        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
        : "bg-slate-50 border-slate-200 text-slate-500"
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${active ? "bg-emerald-500" : "bg-slate-300"}`} />
      <Icon className="h-3 w-3 flex-shrink-0" />
      {active ? label : (inactiveLabel ?? label)}
    </span>
  );
}

function Field({
  label, icon: Icon, type = "text", value, onChange, placeholder, hint,
}: {
  label: string; icon: React.ElementType; type?: string;
  value: string; onChange: (v: string) => void; placeholder?: string; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium flex items-center gap-1.5 text-slate-700">
        <Icon className="h-3.5 w-3.5 text-slate-400" /> {label}
      </label>
      <Input
        type={type} value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-xl font-mono text-sm"
        autoComplete="off"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function TestBadge({ state }: { state: "idle" | "testing" | "ok" | "fail" }) {
  if (state === "testing") return <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…</span>;
  if (state === "ok")      return <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Connected</span>;
  if (state === "fail")    return <span className="flex items-center gap-1 text-xs text-red-500"><XCircle className="h-3.5 w-3.5" /> Failed</span>;
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
              ? "border-blue-500 bg-blue-50 text-blue-800"
              : "border-slate-200 text-slate-600 hover:border-slate-300 bg-white"
          }`}
        >
          {opt.label}
          {opt.desc && <span className="text-xs font-normal opacity-60 mt-0.5">{opt.desc}</span>}
        </button>
      ))}
    </div>
  );
}

export default function MailboxSettings() {
  const { toast } = useToast();
  const [form, setForm]               = useState<MailboxForm>(EMPTY_FORM);
  const [isLoading, setIsLoading]     = useState(true);
  const [isSaving, setIsSaving]       = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [smtpTest, setSmtpTest]       = useState<"idle"|"testing"|"ok"|"fail">("idle");
  const [imapTest, setImapTest]       = useState<"idle"|"testing"|"ok"|"fail">("idle");
  const [smtpErr, setSmtpErr]         = useState("");
  const [imapErr, setImapErr]         = useState("");
  const [showImap, setShowImap]       = useState(false);
  const [customDelay, setCustomDelay] = useState("");
  const [customHourly, setCustomHourly] = useState("");

  const set = <K extends keyof MailboxForm>(key: K, val: MailboxForm[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  useEffect(() => { loadMailbox(); }, []);

  async function loadMailbox() {
    setIsLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/mailbox", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setIsConnected(true);
          setShowImap(!!data.imapHost);
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
            batchSize:    data.batchSize    ?? 10,
            delaySeconds: data.delaySeconds ?? 15,
            maxPerHour:   data.maxPerHour   ?? 100,
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
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/mailbox/test-smtp", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/mailbox/test-imap", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ imapHost: form.imapHost, imapPort: Number(form.imapPort), imapUser: form.imapUser, imapPass: form.imapPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setImapTest("ok");
    } catch (err: any) {
      setImapTest("fail"); setImapErr(err.message);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/mailbox", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpHost: form.smtpHost, smtpPort: Number(form.smtpPort),
          smtpUser: form.smtpUser, smtpPass: form.smtpPass || undefined,
          smtpSecure: form.smtpSecure,
          imapHost: form.imapHost || undefined, imapPort: Number(form.imapPort) || 993,
          imapUser: form.imapUser || undefined, imapPass: form.imapPass || undefined,
          fromName: form.fromName || undefined,
          replyTo:  form.replyTo  || undefined,
          batchSize:    form.batchSize,
          delaySeconds: form.delaySeconds,
          maxPerHour:   form.maxPerHour,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setIsConnected(true);
      toast({ title: "Mailbox saved", description: "Settings and sending protection are now active." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    } finally { setIsSaving(false); }
  }

  async function handleDisconnect() {
    try {
      const token = localStorage.getItem("auth_token");
      await fetch("/api/mailbox", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      setIsConnected(false);
      setForm(EMPTY_FORM);
      setSmtpTest("idle"); setImapTest("idle");
      toast({ title: "Mailbox disconnected" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not disconnect mailbox." });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const isCustomDelay  = !DELAY_OPTIONS.some(o => o.value === form.delaySeconds);
  const isCustomHourly = !HOURLY_OPTIONS.some(o => o.value === form.maxPerHour);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Mailbox Settings</h2>
        <p className="text-slate-500 mt-1 text-sm">
          Connect your business email and configure sending protection to maximize deliverability.
        </p>
      </div>

      {/* Status badge */}
      <div className={`flex items-center gap-3 p-4 rounded-2xl border ${
        isConnected ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"
      }`}>
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isConnected ? "bg-emerald-100" : "bg-slate-100"
        }`}>
          <Mail className={`h-5 w-5 ${isConnected ? "text-emerald-600" : "text-slate-400"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-sm ${isConnected ? "text-emerald-900" : "text-slate-700"}`}>
            {isConnected ? `Connected — ${form.smtpUser}` : "No mailbox connected"}
          </p>
          <p className={`text-xs mt-0.5 ${isConnected ? "text-emerald-700" : "text-slate-500"}`}>
            {isConnected
              ? `SMTP ${form.smtpHost}:${form.smtpPort} · ${form.smtpSecure.toUpperCase()}`
              : "Add your SMTP credentials below to enable direct sending."}
          </p>
        </div>
        {isConnected && (
          <Button
            variant="ghost" size="sm"
            onClick={handleDisconnect}
            className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-1.5 flex-shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" /> Disconnect
          </Button>
        )}
      </div>

      {/* Status pills */}
      {isConnected && (
        <div className="flex flex-wrap gap-2">
          <StatusPill icon={Server}     label="SMTP Connected"          active={true} />
          <StatusPill icon={Mail}       label="IMAP Connected"          active={!!form.imapHost} inactiveLabel="IMAP Not Configured" />
          <StatusPill icon={FolderSync} label="Sent Folder Sync Active" active={!!form.imapHost} inactiveLabel="Sent Folder Sync Inactive" />
          <StatusPill icon={Shield}     label={`${form.delaySeconds}s delay · ${form.batchSize} per batch`} active={true} />
        </div>
      )}

      {/* Provider presets */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quick setup — select your provider</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors text-slate-600"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* SMTP Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <Server className="h-4 w-4 text-blue-500" />
            <h3 className="font-semibold text-slate-800 text-sm">SMTP Settings</h3>
            <span className="ml-auto text-xs text-slate-400">For sending</span>
          </div>
          <div className="p-6 grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Field label="SMTP Host" icon={Server} value={form.smtpHost}
                onChange={v => set("smtpHost", v)} placeholder="smtp.hostinger.com"
                hint={
                  form.smtpHost && !form.smtpHost.startsWith("mail.") && !form.smtpHost.includes("smtp.") && !form.smtpHost.includes("office365") && !form.smtpHost.includes("gmail")
                    ? "⚠ cPanel/Hostinger tip: use mail.yourdomain.com, not yourdomain.com"
                    : undefined
                }
              />
            </div>
            <Field label="Port" icon={Wifi} value={form.smtpPort}
              onChange={v => set("smtpPort", v)} placeholder="587" />
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5 text-slate-700">
                <Wifi className="h-3.5 w-3.5 text-slate-400" /> Encryption
              </label>
              <div className="flex gap-2">
                {(["ssl","tls","none"] as Secure[]).map(s => (
                  <button
                    key={s} type="button"
                    onClick={() => set("smtpSecure", s)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                      form.smtpSecure === s
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">SSL=465, TLS=587, None=25</p>
            </div>
            <Field label="Username / Email" icon={User} value={form.smtpUser}
              onChange={v => set("smtpUser", v)} placeholder="sales@yourcompany.com" />
            <Field label="Password" icon={Lock} type="password" value={form.smtpPass}
              onChange={v => set("smtpPass", v)}
              placeholder={isConnected ? "Leave blank to keep current" : "SMTP password"}
              hint={isConnected ? "Only fill to change the saved password" : undefined} />
          </div>
          <div className="px-6 pb-5 flex items-center gap-3">
            <Button type="button" variant="outline" size="sm"
              onClick={handleTestSmtp}
              disabled={smtpTest === "testing" || !form.smtpHost || !form.smtpUser || !form.smtpPass}
              className="rounded-xl gap-1.5"
            >
              {smtpTest === "testing"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <FlaskConical className="h-3.5 w-3.5" />}
              Test SMTP
            </Button>
            <TestBadge state={smtpTest} />
            {smtpErr && <span className="text-xs text-red-500 truncate">{smtpErr}</span>}
          </div>
        </div>

        {/* IMAP Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowImap(s => !s)}
            className="w-full px-6 py-4 flex items-center gap-2 hover:bg-slate-50 transition-colors"
          >
            <Mail className="h-4 w-4 text-purple-500" />
            <h3 className="font-semibold text-slate-800 text-sm">IMAP Settings</h3>
            <span className="ml-1 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Optional</span>
            <span className="ml-auto text-xs text-slate-400">Save to Sent folder</span>
            {showImap
              ? <ChevronUp className="h-4 w-4 text-slate-400 ml-2" />
              : <ChevronDown className="h-4 w-4 text-slate-400 ml-2" />}
          </button>
          {showImap && (
            <>
              <div className="px-6 pb-2 bg-blue-50/50 border-y border-slate-100">
                <p className="text-xs text-slate-500 py-2">
                  When configured, sent emails are automatically copied to your Sent folder via IMAP.
                  Many hosting providers (Hostinger, cPanel) do this automatically without IMAP.
                </p>
              </div>
              <div className="p-6 grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="IMAP Host" icon={Server} value={form.imapHost}
                    onChange={v => set("imapHost", v)} placeholder="imap.hostinger.com" />
                </div>
                <Field label="Port" icon={Wifi} value={form.imapPort}
                  onChange={v => set("imapPort", v)} placeholder="993" />
                <Field label="Username" icon={User} value={form.imapUser}
                  onChange={v => set("imapUser", v)} placeholder="sales@yourcompany.com" />
                <Field label="Password" icon={Lock} type="password" value={form.imapPass}
                  onChange={v => set("imapPass", v)}
                  placeholder={isConnected && form.imapHost ? "Leave blank to keep current" : "IMAP password"} />
              </div>
              <div className="px-6 pb-5 flex items-center gap-3">
                <Button type="button" variant="outline" size="sm"
                  onClick={handleTestImap}
                  disabled={imapTest === "testing" || !form.imapHost || !form.imapUser || !form.imapPass}
                  className="rounded-xl gap-1.5"
                >
                  {imapTest === "testing"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <FlaskConical className="h-3.5 w-3.5" />}
                  Test IMAP
                </Button>
                <TestBadge state={imapTest} />
                {imapErr && <span className="text-xs text-red-500 truncate">{imapErr}</span>}
              </div>
            </>
          )}
        </div>

        {/* Sender Info */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <User className="h-4 w-4 text-emerald-500" />
            <h3 className="font-semibold text-slate-800 text-sm">Sender Info</h3>
          </div>
          <div className="p-6 grid sm:grid-cols-2 gap-4">
            <Field label="From Name" icon={User} value={form.fromName}
              onChange={v => set("fromName", v)} placeholder="e.g. Your Company Name" />
            <Field label="Reply-To Email" icon={Mail} value={form.replyTo}
              onChange={v => set("replyTo", v)} placeholder="sales@yourcompany.com" />
          </div>
        </div>

        {/* ── Sending Protection ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <Shield className="h-4 w-4 text-violet-500" />
            <h3 className="font-semibold text-slate-800 text-sm">Sending Protection</h3>
            <span className="ml-auto text-xs text-slate-400">Deliverability &amp; rate limiting</span>
          </div>

          {/* Safety warning */}
          <div className="px-6 pt-5 pb-3">
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-relaxed">
                <span className="font-semibold">Lower send speeds improve deliverability and reduce spam/rate-limit issues.</span>{" "}
                A 15-second delay with batches of 10 is the recommended default for most mailboxes.
              </p>
            </div>
          </div>

          <div className="px-6 pb-6 space-y-6">
            {/* Delay between emails */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-400" />
                <label className="text-sm font-semibold text-slate-700">Delay between emails</label>
                <span className="ml-auto text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
                  {form.delaySeconds}s
                </span>
              </div>
              <ChipRow
                options={DELAY_OPTIONS}
                value={DELAY_OPTIONS.find(o => o.value === form.delaySeconds)?.value ?? (isCustomDelay ? -1 as any : 15)}
                onChange={v => { set("delaySeconds", v); setCustomDelay(""); }}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 flex-shrink-0">Custom (seconds):</span>
                <Input
                  type="number"
                  min={1}
                  max={3600}
                  value={customDelay}
                  onChange={e => {
                    setCustomDelay(e.target.value);
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v > 0) set("delaySeconds", v);
                  }}
                  placeholder={String(form.delaySeconds)}
                  className="h-8 rounded-lg text-xs w-28 font-mono"
                />
              </div>
            </div>

            {/* Batch size */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-slate-400" />
                <label className="text-sm font-semibold text-slate-700">Emails per batch</label>
                <span className="ml-auto text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
                  {form.batchSize} emails
                </span>
              </div>
              <ChipRow
                options={BATCH_OPTIONS}
                value={form.batchSize}
                onChange={v => set("batchSize", v)}
              />
              <p className="text-xs text-slate-400">
                When you launch a campaign, only this many emails will be queued at once. You can send more batches after.
              </p>
            </div>

            {/* Max per hour */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-slate-400" />
                <label className="text-sm font-semibold text-slate-700">Max emails per hour</label>
                <span className="ml-auto text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
                  {form.maxPerHour}/hr
                </span>
              </div>
              <ChipRow
                options={HOURLY_OPTIONS}
                value={HOURLY_OPTIONS.find(o => o.value === form.maxPerHour)?.value ?? (isCustomHourly ? -1 as any : 100)}
                onChange={v => { set("maxPerHour", v); setCustomHourly(""); }}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 flex-shrink-0">Custom (per hour):</span>
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  value={customHourly}
                  onChange={e => {
                    setCustomHourly(e.target.value);
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v > 0) set("maxPerHour", v);
                  }}
                  placeholder={String(form.maxPerHour)}
                  className="h-8 rounded-lg text-xs w-28 font-mono"
                />
              </div>
              <p className="text-xs text-slate-400">
                If you hit this limit, sending pauses automatically and resumes when the hour window resets.
              </p>
            </div>

            {/* Summary */}
            <div className="flex flex-wrap gap-3 p-4 rounded-xl bg-slate-50 border border-slate-100">
              {[
                { icon: Clock, text: `${form.delaySeconds}s between emails` },
                { icon: Zap,   text: `${form.batchSize} per batch` },
                { icon: Gauge, text: `${form.maxPerHour}/hr max` },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 text-violet-500" />
                  <span className="text-xs font-medium text-slate-700">{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={isSaving} className="rounded-xl gap-2 px-6">
            {isSaving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              : <><Save className="h-4 w-4" /> Save Mailbox</>}
          </Button>
          {isConnected && (
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Passwords stored encrypted
            </p>
          )}
        </div>
      </form>

      {/* Quota dashboard — only shown when a mailbox is connected */}
      <QuotaWidget visible={isConnected} />
    </div>
  );
}
