import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { useAuth } from "@/context/AuthContext";
import {
  Zap, ArrowRight, Upload, FileText, Send, Sparkles,
  Shield, LayoutGrid, ScanText, Smartphone, Building2,
  Truck, Users, Globe, Lock, CheckCircle2, Server,
  Mail, PanelLeft, Settings2,
} from "lucide-react";
import { motion } from "framer-motion";

function GmailLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#F1F5F9" />
      <path d="M4 8.5L12 13.5L20 8.5V17C20 17.55 19.55 18 19 18H5C4.45 18 4 17.55 4 17V8.5Z" fill="#EA4335" fillOpacity="0.15" />
      <path d="M4 8C4 7.45 4.45 7 5 7H19C19.55 7 20 7.45 20 8L12 13L4 8Z" fill="#EA4335" fillOpacity="0.9" />
      <path d="M4 8.5V17C4 17.55 4.45 18 5 18H8V11L4 8.5Z" fill="#34A853" fillOpacity="0.7" />
      <path d="M20 8.5V17C20 17.55 19.55 18 19 18H16V11L20 8.5Z" fill="#4285F4" fillOpacity="0.7" />
    </svg>
  );
}

function OutlookLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#F0F4FF" />
      <rect x="3" y="5" width="10" height="14" rx="2" fill="#0078D4" fillOpacity="0.9" />
      <path d="M13 8H21V16H13V8Z" fill="#0078D4" fillOpacity="0.4" />
      <path d="M13 8L21 8L17 12L13 8Z" fill="#0078D4" fillOpacity="0.7" />
      <circle cx="8" cy="12" r="2.5" fill="white" fillOpacity="0.9" />
    </svg>
  );
}

function HostingerLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#F3F0FF" />
      <path d="M6 6H9V11H15V6H18V18H15V13.5H9V18H6V6Z" fill="#673DE6" fillOpacity="0.85" />
    </svg>
  );
}

function GoDaddyLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#F0FFF4" />
      <circle cx="12" cy="12" r="7" fill="#1BBF36" fillOpacity="0.15" stroke="#1BBF36" strokeOpacity="0.7" strokeWidth="1.5" />
      <path d="M9 12C9 10.34 10.34 9 12 9C13.3 9 14.4 9.84 14.82 11H13.23C12.92 10.59 12.49 10.33 12 10.33C11.08 10.33 10.33 11.08 10.33 12C10.33 12.92 11.08 13.67 12 13.67V15C10.34 15 9 13.66 9 12Z" fill="#1BBF36" fillOpacity="0.9" />
      <path d="M12 13.67H14.67V11H13.23" fill="#1BBF36" fillOpacity="0.6" />
    </svg>
  );
}

function ZohoLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#FFF7ED" />
      <path d="M5 8H14L9 13H14" stroke="#E8531D" strokeOpacity="0.9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 11H19L14 16H19" stroke="#E8531D" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NamecheapLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#F0FDF4" />
      <path d="M6 17V7L12 14V7" stroke="#DE4A11" strokeOpacity="0.85" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 7H18V17H15" stroke="#DE4A11" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PrivateMailLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#F8F9FA" />
      <rect x="7" y="11" width="10" height="8" rx="1.5" fill="#64748B" fillOpacity="0.7" />
      <path d="M9 11V8.5C9 7.12 10.12 6 11.5 6H12.5C13.88 6 15 7.12 15 8.5V11" stroke="#64748B" strokeOpacity="0.7" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.2" fill="white" />
    </svg>
  );
}

