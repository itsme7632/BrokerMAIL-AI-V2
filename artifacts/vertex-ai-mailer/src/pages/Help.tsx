import { useState, useMemo } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Search, Zap, Server, Megaphone, FileText, BarChart3, CreditCard, AlertTriangle, ChevronDown } from "lucide-react";
import { Link } from "wouter";

function FadeUp({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay, duration: 0.4 }} className={className}>
      {children}
    </motion.div>
  );
}

interface Article { q: string; a: string }
interface Category { id: string; icon: React.ElementType; label: string; color: string; articles: Article[] }

const categories: Category[] = [
  {
    id: "getting-started",
    icon: Zap,
    label: "Getting Started",
    color: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
    articles: [
      { q: "How do I create my first campaign?", a: "Go to Campaigns → New Campaign. Upload a CSV/XLSX lead file, select a template, configure your mailbox, and click Send. Your campaign will process and deliver emails according to your mailbox settings." },
      { q: "What file formats can I upload for leads?", a: "BrokerMAIL AI accepts CSV and XLSX (Excel) files. Your file should have column headers in the first row. Common columns include: name, email, vehicle, pickup, delivery, price, quote_id." },
      { q: "How do I add my business branding?", a: "Go to Settings → Branding. Enter your company name, tagline, website, phone, DOT/MC numbers, and accent color. Upload your logo. This branding appears in all your email templates automatically." },
      { q: "Can I preview an email before sending?", a: "Yes. In the Campaign creation flow, you can preview your email with actual lead data substituted. You can also send a test email to yourself before launching the full campaign." },
      { q: "How long does it take to send a campaign?", a: "Sending speed depends on your mailbox delay settings and the number of leads. You can configure a delay between sends (e.g., 30 seconds) to avoid triggering spam filters. A 100-lead campaign with a 30s delay takes ~50 minutes." },
    ],
  },
  {
    id: "smtp",
    icon: Server,
    label: "SMTP Setup",
    color: "bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400",
    articles: [
      { q: "How do I connect my email account?", a: "Go to Settings → Mailboxes → Add Mailbox. Enter your SMTP server host, port, username, and password. For Gmail SMTP, use smtp.gmail.com:587 with TLS. For Outlook, use smtp.office365.com:587." },
      { q: "What are the correct Gmail SMTP settings?", a: "Host: smtp.gmail.com | Port: 587 | TLS: Yes | Username: your Gmail address | Password: an App Password (not your main password). Generate an App Password at myaccount.google.com/apppasswords — 2-Step Verification must be enabled." },
      { q: "What are the correct Outlook SMTP settings?", a: "Host: smtp.office365.com | Port: 587 | TLS: Yes | Username: your full Outlook email | Password: your account password. For shared mailboxes, use the primary address as the username." },
      { q: "Why is my SMTP connection failing?", a: "Common causes: (1) Wrong host or port — double-check your provider's settings. (2) App Password not used for Gmail — you must use an App Password, not your main password. (3) TLS disabled — ensure TLS/STARTTLS is enabled. (4) Firewall blocking port 587 — contact your hosting provider." },
      { q: "Can I connect multiple mailboxes?", a: "Yes. The number of mailboxes you can connect depends on your plan. Growth and Agency plans allow multiple SMTP accounts. You can assign different mailboxes to different campaigns." },
      { q: "How do I set up Gmail drafts instead of direct send?", a: "Go to Settings → Connect Google Account. Authorize BrokerMAIL AI via OAuth. Once connected, you can choose 'Gmail Drafts' mode in a campaign — emails land in your Gmail Drafts folder for your review before you send them manually." },
    ],
  },
  {
    id: "campaigns",
    icon: Megaphone,
    label: "Campaigns",
    color: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
    articles: [
      { q: "What is a campaign?", a: "A campaign is a batch email send to a list of leads using a template. You upload a lead file, select a template, configure sending options, and launch. BrokerMAIL AI handles the personalization and delivery." },
      { q: "Can I pause or stop a running campaign?", a: "Yes. Open the campaign detail page and click Pause. The campaign will stop after the current email in the queue finishes. You can resume later from where it stopped." },
      { q: "What happens if an email bounces?", a: "Hard bounces (invalid address) are automatically marked as bounced and the address is added to your suppression list to prevent future sends. Soft bounces trigger a retry after a cooldown period." },
      { q: "Can I send follow-up emails to non-openers?", a: "The Follow-ups feature allows you to send a second email to leads who did not open the first. Go to the campaign detail → Follow-ups tab. You can schedule follow-ups after a specified number of days." },
      { q: "How do I see which emails were delivered?", a: "Go to Sent Emails. Filter by campaign, date range, or status (delivered, bounced, failed). Click any email to see its full details, timeline, and tracking data." },
    ],
  },
  {
    id: "templates",
    icon: FileText,
    label: "Templates",
    color: "bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400",
    articles: [
      { q: "What template variables are available?", a: "Available variables: {name} (recipient name), {vehicle} (year/make/model), {pickup} (pickup location), {delivery} (delivery location), {price} (transport price), {route} (route summary), {quote_id} (quote reference), {date} (today's date). These map to your CSV column headers." },
      { q: "How do I create a custom template?", a: "Go to Templates → New Template. Use the rich text editor to write your email body. Insert variables by typing {variable_name}. Choose a design style and configure CTA buttons. Save and assign to a campaign." },
      { q: "Can I use HTML in templates?", a: "Yes. In the Template Editor, switch to HTML Source mode to write or paste raw HTML. This gives you full control over the email design. Make sure to use inline styles for maximum email client compatibility." },
      { q: "What do the design styles (Clean, Modern, etc.) do?", a: "Design styles change the overall visual treatment of your email — font choices, layout structure, header style, and color scheme. They all use your branding (logo, accent color) but apply different typographic and structural treatments." },
      { q: "Can I save a template from the Single Email Composer?", a: "Yes. In the Compose page, after writing your email, click 'Save as Template' at the bottom of the editor. Give it a name and it will appear in your Templates library for future use." },
    ],
  },
  {
    id: "tracking",
    icon: BarChart3,
    label: "Tracking",
    color: "bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400",
    articles: [
      { q: "How does open tracking work?", a: "When open tracking is enabled, a 1×1 transparent pixel image is embedded in your email. When the recipient opens the email and their mail client loads images, we record an 'opened' event. Note: some clients (Apple Mail with MPP) pre-load images, which may inflate open counts." },
      { q: "How does click tracking work?", a: "Click tracking rewrites links in your email to pass through our tracking server before redirecting to the original URL. When a recipient clicks a link, we record the event and immediately redirect them — the experience is seamless." },
      { q: "Can I disable tracking?", a: "Yes. When composing an email or creating a campaign, you can toggle open tracking and click tracking off individually. You can also disable them globally in Settings → Tracking." },
      { q: "Why does my open count seem higher than expected?", a: "Apple Mail's Mail Privacy Protection (MPP) pre-loads email content including tracking pixels, registering as an open even if the user didn't read the email. This is a known limitation of open tracking across the industry — click tracking is generally more reliable." },
      { q: "Where do I see tracking stats?", a: "In Sent Emails, each row shows an open indicator. Click any email to see full tracking details: open count, first opened, last opened, and click events. Campaign-level stats are on the Campaign Detail page." },
    ],
  },
  {
    id: "billing",
    icon: CreditCard,
    label: "Billing",
    color: "bg-pink-50 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400",
    articles: [
      { q: "How do I upgrade my plan?", a: "Go to Settings → Plans. Click 'Request Upgrade' on the plan you want. Enter an optional note for the admin, then submit. An administrator will review and activate your new plan within 1–2 business days. You'll receive an email confirmation." },
      { q: "Is there a free plan?", a: "Yes. BrokerMAIL AI includes a free plan with a limited number of monthly sends. No credit card required. You can upgrade to a paid plan at any time." },
      { q: "How are email limits calculated?", a: "Email limits reset on the first of each calendar month. Each email delivered to one recipient counts as one send. Campaign previews, test emails, and Gmail drafts do not count toward your limit." },
      { q: "How do I request a refund?", a: "Email billing@brokermail.ai with your account email and reason for the request. See our Refund Policy for eligibility details. Refunds are processed within 5–10 business days of approval." },
      { q: "What payment methods are accepted?", a: "BrokerMAIL AI uses a manual billing model — our team arranges payment directly with you. We currently accept bank transfer and other methods arranged case-by-case. Contact sales@brokermail.ai to discuss." },
    ],
  },
  {
    id: "troubleshooting",
    icon: AlertTriangle,
    label: "Troubleshooting",
    color: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400",
    articles: [
      { q: "My campaign is stuck — emails aren't being sent", a: "Check: (1) Your mailbox is active and credentials are valid — test in Settings → Mailboxes. (2) Your plan has remaining email quota for this month. (3) The campaign status is 'running' not 'paused'. (4) No error messages on the campaign detail page. Contact support if the issue persists." },
      { q: "Emails are going to spam", a: "Common causes: (1) Sending too fast — increase the delay in mailbox settings. (2) Your SMTP server IP is on a blacklist — check mxtoolbox.com. (3) Email content triggers spam filters — avoid excessive links, all-caps, or spam keywords. (4) Missing SPF/DKIM records on your domain." },
      { q: "Template variables are showing as {name} instead of the actual value", a: "This means the column header in your CSV doesn't exactly match the variable name. Check that your CSV has a column named 'name' (lowercase). Variable matching is case-sensitive. Download a sample CSV from the Leads Import page for the correct format." },
      { q: "I can't log in to my account", a: "Try: (1) Clear your browser cache and cookies. (2) Use the 'Forgot Password' link on the login page. (3) Make sure you're using the correct email. If you signed up with Google, use 'Continue with Google' instead of email/password." },
      { q: "My sent emails show 'Unknown' as the recipient name", a: "This happens for older emails sent before the current name-parsing system. The platform now derives a name from the email address as a fallback. For new emails, enter the name in the To field: 'John Smith john@example.com'." },
    ],
  },
];

