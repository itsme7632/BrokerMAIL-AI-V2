import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Palette, Server, Bot, Users, CreditCard, Shield, FileText,
  BarChart3, Save, RefreshCw, CheckCircle2, AlertTriangle, Loader2,
  Globe, Mail, Activity, Database,
  AlertCircle, ChevronDown, ChevronUp,
  Eye, EyeOff,
  ToggleLeft, Sliders, Lock, HelpCircle, Download, Bell,
  Coins, MailCheck, Trash2, MessageSquare, Send, Reply,
  UserCheck, Zap, Scale, PlusCircle, MinusCircle, X,
  Upload, RotateCcw, Archive, HardDrive, ClipboardList, ShieldCheck,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SettingsMap = Record<string, string>;

interface QueueStatus {
  pending: number;
  sending: number;
  success: number;
  failed: number;
  totalJobs: number;
  last24h: number;
}

interface AnalyticsSummary {
  totalEmailsSent: number;
  totalFailed: number;
  successRate: string;
  activeUsers: number;
  totalUsers: number;
  smtpMailboxes: number;
  emailsToday: number;
  emailsThisMonth: number;
  aiUsageToday: number;
}

type SubTab =
  | "general" | "branding" | "smtp" | "ai"
  | "users" | "billing" | "security" | "cms" | "analytics"
  | "providers" | "emailControls" | "planPerms" | "credits"
  | "notifications" | "legal" | "support" | "features"
  | "backup" | "superadmin";

interface SupportTicket {
  id: number; userEmail: string; userName: string | null;
  subject: string; message: string; status: string; priority: string;
  adminNote: string | null; assignedTo: string | null;
  replies: { id: string; author: string; authorName: string; message: string; createdAt: string }[];
  createdAt: string; updatedAt: string; resolvedAt: string | null;
}

// ─── Default values ───────────────────────────────────────────────────────────

