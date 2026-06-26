import { useEffect, useState } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, Sparkles, Zap, Loader2, AlertCircle, HelpCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

function FadeUp({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.4 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface Plan {
  id: number;
  name: string;
  slug: string;
  description: string;
  price: number;
  priceLabel: string;
  isPopular: boolean;
  buttonText: string;
  supportLevel: string;
  monthlyEmailLimit: number;
  smtpAccountsLimit: number;
  campaignsLimit: number;
  batchSendLimit: number;
  features: string[];
  sortOrder: number;
  isActive: boolean;
}

const faqs = [
  {
    q: "How does the upgrade process work?",
    a: "Click 'Request Access' on any plan. Submit a short request from your dashboard. An admin reviews it within 1–2 business days and activates your new plan. You'll receive an email confirmation.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes — BrokerMAIL AI includes a free plan so you can explore the platform before committing. No credit card required.",
  },
  {
    q: "Can I switch plans later?",
    a: "Absolutely. Submit a new upgrade request from the Plans page inside your dashboard at any time. Changes take effect upon admin approval.",
  },
  {
    q: "What email providers are supported?",
    a: "BrokerMAIL AI works with Gmail, Outlook, Hostinger, GoDaddy, Zoho, Namecheap, and any private server that supports SMTP/IMAP.",
  },
  {
    q: "Is my mailbox password safe?",
    a: "Yes. All credentials are encrypted at rest using AES-256. We never read your inbox — IMAP is only used to save sent copies.",
  },
  {
    q: "Do emails show BrokerMAIL AI branding?",
    a: "No. Emails go out entirely from your own mailbox with your own branding. No forced signatures or watermarks.",
  },
  {
    q: "What counts as one email send?",
    a: "Each email delivered to one recipient counts as one send. Previews, test emails, and Gmail drafts don't count toward your limit.",
  },
  {
    q: "Is bulk sending included?",
    a: "Bulk sending is included on Growth and above. Starter is suited for smaller batches or testing your templates.",
  },
];

const COMPARE_FEATURES = [
  { label: "Monthly emails", key: (p: Plan) => p.monthlyEmailLimit < 0 || p.monthlyEmailLimit === 999999 ? "Unlimited" : p.monthlyEmailLimit.toLocaleString() },
  { label: "Mailboxes", key: (p: Plan) => p.smtpAccountsLimit < 0 || p.smtpAccountsLimit === 999 ? "Unlimited" : String(p.smtpAccountsLimit) },
  { label: "Campaigns", key: (p: Plan) => p.campaignsLimit < 0 || p.campaignsLimit === 999 ? "Unlimited" : String(p.campaignsLimit) },
  { label: "Batch send limit", key: (p: Plan) => p.batchSendLimit < 0 || p.batchSendLimit === 999999 ? "Unlimited" : String(p.batchSendLimit) },
  { label: "Support level", key: (p: Plan) => p.supportLevel },
];

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL ?? "/";
    fetch(`${base}api/billing/plans`)
      .then(r => r.ok ? r.json() : Promise.reject("Failed to load plans"))
      .then(setPlans)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="py-20 px-5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-b from-blue-50 dark:from-blue-950/30 to-transparent rounded-full blur-3xl -z-10 pointer-events-none opacity-70" />
        <div className="container mx-auto max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-medium mb-6">
              <Zap className="h-3.5 w-3.5" />
              Plans &amp; Pricing
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 text-slate-900 dark:text-slate-100">
              Simple, transparent pricing
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
              Plans built for every stage of your brokerage — from solo brokers to full dispatch teams.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Pricing cards */}
      <section className="pb-24 px-5">
        <div className="container mx-auto max-w-6xl">
          {loading && (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading plans…
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-red-500">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {!loading && !error && plans.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <HelpCircle className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Pricing plans coming soon. <Link href="/contact"><span className="text-blue-600 hover:underline cursor-pointer">Contact us</span></Link> for details.</p>
            </div>
          )}

          {!loading && !error && plans.length > 0 && (
            <>
              <div className={`grid gap-5 ${
                plans.length === 1 ? "sm:grid-cols-1 max-w-sm mx-auto"
                : plans.length === 2 ? "sm:grid-cols-2 max-w-2xl mx-auto"
                : plans.length === 3 ? "sm:grid-cols-3"
                : "sm:grid-cols-2 lg:grid-cols-4"
              }`}>
                {plans.map((plan, i) => (
                  <FadeUp key={plan.id} delay={i * 0.08}>
                    <div className={`relative rounded-2xl border p-7 flex flex-col h-full transition-all duration-200 ${
                      plan.isPopular
                        ? "bg-blue-600 border-blue-500 shadow-2xl shadow-blue-200 dark:shadow-blue-900/40"
                        : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-lg hover:-translate-y-0.5"
                    }`}>
                      {plan.isPopular && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                          <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-amber-400 text-amber-900 text-xs font-bold shadow">
                            <Sparkles className="h-2.5 w-2.5" />
                            Most Popular
                          </div>
                        </div>
                      )}

                      <div className="mb-5">
                        <h3 className={`text-xl font-bold mb-1 ${plan.isPopular ? "text-white" : "text-slate-900 dark:text-slate-100"}`}>{plan.name}</h3>
                        <p className={`text-sm leading-relaxed ${plan.isPopular ? "text-blue-100" : "text-slate-500 dark:text-slate-400"}`}>{plan.description}</p>
                      </div>

                      <div className={`text-3xl font-extrabold mb-6 ${plan.isPopular ? "text-white" : "text-slate-900 dark:text-slate-100"}`}>
                        {plan.priceLabel}
                        {plan.price === 0 && (
                          <span className={`text-sm font-normal ml-1 ${plan.isPopular ? "text-blue-200" : "text-slate-400 dark:text-slate-500"}`}>free forever</span>
                        )}
                      </div>

                      <ul className="space-y-2.5 mb-8 flex-1">
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className={`h-4 w-4 flex-shrink-0 mt-0.5 ${plan.isPopular ? "text-blue-200" : "text-emerald-500"}`} />
                          <span className={`text-sm ${plan.isPopular ? "text-blue-50" : "text-slate-700 dark:text-slate-300"}`}>
                            {plan.monthlyEmailLimit < 0 || plan.monthlyEmailLimit === 999999 ? "Unlimited" : plan.monthlyEmailLimit.toLocaleString()} emails / month
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className={`h-4 w-4 flex-shrink-0 mt-0.5 ${plan.isPopular ? "text-blue-200" : "text-emerald-500"}`} />
                          <span className={`text-sm ${plan.isPopular ? "text-blue-50" : "text-slate-700 dark:text-slate-300"}`}>
                            {plan.smtpAccountsLimit < 0 || plan.smtpAccountsLimit === 999 ? "Unlimited" : plan.smtpAccountsLimit} mailbox{plan.smtpAccountsLimit === 1 ? "" : "es"}
                          </span>
                        </li>
                        {(plan.features || []).map(f => (
                          <li key={f} className="flex items-start gap-2.5">
                            <CheckCircle2 className={`h-4 w-4 flex-shrink-0 mt-0.5 ${plan.isPopular ? "text-blue-200" : "text-emerald-500"}`} />
                            <span className={`text-sm ${plan.isPopular ? "text-blue-50" : "text-slate-700 dark:text-slate-300"}`}>{f}</span>
                          </li>
                        ))}
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className={`h-4 w-4 flex-shrink-0 mt-0.5 ${plan.isPopular ? "text-blue-200" : "text-emerald-500"}`} />
                          <span className={`text-sm ${plan.isPopular ? "text-blue-50" : "text-slate-700 dark:text-slate-300"}`}>
                            {plan.supportLevel} support
                          </span>
                        </li>
                      </ul>

                      <Link href="/register">
                        <button className={`w-full h-11 rounded-xl text-sm font-semibold transition-all duration-150 cursor-pointer ${
                          plan.isPopular
                            ? "bg-white text-blue-700 hover:bg-blue-50 shadow"
                            : "bg-blue-600 hover:bg-blue-700 text-white border border-blue-600 shadow-sm"
                        }`}>
                          {plan.buttonText}
                        </button>
                      </Link>
                    </div>
                  </FadeUp>
                ))}
              </div>

              {/* Comparison table */}
              {plans.length >= 2 && (
                <FadeUp delay={0.3} className="mt-16">
                  <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <th className="text-left px-5 py-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-48">Feature</th>
                          {plans.map(plan => (
                            <th key={plan.id} className="px-5 py-4 text-center text-xs font-bold text-slate-800 dark:text-slate-200">
                              <span className={plan.isPopular ? "text-blue-600 dark:text-blue-400" : ""}>{plan.name}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {COMPARE_FEATURES.map((row, ri) => (
                          <tr key={row.label} className={`border-b border-slate-50 dark:border-slate-800/50 ${ri % 2 === 0 ? "bg-slate-50/50 dark:bg-slate-800/20" : "bg-white dark:bg-transparent"}`}>
                            <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400 text-sm font-medium">{row.label}</td>
                            {plans.map(plan => (
                              <td key={plan.id} className="px-5 py-3.5 text-center text-slate-800 dark:text-slate-200 font-medium text-sm">
                                {row.key(plan)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </FadeUp>
              )}
            </>
          )}

          <FadeUp delay={0.35}>
            <div className="mt-10 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                All plans include a free trial.{" "}
                <Link href="/contact">
                  <span className="text-blue-600 hover:underline cursor-pointer font-medium">Contact us</span>
                </Link>{" "}
                for Enterprise or custom volume inquiries.
              </p>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 px-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">Pricing FAQ</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base">Common questions about plans and billing.</p>
          </div>
          <Accordion type="single" collapsible className="space-y-3">
            {faqs.map((faq, i) => (
              <FadeUp key={i} delay={i * 0.04}>
                <AccordionItem value={`faq-${i}`} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 shadow-sm data-[state=open]:shadow-md transition-shadow">
                  <AccordionTrigger className="text-left text-sm font-semibold text-slate-900 dark:text-slate-100 hover:no-underline py-4">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed pb-4">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              </FadeUp>
            ))}
          </Accordion>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-5">
        <div className="container mx-auto max-w-xl text-center">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 mx-auto mb-5 flex items-center justify-center shadow-lg shadow-blue-200 dark:shadow-blue-900/40">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-4">Ready to get started?</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-7 text-sm leading-relaxed">
            Create a free account and start sending smarter outreach to your auto transport leads.
          </p>
          <Button size="lg" className="h-11 px-8 rounded-xl shadow-md font-medium" asChild>
            <Link href="/register">Create Free Account</Link>
          </Button>
        </div>
      </section>
    </PublicLayout>
  );
}
