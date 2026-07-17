import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, Mail, AlertCircle,
  Building2, Globe, Phone, Hash, Palette, User,
  ImagePlus, Trash2, Eye, LogOut, Sparkles, Shield,
  Zap, Calendar, Lock, Settings2, Unlink,
  CreditCard, HeadphonesIcon, ArrowRight, Server,
  TrendingUp,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

// ── Logo compression: resize to ≤400 px, output PNG (preserves transparency) ──
async function compressLogo(dataUrl: string): Promise<string> {
  if (dataUrl.startsWith("data:image/svg")) return dataUrl;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const maxW = 400;
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxW && dataUrl.length < 300_000) { resolve(dataUrl); return; }
      if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const out = c.toDataURL("image/png");
      resolve(out.length < dataUrl.length ? out : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

interface BrandingData {
  agentName: string; companyName: string; companyTagline: string; companyWebsite: string;
  companyPhone: string; usdot: string; mcNumber: string; accentColor: string;
  useSignature: boolean; logoUrl: string | null;
}

interface BillingData {
  plan: { name: string; slug: string; monthlyEmailLimit: number; smtpAccountsLimit: number; campaignsLimit: number };
  usage: { emailsSentThisMonth: number; smtpAccountsUsed: number; campaignsCount: number };
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Signature Preview ────────────────────────────────────────────────────────
function SignaturePreview({ branding }: { branding: BrandingData }) {
  const accent    = branding.accentColor || "#1d4ed8";
  const agentName = branding.agentName   || "";
  const company   = branding.companyName || "";
  const tagline   = branding.companyTagline || "";
  const phone     = branding.companyPhone || "";
  const website   = branding.companyWebsite || "";
  const usdot     = branding.usdot || "";
  const mc        = branding.mcNumber || "";
  const hasAny    = agentName || company || phone || website || usdot || mc;

  return (
    <div className="rounded-xl border border-border dark:border-slate-700/60 bg-secondary/60 dark:bg-slate-800/40 overflow-hidden shadow-sm">
      {/* Email chrome */}
      <div className="px-3 py-2 border-b border-border dark:border-slate-700/60 flex items-center gap-1.5 bg-secondary/80 dark:bg-slate-800/70">
        <Eye className="h-3 w-3 text-muted-foreground dark:text-slate-400 flex-shrink-0" />
        <span className="text-[10px] font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider">Live Preview</span>
      </div>
      {/* Simulated email fields */}
      <div className="px-4 pt-3 pb-1 space-y-1 border-b border-border/60 dark:border-slate-700/40 text-[11px] text-slate-500">
        <div className="flex gap-2">
          <span className="w-10 text-slate-600 font-medium flex-shrink-0">From:</span>
          <span className="text-muted-foreground dark:text-slate-400">{agentName || "Your Name"} &lt;{branding.agentName ? "you@gmail.com" : "…"}&gt;</span>
        </div>
        <div className="flex gap-2">
          <span className="w-10 text-slate-600 font-medium flex-shrink-0">Subject:</span>
          <span className="text-muted-foreground dark:text-slate-400 italic">Your email subject line…</span>
        </div>
      </div>
      {/* Signature body */}
      <div className="px-4 py-3 text-sm font-sans leading-relaxed">
        {!hasAny ? (
          <p className="text-xs text-slate-500 italic py-2">Fill in company details to preview your email signature.</p>
        ) : (
          <>
            <p className="text-slate-500 text-xs mb-3">Best regards,</p>
            <div className="border-l-2 pl-3" style={{ borderColor: accent }}>
              {agentName && <p className="font-semibold text-foreground dark:text-slate-100 text-sm leading-tight">{agentName}</p>}
              {company && (
                <p className="text-muted-foreground dark:text-slate-400 text-xs mt-0.5">
                  {company}
                  {tagline && <span className="text-slate-500"> — {tagline}</span>}
                </p>
              )}
              {phone && <p className="text-slate-500 text-xs mt-1">{phone}</p>}
              {website && (
                <a
                  href={/^https?:\/\//.test(website) ? website : `https://${website}`}
                  className="text-xs block mt-0.5 hover:underline transition-colors"
                  style={{ color: accent }}
                  target="_blank" rel="noopener noreferrer"
                >
                  {website}
                </a>
              )}
              {(usdot || mc) && (
                <p className="text-slate-500 text-[10px] mt-1.5 pt-1.5 border-t border-border/60 dark:border-slate-700/40">
                  {[usdot && `USDOT #${usdot}`, mc && `MC #${mc}`].filter(Boolean).join(" · ")}
                </p>
              )}
              {branding.logoUrl && (
                <div className="pt-2 mt-1">
                  <img src={branding.logoUrl} alt="Logo" className="h-7 object-contain opacity-90" />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Toggle switch ────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label, description }: {
  checked: boolean; onChange: () => void; label: string; description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3.5">
      <div className="min-w-0 pr-4">
        <p className="text-sm font-medium text-foreground dark:text-slate-200">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <button
        type="button"
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
          checked ? "bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.35)]" : "bg-secondary dark:bg-slate-700"
        }`}
        role="switch"
        aria-checked={checked}
      >
        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

// ── Shared card header ───────────────────────────────────────────────────────
function CardHeader({
  icon: Icon, iconColor, label, subtitle, badge,
}: {
  icon: React.ElementType; iconColor: string; label: string; subtitle?: string; badge?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-4 border-b border-border dark:border-slate-800 flex items-center gap-3">
      <div className={`flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 ${iconColor}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground dark:text-slate-100">{label}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {badge}
    </div>
  );
}

export default function Settings() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Gmail
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [disconnecting, setDisconnecting]     = useState(false);
  const [gmailError, setGmailError]           = useState<string | null>(null);

  // Branding
  const [branding, setBranding] = useState<BrandingData>({
    agentName: "", companyName: "", companyTagline: "", companyWebsite: "", companyPhone: "",
    usdot: "", mcNumber: "", accentColor: "", useSignature: false, logoUrl: null,
  });
  const [isSavingBranding, setIsSavingBranding] = useState(false);
  const [brandingSaved, setBrandingSaved]       = useState(false);

  // Logo
  const [logoPreview, setLogoPreview]       = useState<string | null>(null);
  const [isUploadingLogo, setUploadingLogo] = useState(false);
  const [isRemovingLogo, setRemovingLogo]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Billing
  const [billing, setBilling] = useState<BillingData | null>(null);

  const params              = new URLSearchParams(window.location.search);
  const gmailConnectedParam = params.get("gmail") === "connected";
  const oauthError          = params.get("error");

  useEffect(() => {
    fetch("/api/users/branding", { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => {
        setBranding(d);
        if (d.logoUrl) setLogoPreview(d.logoUrl);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/billing/subscription", { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setBilling(d))
      .catch(() => {});
  }, []);

  async function handleConnectGmail() {
    setConnectingGmail(true); setGmailError(null);
    try {
      const res = await fetch("/api/gmail/connect", { headers: getAuthHeaders() });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).error ?? `Request failed (${res.status})`); }
      const { authUrl } = await res.json();
      window.location.href = authUrl;
    } catch (err: unknown) {
      setGmailError(err instanceof Error ? err.message : "Failed to start Gmail connect");
      setConnectingGmail(false);
    }
  }

  async function handleDisconnectGmail() {
    setDisconnecting(true); setGmailError(null);
    try {
      const res = await fetch("/api/gmail/disconnect", { method: "POST", headers: getAuthHeaders() });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).error ?? `Request failed (${res.status})`); }
      await queryClient.invalidateQueries();
      window.location.reload();
    } catch (err: unknown) {
      setGmailError(err instanceof Error ? err.message : "Failed to disconnect Gmail");
    } finally { setDisconnecting(false); }
  }

  async function handleSaveBranding(e: React.FormEvent) {
    e.preventDefault();
    setIsSavingBranding(true); setBrandingSaved(false);
    try {
      const { logoUrl: _logo, ...brandingWithoutLogo } = branding;
      const res = await fetch("/api/users/branding", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(brandingWithoutLogo),
      });
      if (!res.ok) throw new Error("Save failed");
      setBrandingSaved(true);
      toast({ title: "Branding saved ✓", description: "Your settings will appear in all outgoing emails." });
      setTimeout(() => setBrandingSaved(false), 3000);
    } catch {
      toast({ variant: "destructive", title: "Save failed", description: "Please try again." });
    } finally { setIsSavingBranding(false); }
  }

  function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: "Invalid file", description: "Please select an image file." });
      return;
    }
    const reader = new FileReader();
    reader.onload = async ev => {
      const raw = ev.target?.result as string;
      if (!raw) return;
      const dataUrl = await compressLogo(raw);
      setLogoPreview(dataUrl);
      await uploadLogo(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function uploadLogo(dataUrl: string) {
    setUploadingLogo(true);
    try {
      const res = await fetch("/api/users/logo", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ logoDataUrl: dataUrl }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error ?? "Upload failed");
      }
      const d = await res.json();
      setBranding(b => ({ ...b, logoUrl: d.logoUrl }));
      toast({ title: "Logo uploaded", description: "Your logo will appear in email headers." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Upload failed", description: err.message });
      setLogoPreview(branding.logoUrl);
    } finally { setUploadingLogo(false); }
  }

  async function handleRemoveLogo() {
    setRemovingLogo(true);
    try {
      const res = await fetch("/api/users/logo", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ remove: true }),
      });
      if (!res.ok) throw new Error("Remove failed");
      setLogoPreview(null);
      setBranding(b => ({ ...b, logoUrl: null }));
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast({ title: "Logo removed" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to remove logo", description: err.message });
    } finally { setRemovingLogo(false); }
  }

  // ── Derived display values ───────────────────────────────────────────────────
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;
  const initials = user?.name
    ? user.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  const currentSender = branding.agentName || user?.name || null;

  // ── Plan usage ───────────────────────────────────────────────────────────────
  const emailsUsed  = billing?.usage.emailsSentThisMonth ?? null;
  const emailsLimit = billing?.plan.monthlyEmailLimit ?? null;
  const usagePct = (emailsUsed !== null && emailsLimit !== null && emailsLimit > 0)
    ? Math.min(100, Math.round((emailsUsed / emailsLimit) * 100))
    : null;
  const planName = billing?.plan.name ?? null;

  // ── Shared field label ───────────────────────────────────────────────────────
  function FL({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
    return (
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-1.5">
        <Icon className="h-3 w-3 text-slate-500" />
        {children}
      </label>
    );
  }

  return (
    <div className="max-w-6xl pb-16 space-y-6">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="pb-5 border-b border-border dark:border-slate-800">
        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Settings</h1>
        <p className="text-muted-foreground dark:text-slate-400 mt-1.5 text-sm">Manage your account, branding, preferences, and integrations.</p>
      </div>

      {/* ── Overview stats row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

        <div className="group rounded-xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 p-4 flex items-start gap-3 hover:border-border dark:hover:border-slate-700 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 cursor-default">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10 border border-green-500/20 flex-shrink-0 group-hover:bg-green-500/15 transition-colors">
            <Mail className="h-4 w-4 text-green-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Gmail</p>
            {user?.gmailConnected ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-green-400">Connected</span>
              </div>
            ) : (
              <span className="text-sm font-semibold text-muted-foreground dark:text-slate-400 mt-0.5 block">Not connected</span>
            )}
          </div>
        </div>

        <div className="group rounded-xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 p-4 flex items-start gap-3 hover:border-border dark:hover:border-slate-700 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 cursor-default">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20 flex-shrink-0 group-hover:bg-blue-500/15 transition-colors">
            <Building2 className="h-4 w-4 text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Company</p>
            <p className="text-sm font-semibold text-foreground dark:text-slate-200 mt-0.5 truncate">
              {branding.companyName || <span className="text-slate-500 font-normal italic">Not configured</span>}
            </p>
          </div>
        </div>

        <div className="group rounded-xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 p-4 flex items-start gap-3 hover:border-border dark:hover:border-slate-700 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 cursor-default">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 border border-violet-500/20 flex-shrink-0 group-hover:bg-violet-500/15 transition-colors">
            <Palette className="h-4 w-4 text-violet-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Accent Color</p>
            <div className="flex items-center gap-2 mt-0.5">
              <div
                className="h-4 w-4 rounded-full border-2 border-border/80 dark:border-slate-600 flex-shrink-0"
                style={{ backgroundColor: branding.accentColor || "#1d4ed8" }}
              />
              <span className="text-sm font-mono font-semibold text-foreground dark:text-slate-200 truncate">
                {branding.accentColor || "#1d4ed8"}
              </span>
            </div>
          </div>
        </div>

        <div className="group rounded-xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 p-4 flex items-start gap-3 hover:border-border dark:hover:border-slate-700 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 cursor-default">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 flex-shrink-0 group-hover:bg-amber-500/15 transition-colors">
            <Calendar className="h-4 w-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Member Since</p>
            <p className="text-sm font-semibold text-foreground dark:text-slate-200 mt-0.5">{memberSince ?? <span className="text-slate-500 italic font-normal text-xs">Not configured</span>}</p>
          </div>
        </div>

      </div>

      {/* ── Main grid: content + sidebar ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-[1fr_268px] gap-6 items-start">

        {/* ── Main content column ───────────────────────────────────────────── */}
        <div className="space-y-6 min-w-0">

          {/* ── Profile + Gmail 2-column ──────────────────────────────────── */}
          <div className="grid lg:grid-cols-2 gap-6">

            {/* ── My Profile shortcut ──────────────────────────────────────── */}
            <Link href="/profile">
              <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden cursor-pointer group hover:border-blue-500/40 dark:hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-200">
                {/* Gradient accent */}
                <div className="h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600" />
                <div className="p-6">
                  {/* Avatar row */}
                  <div className="flex items-center gap-4 mb-5">
                    <div className="relative flex-shrink-0">
                      {user?.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-border dark:ring-slate-700" />
                      ) : (
                        <div className="h-14 w-14 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg ring-2 ring-border dark:ring-slate-700 shadow-lg">
                          {initials}
                        </div>
                      )}
                      <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-green-500 border-2 border-card dark:border-slate-900" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground dark:text-white text-base leading-tight">{user?.name}</p>
                      <p className="text-sm text-muted-foreground dark:text-slate-400 mt-0.5 truncate">{user?.email}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 border border-blue-500/20 text-blue-400">
                          <Zap className="h-2.5 w-2.5" />
                          {user?.role === "admin" ? "Admin" : "Agent"}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/10 border border-green-500/20 text-green-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                          Active
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="flex items-center justify-between rounded-xl bg-secondary/60 dark:bg-slate-800/50 border border-border dark:border-slate-700/60 px-4 py-3 group-hover:bg-blue-500/5 group-hover:border-blue-500/20 transition-all duration-200">
                    <div>
                      <p className="text-sm font-semibold text-foreground dark:text-slate-100">My Profile</p>
                      <p className="text-xs text-slate-500 mt-0.5">Name, password, security &amp; preferences</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all duration-200 flex-shrink-0" />
                  </div>
                </div>
              </div>
            </Link>

            {/* ── Gmail Integration ──────────────────────────────────────────── */}
            <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
              <div className="px-6 py-4 border-b border-border dark:border-slate-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 border border-border dark:border-slate-700 flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" aria-hidden="true">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground dark:text-slate-100">Gmail Integration</p>
                    <p className="text-xs text-slate-500 mt-0.5">Google Workspace &amp; personal accounts</p>
                  </div>
                </div>
                {user?.gmailConnected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/10 border border-green-500/25 text-green-400 flex-shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-muted dark:bg-slate-700/60 border border-border/80 dark:border-slate-600 text-muted-foreground dark:text-slate-400 flex-shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                    Not connected
                  </span>
                )}
              </div>

              <div className="p-6 space-y-4">

                {/* Account rows */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-xl border border-border dark:border-slate-700/60 bg-secondary/50 dark:bg-slate-800/40 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Google Account</p>
                      <p className="text-sm font-medium text-foreground dark:text-slate-200 truncate">
                        {user?.gmailConnected ? (user.gmailEmail ?? "Connected") : <span className="text-slate-500 italic">No account connected</span>}
                      </p>
                    </div>
                    {user?.gmailConnected && (
                      <span className="ml-3 flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 border border-green-500/20 text-green-400">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl border border-border dark:border-slate-700/60 bg-secondary/50 dark:bg-slate-800/40 px-4 py-3">
                    <Lock className="h-3.5 w-3.5 text-blue-400/70 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground dark:text-slate-300">OAuth 2.0 Secured</p>
                      <p className="text-[10px] text-slate-500">Credentials are never stored — Google handles authentication directly.</p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  {user?.gmailConnected && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDisconnectGmail}
                      disabled={disconnecting}
                      className="flex-1 h-9 text-xs rounded-xl border-red-900/50 text-red-400 hover:bg-red-950/30 hover:border-red-800 bg-transparent transition-all duration-200"
                    >
                      {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Unlink className="h-3.5 w-3.5 mr-1.5" />Disconnect</>}
                    </Button>
                  )}
                  <Button
                    variant={user?.gmailConnected ? "outline" : "default"}
                    size="sm"
                    onClick={handleConnectGmail}
                    disabled={connectingGmail}
                    className={`h-9 text-xs rounded-xl flex-1 transition-all duration-200 ${user?.gmailConnected ? "bg-transparent border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-foreground dark:text-slate-200" : ""}`}
                  >
                    {connectingGmail
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Connecting…</>
                      : user?.gmailConnected ? "Reconnect" : "Connect Gmail"}
                  </Button>
                </div>

                {/* Feature checklist */}
                <div className="space-y-1.5 pt-1">
                  {[
                    "Send emails directly from your Gmail account",
                    "Create drafts — reviewed before sending",
                    "Secure OAuth — no passwords stored",
                    "Works with all Google Workspace accounts",
                  ].map(f => (
                    <div key={f} className="flex items-center gap-2.5">
                      <div className="h-4 w-4 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />
                      </div>
                      <span className="text-xs text-muted-foreground dark:text-slate-400">{f}</span>
                    </div>
                  ))}
                </div>

                {/* Status banners */}
                {gmailConnectedParam && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-green-950/40 border border-green-900/50 text-green-400 text-xs font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                    Gmail connected successfully.
                  </div>
                )}
                {(gmailError || oauthError) && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950/30 border border-red-900/50 text-red-400 text-xs font-medium">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {gmailError ?? (oauthError === "oauth_denied"
                      ? "You denied access. Please try again."
                      : "Gmail connection failed. Please try again.")}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── Branding ──────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
            <CardHeader
              icon={Building2}
              iconColor="bg-blue-500/15 border border-blue-500/20 text-blue-400"
              label="Branding"
              subtitle="Customize how your brand appears in every outgoing email."
            />

            <form onSubmit={handleSaveBranding}>
              <div className="p-6 lg:p-8">
                <div className="grid lg:grid-cols-3 gap-8">

                  {/* COL 1 — Logo ────────────────────────────────────────────── */}
                  <div className="space-y-4">
                    <p className="text-xs font-semibold text-muted-foreground dark:text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                      <ImagePlus className="h-3.5 w-3.5 text-violet-400" /> Company Logo
                    </p>

                    {/* Drop zone — larger */}
                    <label
                      className="relative rounded-2xl border-2 border-dashed border-border dark:border-slate-700 bg-secondary/50 dark:bg-slate-800/40 flex items-center justify-center cursor-pointer hover:border-border/80 dark:hover:border-slate-600 hover:bg-secondary/80 dark:hover:bg-slate-800/60 transition-all duration-200 group"
                      style={{ minHeight: "192px" }}
                    >
                      <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={handleLogoFileChange} />
                      {isUploadingLogo && (
                        <div className="absolute inset-0 bg-card/80 dark:bg-slate-900/80 flex items-center justify-center z-10 rounded-2xl">
                          <Loader2 className="h-7 w-7 animate-spin text-blue-400" />
                        </div>
                      )}
                      {logoPreview ? (
                        <img src={logoPreview} alt="Logo" className="max-h-28 max-w-[180px] object-contain p-4" />
                      ) : (
                        <div className="flex flex-col items-center gap-3 text-slate-600 group-hover:text-slate-500 transition-colors p-8">
                          <div className="h-12 w-12 rounded-2xl bg-muted dark:bg-slate-700/60 border border-border/80 dark:border-slate-600/60 flex items-center justify-center group-hover:border-slate-500/60 transition-colors">
                            <ImagePlus className="h-5 w-5" />
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-medium text-muted-foreground dark:text-slate-400">Click to upload</p>
                            <p className="text-[10px] text-slate-600 mt-0.5">PNG, JPG, or SVG · Max 600 KB</p>
                          </div>
                        </div>
                      )}
                    </label>

                    <div className="flex gap-2">
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploadingLogo}
                        className="flex-1 h-8 text-xs rounded-xl bg-transparent border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-muted-foreground dark:text-slate-300 transition-all duration-200"
                      >
                        {isUploadingLogo
                          ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Uploading…</>
                          : <><ImagePlus className="h-3 w-3 mr-1" />{logoPreview ? "Change Logo" : "Upload Logo"}</>}
                      </Button>
                      {logoPreview && (
                        <Button
                          type="button" variant="ghost" size="sm"
                          onClick={handleRemoveLogo}
                          disabled={isRemovingLogo || isUploadingLogo}
                          className="h-8 w-8 p-0 rounded-xl text-red-400 hover:bg-red-950/30 hover:text-red-300 transition-all duration-200"
                        >
                          {isRemovingLogo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      )}
                    </div>

                    <p className="text-[11px] text-amber-500/70 leading-relaxed">Gmail may not display inline images in all cases.</p>
                  </div>

                  {/* COL 2 — Company Details ────────────────────────────────── */}
                  <div className="space-y-3.5">
                    <p className="text-xs font-semibold text-muted-foreground dark:text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                      <Building2 className="h-3.5 w-3.5 text-blue-400" /> Company Details
                    </p>

                    <div>
                      <FL icon={Building2}>Company Name</FL>
                      <Input value={branding.companyName} onChange={e => setBranding(b => ({ ...b, companyName: e.target.value }))}
                        placeholder="e.g. Vertex Car Shipping"
                        className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors" />
                    </div>
                    <div>
                      <FL icon={Sparkles}>Tagline / Slogan</FL>
                      <Input value={branding.companyTagline} onChange={e => setBranding(b => ({ ...b, companyTagline: e.target.value }))}
                        placeholder="e.g. Nationwide Vehicle Shipping"
                        className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors" />
                    </div>
                    <div>
                      <FL icon={Globe}>Website</FL>
                      <Input value={branding.companyWebsite} onChange={e => setBranding(b => ({ ...b, companyWebsite: e.target.value }))}
                        placeholder="e.g. www.yourcompany.com"
                        className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors" />
                    </div>
                    <div>
                      <FL icon={Phone}>Phone</FL>
                      <Input value={branding.companyPhone} onChange={e => setBranding(b => ({ ...b, companyPhone: e.target.value }))}
                        placeholder="e.g. (555) 123-4567"
                        className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <FL icon={Shield}>USDOT #</FL>
                        <Input value={branding.usdot} onChange={e => setBranding(b => ({ ...b, usdot: e.target.value }))}
                          placeholder="1234567"
                          className="rounded-xl h-9 text-sm font-mono bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors" />
                      </div>
                      <div>
                        <FL icon={Hash}>MC #</FL>
                        <Input value={branding.mcNumber} onChange={e => setBranding(b => ({ ...b, mcNumber: e.target.value }))}
                          placeholder="987654"
                          className="rounded-xl h-9 text-sm font-mono bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors" />
                      </div>
                    </div>
                    <div>
                      <FL icon={Palette}>Accent Color</FL>
                      <div className="flex gap-2">
                        <input type="color"
                          value={branding.accentColor || "#1d4ed8"}
                          onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                          className="h-9 w-10 rounded-xl border border-border dark:border-slate-700 cursor-pointer bg-secondary/70 dark:bg-slate-800/60 p-1 flex-shrink-0" />
                        <Input value={branding.accentColor}
                          onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                          placeholder="#1d4ed8"
                          className="rounded-xl h-9 text-sm font-mono bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors" />
                      </div>
                    </div>
                    <div>
                      <FL icon={User}>Email (From Name)</FL>
                      <Input value={branding.agentName} onChange={e => setBranding(b => ({ ...b, agentName: e.target.value }))}
                        placeholder="e.g. Frank Miller"
                        className="rounded-xl h-9 text-sm bg-secondary/70 dark:bg-slate-800/60 border-border dark:border-slate-700 focus:border-blue-500/60 transition-colors" />
                      <p className="text-[11px] text-slate-500 mt-1.5">Shown as the sender name. Falls back to CSV agent_name column.</p>
                    </div>
                  </div>

                  {/* COL 3 — Signature Preview ──────────────────────────────── */}
                  <div className="space-y-3 flex flex-col">
                    <p className="text-xs font-semibold text-muted-foreground dark:text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                      <Eye className="h-3.5 w-3.5 text-emerald-400" /> Signature Preview
                    </p>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Live preview of your email signature. Updates instantly as you type.
                    </p>
                    <div className="flex-1">
                      <SignaturePreview branding={branding} />
                    </div>
                  </div>

                </div>
              </div>

              {/* Save footer */}
              <div className="px-6 py-4 bg-card/60 dark:bg-slate-900/60 border-t border-border dark:border-slate-800 flex items-center gap-3">
                <Button
                  type="submit"
                  disabled={isSavingBranding}
                  className="rounded-xl h-9 px-6 font-medium gap-2 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30 transition-all duration-200"
                >
                  {isSavingBranding
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
                    : "Save Branding"}
                </Button>
                {brandingSaved && (
                  <span className="flex items-center gap-1.5 text-sm text-green-400 font-medium">
                    <CheckCircle2 className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>
            </form>
          </div>

          {/* ── Sending Configuration ────────────────────────────────────── */}
          <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
            <CardHeader
              icon={Settings2}
              iconColor="bg-indigo-500/15 border border-indigo-500/20 text-indigo-400"
              label="Sending Configuration"
              subtitle="Your active sending accounts and signature behavior."
            />

            <div className="p-6">
              <div className="grid lg:grid-cols-2 gap-6">

                {/* LEFT — Current Sending Account */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-3">Current Sending Accounts</p>
                  <div className="space-y-2">

                    {/* Gmail */}
                    <div className="flex items-center gap-3 rounded-xl border border-border dark:border-slate-700/60 bg-secondary/40 dark:bg-slate-800/30 px-4 py-3.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-border dark:border-slate-700 flex-shrink-0">
                        <svg viewBox="0 0 24 24" className="h-[13px] w-[13px]" aria-hidden="true">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider leading-tight">Gmail</p>
                        <p className="text-sm font-medium text-foreground dark:text-slate-200 mt-0.5 truncate">
                          {user?.gmailConnected
                            ? (user.gmailEmail ?? "Connected")
                            : <span className="text-slate-500 italic text-xs">Not connected</span>}
                        </p>
                      </div>
                      {user?.gmailConnected ? (
                        <span className="flex-shrink-0 h-2 w-2 rounded-full bg-green-400" />
                      ) : (
                        <span className="flex-shrink-0 h-2 w-2 rounded-full bg-slate-600" />
                      )}
                    </div>

                    {/* SMTP */}
                    <div className="flex items-center gap-3 rounded-xl border border-border dark:border-slate-700/60 bg-secondary/40 dark:bg-slate-800/30 px-4 py-3.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted dark:bg-slate-700/60 border border-border dark:border-slate-700 flex-shrink-0">
                        <Server className="h-3.5 w-3.5 text-muted-foreground dark:text-slate-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider leading-tight">SMTP</p>
                        <p className="text-sm font-medium text-foreground dark:text-slate-200 mt-0.5">
                          {billing?.usage.smtpAccountsUsed
                            ? `${billing.usage.smtpAccountsUsed} active mailbox${billing.usage.smtpAccountsUsed !== 1 ? "es" : ""}`
                            : <span className="text-slate-500 italic text-xs">No mailboxes configured</span>}
                        </p>
                      </div>
                      <span className={`flex-shrink-0 h-2 w-2 rounded-full ${(billing?.usage.smtpAccountsUsed ?? 0) > 0 ? "bg-green-400" : "bg-slate-600"}`} />
                    </div>

                    {/* Current Sender */}
                    <div className="flex items-center gap-3 rounded-xl border border-border dark:border-slate-700/60 bg-secondary/40 dark:bg-slate-800/30 px-4 py-3.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20 flex-shrink-0">
                        <User className="h-3.5 w-3.5 text-blue-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider leading-tight">Current Sender</p>
                        <p className="text-sm font-medium text-foreground dark:text-slate-200 mt-0.5 truncate">{currentSender ?? <span className="text-slate-500 italic text-xs">Not configured</span>}</p>
                      </div>
                    </div>

                  </div>
                </div>

                {/* RIGHT — Behavior */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground dark:text-slate-400 uppercase tracking-wider mb-3">Behavior</p>
                  <div className="rounded-xl border border-border dark:border-slate-700/60 bg-secondary/40 dark:bg-slate-800/30 px-4 divide-y divide-border dark:divide-slate-700/60">
                    <Toggle
                      checked={branding.useSignature}
                      onChange={() => setBranding(b => ({ ...b, useSignature: !b.useSignature }))}
                      label="Automatic Signature"
                      description={branding.useSignature
                        ? "Appended to every outgoing email"
                        : "Template content sent as written"}
                    />
                  </div>
                  {branding.useSignature && (
                    <p className="text-[11px] text-slate-500 mt-2.5 leading-relaxed">
                      Signature is built from your Branding settings above. Edit the Branding section to update it.
                    </p>
                  )}
                </div>

              </div>
            </div>
          </div>

          {/* ── Danger Zone ─────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-red-900/40 bg-card dark:bg-slate-900 overflow-hidden">
            <div className="px-6 py-4 border-b border-red-900/40 flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 flex-shrink-0">
                <LogOut className="h-3.5 w-3.5 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground dark:text-slate-100">Danger Zone</p>
                <p className="text-xs text-slate-500 mt-0.5">Actions that affect your session.</p>
              </div>
            </div>

            <div className="p-6">
              <div className="flex items-center justify-between rounded-xl border border-border dark:border-slate-700/60 bg-secondary/40 dark:bg-slate-800/30 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-foreground dark:text-slate-200">Sign Out</p>
                  <p className="text-xs text-slate-500 mt-0.5">Sign out of BrokerMAIL on this device.</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={logout}
                  className="h-9 px-4 text-xs font-semibold rounded-xl border-red-900/60 text-red-400 hover:bg-red-950/30 hover:border-red-800 hover:text-red-300 bg-transparent transition-all duration-200 flex-shrink-0 ml-4"
                >
                  <LogOut className="h-3.5 w-3.5 mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>

        </div>
        {/* end main column */}

        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-4">

          {/* ── Plan Card ─────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-border dark:border-slate-800 flex items-center gap-2.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/20 flex-shrink-0">
                <CreditCard className="h-3 w-3 text-amber-400" />
              </div>
              <p className="text-sm font-semibold text-foreground dark:text-slate-100">Current Plan</p>
            </div>

            <div className="p-5 space-y-4">
              {/* Plan name */}
              <div className="flex items-center justify-between">
                <div>
                  {planName ? (
                    <p className="text-base font-bold text-foreground dark:text-white">{planName}</p>
                  ) : (
                    <div className="h-5 w-24 rounded bg-muted dark:bg-slate-800 animate-pulse" />
                  )}
                  <p className="text-xs text-slate-500 mt-0.5">This billing period</p>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Zap className="h-2.5 w-2.5" />
                  Active
                </span>
              </div>

              {/* Email usage */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground dark:text-slate-400 flex items-center gap-1.5">
                    <TrendingUp className="h-3 w-3 text-slate-500" />
                    Emails sent
                  </span>
                  {emailsUsed !== null && emailsLimit !== null ? (
                    <span className="text-foreground dark:text-slate-200 font-semibold tabular-nums">
                      {emailsUsed.toLocaleString()} / {emailsLimit === -1 ? "∞" : emailsLimit.toLocaleString()}
                    </span>
                  ) : (
                    <div className="h-3.5 w-20 rounded bg-muted dark:bg-slate-800 animate-pulse" />
                  )}
                </div>
                {/* Progress bar */}
                <div className="h-1.5 w-full rounded-full bg-secondary dark:bg-slate-800 overflow-hidden">
                  {usagePct !== null && (
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${usagePct}%`,
                        backgroundColor: usagePct >= 90 ? "#f87171" : usagePct >= 70 ? "#fb923c" : "#3b82f6",
                      }}
                    />
                  )}
                </div>
                {usagePct !== null && (
                  <p className="text-[10px] text-slate-500 text-right">{usagePct}% used</p>
                )}
              </div>

              {/* Manage Plan CTA */}
              <Link href="/plans">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-9 text-xs rounded-xl border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-foreground dark:text-slate-200 bg-transparent transition-all duration-200 group"
                >
                  Manage Plan
                  <ArrowRight className="h-3 w-3 ml-auto group-hover:translate-x-0.5 transition-transform duration-200" />
                </Button>
              </Link>
            </div>
          </div>

          {/* ── Need Help Card ────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border dark:border-slate-800 bg-card dark:bg-slate-900 overflow-hidden">
            <div className="p-5 space-y-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20">
                <HeadphonesIcon className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground dark:text-slate-100">Need Help?</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">Our support team is here. Open a ticket and we'll get back to you.</p>
              </div>
              <Link href="/support">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-9 text-xs rounded-xl border-border dark:border-slate-700 hover:bg-secondary dark:hover:bg-slate-800 text-foreground dark:text-slate-200 bg-transparent transition-all duration-200"
                >
                  Contact Support
                </Button>
              </Link>
            </div>
          </div>

        </div>
        {/* end sidebar */}

      </div>
    </div>
  );
}
