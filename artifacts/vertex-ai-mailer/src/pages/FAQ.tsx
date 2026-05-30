import { useState } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Zap, Search } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

const categories = [
  {
    label: "Sending & Delivery",
    faqs: [
      {
        q: "Does BrokerMail AI send emails automatically?",
        a: "No. BrokerMail AI never auto-sends without your action. You review the campaign, confirm the recipients, and click Send yourself. For Gmail, emails land as drafts for an extra review step. You are always in full control.",
      },
      {
        q: "Can I send bulk email campaigns?",
        a: "Yes. You can send campaigns to hundreds or thousands of leads at once. You upload a CSV or XLSX file, pick a template, and send the full batch directly from your own business mailbox.",
      },
      {
        q: "Will sent emails appear in my Sent folder?",
        a: "Yes. When IMAP is configured, BrokerMail AI automatically saves a copy of every sent email to your Sent folder using IMAP APPEND. This works for Outlook, Gmail, Hostinger, GoDaddy, and most IMAP-compatible mailboxes.",
      },
      {
        q: "Can I control the sending speed or delay between emails?",
        a: "Yes. You can configure a delay between emails in your mailbox settings to avoid triggering spam filters on bulk sends.",
      },
    ],
  },
  {
    label: "Email Providers",
    faqs: [
      {
        q: "Does it support Gmail?",
        a: "Yes. You can connect Gmail in two ways: (1) use Gmail SMTP credentials to send directly, or (2) connect your Google account to create Gmail drafts that land in your Gmail Drafts folder ready to review.",
      },
      {
        q: "Can I use Outlook or private business email?",
        a: "Yes. Outlook (personal Outlook.com accounts and Office 365 business accounts) is fully supported via SMTP and IMAP. Any private mail server that supports SMTP/IMAP will also work.",
      },
      {
        q: "Does it work with Hostinger and GoDaddy?",
        a: "Yes. Hostinger and GoDaddy are both tested and supported. For cPanel-based providers like these, your SMTP host should be mail.yourdomain.com — BrokerMail AI shows a warning if an incorrect host is detected.",
      },
      {
        q: "What about Zoho, Namecheap, and other providers?",
        a: "Any provider that offers SMTP/IMAP access works with BrokerMail AI. This includes Zoho Mail, Namecheap Private Email, FastMail, ProtonMail Bridge, and most business email hosts.",
      },
    ],
  },
  {
    label: "Uploads & Templates",
    faqs: [
      {
        q: "Can I upload XLSX files?",
        a: "Yes. Both CSV and XLSX (Excel) files are supported. The column detector automatically identifies name, email, vehicle, route, price, and other fields regardless of your column header naming.",
      },
      {
        q: "How do template variables work?",
        a: "Any column header from your spreadsheet becomes a variable in curly braces. For example, a column named 'Vehicle' becomes {vehicle} in your template. BrokerMail AI fills in the value for each row when sending.",
      },
      {
        q: "What if a variable is missing from a row?",
        a: "If a value is missing for a specific row, that variable is replaced with an empty string. You can preview each email before sending to check how it looks for individual leads.",
      },
    ],
  },
  {
    label: "Security & Privacy",
    faqs: [
      {
        q: "Is SMTP secure?",
        a: "Yes. BrokerMail AI connects to your SMTP server using TLS/SSL (port 465 or STARTTLS on port 587). Passwords are stored encrypted at rest and never exposed in logs.",
      },
      {
        q: "Can I use my own branding?",
        a: "Yes, fully. BrokerMail AI is completely white-label. Emails are sent from your own business mailbox with your company name and signature. There are no forced footers, watermarks, or 'Sent via' attributions.",
      },
      {
        q: "Does BrokerMail AI read my inbox?",
        a: "No. IMAP access is used only to save copies of sent emails to your Sent folder. Your inbox is never read, scanned, or stored.",
      },
    ],
  },
  {
    label: "Platform",
    faqs: [
      {
        q: "Is BrokerMail AI mobile friendly?",
        a: "Yes. The platform is fully responsive and works on phones and tablets. You can manage templates, upload lead sheets, and monitor campaigns from any device.",
      },
      {
        q: "Who is BrokerMail AI built for?",
        a: "BrokerMail AI is built specifically for auto transport brokers, dispatch teams, vehicle shipping companies, and lead generation teams in the transport industry.",
      },
    ],
  },
];

function FadeUp({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay, duration: 0.4 }}>
      {children}
    </motion.div>
  );
}

export default function FAQ() {
  const [query, setQuery] = useState("");

  const filtered = categories
    .map(cat => ({
      ...cat,
      faqs: cat.faqs.filter(
        f =>
          f.q.toLowerCase().includes(query.toLowerCase()) ||
          f.a.toLowerCase().includes(query.toLowerCase())
      ),
    }))
    .filter(cat => cat.faqs.length > 0);

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="py-20 px-5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-b from-blue-50 to-transparent rounded-full blur-3xl -z-10 pointer-events-none opacity-70" />
        <div className="container mx-auto max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium mb-6">
              <Zap className="h-3.5 w-3.5" />
              Frequently Asked Questions
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 text-slate-900">
              How can we help?
            </h1>
            <p className="text-slate-500 text-base sm:text-lg max-w-xl mx-auto mb-8 leading-relaxed">
              Everything you need to know about BrokerMail AI, email sending, and mailbox setup.
            </p>
            {/* Search */}
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search questions..."
                className="pl-10 h-11 rounded-xl border-slate-200 bg-white shadow-sm text-sm"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* FAQ accordion */}
      <section className="pb-24 px-5">
        <div className="container mx-auto max-w-3xl">
          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-slate-500 text-sm">No results for "<span className="font-medium text-slate-700">{query}</span>"</p>
              <button onClick={() => setQuery("")} className="mt-3 text-blue-600 text-sm font-medium hover:underline">Clear search</button>
            </div>
          ) : (
            <div className="space-y-10">
              {filtered.map((cat, ci) => (
                <FadeUp key={cat.label} delay={ci * 0.06}>
                  <div>
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">{cat.label}</h2>
                    <Accordion type="single" collapsible className="space-y-3">
                      {cat.faqs.map((faq, fi) => (
                        <AccordionItem
                          key={fi}
                          value={`${ci}-${fi}`}
                          className="bg-white border border-slate-200 rounded-2xl px-5 shadow-sm data-[state=open]:shadow-md transition-shadow"
                        >
                          <AccordionTrigger className="text-left text-sm font-semibold text-slate-900 hover:no-underline py-4">
                            {faq.q}
                          </AccordionTrigger>
                          <AccordionContent className="text-sm text-slate-500 leading-relaxed pb-4">
                            {faq.a}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>
                </FadeUp>
              ))}
            </div>
          )}

          {/* Still have questions */}
          <FadeUp delay={0.3}>
            <div className="mt-16 text-center p-8 rounded-2xl bg-blue-50 border border-blue-100">
              <h3 className="font-bold text-slate-900 mb-2">Still have questions?</h3>
              <p className="text-sm text-slate-500 mb-4">Our team is happy to help you get set up.</p>
              <Link href="/contact">
                <span className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors cursor-pointer shadow-sm">
                  Contact Support
                </span>
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
    </PublicLayout>
  );
}
