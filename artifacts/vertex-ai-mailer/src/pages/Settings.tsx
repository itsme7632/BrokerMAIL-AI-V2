import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, Mail, AlertCircle,
  Building2, Globe, Phone, Hash, Palette, PenLine, User,
  ImagePlus, X, Trash2, Eye,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

interface BrandingData {
  agentName: string; companyName: string; companyTagline: string; companyWebsite: string;
  companyPhone: string; usdot: string; mcNumber: string; accentColor: string;
  useSignature: boolean; logoUrl: string | null;
}

const TEMPLATE_VARIABLES = [
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
  const accent     = branding.accentColor || "#1d4ed8";
  const agentName  = branding.agentName   || "";
  const company    = branding.companyName || "";
  const tagline    = branding.companyTagline || "";
  const phone      = branding.companyPhone || "";
  const website    = branding.companyWebsite || "";
  const usdot      = branding.usdot || "";
  const mc         = branding.mcNumber || "";

  const hasAny = agentName || company || phone || website || usdot || mc;

  return (
    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5" /> Live Signature Preview
      </p>
      {!hasAny ? (
        <p className="text-xs text-slate-400 italic">Fill in your company details above to see the signature preview.</p>
      ) : (
        <div className="text-sm leading-relaxed font-sans">
          <div className="border-t border-slate-200 pt-3 mt-1">
            <p className="text-slate-500 text-xs mb-1.5">Best regards,</p>
            {agentName && <p className="font-semibold text-slate-900">{agentName}</p>}
            {company && (
              <p className="text-slate-700">
                {company}
                {tagline && <span className="text-slate-400 font-normal text-xs ml-1.5">{tagline}</span>}
              </p>
            )}
            {phone && <p className="text-slate-500 text-xs mt-0.5">{phone}</p>}
            {website && (
              <a
                href={/^https?:\/\//.test(website) ? website : `https://${website}`}
                className="text-xs mt-0.5 block"
                style={{ color: accent }}
                target="_blank" rel="noopener noreferrer"
              >
                {website}
              </a>
            )}
            {(usdot || mc) && (
              <p className="text-slate-400 text-xs mt-1">
                {[usdot && `USDOT #${usdot}`, mc && `MC #${mc}`].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}
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
  const [logoPreview, setLogoPreview]   = useState<string | null>(null);
  const [isUploadingLogo, setUploadingLogo] = useState(false);
  const [isRemovingLogo, setRemovingLogo]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const params            = new URLSearchParams(window.location.search);
  const gmailConnectedParam = params.get("gmail") === "connected";
  const oauthError        = params.get("error");

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
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(brandingWithoutLogo),
      });
      if (!res.ok) throw new Error("Save failed");
      setBrandingSaved(true);
      setTimeout(() => setBrandingSaved(false), 3000);
    } finally { setIsSavingBranding(false); }
  }

  function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: "Invalid file", description: "Please select an image file." });
      return;
    }
    if (file.size > 600 * 1024) {
      toast({ variant: "destructive", title: "File too large", description: "Logo must be under 600 KB." });
      return;
    }

    const reader = new FileReader();
    reader.onload = async ev => {
      const dataUrl = ev.target?.result as string;
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground mt-1">Manage your account, branding, and integrations.</p>
      </div>

      <div className="space-y-8">

        {/* Profile */}
        <section className="space-y-4">
          <h3 className="text-lg font-medium">Profile</h3>
          <div className="p-6 rounded-lg border border-border bg-card space-y-4">
            <div><label className="text-sm font-medium text-muted-foreground">Name</label><p className="text-foreground">{user?.name}</p></div>
            <div><label className="text-sm font-medium text-muted-foreground">Email</label><p className="text-foreground">{user?.email}</p></div>
          </div>
        </section>

        {/* Company Logo */}
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-medium">Company Logo</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Upload your company logo to display in email headers. PNG, JPG, or SVG recommended — max 600 KB.
            </p>
          </div>
          <div className="p-6 rounded-lg border border-border bg-card space-y-4">
            <div className="flex items-start gap-4">
              {/* Logo preview */}
              <div
                className="h-20 w-36 rounded-xl border border-slate-200 flex items-center justify-center bg-slate-50 overflow-hidden flex-shrink-0 relative"
              >
                {isUploadingLogo && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-xl z-10">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                  </div>
                )}
                {logoPreview ? (
                  <img src={logoPreview} alt="Company logo" className="max-h-16 max-w-32 object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-slate-300">
                    <ImagePlus className="h-7 w-7" />
                    <span className="text-xs">No logo</span>
                  </div>
                )}
              </div>

              {/* Upload controls */}
              <div className="flex flex-col gap-2 flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingLogo}
                  className="rounded-xl gap-2 w-fit"
                >
                  {isUploadingLogo
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                    : <><ImagePlus className="h-3.5 w-3.5" /> {logoPreview ? "Change Logo" : "Upload Logo"}</>}
                </Button>
                {logoPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveLogo}
                    disabled={isRemovingLogo || isUploadingLogo}
                    className="rounded-xl gap-2 w-fit text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    {isRemovingLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Remove
                  </Button>
                )}
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Shown in email headers for all 10 templates. Displayed in Outlook, Apple Mail, and most mobile clients.
                  <br />
                  <span className="text-amber-600">Note: Gmail may not display inline images in some cases.</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Company Branding */}
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-medium">Company Branding</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Set your company details once. These apply automatically to every email header and signature.
            </p>
          </div>

          <form onSubmit={handleSaveBranding} className="p-6 rounded-lg border border-border bg-card space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" /> Agent Name
                </label>
                <Input value={branding.agentName} onChange={e => setBranding(b => ({ ...b, agentName: e.target.value }))} placeholder="e.g. Sarah Mitchell" className="rounded-xl" />
                <p className="text-xs text-muted-foreground">Used in signature when no agent_name column in CSV</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Company Name
                </label>
                <Input value={branding.companyName} onChange={e => setBranding(b => ({ ...b, companyName: e.target.value }))} placeholder="e.g. Your Company Name" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Company Tagline / Slogan
                </label>
                <Input value={branding.companyTagline} onChange={e => setBranding(b => ({ ...b, companyTagline: e.target.value }))} placeholder="e.g. Nationwide Vehicle Shipping" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" /> Website
                </label>
                <Input value={branding.companyWebsite} onChange={e => setBranding(b => ({ ...b, companyWebsite: e.target.value }))} placeholder="e.g. www.yourcompany.com" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Phone
                </label>
                <Input value={branding.companyPhone} onChange={e => setBranding(b => ({ ...b, companyPhone: e.target.value }))} placeholder="e.g. (555) 123-4567" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" /> USDOT #
                </label>
                <Input value={branding.usdot} onChange={e => setBranding(b => ({ ...b, usdot: e.target.value }))} placeholder="e.g. 1234567" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" /> MC #
                </label>
                <Input value={branding.mcNumber} onChange={e => setBranding(b => ({ ...b, mcNumber: e.target.value }))} placeholder="e.g. 987654" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-muted-foreground" /> Accent Color
                </label>
                <div className="flex gap-2">
                  <input type="color" value={branding.accentColor || "#1d4ed8"} onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))} className="h-11 w-12 rounded-xl border border-input cursor-pointer bg-transparent p-1" />
                  <Input value={branding.accentColor} onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))} placeholder="#1d4ed8" className="rounded-xl font-mono" />
                </div>
              </div>
            </div>

            {/* Automatic Signature Toggle */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2.5">
                  <PenLine className="h-4 w-4 text-slate-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-slate-800">Automatic Signature</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {branding.useSignature
                        ? "On — agent name, company, tagline, phone, website & credentials appended automatically"
                        : "Off — template content is sent exactly as written, no additions"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBranding(b => ({ ...b, useSignature: !b.useSignature }))}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${branding.useSignature ? "bg-blue-600" : "bg-slate-200"}`}
                  role="switch" aria-checked={branding.useSignature}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${branding.useSignature ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
            </div>

            {/* Live Signature Preview */}
            {branding.useSignature && <SignaturePreview branding={branding} />}

            {/* How branding works */}
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
                <p className="text-xs font-semibold text-blue-800 mb-1">Automatic — no variables needed</p>
                <p className="text-xs text-blue-700 leading-relaxed">
                  Your company name and logo appear in the email header automatically. When "Automatic Signature" is on, agent name, tagline, phone, website, USDOT, and MC# are appended to every email.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Use these in template bodies</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {TEMPLATE_VARIABLES.map(v => (
                    <div key={v.var} className="flex flex-col gap-0.5 p-2 rounded-lg bg-slate-50 border border-slate-100">
                      <code className="text-xs font-mono text-blue-600 font-semibold">{v.var}</code>
                      <span className="text-xs text-slate-500">{v.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={isSavingBranding} className="rounded-xl gap-2">
                {isSavingBranding ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save Branding"}
              </Button>
              {brandingSaved && (
                <span className="flex items-center gap-1.5 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> Saved
                </span>
              )}
            </div>
          </form>
        </section>

        {/* Gmail */}
        <section className="space-y-4">
          <h3 className="text-lg font-medium">Integrations</h3>
          <div className="p-6 rounded-lg border border-border bg-card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h4 className="font-medium">Gmail</h4>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {user?.gmailConnected ? `Connected as ${user.gmailEmail}` : "Not connected — required for creating drafts"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {user?.gmailConnected && (
                  <Button variant="ghost" size="sm" onClick={handleDisconnectGmail} disabled={disconnecting} className="text-muted-foreground hover:text-destructive">
                    {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
                  </Button>
                )}
                <Button variant={user?.gmailConnected ? "outline" : "default"} onClick={handleConnectGmail} disabled={connectingGmail}>
                  {connectingGmail ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Connecting…</> : user?.gmailConnected ? "Reconnect" : "Connect Gmail"}
                </Button>
              </div>
            </div>

            {gmailConnectedParam && (
              <div className="flex items-center gap-2 mt-2 p-3 rounded-md bg-green-500/10 border border-green-500/20 text-green-600 text-sm">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> Gmail connected successfully.
              </div>
            )}
            {(gmailError || oauthError) && (
              <p className="mt-2 text-sm text-destructive">
                {gmailError ?? (oauthError === "oauth_denied" ? "You denied access. Please try again." : "Gmail connection failed. Please try again.")}
              </p>
            )}
          </div>
        </section>

        {/* Sign out */}
        <section className="pt-6 border-t border-border">
          <Button variant="destructive" onClick={logout}>Sign Out</Button>
        </section>
      </div>
    </div>
  );
}