function FadeUp({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.45 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function MockupCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 overflow-hidden">
      <div className="h-9 bg-slate-50 border-b border-slate-100 flex items-center px-3 gap-2">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-300/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-300/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-300/70" />
        </div>
        <span className="text-xs text-slate-400 font-medium ml-1">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function TemplateBuilderMockup() {
  return (
    <MockupCard title="Template Builder">
      <div className="space-y-3">
        <div className="h-7 bg-slate-100 rounded-lg w-2/3" />
        <div className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50">
          <div className="flex gap-2">
            {["B", "I", "U", "—"].map(f => (
              <div key={f} className="h-6 w-6 rounded bg-white border border-slate-200 text-xs text-slate-400 flex items-center justify-center font-semibold">{f}</div>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="h-2 bg-slate-200 rounded-full w-full" />
            <div className="h-2 bg-slate-200 rounded-full w-5/6" />
            <div className="flex items-center gap-1.5">
              <div className="h-2 bg-blue-200 rounded-full w-20" />
              <div className="h-2 bg-slate-200 rounded-full w-24" />
              <div className="h-2 bg-violet-200 rounded-full w-16" />
            </div>
            <div className="h-2 bg-slate-200 rounded-full w-4/5" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-5 px-2 bg-blue-50 rounded-full border border-blue-100 text-xs text-blue-600 flex items-center">{"{name}"}</div>
          <div className="h-5 px-2 bg-violet-50 rounded-full border border-violet-100 text-xs text-violet-600 flex items-center">{"{vehicle}"}</div>
          <div className="h-5 px-2 bg-emerald-50 rounded-full border border-emerald-100 text-xs text-emerald-600 flex items-center">{"{route}"}</div>
        </div>
      </div>
    </MockupCard>
  );
}

function CsvUploadMockup() {
  return (
    <MockupCard title="Upload & Send">
      <div className="space-y-3">
        <div className="border-2 border-dashed border-blue-200 rounded-xl p-4 text-center bg-blue-50/30">
          <Upload className="h-5 w-5 text-blue-400 mx-auto mb-1.5" />
          <p className="text-xs text-blue-500 font-medium">leads_june_2026.csv</p>
          <p className="text-xs text-slate-400">847 rows detected</p>
        </div>
        <div className="space-y-1.5">
          {[
            { label: "email",   val: "john@example.com",  color: "bg-blue-100 text-blue-700" },
            { label: "vehicle", val: "2022 Ford F-150",   color: "bg-violet-100 text-violet-700" },
            { label: "route",   val: "Dallas → Chicago",  color: "bg-emerald-100 text-emerald-700" },
          ].map(r => (
            <div key={r.label} className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.color}`}>{r.label}</span>
              <span className="text-xs text-slate-500 truncate">{r.val}</span>
            </div>
          ))}
        </div>
        <div className="h-7 bg-blue-600 rounded-lg flex items-center justify-center gap-1.5">
          <Send className="h-3 w-3 text-white" />
          <span className="text-xs text-white font-semibold">Send 847 emails</span>
        </div>
      </div>
    </MockupCard>
  );
}

function MailboxMockup() {
  return (
    <MockupCard title="Mailbox Settings">
      <div className="space-y-2.5">
        {[
          { label: "SMTP Host", val: "mail.yourdomain.com" },
          { label: "Port",      val: "465 (SSL)" },
          { label: "Username",  val: "you@yourdomain.com" },
        ].map(f => (
          <div key={f.label}>
            <p className="text-xs text-slate-400 mb-1">{f.label}</p>
            <div className="h-7 bg-slate-50 border border-slate-200 rounded-lg px-2.5 flex items-center">
              <span className="text-xs text-slate-600">{f.val}</span>
            </div>
          </div>
        ))}
        <div className="flex gap-2 pt-1 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-700 font-medium">SMTP Connected</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-700 font-medium">IMAP Active</span>
          </div>
        </div>
      </div>
    </MockupCard>
  );
}

function DashboardMockup() {
  return (
    <MockupCard title="Dashboard">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Sent",    val: "2,847", color: "text-blue-600" },
            { label: "Opened",  val: "61%",   color: "text-emerald-600" },
            { label: "Replied", val: "128",   color: "text-violet-600" },
          ].map(s => (
            <div key={s.label} className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
              <p className={`text-base font-bold ${s.color}`}>{s.val}</p>
              <p className="text-xs text-slate-400">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {[
            { name: "June Campaign",  pct: 82, color: "bg-blue-500" },
            { name: "Dallas Leads",   pct: 65, color: "bg-violet-400" },
            { name: "Midwest Route",  pct: 48, color: "bg-emerald-400" },
          ].map(c => (
            <div key={c.name}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-slate-600">{c.name}</span>
                <span className="text-xs text-slate-400">{c.pct}%</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${c.color} rounded-full`} style={{ width: `${c.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockupCard>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) setLocation("/dashboard");
  }, [user, setLocation]);

  const providers = [
    { name: "Gmail",        Logo: GmailLogo },
    { name: "Outlook",      Logo: OutlookLogo },
    { name: "Hostinger",    Logo: HostingerLogo },
    { name: "GoDaddy",      Logo: GoDaddyLogo },
    { name: "Zoho",         Logo: ZohoLogo },
    { name: "Namecheap",    Logo: NamecheapLogo },
    { name: "Private Mail", Logo: PrivateMailLogo },
  ];

  const features = [
    { icon: Sparkles,   title: "AI Personalization",   desc: "Generate personalized outreach emails from CSV or XLSX lead sheets.",               color: "bg-violet-50 text-violet-600" },
    { icon: Shield,     title: "SMTP + IMAP Support",  desc: "Connect Hostinger, GoDaddy, Zoho, Outlook, Gmail, or private mail.",               color: "bg-blue-50 text-blue-600" },
    { icon: Globe,      title: "White-Label Branding", desc: "Use your own company name, signature, and branding — no forced watermarks.",        color: "bg-emerald-50 text-emerald-600" },
    { icon: LayoutGrid, title: "Bulk Outreach Control",desc: "Send campaigns in batches like 100, 500, or full lead lists.",                      color: "bg-amber-50 text-amber-600" },
    { icon: ScanText,   title: "Auto Column Detection",desc: "Automatically detect name, vehicle, route, and pricing columns.",                   color: "bg-pink-50 text-pink-600" },
    { icon: Smartphone, title: "Mobile Friendly",      desc: "Manage campaigns and outreach directly from your phone.",                           color: "bg-cyan-50 text-cyan-600" },
  ];

  const workflow = [
    { icon: Upload,    step: "01", title: "Upload your lead sheet",       desc: "Drop a CSV or XLSX file — columns auto-detected instantly.",           color: "from-blue-500 to-blue-600" },
    { icon: FileText,  step: "02", title: "Create personalized templates",desc: "Write email templates with {variables} mapped to your columns.",        color: "from-violet-500 to-violet-600" },
    { icon: Settings2, step: "03", title: "Connect your mailbox",         desc: "Add SMTP/IMAP credentials from any provider — takes 60 seconds.",       color: "from-emerald-500 to-emerald-600" },
    { icon: Send,      step: "04", title: "Send outreach campaigns",      desc: "Launch bulk personalized emails direct from your business mailbox.",     color: "from-orange-500 to-orange-600" },
  ];

  const trust = [
    { icon: Lock,       text: "Passwords stored encrypted" },
    { icon: Shield,     text: "Secure SMTP & IMAP support" },
    { icon: Globe,      text: "White-label branding — no forced signatures" },
    { icon: Server,     text: "Works with private mail servers" },
    { icon: Smartphone, text: "Mobile-friendly dashboard" },
    { icon: Mail,       text: "Gmail + Outlook compatible" },
  ];

  const plans = [
    {
      name: "Starter",
      desc: "Perfect for independent brokers.",
      highlight: false,
      items: ["500 emails / month", "1 mailbox", "CSV upload", "Basic personalization"],
    },
    {
      name: "Growth",
      desc: "Built for scaling teams.",
      highlight: true,
      items: ["10,000 emails / month", "SMTP + IMAP support", "Bulk sending", "White-label branding"],
    },
    {
      name: "Agency",
      desc: "For multi-user dispatch shops.",
      highlight: false,
      items: ["Unlimited campaigns", "Multi-user access", "Admin dashboard", "Priority support"],
    },
  ];

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="py-24 sm:py-32 px-5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-b from-blue-50 to-transparent rounded-full blur-3xl -z-10 pointer-events-none opacity-70" />
        <div className="absolute top-20 right-0 w-[400px] h-[400px] bg-violet-50 rounded-full blur-3xl -z-10 pointer-events-none opacity-50" />

        <div className="container mx-auto max-w-4xl text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium mb-7">
              <Zap className="h-3.5 w-3.5" />
              AI-Powered Outreach for Auto Transport
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-5 leading-[1.1] text-slate-900">
              Close more transport deals
              <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-500">
                {" "}with AI-powered outreach.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-slate-500 max-w-2xl mx-auto mb-8 leading-relaxed px-2">
              Upload lead sheets, personalize emails instantly, and send directly from your own business mailbox using SMTP or Gmail.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-5">
              <Button size="lg" className="h-12 px-7 rounded-xl shadow-md font-medium group w-full sm:w-auto" asChild>
                <Link href="/register">
                  Start Sending Outreach
                  <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 rounded-xl border-slate-200 font-medium text-slate-700 w-full sm:w-auto" asChild>
                <Link href="/pricing">View Pricing</Link>
              </Button>
            </div>
            <p className="text-xs text-slate-400 font-medium">Built specifically for auto transport brokers.</p>
          </motion.div>

          {/* App mockup */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-16 relative mx-auto max-w-4xl"
          >
            <div className="rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-200/80 overflow-hidden">
              <div className="h-10 bg-slate-50 border-b border-slate-100 flex items-center px-4 gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-300/70" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-300/70" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-300/70" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="h-5 w-44 bg-slate-100 rounded-md" />
                </div>
              </div>
              <div className="flex">
                <div className="w-40 bg-white border-r border-slate-100 p-3 space-y-1 hidden sm:block">
                  {["Dashboard", "Campaigns", "Upload & Send", "Templates", "Mailbox"].map((item, i) => (
                    <div key={item} className={`h-8 rounded-lg flex items-center px-3 gap-2 ${i === 0 ? "bg-blue-50" : ""}`}>
                      <div className={`h-2 w-2 rounded-full flex-shrink-0 ${i === 0 ? "bg-blue-500" : "bg-slate-200"}`} />
                      <div className={`h-2 rounded-full ${i === 0 ? "bg-blue-300 w-16" : "bg-slate-100 w-14"}`} />
                    </div>
                  ))}
                </div>
                <div className="flex-1 p-4 bg-slate-50/50">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {[
                      { c: "bg-blue-500",   v: "2,847" },
                      { c: "bg-violet-400", v: "61%" },
                      { c: "bg-emerald-400",v: "128" },
                      { c: "bg-amber-400",  v: "94%" },
                    ].map(({ c, v }, i) => (
                      <div key={i} className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                        <div className={`h-6 w-6 rounded-lg ${c} opacity-20 mb-2`} />
                        <div className="h-2 w-10 bg-slate-100 rounded-full mb-1.5" />
                        <div className="h-4 w-10 bg-slate-200 rounded-md flex items-center justify-center text-slate-500 font-bold" style={{ fontSize: 9 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 space-y-2.5">
                    {[82, 65, 48, 91].map((w, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="h-6 w-6 rounded-lg bg-slate-100 flex-shrink-0" />
                        <div className="flex-1 space-y-1.5 min-w-0">
                          <div className="h-1.5 rounded-full bg-slate-100" style={{ width: `${w}%` }} />
                          <div className="h-1.5 rounded-full bg-blue-100" style={{ width: `${Math.max(w - 15, 10)}%` }} />
                        </div>
                        <div className="h-5 w-12 rounded-full bg-blue-50 border border-blue-100 flex-shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Provider logos */}
      <section className="py-12 px-5 border-y border-slate-100 bg-slate-50">
        <div className="container mx-auto max-w-5xl text-center">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-8">
            Works with your existing business email
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-5">
            {providers.map(({ name, Logo }) => (
              <div key={name} className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow group">
                <Logo className="h-7 w-7 flex-shrink-0" />
                <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-5">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">Everything you need for broker outreach</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-sm sm:text-base">From lead import to personalized sending — designed for the auto transport workflow.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((feat, i) => (
              <FadeUp key={i} delay={i * 0.07}>
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 h-full">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center mb-4 ${feat.color}`}>
                    <feat.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mb-1.5">{feat.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{feat.desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="py-24 px-5 bg-gradient-to-b from-slate-50 to-white border-y border-slate-100">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">How BrokerMail AI works</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-sm sm:text-base">Four simple steps from spreadsheet to delivered outreach.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
            <div className="hidden lg:block absolute top-10 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-blue-200 via-violet-200 to-orange-200 z-0" />
            {workflow.map((step, i) => (
              <FadeUp key={i} delay={i * 0.1} className="relative z-10">
                <div className="flex flex-col items-center text-center">
                  <div className={`h-20 w-20 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-lg mb-5`}>
                    <step.icon className="h-8 w-8 text-white" />
                  </div>
                  <span className="text-xs font-bold text-slate-300 tracking-widest mb-2">{step.step}</span>
                  <h3 className="text-base font-bold text-slate-900 mb-2">{step.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Product mockups */}
      <section className="py-24 px-5">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">Everything you need for broker outreach.</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-sm sm:text-base">A complete platform built around how transport brokers work.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <FadeUp delay={0}>
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-violet-50 flex items-center justify-center"><FileText className="h-4 w-4 text-violet-600" /></div>
                  <span className="text-sm font-semibold text-slate-700">Template Builder</span>
                </div>
                <TemplateBuilderMockup />
              </div>
            </FadeUp>
            <FadeUp delay={0.1}>
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-blue-50 flex items-center justify-center"><Upload className="h-4 w-4 text-blue-600" /></div>
                  <span className="text-sm font-semibold text-slate-700">CSV Upload & Send</span>
                </div>
                <CsvUploadMockup />
              </div>
            </FadeUp>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <FadeUp delay={0.15}>
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-emerald-50 flex items-center justify-center"><Settings2 className="h-4 w-4 text-emerald-600" /></div>
                  <span className="text-sm font-semibold text-slate-700">SMTP / IMAP Setup</span>
                </div>
                <MailboxMockup />
              </div>
            </FadeUp>
            <FadeUp delay={0.2}>
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-amber-50 flex items-center justify-center"><PanelLeft className="h-4 w-4 text-amber-600" /></div>
                  <span className="text-sm font-semibold text-slate-700">Campaign Dashboard</span>
                </div>
                <DashboardMockup />
              </div>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="py-24 px-5 bg-slate-900">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Built for real transport businesses</h2>
            <p className="text-slate-400 max-w-xl mx-auto text-sm sm:text-base">Reliable, private, and fully white-label from day one.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trust.map((item, i) => (
              <FadeUp key={i} delay={i * 0.07}>
                <div className="flex items-center gap-3 bg-slate-800/50 rounded-2xl p-5 border border-slate-700/50 hover:border-slate-600 transition-colors">
                  <div className="h-9 w-9 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <item.icon className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                    <span className="text-sm text-slate-200 font-medium">{item.text}</span>
                  </div>
                </div>
              </FadeUp>
            ))}
          </div>
          <FadeUp delay={0.5}>
            <div className="mt-8 text-center">
              <Link href="/trust">
                <span className="text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer font-medium">
                  Learn more about our security practices →
                </span>
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* Built For */}
      <section className="py-24 px-5">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">Built for the Auto Transport Industry</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-sm sm:text-base">Designed around how vehicle shipping teams actually work.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Truck,      label: "Auto Transport Brokers" },
              { icon: Users,      label: "Dispatch Teams" },
              { icon: Building2,  label: "Vehicle Shipping Companies" },
              { icon: LayoutGrid, label: "Lead Generation Teams" },
            ].map((item, i) => (
              <FadeUp key={i} delay={i * 0.08}>
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col items-center text-center gap-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                  <div className="h-12 w-12 rounded-2xl bg-blue-50 flex items-center justify-center">
                    <item.icon className="h-6 w-6 text-blue-600" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800 leading-snug">{item.label}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing preview */}
      <section className="py-24 px-5 bg-slate-50 border-y border-slate-100">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">Simple, transparent pricing</h2>
            <p className="text-slate-500 max-w-lg mx-auto text-sm sm:text-base">Plans built for every stage of your brokerage.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {plans.map((plan, i) => (
              <FadeUp key={i} delay={i * 0.1}>
                <div className={`rounded-2xl border p-7 flex flex-col h-full transition-all duration-200 ${
                  plan.highlight
                    ? "bg-blue-600 border-blue-500 shadow-xl shadow-blue-200"
                    : "bg-white border-slate-200 shadow-sm hover:shadow-md"
                }`}>
                  {plan.highlight && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 text-white text-xs font-semibold mb-4 self-start">
                      <Sparkles className="h-3 w-3" />
                      Most Popular
                    </div>
                  )}
                  <h3 className={`text-xl font-bold mb-1 ${plan.highlight ? "text-white" : "text-slate-900"}`}>{plan.name}</h3>
                  <p className={`text-sm mb-5 ${plan.highlight ? "text-blue-100" : "text-slate-500"}`}>{plan.desc}</p>
                  <ul className="space-y-2.5 mb-7 flex-1">
                    {plan.items.map(item => (
                      <li key={item} className="flex items-center gap-2.5">
                        <CheckCircle2 className={`h-4 w-4 flex-shrink-0 ${plan.highlight ? "text-blue-200" : "text-emerald-500"}`} />
                        <span className={`text-sm ${plan.highlight ? "text-blue-50" : "text-slate-700"}`}>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <button disabled className={`w-full h-11 rounded-xl text-sm font-semibold cursor-not-allowed ${
                    plan.highlight ? "bg-white/20 text-white border border-white/30" : "bg-slate-100 text-slate-400 border border-slate-200"
                  }`}>
                    Coming Soon
                  </button>
                </div>
              </FadeUp>
            ))}
          </div>
          <FadeUp delay={0.35}>
            <div className="mt-8 text-center">
              <Link href="/pricing">
                <span className="text-sm text-blue-600 hover:underline cursor-pointer font-medium">View full pricing details →</span>
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-5">
        <div className="container mx-auto max-w-2xl text-center">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 mx-auto mb-6 flex items-center justify-center shadow-lg shadow-blue-200">
            <Zap className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
            Upload your first lead sheet in under 60 seconds.
          </h2>
          <p className="text-slate-500 mb-8 leading-relaxed text-sm sm:text-base px-2">
            No complicated setup. Connect your mailbox, upload your leads, and start sending personalized outreach today.
          </p>
          <Button size="lg" className="h-12 px-10 rounded-xl shadow-md shadow-blue-200 font-medium w-full sm:w-auto group" asChild>
            <Link href="/register">
              Start Sending Emails
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </Button>
        </div>
      </section>
    </PublicLayout>
  );
}
