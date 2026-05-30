import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, Sparkles, Zap } from "lucide-react";
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

const plans = [
  {
    name: "Starter",
    desc: "Perfect for independent brokers getting started.",
    highlight: false,
    badge: null,
    items: [
      "500 emails / month",
      "1 mailbox",
      "CSV / XLSX upload",
      "Basic personalization",
    ],
  },
  {
    name: "Growth",
    desc: "Built for scaling teams with heavy lead flow.",
    highlight: true,
    badge: "Most Popular",
    items: [
      "10,000 emails / month",
      "SMTP + IMAP support",
      "White-label branding",
      "Bulk outreach sending",
    ],
  },
  {
    name: "Agency",
    desc: "For multi-user shops and enterprise dispatch.",
    highlight: false,
    badge: null,
    items: [
      "Unlimited campaigns",
      "Multi-user support",
      "Admin dashboard",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    desc: "Custom solutions for large-scale operations.",
    highlight: false,
    badge: "Enterprise",
    items: [
      "Custom sending limits",
      "Dedicated onboarding",
      "Team management",
      "Future API access",
    ],
  },
];

const faqs = [
  {
    q: "When will pricing be available?",
    a: "We're currently in active development. Pricing plans will launch soon — sign up to be notified when they go live.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — when we launch, all plans will include a free trial period so you can test before committing.",
  },
  {
    q: "Can I switch plans later?",
    a: "Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect on your next billing cycle.",
  },
  {
    q: "What email providers are supported?",
    a: "BrokerMail AI works with Gmail, Outlook, Hostinger, GoDaddy, Zoho, Namecheap, and any private mail server that supports SMTP/IMAP.",
  },
  {
    q: "Is my mailbox password safe?",
    a: "Yes. All credentials are stored encrypted at rest. We never read your inbox — IMAP is used only to save sent copies.",
  },
  {
    q: "Do emails show BrokerMail AI branding?",
    a: "No. Emails are sent entirely from your own mailbox with your own branding. There are no forced signatures or watermarks.",
  },
  {
    q: "What counts as one email send?",
    a: "Each individual email delivered to a recipient counts as one send. Previews and drafts do not count toward your limit.",
  },
  {
    q: "Is bulk sending included?",
    a: "Bulk sending is included on Growth and above. Starter is suited for smaller batches or testing your templates.",
  },
];

export default function Pricing() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="py-20 px-5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-b from-blue-50 to-transparent rounded-full blur-3xl -z-10 pointer-events-none opacity-70" />
        <div className="container mx-auto max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium mb-6">
              <Zap className="h-3.5 w-3.5" />
              Plans &amp; Pricing
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 text-slate-900">
              Simple, transparent pricing
            </h1>
            <p className="text-slate-500 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
              Plans built for every stage of your brokerage — from solo brokers to full dispatch teams.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Pricing cards */}
      <section className="pb-24 px-5">
        <div className="container mx-auto max-w-6xl">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {plans.map((plan, i) => (
              <FadeUp key={plan.name} delay={i * 0.08}>
                <div className={`rounded-2xl border p-7 flex flex-col h-full transition-all duration-200 ${
                  plan.highlight
                    ? "bg-blue-600 border-blue-500 shadow-2xl shadow-blue-200"
                    : "bg-white border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5"
                }`}>
                  {plan.badge && (
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold mb-4 self-start ${
                      plan.highlight ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                    }`}>
                      <Sparkles className="h-3 w-3" />
                      {plan.badge}
                    </div>
                  )}
                  <h3 className={`text-xl font-bold mb-1.5 ${plan.highlight ? "text-white" : "text-slate-900"}`}>{plan.name}</h3>
                  <p className={`text-sm mb-6 leading-relaxed ${plan.highlight ? "text-blue-100" : "text-slate-500"}`}>{plan.desc}</p>
                  <ul className="space-y-3 mb-8 flex-1">
                    {plan.items.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <CheckCircle2 className={`h-4 w-4 flex-shrink-0 mt-0.5 ${plan.highlight ? "text-blue-200" : "text-emerald-500"}`} />
                        <span className={`text-sm ${plan.highlight ? "text-blue-50" : "text-slate-700"}`}>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled
                    className={`w-full h-11 rounded-xl text-sm font-semibold cursor-not-allowed select-none ${
                      plan.highlight
                        ? "bg-white/20 text-white border border-white/30"
                        : "bg-slate-100 text-slate-400 border border-slate-200"
                    }`}
                  >
                    Coming Soon
                  </button>
                </div>
              </FadeUp>
            ))}
          </div>

          {/* Note */}
          <FadeUp delay={0.35}>
            <div className="mt-10 text-center">
              <p className="text-sm text-slate-500">
                All plans will include a free trial.{" "}
                <Link href="/contact">
                  <span className="text-blue-600 hover:underline cursor-pointer font-medium">Contact us</span>
                </Link>{" "}
                for Enterprise inquiries.
              </p>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 px-5 border-t border-slate-100 bg-slate-50">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-3">Pricing FAQ</h2>
            <p className="text-slate-500 text-sm sm:text-base">Common questions about plans and billing.</p>
          </div>
          <Accordion type="single" collapsible className="space-y-3">
            {faqs.map((faq, i) => (
              <FadeUp key={i} delay={i * 0.05}>
                <AccordionItem value={`faq-${i}`} className="bg-white border border-slate-200 rounded-2xl px-5 shadow-sm data-[state=open]:shadow-md transition-shadow">
                  <AccordionTrigger className="text-left text-sm font-semibold text-slate-900 hover:no-underline py-4">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-slate-500 leading-relaxed pb-4">
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
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 mx-auto mb-5 flex items-center justify-center shadow-lg shadow-blue-200">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">Ready to get started?</h2>
          <p className="text-slate-500 mb-7 text-sm leading-relaxed">Sign up now and be the first to access paid plans when they launch.</p>
          <Button size="lg" className="h-11 px-8 rounded-xl shadow-md font-medium" asChild>
            <Link href="/register">Create Free Account</Link>
          </Button>
        </div>
      </section>
    </PublicLayout>
  );
}
