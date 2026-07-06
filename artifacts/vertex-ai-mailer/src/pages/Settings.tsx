import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, Mail, AlertCircle,
  Building2, Globe, Phone, Hash, Palette, PenLine, User,
  ImagePlus, Trash2, Eye, LogOut, Sparkles, Shield,
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

const TEMPLATE_VARIABLES: { var: string; desc: string }[] = [
  { var: "{name}",       desc: "Recipient's name" },
  { var: "{vehicle}",    desc: "Vehicle (year/make/model)" },
  { var: "{pickup}",     desc: "Pickup location" },
  { var: "{delivery}",   desc: "Delivery location" },
  { var: "{price}",      desc: "Transport price (auto-formats)" },
  { var: "{route}",      desc: "Route summary" },
  { var: "{quote_id}",   desc: "Quote / order ID from CSV" },
  { var: "{agent_name}", desc: "Sending agent's name (CSV column)" },
];

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Live signature preview rendered inline using branding state */
function SignaturePreview({ branding }: { branding: BrandingData }) {
  const accent    = branding.accentColor || "#1d4ed8";
  const agentName = branding.agentName   || "";
  const company   = branding.companyName || "";
  const tagline   = branding.companyTagline || "";
  const phone     = branding.companyPhone || "";
  const website   = branding.companyWebsite || "";
  const usdot     = branding.usdot || "";
  const mc        = branding.mcNumber || "";

  const hasAny = agentName || company || phone || website || usdot || mc;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Signature Preview</span>
      </div>
      <div className="px-4 py-3">
        {!hasAny ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">Fill in your company details above to preview the signature.</p>
        ) : (
          <div className="text-sm leading-relaxed font-sans">
            <p className="text-slate-400 dark:text-slate-500 text-xs mb-1.5">Best regards,</p>
            <div className="border-t border-slate-200 dark:border-slate-700 pt-2.5 space-y-0.5">
              {agentName && <p className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{agentName}</p>}
              {company && (
                <p className="text-slate-600 dark:text-slate-400 text-sm">
                  {company}
                  {tagline && <span className="text-slate-400 dark:text-slate-500 font-normal text-xs ml-1.5">— {tagline}</span>}
                </p>
              )}
              {phone && <p className="text-slate-500 dark:text-slate-400 text-xs">{phone}</p>}
              {website && (
                <a
                  href={/^https?:\/\//.test(website) ? website : `https://${website}`}
                  className="text-xs block hover:underline"
                  style={{ color: accent }}
                  target="_blank" rel="noopener noreferrer"
                >
                  {website}
                </a>
              )}
              {(usdot || mc) && (
                <p className="text-slate-400 dark:text-slate-500 text-xs pt-0.5">
                  {[usdot && `USDOT #${usdot}`, mc && `MC #${mc}`].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
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

  // ── Shared card header ───────────────────────────────────────────────────────
  function SectionHeader({
    icon: Icon, iconBg, label, description,
  }: {
    icon: React.ElementType;
    iconBg: string;
    label: string;
    description?: string;
  }) {
    return (
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className={`flex items-center justify-center h-7 w-7 rounded-lg ${iconBg} flex-shrink-0`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
        </div>
        {description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 ml-[2.375rem] leading-relaxed">{description}</p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage your account, branding, and integrations.
        </p>
      </div>

      {/* ── Profile ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <SectionHeader
          icon={User}
          iconBg="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
          label="Profile"
        />
        <div className="p-6 flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0 shadow-sm">
            {user?.name?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{user?.name}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* ── Company Logo ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <SectionHeader
          icon={ImagePlus}
          iconBg="bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
          label="Company Logo"
          description="Upload your logo to display in email headers. PNG, JPG, or SVG recommended — max 600 KB."
        />
        <div className="p-6">
          <div className="flex items-start gap-5">
            {/* Preview box */}
            <div className="h-20 w-36 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center bg-slate-50 dark:bg-slate-800/50 overflow-hidden flex-shrink-0 relative">
              {isUploadingLogo && (
                <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 flex items-center justify-center rounded-xl z-10">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                </div>
              )}
              {logoPreview ? (
                <img src={logoPreview} alt="Company logo" className="max-h-16 max-w-32 object-contain p-2" />
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-slate-300 dark:text-slate-600">
                  <ImagePlus className="h-6 w-6" />
                  <span className="text-xs font-medium">No logo</span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex flex-col gap-2.5 flex-1 pt-1">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingLogo}
                className="rounded-lg gap-2 w-fit h-8 text-xs font-medium"
              >
                {isUploadingLogo
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                  : <><ImagePlus className="h-3.5 w-3.5" /> {logoPreview ? "Change Logo" : "Upload Logo"}</>}
              </Button>
              {logoPreview && (
                <Button
                  type="button" variant="ghost" size="sm"
                  onClick={handleRemoveLogo}
                  disabled={isRemovingLogo || isUploadingLogo}
                  className="rounded-lg gap-2 w-fit h-8 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                >
                  {isRemovingLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Remove
                </Button>
              )}
              <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
                Shown in email headers for all 10 templates. Displayed in Outlook, Apple Mail, and most mobile clients.
                <br />
                <span className="text-amber-500 dark:text-amber-400">Gmail may not display inline images in some cases.</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Company Branding ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <SectionHeader
          icon={Building2}
          iconBg="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
          label="Company Branding"
          description="Set your company details once. They apply automatically to every email header and signature."
        />

        <form onSubmit={handleSaveBranding}>
          <div className="p-6 space-y-6">

            {/* Identity fields */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wide">
                  <User className="h-3 w-3" /> Agent Name
                </label>
                <Input
                  value={branding.agentName}
                  onChange={e => setBranding(b => ({ ...b, agentName: e.target.value }))}
                  placeholder="e.g. Sarah Mitchell"
                  className="rounded-lg h-9 text-sm"
                />
                <p className="text-xs text-slate-400 dark:text-slate-500">Used in signature when no agent_name column in CSV</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wide">
                  <Building2 className="h-3 w-3" /> Company Name
                </label>
                <Input
                  value={branding.companyName}
                  onChange={e => setBranding(b => ({ ...b, companyName: e.target.value }))}
                  placeholder="e.g. Vertex Car Shipping"
                  className="rounded-lg h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wide">
                  <Sparkles className="h-3 w-3" /> Company Tagline / Slogan
                </label>
                <Input
                  value={branding.companyTagline}
                  onChange={e => setBranding(b => ({ ...b, companyTagline: e.target.value }))}
                  placeholder="e.g. Nationwide Vehicle Shipping"
                  className="rounded-lg h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wide">
                  <Globe className="h-3 w-3" /> Website
                </label>
                <Input
                  value={branding.companyWebsite}
                  onChange={e => setBranding(b => ({ ...b, companyWebsite: e.target.value }))}
                  placeholder="e.g. www.yourcompany.com"
                  className="rounded-lg h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wide">
                  <Phone className="h-3 w-3" /> Phone
                </label>
                <Input
                  value={branding.companyPhone}
                  onChange={e => setBranding(b => ({ ...b, companyPhone: e.target.value }))}
                  placeholder="e.g. (555) 123-4567"
                  className="rounded-lg h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wide">
                  <Palette className="h-3 w-3" /> Accent Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={branding.accentColor || "#1d4ed8"}
                    onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                    className="h-9 w-10 rounded-lg border border-input cursor-pointer bg-transparent p-1 flex-shrink-0"
                  />
                  <Input
                    value={branding.accentColor}
                    onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                    placeholder="#1d4ed8"
                    className="rounded-lg h-9 text-sm font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Credentials row */}
            <div className="grid sm:grid-cols-2 gap-4 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="space-y-1.5 pt-4">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wide">
                  <Shield className="h-3 w-3" /> USDOT #
                </label>
                <Input
                  value={branding.usdot}
                  onChange={e => setBranding(b => ({ ...b, usdot: e.target.value }))}
                  placeholder="e.g. 1234567"
                  className="rounded-lg h-9 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5 pt-4">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wide">
                  <Hash className="h-3 w-3" /> MC #
                </label>
                <Input
                  value={branding.mcNumber}
                  onChange={e => setBranding(b => ({ ...b, mcNumber: e.target.value }))}
                  placeholder="e.g. 987654"
                  className="rounded-lg h-9 text-sm font-mono"
                />
              </div>
            </div>

            {/* Automatic Signature toggle */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
              <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm flex-shrink-0">
                    <PenLine className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Automatic Signature</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {branding.useSignature
                        ? "On — name, company, tagline, phone, website & credentials appended automatically"
                        : "Off — template content is sent exactly as written, no additions"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBranding(b => ({ ...b, useSignature: !b.useSignature }))}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${branding.useSignature ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"}`}
                  role="switch" aria-checked={branding.useSignature}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${branding.useSignature ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
            </div>

            {/* Live signature preview */}
            {branding.useSignature && <SignaturePreview branding={branding} />}

            {/* How branding works */}
            <div className="space-y-4 border-t border-slate-100 dark:border-slate-800 pt-5">
              <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 p-4">
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-1">Automatic — no variables needed</p>
                <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
                  Your company name and logo appear in the email header automatically. When "Automatic Signature" is on,
                  agent name, tagline, phone, website, USDOT, and MC# are appended to every email.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5">
                  Available variables for template bodies
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TEMPLATE_VARIABLES.map(v => (
                    <div key={v.var} className="flex flex-col gap-0.5 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700">
                      <code className="text-xs font-mono text-blue-600 dark:text-blue-400 font-semibold">{v.var}</code>
                      <span className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{v.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer with save button */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <Button
              type="submit"
              disabled={isSavingBranding}
              className="rounded-lg gap-2 h-9 px-5 font-medium"
            >
              {isSavingBranding
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                : "Save Changes"}
            </Button>
            {brandingSaved && (
              <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Saved
              </span>
            )}
          </div>
        </form>
      </div>

      {/* ── Integrations ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <SectionHeader
          icon={Mail}
          iconBg="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
          label="Integrations"
          description="Connect your sending account to create and send emails."
        />

        <div className="p-6 space-y-3">
          {/* Gmail card */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Gmail "G" logo using SVG for accuracy */}
              <div className="flex-shrink-0 h-9 w-9 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 h-[18px] w-[18px]" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Gmail</p>
                  {user?.gmailConnected ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/50">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 dark:bg-green-400" />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                      Not connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {user?.gmailConnected
                    ? `Sending as ${user.gmailEmail}`
                    : "Required for creating Gmail drafts"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
              {user?.gmailConnected && (
                <Button
                  variant="ghost" size="sm"
                  onClick={handleDisconnectGmail}
                  disabled={disconnecting}
                  className="h-8 text-xs text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg"
                >
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Disconnect"}
                </Button>
              )}
              <Button
                variant={user?.gmailConnected ? "outline" : "default"}
                size="sm"
                onClick={handleConnectGmail}
                disabled={connectingGmail}
                className="h-8 text-xs rounded-lg"
              >
                {connectingGmail
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Connecting…</>
                  : user?.gmailConnected ? "Reconnect" : "Connect Gmail"}
              </Button>
            </div>
          </div>

          {/* Success / error banners */}
          {gmailConnectedParam && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50 text-green-700 dark:text-green-400 text-sm">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              Gmail connected successfully.
            </div>
          )}
          {(gmailError || oauthError) && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {gmailError ?? (oauthError === "oauth_denied"
                ? "You denied access. Please try again."
                : "Gmail connection failed. Please try again.")}
            </div>
          )}
        </div>
      </div>

      {/* ── Account actions ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-red-100 dark:border-red-900/40 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-red-100 dark:border-red-900/40">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-red-50 dark:bg-red-900/30 flex-shrink-0">
              <LogOut className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
            </div>
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Account</span>
          </div>
        </div>
        <div className="p-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Sign out of BrokerMAIL AI</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">You will be returned to the login screen.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={logout}
            className="rounded-lg h-8 text-xs font-medium border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 hover:border-red-300"
          >
            <LogOut className="h-3.5 w-3.5 mr-1.5" />
            Sign Out
          </Button>
        </div>
      </div>

    </div>
  );
}