function ArticleCard({ article }: { article: Article }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        className="w-full text-left flex items-start justify-between gap-3 px-5 py-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{article.q}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/50 text-sm text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-700">
          {article.a}
        </div>
      )}
    </div>
  );
}

export default function Help() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filteredCategories = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q && !activeCategory) return categories;
    return categories
      .filter(cat => !activeCategory || cat.id === activeCategory)
      .map(cat => ({
        ...cat,
        articles: q
          ? cat.articles.filter(a => a.q.toLowerCase().includes(q) || a.a.toLowerCase().includes(q))
          : cat.articles,
      }))
      .filter(cat => cat.articles.length > 0);
  }, [search, activeCategory]);

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="py-20 px-5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-gradient-to-b from-blue-50 dark:from-blue-950/30 to-transparent rounded-full blur-3xl -z-10 pointer-events-none opacity-60" />
        <div className="container mx-auto max-w-2xl text-center">
          <FadeUp>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4 text-slate-900 dark:text-slate-100">Help Center</h1>
            <p className="text-slate-500 dark:text-slate-400 mb-8 text-sm sm:text-base">Find answers to common questions about BrokerMAIL AI.</p>
            <div className="relative max-w-lg mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search all help articles…"
                className="pl-11 h-12 rounded-2xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder-slate-400 shadow-sm"
              />
            </div>
          </FadeUp>
        </div>
      </section>

      {/* Category filters */}
      <section className="pb-6 px-5">
        <div className="container mx-auto max-w-5xl">
          <div className="flex flex-wrap gap-2 justify-center">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                !activeCategory ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              All topics
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(c => c === cat.id ? null : cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat.id ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                <cat.icon className="h-3 w-3" />
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Articles */}
      <section className="pb-24 px-5">
        <div className="container mx-auto max-w-4xl space-y-10">
          {filteredCategories.length === 0 ? (
            <div className="text-center py-16 text-slate-400 dark:text-slate-600">
              <Search className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No articles match your search.</p>
              <button onClick={() => setSearch("")} className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">Clear search</button>
            </div>
          ) : filteredCategories.map((cat, i) => (
            <FadeUp key={cat.id} delay={i * 0.04}>
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${cat.color}`}>
                    <cat.icon className="h-3.5 w-3.5" />
                  </div>
                  <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{cat.label}</h2>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{cat.articles.length} articles</span>
                </div>
                <div className="space-y-2">
                  {cat.articles.map(article => <ArticleCard key={article.q} article={article} />)}
                </div>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* Still need help? */}
      <section className="py-16 px-5 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800">
        <div className="container mx-auto max-w-xl text-center">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">Still need help?</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 leading-relaxed">
            Our team responds within 1 business day. Describe your issue in detail for the fastest resolution.
          </p>
          <Link href="/contact">
            <button className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors shadow-sm shadow-blue-200">
              Contact Support
            </button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
