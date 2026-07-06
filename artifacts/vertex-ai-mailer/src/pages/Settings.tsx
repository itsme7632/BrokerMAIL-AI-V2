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
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

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
    <div className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700/60 flex items-center gap-1.5 bg-slate-800/80">
        <Eye className="h-3 w-3 text-slate-400 flex-shrink-0" />
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Live Preview</span>
      </div>
      <div className="px-4 py-3 text-sm font-sans leading-relaxed">
        {!hasAny ? (
          <p className="text-xs text-slate-500 italic">Fill in company details to preview your email signature.</p>
        ) : (
          <>
            <p className="text-slate-500 text-xs mb-2">Best regards,</p>
            <div className="border-t border-slate-700/50 pt-2.5 space-y-0.5">
              {agentName && <p className="font-semibold text-slate-100 text-sm">{agentName}</p>}
              {company && (
                <p className="text-slate-400 text-xs">
                  {company}
                  {tagline && <span className="text-slate-500 ml-1">— {tagline}</span>}
                </p>
              )}
              {phone && <p className="text-slate-500 text-xs">{phone}</p>}
              {website && (
                <a
                  href={/^https?:\/\//.test(website) ? website : `https://${website}`}
                  className="text-xs block hover:underline transition-colors"
                  style={{ color: accent }}
                  target="_blank" rel="noopener noreferrer"
                >
                  {website}
                </a>
              )}
              {(usdot || mc) && (
                <p className="text-slate-500 text-xs pt-0.5">
                  {[usdot && `USDOT #${usdot}`, mc && `MC #${mc}`].filter(Boolean).join(" · ")}
                </p>
              )}
              {branding.logoUrl && (
                <div className="pt-2.5 border-t border-slate-700/40 mt-1.5">
                  <img src={branding.logoUrl} alt="Logo" className="h-6 object-contain opacity-90" />
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
    <div className="flex items-center justify-between py-3">
      <div className="min-w-0 pr-4">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <button
        type="button"
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
          checked ? "bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.35)]" : "bg-slate-700"
        }`}
        role="switch"
        aria-checked={checked}
      >
        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

// ── "Coming Soon" preference row ─────────────────────────────────────────────
function ComingSoonRow({ label, description }: { label: string; description?: string }) {
  return (
    <div className="flex items-center justify-between py-3 opacity-50">
      <div className="min-w-0 pr-4">
        <p className="text-sm font-medium text-slate-300">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <span className="flex-shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-slate-700/80 border border-slate-600/60 text-slate-400">
        Soon
      </span>
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
    : "—";
  const initials = user?.name
    ? user.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  // ── Shared field label ───────────────────────────────────────────────────────
  function FL({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
    return (
      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
        <Icon className="h-3 w-3 text-slate-500" />
        {children}
      </label>
    );
  }

  // ── Shared card header ───────────────────────────────────────────────────────
  function CardHeader({
    icon: Icon, iconColor, label, subtitle,
  }: {
    icon: React.ElementType; iconColor: string; label: string; subtitle?: string;
  }) {
    return (
      <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-3">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 ${iconColor}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100">{label}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6 pb-16">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="pb-5 border-b border-slate-800">
        <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
        <p className="text-slate-400 mt-1.5 text-sm">Manage your account, branding, preferences, and integrations.</p>
      </div>

      {/* ── Overview stats row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10 border border-green-500/20 flex-shrink-0">
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
              <span className="text-sm font-semibold text-slate-400 mt-0.5 block">Not connected</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20 flex-shrink-0">
            <Building2 className="h-4 w-4 text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Company</p>
            <p className="text-sm font-semibold text-slate-200 mt-0.5 truncate">
              {branding.companyName || "—"}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 border border-violet-500/20 flex-shrink-0">
            <Palette className="h-4 w-4 text-violet-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Accent Color</p>
            <div className="flex items-center gap-2 mt-0.5">
              <div
                className="h-4 w-4 rounded-full border-2 border-slate-600 flex-shrink-0"
                style={{ backgroundColor: branding.accentColor || "#1d4ed8" }}
              />
              <span className="text-sm font-mono font-semibold text-slate-200 truncate">
                {branding.accentColor || "#1d4ed8"}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 flex-shrink-0">
            <Calendar className="h-4 w-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Member Since</p>
            <p className="text-sm font-semibold text-slate-200 mt-0.5">{memberSince}</p>
          </div>
        </div>

      </div>

      {/* ── Profile + Gmail 2-column ─────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6">

        {/* ── Profile ─────────────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
          <CardHeader icon={User} iconColor="bg-slate-700/80 text-slate-300" label="Profile Information" />
          <div className="p-6 space-y-5">
            {/* Avatar + identity */}
            <div className="flex items-center gap-4">
              <div className="relative flex-shrink-0">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-slate-700" />
                ) : (
                  <div className="h-14 w-14 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-lg ring-2 ring-slate-700 shadow-lg">
                    {initials}
                  </div>
                )}
                <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-green-500 border-2 border-slate-900" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white text-base leading-tight">{user?.name}</p>
                <p className="text-sm text-slate-400 mt-0.5 truncate">{user?.email}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 border border-blue-500/20 text-blue-400">
                    <Zap className="h-2.5 w-2.5" />
                    {user?.role === "admin" ? "Admin" : "Agent"}
                  </span>
                  {user?.gmailConnected && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/10 border border-green-500/20 text-green-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                      Gmail
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Detail grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-800/50 border border-slate-700/60 px-3.5 py-3">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Company</p>
                <p className="text-sm text-slate-200 font-medium truncate">{branding.companyName || "—"}</p>
              </div>
              <div className="rounded-xl bg-slate-800/50 border border-slate-700/60 px-3.5 py-3">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Phone</p>
                <p className="text-sm text-slate-200 font-medium truncate">{branding.companyPhone || "—"}</p>
              </div>
              <div className="rounded-xl bg-slate-800/50 border border-slate-700/60 px-3.5 py-3">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Member Since</p>
                <p className="text-sm text-slate-200 font-medium">{memberSince}</p>
              </div>
              <div className="rounded-xl bg-slate-800/50 border border-slate-700/60 px-3.5 py-3">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Gmail</p>
                <p className="text-sm font-medium truncate" style={{ color: user?.gmailConnected ? "#4ade80" : "#94a3b8" }}>
                  {user?.gmailConnected ? "Connected" : "Not connected"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Gmail Integration ────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 border border-slate-700 flex-shrink-0">
                <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-100">Gmail Integration</p>
                <p className="text-xs text-slate-500 mt-0.5">Connect your Google account to send emails.</p>
              </div>
            </div>
            {user?.gmailConnected ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/10 border border-green-500/25 text-green-400 flex-shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-700/60 border border-slate-600 text-slate-400 flex-shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                Not connected
              </span>
            )}
          </div>

          <div className="p-6 space-y-4">

            {/* Account + OAuth rows */}
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Google Account</p>
                  <p className="text-sm font-medium text-slate-200 truncate">
                    {user?.gmailConnected ? (user.gmailEmail ?? "Connected") : "No account connected"}
                  </p>
                </div>
                {user?.gmailConnected && (
                  <span className="ml-3 flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 border border-green-500/20 text-green-400">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Active
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-3">
                <Lock className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-300">OAuth 2.0 Secured</p>
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
                  className="flex-1 h-9 text-xs rounded-xl border-red-900/50 text-red-400 hover:bg-red-950/30 hover:border-red-800 bg-transparent"
                >
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Disconnect"}
                </Button>
              )}
              <Button
                variant={user?.gmailConnected ? "outline" : "default"}
                size="sm"
                onClick={handleConnectGmail}
                disabled={connectingGmail}
                className={`h-9 text-xs rounded-xl flex-1 ${user?.gmailConnected ? "bg-transparent border-slate-700 hover:bg-slate-800 text-slate-200" : ""}`}
              >
                {connectingGmail
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Connecting…</>
                  : user?.gmailConnected ? "Reconnect" : "Connect Gmail"}
              </Button>
            </div>

            {/* Feature checklist */}
            <div className="space-y-1.5 pt-1">
              {[
                "Send emails directly from Gmail",
                "Create drafts in your Gmail account",
                "Track opens and clicks",
                "Secure OAuth connection",
                "Works with all Google Workspace accounts",
              ].map(f => (
                <div key={f} className="flex items-center gap-2.5">
                  <div className="h-4 w-4 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />
                  </div>
                  <span className="text-xs text-slate-400">{f}</span>
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

      {/* ── Branding ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
        <CardHeader
          icon={Building2}
          iconColor="bg-blue-500/15 border border-blue-500/20 text-blue-400"
          label="Branding"
          subtitle="Customize how your brand appears in every outgoing email."
        />

        <form onSubmit={handleSaveBranding}>
          <div className="p-6">
            <div className="grid lg:grid-cols-3 gap-6">

              {/* COL 1 — Logo ─────────────────────────────────────────────────── */}
              <div className="space-y-4">
                <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                  <ImagePlus className="h-3.5 w-3.5 text-violet-400" /> Company Logo
                </p>

                {/* Drop zone */}
                <label
                  className="relative rounded-2xl border-2 border-dashed border-slate-700 bg-slate-800/40 flex items-center justify-center cursor-pointer hover:border-slate-600 hover:bg-slate-800/60 transition-all duration-200 group"
                  style={{ minHeight: "148px" }}
                >
                  <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={handleLogoFileChange} />
                  {isUploadingLogo && (
                    <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center z-10 rounded-2xl">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
                    </div>
                  )}
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="max-h-24 max-w-[160px] object-contain p-3" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-600 group-hover:text-slate-500 transition-colors p-6">
                      <div className="h-10 w-10 rounded-xl bg-slate-700/60 border border-slate-600/60 flex items-center justify-center">
                        <ImagePlus className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                      </div>
                      <p className="text-xs font-medium text-center">Click to upload</p>
                      <p className="text-[10px] text-slate-600">PNG, JPG, or SVG</p>
                    </div>
                  )}
                </label>

                <div className="flex gap-2">
                  <Button
                    type="button" variant="outline" size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingLogo}
                    className="flex-1 h-8 text-xs rounded-xl bg-transparent border-slate-700 hover:bg-slate-800 text-slate-300"
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
                      className="h-8 w-8 p-0 rounded-xl text-red-400 hover:bg-red-950/30 hover:text-red-300"
                    >
                      {isRemovingLogo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </Button>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 leading-relaxed">Max 600 KB. Appears in your email headers and signature.</p>
                <p className="text-[11px] text-amber-500/80">Gmail may not display inline images in all cases.</p>
              </div>

              {/* COL 2 — Company Details ──────────────────────────────────────── */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                  <Building2 className="h-3.5 w-3.5 text-blue-400" /> Company Details
                </p>

                <div>
                  <FL icon={Building2}>Company Name</FL>
                  <Input value={branding.companyName} onChange={e => setBranding(b => ({ ...b, companyName: e.target.value }))}
                    placeholder="e.g. Vertex Car Shipping"
                    className="rounded-xl h-9 text-sm bg-slate-800/60 border-slate-700 focus:border-blue-500/60" />
                </div>
                <div>
                  <FL icon={Sparkles}>Tagline / Slogan</FL>
                  <Input value={branding.companyTagline} onChange={e => setBranding(b => ({ ...b, companyTagline: e.target.value }))}
                    placeholder="e.g. Nationwide Vehicle Shipping"
                    className="rounded-xl h-9 text-sm bg-slate-800/60 border-slate-700 focus:border-blue-500/60" />
                </div>
                <div>
                  <FL icon={Globe}>Website</FL>
                  <Input value={branding.companyWebsite} onChange={e => setBranding(b => ({ ...b, companyWebsite: e.target.value }))}
                    placeholder="e.g. www.yourcompany.com"
                    className="rounded-xl h-9 text-sm bg-slate-800/60 border-slate-700 focus:border-blue-500/60" />
                </div>
                <div>
                  <FL icon={Phone}>Phone</FL>
                  <Input value={branding.companyPhone} onChange={e => setBranding(b => ({ ...b, companyPhone: e.target.value }))}
                    placeholder="e.g. (555) 123-4567"
                    className="rounded-xl h-9 text-sm bg-slate-800/60 border-slate-700 focus:border-blue-500/60" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <FL icon={Shield}>USDOT #</FL>
                    <Input value={branding.usdot} onChange={e => setBranding(b => ({ ...b, usdot: e.target.value }))}
                      placeholder="1234567"
                      className="rounded-xl h-9 text-sm font-mono bg-slate-800/60 border-slate-700 focus:border-blue-500/60" />
                  </div>
                  <div>
                    <FL icon={Hash}>MC #</FL>
                    <Input value={branding.mcNumber} onChange={e => setBranding(b => ({ ...b, mcNumber: e.target.value }))}
                      placeholder="987654"
                      className="rounded-xl h-9 text-sm font-mono bg-slate-800/60 border-slate-700 focus:border-blue-500/60" />
                  </div>
                </div>
                <div>
                  <FL icon={Palette}>Accent Color</FL>
                  <div className="flex gap-2">
                    <input type="color"
                      value={branding.accentColor || "#1d4ed8"}
                      onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                      className="h-9 w-10 rounded-xl border border-slate-700 cursor-pointer bg-slate-800/60 p-1 flex-shrink-0" />
                    <Input value={branding.accentColor}
                      onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                      placeholder="#1d4ed8"
                      className="rounded-xl h-9 text-sm font-mono bg-slate-800/60 border-slate-700 focus:border-blue-500/60" />
                  </div>
                </div>
                <div>
                  <FL icon={User}>Email (From Name)</FL>
                  <Input value={branding.agentName} onChange={e => setBranding(b => ({ ...b, agentName: e.target.value }))}
                    placeholder="e.g. Frank Miller"
                    className="rounded-xl h-9 text-sm bg-slate-800/60 border-slate-700 focus:border-blue-500/60" />
                  <p className="text-[11px] text-slate-500 mt-1.5">Shown as the sender name. Falls back to CSV agent_name column.</p>
                </div>
              </div>

              {/* COL 3 — Signature Preview ────────────────────────────────────── */}
              <div className="space-y-3 flex flex-col">
                <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                  <Eye className="h-3.5 w-3.5 text-emerald-400" /> Signature Preview
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  This is how your signature appears in every outgoing email. Updates instantly as you type.
                </p>
                <div className="flex-1">
                  <SignaturePreview branding={branding} />
                </div>
              </div>

            </div>
          </div>

          {/* Save footer */}
          <div className="px-6 py-4 bg-slate-900/60 border-t border-slate-800 flex items-center gap-3">
            <Button
              type="submit"
              disabled={isSavingBranding}
              className="rounded-xl h-9 px-6 font-medium gap-2 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30"
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

      {/* ── Email Preferences ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
        <CardHeader
          icon={Settings2}
          iconColor="bg-indigo-500/15 border border-indigo-500/20 text-indigo-400"
          label="Email Preferences"
          subtitle="Configure default behavior for new emails and campaigns."
        />

        <div className="p-6">
          <div className="grid lg:grid-cols-2 gap-6">

            {/* LEFT — Sending defaults (Coming Soon) */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Sending Defaults</p>
              <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 px-4 divide-y divide-slate-700/60">
                <ComingSoonRow
                  label="Default From"
                  description="Choose which account sends outgoing emails"
                />
                <ComingSoonRow
                  label="Default Reply-To"
                  description="Override the reply-to address on campaigns"
                />
                <ComingSoonRow
                  label="Default BCC"
                  description="Blind-copy an address on every email sent"
                />
              </div>
            </div>

            {/* RIGHT — Behavior toggles */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Behavior</p>
              <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 px-4 divide-y divide-slate-700/60">
                {/* Automatic Signature — live toggle */}
                <Toggle
                  checked={branding.useSignature}
                  onChange={() => setBranding(b => ({ ...b, useSignature: !b.useSignature }))}
                  label="Automatic Signature"
                  description={branding.useSignature
                    ? "Appended to every outgoing email"
                    : "Template content sent as written"}
                />
                <ComingSoonRow label="Track Email Opens" description="Get notified when recipients open your emails" />
                <ComingSoonRow label="Track Link Clicks" description="Track clicks on links in your emails" />
                <ComingSoonRow label="Save Sent Emails" description="Save a copy to your Gmail Sent folder" />
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

      {/* ── Danger Zone ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-red-900/40 bg-slate-900 overflow-hidden">
        <div className="px-6 py-4 border-b border-red-900/40 flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 flex-shrink-0">
            <LogOut className="h-3.5 w-3.5 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">Danger Zone</p>
            <p className="text-xs text-slate-500 mt-0.5">Irreversible and sensitive actions.</p>
          </div>
        </div>

        <div className="p-6 space-y-3">

          {/* Sign Out */}
          <div className="flex items-center justify-between rounded-xl border border-slate-700/60 bg-slate-800/30 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-200">Sign Out</p>
              <p className="text-xs text-slate-500 mt-0.5">Sign out of BrokerMAIL on all devices.</p>
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

          {/* Disconnect Gmail — only shown when connected */}
          {user?.gmailConnected && (
            <div className="flex items-center justify-between rounded-xl border border-slate-700/60 bg-slate-800/30 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-200">Disconnect Gmail</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Remove Google account access. Campaigns and draft creation will stop working.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnectGmail}
                disabled={disconnecting}
                className="h-9 px-4 text-xs font-semibold rounded-xl border-red-900/60 text-red-400 hover:bg-red-950/30 hover:border-red-800 hover:text-red-300 bg-transparent transition-all duration-200 flex-shrink-0 ml-4"
              >
                {disconnecting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                  : <Unlink className="h-3.5 w-3.5 mr-2" />}
                Disconnect
              </Button>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