const DEFAULTS: SettingsMap = {
  // General
  platformName:    "BrokerMail AI",
  supportEmail:    "",
  contactPhone:    "",
  companyAddress:  "",
  footerText:      "Built for the auto transport industry.",
  maintenanceMode: "false",
  // Branding
  defaultAccentColor:  "#1d4ed8",
  defaultEmailSlogan:  "Your #1 Auto Transport Partner",
  defaultEmailStyle:   "clean",
  defaultButtonStyle:  "rounded",
  defaultFont:         "inter",
  // SMTP
  defaultBatchSize:    "10",
  defaultDelaySeconds: "15",
  defaultMaxPerHour:   "100",
  queueEnabled:        "true",
  autoRetryEnabled:    "true",
  maxRetryAttempts:    "3",
  // AI
  aiModel:        "gpt-4o-mini",
  aiEnabled:      "true",
  aiTemperature:  "0.7",
  dailyAiLimit:   "500",
  // Users
  allowRegistrations:      "true",
  requireEmailVerification: "false",
  freeMonthlyEmailLimit:   "100",
  freeBatchLimit:          "10",
  autoSuspendOnAbuse:      "false",
  // Billing
  stripePublishableKey:  "",
  stripeWebhookSecret:   "",
  creditsPerDollar:      "100",
  creditSystemEnabled:   "false",
  freeTrialDays:         "0",
  // Security
  sessionTimeoutHours:     "24",
  loginRateLimit:          "10",
  failedLoginThreshold:    "5",
  requireAdminMfa:         "false",
  maxEmailsPerDay:         "1000",
  maxLeadsPerUpload:       "10000",
  emailLimitPerUser:       "500",
  // CMS
  heroTitle:       "Close more transport deals with AI-powered outreach.",
  heroSubtitle:    "Upload lead sheets, personalize emails instantly, and send directly from your own business mailbox.",
  heroSlogan:      "Built specifically for auto transport brokers.",
  faqContent:      "",
  pricingContent:  "",
  contactContent:  "",
  // Email Provider Management
  gmailDraftsEnabled:  "true",
  smtpSendingEnabled:  "true",
  imapSyncEnabled:     "true",
  providerGmail:       "true",
  providerOutlook:     "true",
  providerHostinger:   "true",
  providerGoDaddy:     "true",
  providerZoho:        "true",
  providerNamecheap:   "true",
  providerPrivateMail: "true",
  // Global Email Controls
  platformMaxEmailsPerHour: "500",
  minDelaySecs:             "5",
  spamScoreThreshold:       "7",
  queueCooldownMins:        "5",
  bounceRateThreshold:      "5",
  // User Plan Permissions
  planFreeMaxUploadsDay:       "3",
  planProMaxUploadsDay:        "20",
  planEnterpriseMaxUploadsDay: "100",
  planFreeMaxContactsMonth:       "500",
  planProMaxContactsMonth:        "5000",
  planEnterpriseMaxContactsMonth: "50000",
  planFreeSmtp:          "false",
  planProSmtp:           "true",
  planEnterpriseSmtp:    "true",
  planFreeAi:            "false",
  planProAi:             "true",
  planEnterpriseAi:      "true",
  planFreeBranding:      "false",
  planProBranding:       "true",
  planEnterpriseBranding:"true",
  planFreePriority:      "false",
  planProPriority:       "false",
  planEnterprisePriority:"true",
  // Credits System
  freeTrialCredits: "50",
  aiCreditCost:     "5",
  emailCreditCost:  "1",
  // Admin Notifications
  adminNotificationEmail: "",
  notifySmtpFailures:     "true",
  notifyBouncedEmails:    "true",
  notifyFailedPayments:   "true",
  notifySpamComplaints:   "true",
  notifyServerIssues:     "true",
  // Legal CMS
  privacyPolicy:    "",
  termsOfService:   "",
  refundPolicy:     "",
  aboutPageContent: "",
  // Feature Toggles
  featureLandingPage:        "true",
  featurePublicRegistration: "true",
  featureAiWriter:           "true",
  featureSmtpSending:        "true",
  featureGmailDrafts:        "true",
  featureQueueSystem:        "true",
  featureAnalytics:          "true",
  // Super Admin
  superAdminEmail:         "",
  auditAllActions:         "true",
  preventAccidentalDelete: "true",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/admin/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `Error ${res.status}`); }
  return res.json();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, desc, color }: {
  icon: React.ElementType; title: string; desc: string; color: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-5 pb-4 border-b border-slate-100">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="font-bold text-slate-900 text-base">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function Field({
  label, settingsKey, settings, onChange, type = "text", placeholder, hint, mono,
}: {
  label: string; settingsKey: string; settings: SettingsMap;
  onChange: (key: string, val: string) => void;
  type?: string; placeholder?: string; hint?: string; mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <Input
        type={type}
        value={settings[settingsKey] ?? ""}
        onChange={e => onChange(settingsKey, e.target.value)}
        placeholder={placeholder}
        className={`rounded-xl ${mono ? "font-mono" : ""}`}
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function SecretField({
  label, settingsKey, settings, onChange, placeholder,
}: {
  label: string; settingsKey: string; settings: SettingsMap;
  onChange: (key: string, val: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={settings[settingsKey] ?? ""}
          onChange={e => onChange(settingsKey, e.target.value)}
          placeholder={placeholder}
          className="rounded-xl font-mono pr-10"
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label, desc, settingsKey, settings, onChange, danger,
}: {
  label: string; desc?: string; settingsKey: string;
  settings: SettingsMap; onChange: (key: string, val: string) => void;
  danger?: boolean;
}) {
  const on = settings[settingsKey] === "true";
  return (
    <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
      on && danger ? "bg-red-50 border-red-100" : "bg-slate-50 border-slate-100"
    }`}>
      <div className="flex-1 min-w-0 pr-4">
        <p className={`text-sm font-semibold ${on && danger ? "text-red-900" : "text-slate-800"}`}>{label}</p>
        {desc && <p className="text-xs text-slate-500 mt-0.5">{desc}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(settingsKey, on ? "false" : "true")}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
          on ? (danger ? "bg-red-500" : "bg-blue-600") : "bg-slate-200"
        }`}
        role="switch"
        aria-checked={on}
      >
        <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function NumberSlider({
  label, desc, settingsKey, settings, onChange, min, max, step = 1, unit,
}: {
  label: string; desc?: string; settingsKey: string; settings: SettingsMap;
  onChange: (key: string, val: string) => void;
  min: number; max: number; step?: number; unit?: string;
}) {
  const val = Number(settings[settingsKey] ?? min);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        <span className="text-sm font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">
          {val}{unit ? ` ${unit}` : ""}
        </span>
      </div>
      {desc && <p className="text-xs text-slate-400">{desc}</p>}
      <input
        type="range"
        min={min} max={max} step={step}
        value={val}
        onChange={e => onChange(settingsKey, e.target.value)}
        className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
      />
      <div className="flex justify-between text-xs text-slate-400">
        <span>{min}{unit ? unit : ""}</span>
        <span>{max}{unit ? unit : ""}</span>
      </div>
    </div>
  );
}

function TextareaField({
  label, settingsKey, settings, onChange, placeholder, rows = 4, hint,
}: {
  label: string; settingsKey: string; settings: SettingsMap;
  onChange: (key: string, val: string) => void;
  placeholder?: string; rows?: number; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <textarea
        value={settings[settingsKey] ?? ""}
        onChange={e => onChange(settingsKey, e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function SaveBar({ saving, onSave, label = "Save Settings" }: {
  saving: boolean; onSave: () => void; label?: string;
}) {
  return (
    <div className="flex items-center gap-3 pt-2 border-t border-slate-100 mt-4">
      <Button onClick={onSave} disabled={saving} className="rounded-xl gap-2 px-6">
        {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <><Save className="h-4 w-4" />{label}</>}
      </Button>
      <p className="text-xs text-slate-400">Changes apply immediately across the platform.</p>
    </div>
  );
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${color}`}>
      <p className="text-2xl font-bold leading-none">{value}</p>
      <p className="text-xs font-semibold opacity-70 mt-1">{label}</p>
      {sub && <p className="text-xs opacity-50 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── SUB-TABS DEFINITION ─────────────────────────────────────────────────────

const SUB_TABS: { id: SubTab; label: string; icon: React.ElementType; group?: string }[] = [
  { id: "general",      label: "General",       icon: Globe,         group: "Platform" },
  { id: "branding",     label: "Branding",      icon: Palette,       group: "Platform" },
  { id: "features",     label: "Features",      icon: ToggleLeft,    group: "Platform" },
  { id: "security",     label: "Security",      icon: Shield,        group: "Platform" },
  { id: "superadmin",   label: "Super Admin",   icon: Lock,          group: "Platform" },
  { id: "providers",    label: "Providers",     icon: MailCheck,     group: "Email" },
  { id: "smtp",         label: "SMTP",          icon: Server,        group: "Email" },
  { id: "emailControls",label: "Email Controls",icon: Sliders,       group: "Email" },
  { id: "ai",           label: "AI",            icon: Bot,           group: "Email" },
  { id: "users",        label: "Users",         icon: Users,         group: "Users & Plans" },
  { id: "planPerms",    label: "Plan Perms",    icon: UserCheck,     group: "Users & Plans" },
  { id: "billing",      label: "Billing",       icon: CreditCard,    group: "Users & Plans" },
  { id: "credits",      label: "Credits",       icon: Coins,         group: "Users & Plans" },
  { id: "notifications",label: "Notifications", icon: Bell,          group: "Admin" },
  { id: "support",      label: "Support",       icon: HelpCircle,    group: "Admin" },
  { id: "backup",       label: "Backup",        icon: Download,      group: "Admin" },
  { id: "migration",    label: "Migration",     icon: ClipboardList, group: "Admin" },
  { id: "analytics",    label: "Analytics",     icon: BarChart3,     group: "Admin" },
  { id: "cms",          label: "CMS",           icon: FileText,      group: "Content" },
  { id: "legal",        label: "Legal",         icon: Scale,         group: "Content" },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export function AdminSettings() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<SubTab>("general");
  const [settings, setSettings] = useState<SettingsMap>({ ...DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Support ticket state
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [ticketReply, setTicketReply] = useState("");
  const [ticketReplying, setTicketReplying] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketStatusFilter, setTicketStatusFilter] = useState("all");

  // Credits adjustment state
  const [creditUsers, setCreditUsers] = useState<{ id: number; name: string; email: string; credits: number; plan: string }[]>([]);
  const [creditUsersLoading, setCreditUsersLoading] = useState(false);
  const [creditSearch, setCreditSearch] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditTargetId, setCreditTargetId] = useState<number | null>(null);
  const [creditAdjusting, setCreditAdjusting] = useState(false);

  // Backup/export/import state
  const [exporting, setExporting]       = useState<string | null>(null);
  const [importing, setImporting]       = useState<string | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoring, setRestoring]       = useState(false);

  // Migration verification state
  type VerifyCheck = { label: string; count: number; ok: boolean; partial?: boolean; detail: string };
  type VerifyResult = { ok: boolean; checks: Record<string, VerifyCheck>; verifiedAt: string };
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying]       = useState(false);

  const set = (key: string, val: string) => setSettings(s => ({ ...s, [key]: val }));

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("settings");
      setSettings({ ...DEFAULTS, ...data });
    } catch {
      toast({ variant: "destructive", title: "Could not load settings" });
    } finally { setLoading(false); }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const [stats, queue] = await Promise.all([
        apiFetch("stats"),
        apiFetch("queue-status").catch(() => null),
      ]);
      setAnalytics({
        totalEmailsSent:   stats.totalDraftsCreated ?? 0,
        totalFailed:       stats.failedSends ?? 0,
        successRate:       (() => {
          const s = stats.totalDraftsCreated ?? 0;
          const f = stats.failedSends ?? 0;
          return s + f > 0 ? `${Math.round(s / (s + f) * 100)}%` : "—";
        })(),
        activeUsers:       stats.activeUsers ?? 0,
        totalUsers:        stats.totalUsers ?? 0,
        smtpMailboxes:     stats.smtpMailboxes ?? 0,
        emailsToday:       stats.emailsSentToday ?? 0,
        emailsThisMonth:   stats.emailsSentMonth ?? 0,
        aiUsageToday:      0,
      });
      if (queue) setQueueStatus(queue);
    } catch { /* silent */ }
    finally { setAnalyticsLoading(false); }
  }, []);

  const loadTickets = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const params = new URLSearchParams();
      if (ticketStatusFilter !== "all") params.set("status", ticketStatusFilter);
      if (ticketSearch) params.set("search", ticketSearch);
      const data = await apiFetch(`support?${params}`);
      setTickets(data);
    } catch { /* silent */ }
    finally { setTicketsLoading(false); }
  }, [ticketStatusFilter, ticketSearch]);

  const loadCreditUsers = useCallback(async () => {
    setCreditUsersLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (creditSearch) params.set("search", creditSearch);
      const data = await apiFetch(`users?${params}`);
      setCreditUsers(data.data ?? []);
    } catch { /* silent */ }
    finally { setCreditUsersLoading(false); }
  }, [creditSearch]);

  async function adjustCredits(userId: number, amount: number) {
    if (!amount) { toast({ variant: "destructive", title: "Enter an amount" }); return; }
    setCreditAdjusting(true);
    try {
      await apiFetch(`users/${userId}/credits`, {
        method: "POST",
        body: JSON.stringify({ amount, reason: creditReason }),
      });
      toast({ title: `Credits ${amount >= 0 ? "added" : "removed"}`, description: `${Math.abs(amount)} credits adjusted.` });
      setCreditAmount(""); setCreditReason(""); setCreditTargetId(null);
      loadCreditUsers();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    } finally { setCreditAdjusting(false); }
  }

  async function replyToTicket() {
    if (!selectedTicket || !ticketReply.trim()) return;
    setTicketReplying(true);
    try {
      const data = await apiFetch(`support/${selectedTicket.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ message: ticketReply }),
      });
      setSelectedTicket(t => t ? { ...t, replies: [...t.replies, data.reply], status: t.status === "open" ? "in_progress" : t.status } : t);
      setTicketReply("");
      toast({ title: "Reply sent" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    } finally { setTicketReplying(false); }
  }

  async function updateTicketStatus(id: number, status: string) {
    try {
      await apiFetch(`support/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setTickets(ts => ts.map(t => t.id === id ? { ...t, status } : t));
      if (selectedTicket?.id === id) setSelectedTicket(t => t ? { ...t, status } : t);
      toast({ title: "Ticket updated" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    }
  }

  async function deleteTicket(id: number) {
    try {
      await apiFetch(`support/${id}`, { method: "DELETE" });
      setTickets(ts => ts.filter(t => t.id !== id));
      if (selectedTicket?.id === id) setSelectedTicket(null);
      toast({ title: "Ticket deleted" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    }
  }

  async function doExport(type: string) {
    setExporting(type);
    try {
      const res = await fetch(`/api/admin/export/${type}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${type}_export.${type === "settings" ? "json" : "csv"}`;
      a.click(); URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: `${type} exported successfully.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Export failed", description: err.message });
    } finally { setExporting(null); }
  }

  function pickFile(accept: string): Promise<File | null> {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file"; input.accept = accept;
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async function readFileAsJson(file: File): Promise<any> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try { resolve(JSON.parse(e.target?.result as string)); }
        catch { reject(new Error("Invalid JSON file — could not parse.")); }
      };
      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.readAsText(file);
    });
  }

  async function doImport(type: string) {
    const file = await pickFile(".json");
    if (!file) return;
    setImporting(type);
    try {
      const data = await readFileAsJson(file);
      const body = type === "campaigns"
        ? JSON.stringify({ campaigns: Array.isArray(data) ? data : data.campaigns ?? [] })
        : JSON.stringify(Array.isArray(data) ? data : (type === "users" ? data.users ?? data : data));
      const res = await fetch(`/api/admin/import/${type}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Import failed");
      toast({ title: "Import complete", description: result.message });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Import failed", description: err.message });
    } finally { setImporting(null); }
  }

  async function doFullBackup() {
    setCreatingBackup(true);
    try {
      const res = await fetch("/api/admin/backup/full", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error("Backup failed");
      const blob = await res.blob();
      const date = new Date().toISOString().split("T")[0];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `brokermail_backup_${date}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast({ title: "Full backup ready", description: "All data exported to JSON." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Backup failed", description: err.message });
    } finally { setCreatingBackup(false); }
  }

  async function doFullRestore() {
    const file = await pickFile(".zip");
    if (!file) return;
    setRestoring(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/restore/full", {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` },
        body: form,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Restore failed");
      const r = result.results ?? {};
      toast({
        title: "Restore complete — users can log in immediately",
        description: [
          `Settings: ${r.settings ?? 0}`,
          `Users: ${r.users ?? 0}`,
          `Campaigns: ${r.campaigns ?? 0}`,
          `Templates: ${r.templates ?? 0}`,
          `Mailboxes: ${r.mailboxes ?? 0}`,
          `Plans: ${r.plans ?? 0}`,
        ].join(" · "),
      });
      if (result.warnings?.length) {
        result.warnings.slice(0, 3).forEach((w: string) =>
          toast({ variant: "destructive", title: "Restore warning", description: w })
        );
      }
      loadSettings();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Restore failed", description: err.message });
    } finally { setRestoring(false); }
  }

  async function doMigrationVerify() {
    setVerifying(true);
    try {
      const res = await fetch("/api/admin/migration/verify", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setVerifyResult(data);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Verification failed", description: err.message });
    } finally { setVerifying(false); }
  }

  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => { if (activeTab === "analytics") loadAnalytics(); }, [activeTab, loadAnalytics]);
  useEffect(() => { if (activeTab === "support") loadTickets(); }, [activeTab, loadTickets]);
  useEffect(() => { if (activeTab === "credits") loadCreditUsers(); }, [activeTab, loadCreditUsers]);

  async function saveSection(keys: string[]) {
    setSaving(true);
    try {
      const patch: SettingsMap = {};
      keys.forEach(k => { patch[k] = settings[k] ?? DEFAULTS[k] ?? ""; });
      await apiFetch("settings", { method: "PUT", body: JSON.stringify(patch) });
      toast({ title: "Settings saved", description: `${keys.length} setting${keys.length !== 1 ? "s" : ""} updated.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    } finally { setSaving(false); }
  }

  const activeTabObj = SUB_TABS.find(t => t.id === activeTab)!;

  if (loading) {
    return (
      <div className="space-y-3">
        {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mobile tab selector */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setShowMobileMenu(m => !m)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700"
        >
          <div className="flex items-center gap-2">
            <activeTabObj.icon className="h-4 w-4 text-blue-600" />
            {activeTabObj.label}
          </div>
          {showMobileMenu ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
        {showMobileMenu && (
          <div className="mt-1 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-lg">
            {SUB_TABS.map(t => (
              <button key={t.id} type="button"
                onClick={() => { setActiveTab(t.id); setShowMobileMenu(false); }}
                className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm border-b border-slate-50 last:border-0 transition-colors ${
                  activeTab === t.id ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <t.icon className="h-4 w-4 flex-shrink-0" />
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-5">
        {/* Desktop sidebar nav */}
        <nav className="hidden lg:flex flex-col gap-0.5 flex-shrink-0 w-44 overflow-y-auto max-h-[calc(100vh-200px)]">
          {Object.entries(SUB_TABS.reduce((acc, t) => {
            const g = t.group ?? "Other";
            if (!acc[g]) acc[g] = [];
            acc[g].push(t);
            return acc;
          }, {} as Record<string, typeof SUB_TABS>)).map(([group, tabs]) => (
            <div key={group} className="mb-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 pt-2 pb-1">{group}</p>
              {tabs.map(t => (
                <button key={t.id} type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left ${
                    activeTab === t.id
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <t.icon className="h-3.5 w-3.5 flex-shrink-0" />
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Panel */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 overflow-hidden overflow-y-auto max-h-[calc(100vh-200px)]">

          {/* ── 1. GENERAL ────────────────────────────────────────────────── */}
          {activeTab === "general" && (
            <div className="space-y-5">
              <SectionHeader icon={Globe} title="General Platform Settings" color="bg-blue-50 text-blue-600"
                desc="Platform identity, contact info, and operational status." />

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Platform Name" settingsKey="platformName" settings={settings} onChange={set}
                    placeholder="BrokerMail AI" />
                </div>
                <Field label="Support Email" settingsKey="supportEmail" settings={settings} onChange={set}
                  type="email" placeholder="support@brokermail.ai" />
                <Field label="Contact Phone" settingsKey="contactPhone" settings={settings} onChange={set}
                  type="tel" placeholder="+1 (555) 000-0000" />
                <div className="sm:col-span-2">
                  <Field label="Company Address" settingsKey="companyAddress" settings={settings} onChange={set}
                    placeholder="123 Main St, Orlando, FL 32801" />
                </div>
                <div className="sm:col-span-2">
                  <Field label="Footer Text" settingsKey="footerText" settings={settings} onChange={set}
                    placeholder="Built for the auto transport industry." />
                </div>
              </div>

              <Toggle label="Maintenance Mode" danger
                desc="When ON, non-admin users see a maintenance page and cannot use the platform."
                settingsKey="maintenanceMode" settings={settings} onChange={set} />

              {settings.maintenanceMode === "true" && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
                  <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="text-sm text-red-800 font-medium">
                      Maintenance mode is <strong>ON</strong>. All non-admin users are locked out.
                    </p>
                    {settings.maintenanceStartedAt && (
                      <p className="text-xs text-red-600">
                        Active since {new Date(settings.maintenanceStartedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-4 pt-1">
                <Field
                  label="Maintenance Message"
                  settingsKey="maintenanceMessage"
                  settings={settings}
                  onChange={set}
                  placeholder="We're currently performing system upgrades. Please check back shortly."
                />
                <Field
                  label="Expected Return Time (optional)"
                  settingsKey="maintenanceReturnTime"
                  settings={settings}
                  onChange={set}
                  placeholder="e.g. 2026-06-01T14:00 or 'Sunday 2pm EST'"
                />
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "platformName", "supportEmail", "contactPhone",
                "companyAddress", "footerText", "maintenanceMode",
                "maintenanceMessage", "maintenanceReturnTime",
              ])} label="Save General Settings" />
            </div>
          )}

          {/* ── 2. BRANDING ───────────────────────────────────────────────── */}
          {activeTab === "branding" && (
            <div className="space-y-5">
              <SectionHeader icon={Palette} title="Branding Defaults" color="bg-purple-50 text-purple-600"
                desc="Default visual settings applied to emails and the platform UI." />

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Default Accent Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={settings.defaultAccentColor ?? "#1d4ed8"}
                      onChange={e => set("defaultAccentColor", e.target.value)}
                      className="h-11 w-16 rounded-xl border border-slate-200 cursor-pointer p-1"
                    />
                    <Input
                      value={settings.defaultAccentColor ?? "#1d4ed8"}
                      onChange={e => set("defaultAccentColor", e.target.value)}
                      placeholder="#1d4ed8"
                      className="rounded-xl font-mono flex-1"
                    />
                  </div>
                  <div className="h-8 rounded-xl border border-slate-100" style={{ backgroundColor: settings.defaultAccentColor || "#1d4ed8" }} />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Default Email Layout Style</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: "clean",   label: "Clean",   color: "#1d4ed8" },
                      { value: "modern",  label: "Modern",  color: "#4f46e5" },
                      { value: "minimal", label: "Minimal", color: "#e2e8f0" },
                      { value: "luxury",  label: "Luxury",  color: "#0f172a" },
                    ].map(s => (
                      <button key={s.value} type="button"
                        onClick={() => set("defaultEmailStyle", s.value)}
                        className={`flex items-center gap-2 p-2.5 rounded-xl border-2 text-xs font-semibold text-left transition-colors ${
                          settings.defaultEmailStyle === s.value
                            ? "border-blue-500 bg-blue-50 text-blue-800"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <span className="h-4 w-4 rounded flex-shrink-0" style={{ backgroundColor: s.color }} />
                        {s.label}
                        {settings.defaultEmailStyle === s.value && <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 ml-auto" />}
                      </button>
                    ))}
                  </div>
                </div>

                <Field label="Default Email Slogan" settingsKey="defaultEmailSlogan" settings={settings} onChange={set}
                  placeholder="Your #1 Auto Transport Partner" />

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Default Font</label>
                  <select
                    value={settings.defaultFont ?? "inter"}
                    onChange={e => set("defaultFont", e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white text-slate-700"
                  >
                    {["inter", "roboto", "lato", "open-sans", "georgia", "courier"].map(f => (
                      <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1).replace("-", " ")}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Default Button Style</label>
                  <div className="flex gap-2">
                    {[
                      { value: "rounded",   label: "Rounded" },
                      { value: "pill",      label: "Pill" },
                      { value: "sharp",     label: "Sharp" },
                    ].map(b => (
                      <button key={b.value} type="button"
                        onClick={() => set("defaultButtonStyle", b.value)}
                        className={`flex-1 py-2 text-xs font-semibold rounded-xl border-2 transition-colors ${
                          settings.defaultButtonStyle === b.value
                            ? "border-blue-500 bg-blue-50 text-blue-800"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "defaultAccentColor", "defaultEmailSlogan", "defaultEmailStyle",
                "defaultButtonStyle", "defaultFont",
              ])} label="Save Branding" />
            </div>
          )}

          {/* ── 3. SMTP SYSTEM CONTROLS ───────────────────────────────────── */}
          {activeTab === "smtp" && (
            <div className="space-y-5">
              <SectionHeader icon={Server} title="SMTP System Controls" color="bg-emerald-50 text-emerald-600"
                desc="Platform-wide defaults for email delivery, rate limiting, and queue behavior." />

              <div className="grid sm:grid-cols-2 gap-5">
                <NumberSlider label="Default Batch Size" desc="Emails queued per send batch."
                  settingsKey="defaultBatchSize" settings={settings} onChange={set}
                  min={1} max={500} unit="emails" />
                <NumberSlider label="Default Delay Between Emails" desc="Pause between each delivery."
                  settingsKey="defaultDelaySeconds" settings={settings} onChange={set}
                  min={1} max={300} unit="sec" />
                <NumberSlider label="Default Hourly Send Limit" desc="Max emails per user per hour."
                  settingsKey="defaultMaxPerHour" settings={settings} onChange={set}
                  min={10} max={2000} step={10} unit="/hr" />
                <NumberSlider label="Max Retry Attempts" desc="Before permanently marking failed."
                  settingsKey="maxRetryAttempts" settings={settings} onChange={set}
                  min={0} max={10} />
              </div>

              <div className="space-y-3">
                <Toggle label="Email Queue System"
                  desc="Enables the background queue processor. Disable to block all sending."
                  settingsKey="queueEnabled" settings={settings} onChange={set} />
                <Toggle label="Auto Retry on Failure"
                  desc="Automatically retry failed emails up to the max retry limit."
                  settingsKey="autoRetryEnabled" settings={settings} onChange={set} />
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                {[
                  { key: "maxEmailsPerDay",   label: "Max Emails / Day (platform)" },
                  { key: "emailLimitPerUser", label: "Max Emails / Day (per user)" },
                  { key: "maxLeadsPerUpload", label: "Max Leads Per Upload" },
                ].map(f => (
                  <Field key={f.key} label={f.label} settingsKey={f.key} settings={settings} onChange={set}
                    type="number" mono />
                ))}
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "defaultBatchSize", "defaultDelaySeconds", "defaultMaxPerHour",
                "maxRetryAttempts", "queueEnabled", "autoRetryEnabled",
                "maxEmailsPerDay", "emailLimitPerUser", "maxLeadsPerUpload",
              ])} label="Save SMTP Controls" />
            </div>
          )}

          {/* ── 4. AI SETTINGS ────────────────────────────────────────────── */}
          {activeTab === "ai" && (
            <div className="space-y-5">
              <SectionHeader icon={Bot} title="AI Settings" color="bg-violet-50 text-violet-600"
                desc="Control AI generation behavior, model selection, and usage limits." />

              <Toggle label="AI Email Generation"
                desc="Enables AI-powered email personalization. Disable to use templates only."
                settingsKey="aiEnabled" settings={settings} onChange={set} />

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">AI Model</label>
                  <select
                    value={settings.aiModel ?? "gpt-4o-mini"}
                    onChange={e => set("aiModel", e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white text-slate-700"
                  >
                    {[
                      { value: "gpt-4o-mini",   label: "GPT-4o Mini (fast, cheap)" },
                      { value: "gpt-4o",         label: "GPT-4o (smart, slower)" },
                      { value: "gpt-4-turbo",    label: "GPT-4 Turbo" },
                      { value: "gpt-3.5-turbo",  label: "GPT-3.5 Turbo (economy)" },
                    ].map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <p className="text-xs text-slate-400">Selected model is used for all AI generation on the platform.</p>
                </div>

                <Field label="Daily AI Usage Limit (calls)" settingsKey="dailyAiLimit"
                  settings={settings} onChange={set} type="number" mono
                  hint="Max AI API calls per day across all users." />
              </div>

              <NumberSlider label="AI Temperature" desc="Controls creativity. Lower = more deterministic."
                settingsKey="aiTemperature" settings={settings} onChange={set}
                min={0} max={1} step={0.1} />

              <div className="flex items-center gap-3 p-4 rounded-xl bg-violet-50 border border-violet-100">
                <Bot className="h-5 w-5 text-violet-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-violet-900">Current Model: {settings.aiModel || "gpt-4o-mini"}</p>
                  <p className="text-xs text-violet-700 mt-0.5">
                    Temperature {settings.aiTemperature || "0.7"} · Daily limit {(settings.dailyAiLimit || "500")} calls
                  </p>
                </div>
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "aiEnabled", "aiModel", "aiTemperature", "dailyAiLimit",
              ])} label="Save AI Settings" />
            </div>
          )}

          {/* ── 5. USER MANAGEMENT CONTROLS ──────────────────────────────── */}
          {activeTab === "users" && (
            <div className="space-y-5">
              <SectionHeader icon={Users} title="User Management Controls" color="bg-teal-50 text-teal-600"
                desc="Registration controls, verification requirements, and default plan limits." />

              <div className="space-y-3">
                <Toggle label="Allow New Registrations"
                  desc="When OFF, no new accounts can be created (invite-only mode)."
                  settingsKey="allowRegistrations" settings={settings} onChange={set} />
                <Toggle label="Require Email Verification"
                  desc="New users must verify their email before accessing the platform."
                  settingsKey="requireEmailVerification" settings={settings} onChange={set} />
                <Toggle label="Auto-Suspend on Abuse" danger
                  desc="Automatically suspends accounts that trigger spam/rate-limit violations."
                  settingsKey="autoSuspendOnAbuse" settings={settings} onChange={set} />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Free Plan Defaults</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Monthly Email Limit (Free)" settingsKey="freeMonthlyEmailLimit"
                    settings={settings} onChange={set} type="number" mono
                    hint="Set to -1 for unlimited." />
                  <Field label="Batch Send Limit (Free)" settingsKey="freeBatchLimit"
                    settings={settings} onChange={set} type="number" mono
                    hint="Max emails per batch for free users." />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-teal-50 border border-teal-100">
                <p className="text-xs font-semibold text-teal-800 mb-2">Current Status</p>
                <div className="flex flex-wrap gap-3">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    settings.allowRegistrations === "true" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  }`}>
                    {settings.allowRegistrations === "true" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                    Registrations {settings.allowRegistrations === "true" ? "Open" : "Closed"}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    settings.requireEmailVerification === "true" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                  }`}>
                    <Mail className="h-3.5 w-3.5" />
                    Email Verification {settings.requireEmailVerification === "true" ? "Required" : "Not Required"}
                  </span>
                </div>
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "allowRegistrations", "requireEmailVerification", "autoSuspendOnAbuse",
                "freeMonthlyEmailLimit", "freeBatchLimit",
              ])} label="Save User Settings" />
            </div>
          )}

          {/* ── 6. BILLING SETTINGS ──────────────────────────────────────── */}
          {activeTab === "billing" && (
            <div className="space-y-5">
              <SectionHeader icon={CreditCard} title="Billing Settings" color="bg-amber-50 text-amber-600"
                desc="Stripe integration, credit system, and pricing configuration." />

              <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">Stripe Integration — Coming Soon</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Add your Stripe keys below to enable paid plan subscriptions. Currently, plans are managed manually.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Stripe Configuration</p>
                <Field label="Stripe Publishable Key (pk_live_...)" settingsKey="stripePublishableKey"
                  settings={settings} onChange={set} placeholder="pk_live_..." mono />
                <SecretField label="Stripe Webhook Secret (whsec_...)" settingsKey="stripeWebhookSecret"
                  settings={settings} onChange={set} placeholder="whsec_..." />
              </div>

              <div className="space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Credit System</p>
                <Toggle label="Enable Credit System"
                  desc="Users can purchase credits to unlock AI generation and extra sends."
                  settingsKey="creditSystemEnabled" settings={settings} onChange={set} />
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Credits per Dollar" settingsKey="creditsPerDollar"
                    settings={settings} onChange={set} type="number" mono
                    hint="How many credits $1 USD buys." />
                  <Field label="Free Trial Days" settingsKey="freeTrialDays"
                    settings={settings} onChange={set} type="number" mono
                    hint="Days of Pro access after signup. 0 = no trial." />
                </div>
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "stripePublishableKey", "stripeWebhookSecret",
                "creditsPerDollar", "creditSystemEnabled", "freeTrialDays",
              ])} label="Save Billing Settings" />
            </div>
          )}

          {/* ── 7. SECURITY SETTINGS ─────────────────────────────────────── */}
          {activeTab === "security" && (
            <div className="space-y-5">
              <SectionHeader icon={Shield} title="Security Settings" color="bg-red-50 text-red-600"
                desc="Session management, rate limiting, and authentication controls." />

              <div className="grid sm:grid-cols-2 gap-5">
                <NumberSlider label="Session Timeout" desc="Users are auto-logged out after this many hours of inactivity."
                  settingsKey="sessionTimeoutHours" settings={settings} onChange={set}
                  min={1} max={168} unit="hrs" />
                <NumberSlider label="Login Rate Limit" desc="Max login attempts per IP per 15 minutes."
                  settingsKey="loginRateLimit" settings={settings} onChange={set}
                  min={3} max={50} />
                <NumberSlider label="Failed Login Threshold" desc="Failed attempts before account is locked."
                  settingsKey="failedLoginThreshold" settings={settings} onChange={set}
                  min={3} max={20} />
              </div>

              <div className="space-y-3">
                <Toggle label="Require Admin MFA" danger
                  desc="Admin accounts must use multi-factor authentication to log in."
                  settingsKey="requireAdminMfa" settings={settings} onChange={set} />
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Security Summary</p>
                {[
                  { label: "Session Timeout", value: `${settings.sessionTimeoutHours || 24}h` },
                  { label: "Login Rate Limit", value: `${settings.loginRateLimit || 10} / 15 min` },
                  { label: "Failed Login Lockout", value: `After ${settings.failedLoginThreshold || 5} attempts` },
                  { label: "Admin MFA", value: settings.requireAdminMfa === "true" ? "Required" : "Not Required" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center text-sm py-1 border-b border-slate-100 last:border-0">
                    <span className="text-slate-500 text-xs">{label}</span>
                    <span className="font-semibold text-slate-800 text-xs">{value}</span>
                  </div>
                ))}
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "sessionTimeoutHours", "loginRateLimit", "failedLoginThreshold", "requireAdminMfa",
              ])} label="Save Security Settings" />
            </div>
          )}

          {/* ── 8. CMS / WEBSITE SETTINGS ────────────────────────────────── */}
          {activeTab === "cms" && (
            <div className="space-y-5">
              <SectionHeader icon={FileText} title="CMS / Website Settings" color="bg-indigo-50 text-indigo-600"
                desc="Edit homepage copy, FAQ content, and public-facing page text." />

              <div className="space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Homepage Hero</p>
                <Field label="Hero Title" settingsKey="heroTitle" settings={settings} onChange={set}
                  placeholder="Close more transport deals with AI-powered outreach." />
                <Field label="Hero Subtitle" settingsKey="heroSubtitle" settings={settings} onChange={set}
                  placeholder="Upload lead sheets, personalize emails instantly…" />
                <Field label="Hero Slogan / Tagline" settingsKey="heroSlogan" settings={settings} onChange={set}
                  placeholder="Built specifically for auto transport brokers." />
              </div>

              <div className="space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">FAQ Content</p>
                <TextareaField label="FAQ Page Content (Markdown / plain text)" settingsKey="faqContent"
                  settings={settings} onChange={set} rows={8}
                  placeholder={"Q: What is BrokerMail AI?\nA: BrokerMail AI is an email automation platform...\n\nQ: How does the batch system work?\nA: ..."}
                  hint="Leave blank to use the hardcoded FAQ component." />
              </div>

              <div className="space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pricing Page Notes</p>
                <TextareaField label="Pricing Page Disclaimer / Extra Content" settingsKey="pricingContent"
                  settings={settings} onChange={set} rows={4}
                  placeholder="All prices are in USD. Cancel anytime. No contracts."
                  hint="Shown at the bottom of the pricing page." />
              </div>

              <div className="space-y-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contact Page</p>
                <TextareaField label="Contact Page Custom Message" settingsKey="contactContent"
                  settings={settings} onChange={set} rows={4}
                  placeholder="Have questions? Reach us at support@brokermail.ai or call (555) 000-0000."
                  hint="Replaces or supplements the default contact page intro." />
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "heroTitle", "heroSubtitle", "heroSlogan",
                "faqContent", "pricingContent", "contactContent",
              ])} label="Save CMS Content" />
            </div>
          )}

          {/* ── 9. ANALYTICS DASHBOARD ────────────────────────────────────── */}
          {activeTab === "analytics" && (
            <div className="space-y-5">
              <SectionHeader icon={BarChart3} title="Analytics Dashboard" color="bg-blue-50 text-blue-600"
                desc="Real-time platform metrics, email delivery stats, and queue health." />

              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">Live data from the database</p>
                <Button variant="outline" size="sm" onClick={loadAnalytics}
                  disabled={analyticsLoading} className="gap-1.5 rounded-xl h-8">
                  <RefreshCw className={`h-3.5 w-3.5 ${analyticsLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              {analyticsLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
                </div>
              ) : analytics ? (
                <>
                  {/* Email stats */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Email Delivery</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <StatCard label="Total Sent (All Time)" value={analytics.totalEmailsSent.toLocaleString()}
                        color="bg-emerald-50 border-emerald-100 text-emerald-800" />
                      <StatCard label="Total Failed" value={analytics.totalFailed.toLocaleString()}
                        color={analytics.totalFailed > 0 ? "bg-red-50 border-red-100 text-red-800" : "bg-slate-50 border-slate-100 text-slate-600"} />
                      <StatCard label="SMTP Success Rate" value={analytics.successRate}
                        color="bg-blue-50 border-blue-100 text-blue-800" />
                      <StatCard label="Emails Today" value={analytics.emailsToday.toLocaleString()}
                        sub={`${analytics.emailsThisMonth.toLocaleString()} this month`}
                        color="bg-indigo-50 border-indigo-100 text-indigo-800" />
                    </div>
                  </div>

                  {/* User stats */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Users & Connections</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <StatCard label="Active Users" value={analytics.activeUsers.toLocaleString()}
                        sub={`of ${analytics.totalUsers} total`}
                        color="bg-teal-50 border-teal-100 text-teal-800" />
                      <StatCard label="SMTP Mailboxes" value={analytics.smtpMailboxes.toLocaleString()}
                        color="bg-violet-50 border-violet-100 text-violet-800" />
                      <StatCard label="AI Calls Today" value={analytics.aiUsageToday.toLocaleString()}
                        sub={`Limit: ${settings.dailyAiLimit || "500"}`}
                        color="bg-amber-50 border-amber-100 text-amber-800" />
                    </div>
                  </div>

                  {/* Queue status */}
                  {queueStatus && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Queue Status</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="Pending" value={queueStatus.pending.toLocaleString()}
                          color="bg-blue-50 border-blue-100 text-blue-800" />
                        <StatCard label="Currently Sending" value={queueStatus.sending.toLocaleString()}
                          color={queueStatus.sending > 0 ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-slate-50 border-slate-100 text-slate-600"} />
                        <StatCard label="Delivered (Queue)" value={queueStatus.success.toLocaleString()}
                          color="bg-teal-50 border-teal-100 text-teal-800" />
                        <StatCard label="Failed (Queue)" value={queueStatus.failed.toLocaleString()}
                          color={queueStatus.failed > 0 ? "bg-red-50 border-red-100 text-red-800" : "bg-slate-50 border-slate-100 text-slate-600"} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <Database className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-xs text-slate-600">
                            {(queueStatus.pending + queueStatus.sending + queueStatus.success + queueStatus.failed).toLocaleString()} total queue items
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Activity className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-xs text-slate-600">{queueStatus.last24h.toLocaleString()} processed in last 24h</span>
                        </div>
                        <div className="flex items-center gap-1.5 ml-auto">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                            settings.queueEnabled === "true"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-red-100 text-red-700"
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${settings.queueEnabled === "true" ? "bg-emerald-500" : "bg-red-500"}`} />
                            Queue {settings.queueEnabled === "true" ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Summary row */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Platform Health</p>
                    <div className="space-y-2">
                      {[
                        {
                          label: "Delivery Success Rate",
                          value: analytics.successRate,
                          ok: analytics.successRate !== "—" && parseInt(analytics.successRate) >= 90,
                        },
                        {
                          label: "Queue System",
                          value: settings.queueEnabled === "true" ? "Operational" : "Disabled",
                          ok: settings.queueEnabled === "true",
                        },
                        {
                          label: "AI Generation",
                          value: settings.aiEnabled === "true" ? `Active (${settings.aiModel || "gpt-4o-mini"})` : "Disabled",
                          ok: settings.aiEnabled === "true",
                        },
                        {
                          label: "Maintenance Mode",
                          value: settings.maintenanceMode === "true" ? "ON — Users Locked Out" : "OFF — Platform Active",
                          ok: settings.maintenanceMode !== "true",
                        },
                        {
                          label: "Registrations",
                          value: settings.allowRegistrations === "true" ? "Open" : "Closed",
                          ok: true,
                        },
                      ].map(({ label, value, ok }) => (
                        <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                          <span className="text-xs text-slate-500">{label}</span>
                          <span className={`flex items-center gap-1.5 text-xs font-semibold ${ok ? "text-emerald-700" : "text-red-600"}`}>
                            {ok
                              ? <CheckCircle2 className="h-3.5 w-3.5" />
                              : <AlertTriangle className="h-3.5 w-3.5" />}
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-16 text-center">
                  <BarChart3 className="h-10 w-10 mx-auto text-slate-200 mb-3" />
                  <p className="text-slate-400 text-sm">Could not load analytics. Try refreshing.</p>
                </div>
              )}
            </div>
          )}


          {/* ── 10. EMAIL PROVIDER MANAGEMENT ──────────────────────────────── */}
          {activeTab === "providers" && (
            <div className="space-y-5">
              <SectionHeader icon={MailCheck} title="Email Provider Management" color="bg-emerald-50 text-emerald-600"
                desc="Enable or disable email sending methods and specific provider integrations." />

              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sending Methods</p>
                <Toggle label="Gmail Drafts" desc="Allow users to create Gmail drafts via OAuth."
                  settingsKey="gmailDraftsEnabled" settings={settings} onChange={set} />
                <Toggle label="SMTP Sending" desc="Allow users to send via custom SMTP mailboxes."
                  settingsKey="smtpSendingEnabled" settings={settings} onChange={set} />
                <Toggle label="IMAP Sync" desc="Allow users to sync inbox via IMAP."
                  settingsKey="imapSyncEnabled" settings={settings} onChange={set} />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Allowed Providers</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {[
                    { key: "providerGmail",       label: "Gmail",        icon: "G" },
                    { key: "providerOutlook",     label: "Outlook",      icon: "O" },
                    { key: "providerHostinger",   label: "Hostinger",    icon: "H" },
                    { key: "providerGoDaddy",     label: "GoDaddy",      icon: "GD" },
                    { key: "providerZoho",        label: "Zoho",         icon: "Z" },
                    { key: "providerNamecheap",   label: "Namecheap",    icon: "N" },
                    { key: "providerPrivateMail", label: "Private Mail", icon: "PM" },
                  ].map(p => {
                    const on = settings[p.key] === "true";
                    return (
                      <div key={p.key} className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${on ? "bg-emerald-50 border-emerald-100" : "bg-slate-50 border-slate-100"}`}>
                        <div className="flex items-center gap-2">
                          <span className={`h-7 w-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0 ${on ? "bg-emerald-200 text-emerald-800" : "bg-slate-200 text-slate-500"}`}>{p.icon}</span>
                          <span className="text-sm font-medium text-slate-800">{p.label}</span>
                        </div>
                        <button type="button" onClick={() => set(p.key, on ? "false" : "true")}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${on ? "bg-emerald-500" : "bg-slate-200"}`}
                          role="switch" aria-checked={on}>
                          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "gmailDraftsEnabled", "smtpSendingEnabled", "imapSyncEnabled",
                "providerGmail", "providerOutlook", "providerHostinger",
                "providerGoDaddy", "providerZoho", "providerNamecheap", "providerPrivateMail",
              ])} label="Save Provider Settings" />
            </div>
          )}

          {/* ── 11. GLOBAL EMAIL CONTROLS ───────────────────────────────────── */}
          {activeTab === "emailControls" && (
            <div className="space-y-5">
              <SectionHeader icon={Sliders} title="Global Email Controls" color="bg-orange-50 text-orange-600"
                desc="Platform-wide limits, spam protection thresholds, and queue cooldown timers." />

              <div className="grid sm:grid-cols-2 gap-5">
                <NumberSlider label="Max Emails / Hour (Platform-wide)" desc="Hard cap across all users."
                  settingsKey="platformMaxEmailsPerHour" settings={settings} onChange={set}
                  min={10} max={5000} step={10} unit="/hr" />
                <NumberSlider label="Max Emails / Day (Platform-wide)"
                  settingsKey="maxEmailsPerDay" settings={settings} onChange={set}
                  min={100} max={50000} step={100} unit="/day" />
                <NumberSlider label="Minimum Delay Between Sends" desc="Enforced for every user."
                  settingsKey="minDelaySecs" settings={settings} onChange={set}
                  min={1} max={120} unit="sec" />
                <NumberSlider label="Queue Cooldown Timer" desc="Minutes queue pauses after hitting rate limit."
                  settingsKey="queueCooldownMins" settings={settings} onChange={set}
                  min={1} max={60} unit="min" />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Spam Protection</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-medium text-slate-700">Spam Score Threshold</label>
                      <span className="text-sm font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-lg">{settings.spamScoreThreshold ?? "7"} / 10</span>
                    </div>
                    <p className="text-xs text-slate-400">Emails above this score are blocked.</p>
                    <input type="range" min={1} max={10} step={1}
                      value={Number(settings.spamScoreThreshold ?? 7)}
                      onChange={e => set("spamScoreThreshold", e.target.value)}
                      className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-orange-500" />
                    <div className="flex justify-between text-xs text-slate-400"><span>1 (strict)</span><span>10 (lenient)</span></div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-medium text-slate-700">Bounce Rate Threshold</label>
                      <span className="text-sm font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-lg">{settings.bounceRateThreshold ?? "5"}%</span>
                    </div>
                    <p className="text-xs text-slate-400">Auto-suspend user when their bounce rate exceeds this.</p>
                    <input type="range" min={1} max={30} step={1}
                      value={Number(settings.bounceRateThreshold ?? 5)}
                      onChange={e => set("bounceRateThreshold", e.target.value)}
                      className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-orange-500" />
                    <div className="flex justify-between text-xs text-slate-400"><span>1%</span><span>30%</span></div>
                  </div>
                </div>
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "platformMaxEmailsPerHour", "maxEmailsPerDay", "minDelaySecs",
                "queueCooldownMins", "spamScoreThreshold", "bounceRateThreshold",
              ])} label="Save Email Controls" />
            </div>
          )}

          {/* ── 12. USER PLAN PERMISSIONS ───────────────────────────────────── */}
          {activeTab === "planPerms" && (
            <div className="space-y-5">
              <SectionHeader icon={UserCheck} title="User Plan Permissions" color="bg-teal-50 text-teal-600"
                desc="Control what each plan tier can access. Changes apply globally." />

              {(["Free", "Pro", "Enterprise"] as const).map(tier => {
                const t = tier.toLowerCase();
                const color = tier === "Free" ? "bg-slate-50 border-slate-200" : tier === "Pro" ? "bg-blue-50 border-blue-200" : "bg-purple-50 border-purple-200";
                const badge = tier === "Free" ? "bg-slate-200 text-slate-700" : tier === "Pro" ? "bg-blue-200 text-blue-800" : "bg-purple-200 text-purple-800";
                return (
                  <div key={tier} className={`rounded-2xl border p-4 space-y-4 ${color}`}>
                    <div className="flex items-center justify-between">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${badge}`}>{tier} Plan</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Max Uploads / Day</label>
                        <Input type="number" value={settings[`plan${tier}MaxUploadsDay`] ?? "3"}
                          onChange={e => set(`plan${tier}MaxUploadsDay`, e.target.value)}
                          className="h-8 rounded-lg text-sm" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Max Contacts / Month</label>
                        <Input type="number" value={settings[`plan${tier}MaxContactsMonth`] ?? "500"}
                          onChange={e => set(`plan${tier}MaxContactsMonth`, e.target.value)}
                          className="h-8 rounded-lg text-sm" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        { key: `plan${tier}Smtp`,     label: "SMTP Access" },
                        { key: `plan${tier}Ai`,       label: "AI Writer" },
                        { key: `plan${tier}Branding`, label: "Custom Branding" },
                        { key: `plan${tier}Priority`, label: "Priority Sending" },
                      ].map(p => {
                        const on = settings[p.key] === "true";
                        return (
                          <button key={p.key} type="button"
                            onClick={() => set(p.key, on ? "false" : "true")}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${on ? "border-emerald-400 bg-emerald-100 text-emerald-800" : "border-slate-200 bg-white text-slate-500"}`}>
                            {on ? <CheckCircle2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <SaveBar saving={saving} onSave={() => saveSection([
                "planFreeMaxUploadsDay", "planProMaxUploadsDay", "planEnterpriseMaxUploadsDay",
                "planFreeMaxContactsMonth", "planProMaxContactsMonth", "planEnterpriseMaxContactsMonth",
                "planFreeSmtp", "planProSmtp", "planEnterpriseSmtp",
                "planFreeAi", "planProAi", "planEnterpriseAi",
                "planFreeBranding", "planProBranding", "planEnterpriseBranding",
                "planFreePriority", "planProPriority", "planEnterprisePriority",
              ])} label="Save Plan Permissions" />
            </div>
          )}

          {/* ── 13. CREDITS SYSTEM ─────────────────────────────────────────── */}
          {activeTab === "credits" && (
            <div className="space-y-5">
              <SectionHeader icon={Coins} title="Credits System" color="bg-amber-50 text-amber-600"
                desc="Set credit costs, free trial amounts, and manually adjust user balances." />

              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="Free Trial Credits" settingsKey="freeTrialCredits" settings={settings} onChange={set}
                  type="number" mono hint="Credits given to new users on signup." />
                <Field label="AI Credit Cost (per call)" settingsKey="aiCreditCost" settings={settings} onChange={set}
                  type="number" mono hint="Credits deducted per AI email generation." />
                <Field label="Email Send Cost (per email)" settingsKey="emailCreditCost" settings={settings} onChange={set}
                  type="number" mono hint="Credits deducted per sent email." />
              </div>

              <SaveBar saving={saving} onSave={() => saveSection(["freeTrialCredits", "aiCreditCost", "emailCreditCost"])}
                label="Save Credit Costs" />

              <div className="border-t border-slate-100 pt-5 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Manually Adjust User Credits</p>
                <div className="flex gap-2">
                  <Input placeholder="Search user..." value={creditSearch}
                    onChange={e => setCreditSearch(e.target.value)}
                    className="rounded-xl flex-1" />
                  <Button variant="outline" size="sm" onClick={loadCreditUsers} className="rounded-xl gap-1.5 shrink-0">
                    <RefreshCw className={`h-3.5 w-3.5 ${creditUsersLoading ? "animate-spin" : ""}`} />Search
                  </Button>
                </div>

                {creditUsersLoading ? (
                  <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {creditUsers.map(u => (
                      <div key={u.id} className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${creditTargetId === u.id ? "border-amber-400 bg-amber-50" : "border-slate-100 bg-slate-50 hover:bg-slate-100"}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800 truncate">{u.name}</p>
                          <p className="text-xs text-slate-500">{u.email} · <span className="font-bold text-amber-600">{u.credits} credits</span></p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setCreditTargetId(creditTargetId === u.id ? null : u.id)}
                          className="rounded-xl text-xs ml-2 shrink-0">
                          {creditTargetId === u.id ? "Cancel" : "Adjust"}
                        </Button>
                      </div>
                    ))}
                    {creditUsers.length === 0 && <p className="text-sm text-slate-400 text-center py-6">No users found. Search to find a user.</p>}
                  </div>
                )}

                {creditTargetId !== null && (
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-3">
                    <p className="text-sm font-semibold text-amber-900">
                      Adjusting credits for: {creditUsers.find(u => u.id === creditTargetId)?.email}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500">Amount (use - to remove)</label>
                        <Input type="number" value={creditAmount} onChange={e => setCreditAmount(e.target.value)}
                          placeholder="e.g. 100 or -50" className="rounded-xl" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500">Reason (optional)</label>
                        <Input value={creditReason} onChange={e => setCreditReason(e.target.value)}
                          placeholder="Bonus, refund, etc." className="rounded-xl" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => adjustCredits(creditTargetId!, parseInt(creditAmount))} disabled={creditAdjusting}
                        className="flex-1 rounded-xl gap-1.5 bg-amber-600 hover:bg-amber-700">
                        {creditAdjusting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                        Apply Adjustment
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 14. ADMIN NOTIFICATIONS ────────────────────────────────────── */}
          {activeTab === "notifications" && (
            <div className="space-y-5">
              <SectionHeader icon={Bell} title="Admin Notifications" color="bg-yellow-50 text-yellow-600"
                desc="Configure which alerts are sent to the admin notification email." />

              <Field label="Admin Notification Email" settingsKey="adminNotificationEmail"
                settings={settings} onChange={set} type="email"
                placeholder="admin@yourdomain.com"
                hint="All alerts are sent to this address." />

              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Alert Types</p>
                {[
                  { key: "notifySmtpFailures",   label: "SMTP Failures",    desc: "When an SMTP send permanently fails after all retries." },
                  { key: "notifyBouncedEmails",  label: "Bounced Emails",   desc: "When email bounce rate exceeds the configured threshold." },
                  { key: "notifyFailedPayments", label: "Failed Payments",  desc: "When a Stripe payment or subscription charge fails." },
                  { key: "notifySpamComplaints", label: "Spam Complaints",  desc: "When a recipient marks an email as spam." },
                  { key: "notifyServerIssues",   label: "Server Issues",    desc: "Critical system errors, database failures, or queue crashes." },
                ].map(n => (
                  <Toggle key={n.key} label={n.label} desc={n.desc}
                    settingsKey={n.key} settings={settings} onChange={set} />
                ))}
              </div>

              <div className="p-4 rounded-xl bg-yellow-50 border border-yellow-100">
                <p className="text-xs font-semibold text-yellow-800 mb-2">Notification Summary</p>
                <div className="flex flex-wrap gap-2">
                  {["notifySmtpFailures", "notifyBouncedEmails", "notifyFailedPayments", "notifySpamComplaints", "notifyServerIssues"].map(k => (
                    <span key={k} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${settings[k] === "true" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                      {k.replace("notify", "").replace(/([A-Z])/g, " $1").trim()}: {settings[k] === "true" ? "ON" : "OFF"}
                    </span>
                  ))}
                </div>
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "adminNotificationEmail", "notifySmtpFailures", "notifyBouncedEmails",
                "notifyFailedPayments", "notifySpamComplaints", "notifyServerIssues",
              ])} label="Save Notification Settings" />
            </div>
          )}

          {/* ── 15. TRUST & LEGAL CMS ──────────────────────────────────────── */}
          {activeTab === "legal" && (
            <div className="space-y-5">
              <SectionHeader icon={Scale} title="Trust & Legal CMS" color="bg-slate-50 text-slate-600"
                desc="Edit the content of your legal and public-facing pages. All changes are live immediately." />

              {[
                { key: "privacyPolicy",   label: "Privacy Policy",  placeholder: "## Privacy Policy\n\nLast updated: ...\n\nWe collect..." },
                { key: "termsOfService",  label: "Terms of Service", placeholder: "## Terms of Service\n\nBy using BrokerMail AI..." },
                { key: "refundPolicy",    label: "Refund Policy",   placeholder: "## Refund Policy\n\nRefunds are available within 14 days..." },
                { key: "aboutPageContent",label: "About Page",      placeholder: "## About BrokerMail AI\n\nWe built this platform to help auto transport brokers..." },
                { key: "contactContent",  label: "Contact Page",    placeholder: "Have questions? Reach us at support@brokermail.ai" },
              ].map(p => (
                <TextareaField key={p.key} label={p.label} settingsKey={p.key}
                  settings={settings} onChange={set} rows={6} placeholder={p.placeholder}
                  hint="Supports Markdown. Leave blank to use the default page." />
              ))}

              <SaveBar saving={saving} onSave={() => saveSection([
                "privacyPolicy", "termsOfService", "refundPolicy", "aboutPageContent", "contactContent",
              ])} label="Save Legal Pages" />
            </div>
          )}

          {/* ── 16. SUPPORT SYSTEM ─────────────────────────────────────────── */}
          {activeTab === "support" && (
            <div className="space-y-4">
              <SectionHeader icon={HelpCircle} title="Support Inbox" color="bg-sky-50 text-sky-600"
                desc="View and reply to user support tickets." />

              <div className="flex gap-2 flex-wrap">
                <Input placeholder="Search tickets..." value={ticketSearch}
                  onChange={e => setTicketSearch(e.target.value)}
                  className="rounded-xl flex-1 min-w-0" />
                <select value={ticketStatusFilter} onChange={e => setTicketStatusFilter(e.target.value)}
                  className="h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white text-slate-700 shrink-0">
                  {["all", "open", "in_progress", "resolved", "closed"].map(s => (
                    <option key={s} value={s}>{s === "all" ? "All Status" : s.replace("_", " ")}</option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={loadTickets} className="rounded-xl gap-1.5 shrink-0">
                  <RefreshCw className={`h-3.5 w-3.5 ${ticketsLoading ? "animate-spin" : ""}`} />Refresh
                </Button>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                {/* Ticket list */}
                <div className="space-y-2">
                  {ticketsLoading ? (
                    Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
                  ) : tickets.length === 0 ? (
                    <div className="py-12 text-center">
                      <MessageSquare className="h-10 w-10 mx-auto text-slate-200 mb-2" />
                      <p className="text-slate-400 text-sm">No tickets found.</p>
                    </div>
                  ) : tickets.map(t => {
                    const priorityColor = t.priority === "urgent" ? "bg-red-100 text-red-700" : t.priority === "high" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600";
                    const statusColor = t.status === "open" ? "bg-sky-100 text-sky-700" : t.status === "in_progress" ? "bg-amber-100 text-amber-700" : t.status === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500";
                    return (
                      <div key={t.id}
                        onClick={() => setSelectedTicket(t)}
                        className={`p-3 rounded-xl border cursor-pointer transition-colors ${selectedTicket?.id === t.id ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{t.subject}</p>
                            <p className="text-xs text-slate-500 truncate">{t.userEmail}</p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${statusColor}`}>{t.status.replace("_", " ")}</span>
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${priorityColor}`}>{t.priority}</span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{new Date(t.createdAt).toLocaleDateString()}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Ticket detail */}
                {selectedTicket ? (
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{selectedTicket.subject}</p>
                        <p className="text-xs text-slate-500">{selectedTicket.userName ?? selectedTicket.userEmail}</p>
                      </div>
                      <div className="flex gap-1">
                        <select value={selectedTicket.status}
                          onChange={e => updateTicketStatus(selectedTicket.id, e.target.value)}
                          className="h-7 px-2 rounded-lg border border-slate-200 text-xs bg-white">
                          {["open", "in_progress", "resolved", "closed"].map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                        </select>
                        <button onClick={() => deleteTicket(selectedTicket.id)}
                          className="h-7 w-7 flex items-center justify-center rounded-lg border border-red-200 text-red-400 hover:bg-red-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-700 max-h-24 overflow-y-auto">
                      {selectedTicket.message}
                    </div>

                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {selectedTicket.replies.map(r => (
                        <div key={r.id} className={`p-2.5 rounded-xl text-xs ${r.author === "admin" ? "bg-blue-50 border border-blue-100" : "bg-slate-50 border border-slate-100"}`}>
                          <p className="font-semibold text-slate-700 mb-1">{r.authorName}</p>
                          <p className="text-slate-600">{r.message}</p>
                          <p className="text-slate-400 mt-1">{new Date(r.createdAt).toLocaleString()}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <textarea value={ticketReply} onChange={e => setTicketReply(e.target.value)}
                        placeholder="Type a reply..." rows={2}
                        className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500" />
                      <Button onClick={replyToTicket} disabled={ticketReplying || !ticketReply.trim()}
                        className="rounded-xl gap-1.5 bg-sky-600 hover:bg-sky-700 self-end">
                        {ticketReplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border border-dashed border-slate-200 rounded-xl flex items-center justify-center py-12">
                    <div className="text-center">
                      <Reply className="h-8 w-8 mx-auto text-slate-200 mb-2" />
                      <p className="text-sm text-slate-400">Select a ticket to view &amp; reply</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 17. FEATURE TOGGLES ────────────────────────────────────────── */}
          {activeTab === "features" && (
            <div className="space-y-5">
              <SectionHeader icon={ToggleLeft} title="Feature Toggles" color="bg-violet-50 text-violet-600"
                desc="Enable or disable major platform features without code changes." />

              <div className="space-y-3">
                {[
                  { key: "featureLandingPage",        label: "Landing Page",          desc: "Public marketing homepage is visible to unauthenticated visitors.", danger: false },
                  { key: "featurePublicRegistration",  label: "Public Registration",   desc: "Allow new users to register. Disable to close signups.", danger: true },
                  { key: "featureAiWriter",            label: "AI Email Writer",       desc: "Users can generate personalized emails with AI.", danger: false },
                  { key: "featureSmtpSending",         label: "SMTP Sending",          desc: "Users can send emails via SMTP mailboxes.", danger: false },
                  { key: "featureGmailDrafts",         label: "Gmail Drafts",          desc: "Users can create Gmail drafts via OAuth.", danger: false },
                  { key: "featureQueueSystem",         label: "Queue System",          desc: "Background email queue processor. Disable to halt all sending.", danger: true },
                  { key: "featureAnalytics",           label: "User Analytics",        desc: "Users can see their email open/click analytics.", danger: false },
                ].map(f => (
                  <Toggle key={f.key} label={f.label} desc={f.desc} danger={f.danger}
                    settingsKey={f.key} settings={settings} onChange={set} />
                ))}
              </div>

              <div className="p-4 rounded-xl bg-violet-50 border border-violet-100">
                <p className="text-xs font-semibold text-violet-800 mb-2">Active Features</p>
                <div className="flex flex-wrap gap-2">
                  {["featureLandingPage", "featurePublicRegistration", "featureAiWriter",
                    "featureSmtpSending", "featureGmailDrafts", "featureQueueSystem", "featureAnalytics"].map(k => {
                    const on = settings[k] === "true";
                    return (
                      <span key={k} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${on ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                        {k.replace("feature", "").replace(/([A-Z])/g, " $1").trim()}: {on ? "ON" : "OFF"}
                      </span>
                    );
                  })}
                </div>
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "featureLandingPage", "featurePublicRegistration", "featureAiWriter",
                "featureSmtpSending", "featureGmailDrafts", "featureQueueSystem", "featureAnalytics",
              ])} label="Save Feature Toggles" />
            </div>
          )}

          {/* ── 18. BACKUP & EXPORT ────────────────────────────────────────── */}
          {activeTab === "backup" && (
            <div className="space-y-6">
              <SectionHeader icon={HardDrive} title="Backup & Restore" color="bg-green-50 text-green-600"
                desc="ZIP package with 8 JSON files — includes password hashes so users log in immediately after migration." />

              {/* ── Full Backup / Restore ─────────────────────────────────── */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Full Platform Backup (ZIP)</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="p-5 rounded-2xl border border-green-200 bg-green-50 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-green-100 flex items-center justify-center">
                        <Archive className="h-5 w-5 text-green-700" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">Download Full Backup</p>
                        <p className="text-xs text-slate-500 mt-0.5">ZIP containing users.json (with password hashes), campaigns, templates, mailboxes, branding, plans & settings.</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {["users.json","campaigns.json","templates.json","mailboxes.json","branding.json","plans.json","settings.json"].map(f => (
                        <span key={f} className="px-2 py-0.5 rounded-md bg-green-100 text-green-800 text-[10px] font-mono">{f}</span>
                      ))}
                    </div>
                    <Button className="w-full rounded-xl gap-2 bg-green-600 hover:bg-green-700 text-white"
                      disabled={creatingBackup}
                      onClick={doFullBackup}>
                      {creatingBackup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {creatingBackup ? "Creating Backup..." : "Download .zip Backup"}
                    </Button>
                  </div>

                  <div className="p-5 rounded-2xl border border-amber-200 bg-amber-50 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center">
                        <RotateCcw className="h-5 w-5 text-amber-700" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">Restore from ZIP</p>
                        <p className="text-xs text-slate-500 mt-0.5">Upload a backup ZIP. Restores all data — password hashes included so users can log in immediately.</p>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-100 border border-amber-200">
                      <p className="text-[11px] text-amber-800 font-medium">✓ Password hashes restored — no reset required</p>
                      <p className="text-[11px] text-amber-700 mt-0.5">✓ Mailbox SMTP credentials preserved</p>
                      <p className="text-[11px] text-amber-700 mt-0.5">✓ Branding & company profiles restored</p>
                    </div>
                    <Button variant="outline" className="w-full rounded-xl gap-2 border-amber-300 text-amber-800 hover:bg-amber-100"
                      disabled={restoring}
                      onClick={doFullRestore}>
                      {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {restoring ? "Restoring..." : "Upload & Restore .zip"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── Export Individual ─────────────────────────────────────── */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Export Individual Data</p>
                <div className="grid sm:grid-cols-3 gap-4">
                  {[
                    { type: "users",     label: "Export Users",     desc: "All user accounts. CSV format.", icon: Users },
                    { type: "campaigns", label: "Export Campaigns", desc: "All campaigns & metadata. CSV format.", icon: Mail },
                    { type: "settings",  label: "Export Settings",  desc: "Platform settings snapshot. JSON format.", icon: Database },
                  ].map(e => (
                    <div key={e.type} className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <e.icon className="h-4 w-4 text-blue-700" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 text-xs">{e.label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{e.desc}</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="w-full rounded-xl gap-2"
                        disabled={exporting === e.type}
                        onClick={() => doExport(e.type)}>
                        {exporting === e.type ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                        {exporting === e.type ? "Exporting..." : "Download"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Import Individual ─────────────────────────────────────── */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Import Individual Data</p>
                <div className="grid sm:grid-cols-3 gap-4">
                  {[
                    { type: "users",     label: "Import Users",     desc: "JSON array of user objects. Upserts by email.", icon: Users,    color: "bg-purple-100 text-purple-700" },
                    { type: "campaigns", label: "Import Campaigns", desc: "JSON array of campaigns. Skips duplicates.", icon: Mail,     color: "bg-indigo-100 text-indigo-700" },
                    { type: "settings",  label: "Import Settings",  desc: "JSON settings object. Overwrites existing keys.", icon: Database, color: "bg-teal-100 text-teal-700"   },
                  ].map(e => (
                    <div key={e.type} className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${e.color}`}>
                          <e.icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 text-xs">{e.label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{e.desc}</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="w-full rounded-xl gap-2"
                        disabled={importing === e.type}
                        onClick={() => doImport(e.type)}>
                        {importing === e.type ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                        {importing === e.type ? "Importing..." : "Upload JSON"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-700 leading-relaxed">
                <span className="font-semibold text-blue-900">Full ZIP backup</span> includes password hashes — users log in immediately after restore with no password reset needed.
                Individual imports (above) do not restore passwords; new users created that way must set a password via the reset flow.
              </div>
            </div>
          )}

          {/* ── 19. MIGRATION VERIFICATION ─────────────────────────────────── */}
          {activeTab === "migration" && (
            <div className="space-y-6">
              <SectionHeader icon={ShieldCheck} title="Migration Verification" color="bg-blue-50 text-blue-600"
                desc="Run this after restoring a backup to verify all data migrated correctly. Use before going live on a new server or domain." />

              {/* Quick actions */}
              <div className="flex flex-wrap gap-3">
                <Button className="gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={verifying} onClick={doMigrationVerify}>
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {verifying ? "Verifying..." : "Run Verification Check"}
                </Button>
                <Button variant="outline" className="gap-2 rounded-xl" onClick={doFullBackup} disabled={creatingBackup}>
                  {creatingBackup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {creatingBackup ? "Preparing..." : "Download Backup First"}
                </Button>
              </div>

              {/* Checklist */}
              {verifyResult ? (
                <div className="space-y-3">
                  <div className={`flex items-center gap-3 p-4 rounded-xl border ${verifyResult.ok ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
                    {verifyResult.ok
                      ? <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                      : <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />}
                    <div>
                      <p className={`font-semibold text-sm ${verifyResult.ok ? "text-green-800" : "text-amber-800"}`}>
                        {verifyResult.ok ? "Migration verified — all checks passed" : "Some checks need attention"}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">Verified at {new Date(verifyResult.verifiedAt).toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    {Object.entries(verifyResult.checks).map(([key, chk]) => {
                      const isOk      = chk.ok;
                      const isPartial = !chk.ok && (chk as any).partial;
                      const isFail    = !chk.ok && !isPartial;
                      return (
                        <div key={key} className={`flex items-start gap-3 p-4 rounded-xl border ${
                          isOk      ? "bg-green-50 border-green-200"
                          : isPartial ? "bg-amber-50 border-amber-200"
                          : "bg-red-50 border-red-200"
                        }`}>
                          <div className="mt-0.5 flex-shrink-0">
                            {isOk
                              ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                              : isPartial
                              ? <AlertTriangle className="h-4 w-4 text-amber-500" />
                              : <AlertCircle className="h-4 w-4 text-red-500" />}
                          </div>
                          <div>
                            <p className={`font-semibold text-xs ${isOk ? "text-green-800" : isPartial ? "text-amber-800" : "text-red-800"}`}>
                              {chk.label}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">{chk.detail}</p>
                          </div>
                          <div className="ml-auto">
                            <span className={`text-sm font-bold tabular-nums ${isOk ? "text-green-700" : isPartial ? "text-amber-700" : "text-red-600"}`}>
                              {chk.count}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <Button variant="outline" size="sm" className="gap-2 rounded-xl w-full" onClick={doMigrationVerify} disabled={verifying}>
                    <RefreshCw className="h-3.5 w-3.5" /> Re-run verification
                  </Button>
                </div>
              ) : (
                <div className="p-8 rounded-2xl border-2 border-dashed border-slate-200 text-center">
                  <ClipboardList className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="font-semibold text-slate-600 text-sm">No verification run yet</p>
                  <p className="text-xs text-slate-400 mt-1">Click "Run Verification Check" above to test your migration.</p>
                </div>
              )}

              {/* Migration guide */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Migration Checklist</p>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                  {[
                    { step: "1", title: "Create backup on source server", desc: "Admin → Settings → Backup → Download .zip Backup" },
                    { step: "2", title: "Install fresh BrokerMAIL on target", desc: "New Replit, VPS, or hosting provider — run database migrations" },
                    { step: "3", title: "Restore the ZIP backup", desc: "Admin → Settings → Backup → Upload & Restore .zip" },
                    { step: "4", title: "Run verification here", desc: "Confirm all users, hashes, templates, mailboxes, and campaigns are present" },
                    { step: "5", title: "Test a user login", desc: "Sign in with an existing user email + original password to confirm hashes work" },
                    { step: "6", title: "Update DNS / redirect traffic", desc: "Point your domain to the new server — users experience no disruption" },
                  ].map(s => (
                    <div key={s.step} className="flex items-start gap-4 p-4">
                      <div className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                        {s.step}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── 20. SUPER ADMIN PROTECTION ─────────────────────────────────── */}
          {activeTab === "superadmin" && (
            <div className="space-y-5">
              <SectionHeader icon={Lock} title="Super Admin Protection" color="bg-red-50 text-red-600"
                desc="Role hierarchy, deletion protection, and audit trail configuration." />

              <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
                <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-800">Changes here affect core admin access controls. Proceed with caution.</p>
              </div>

              <Field label="Super Admin Email" settingsKey="superAdminEmail"
                settings={settings} onChange={set} type="email"
                placeholder="superadmin@yourdomain.com"
                hint="This account cannot be deleted or demoted by other admins." />

              <div className="space-y-3">
                <Toggle label="Prevent Accidental Deletion" danger
                  desc="Blocks admin accounts from deleting themselves or the super admin account."
                  settingsKey="preventAccidentalDelete" settings={settings} onChange={set} />
                <Toggle label="Full Audit Logging"
                  desc="Log all admin actions to the system log with full detail including IP and timestamps."
                  settingsKey="auditAllActions" settings={settings} onChange={set} />
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Role Hierarchy</p>
                <div className="space-y-1">
                  {[
                    { role: "Super Admin", desc: "Full access, cannot be deleted or demoted.", badge: "bg-red-100 text-red-700" },
                    { role: "Admin",       desc: "Full platform management. Cannot touch super admin.", badge: "bg-amber-100 text-amber-700" },
                    { role: "User",        desc: "Standard user access. No admin capabilities.", badge: "bg-slate-100 text-slate-600" },
                  ].map(r => (
                    <div key={r.role} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${r.badge}`}>{r.role}</span>
                      <p className="text-xs text-slate-500">{r.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <SaveBar saving={saving} onSave={() => saveSection([
                "superAdminEmail", "preventAccidentalDelete", "auditAllActions",
              ])} label="Save Super Admin Settings" />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
