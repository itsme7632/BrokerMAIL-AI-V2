import { PublicLayout } from "@/components/layout/PublicLayout";
import { motion } from "framer-motion";
import { Truck, Zap, Shield, Target, Users, BarChart3, Mail } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

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

const values = [
  {
    icon: Truck,
    title: "Built for Auto Transport",
    desc: "Every feature, every template, every variable in BrokerMAIL AI is designed around the daily reality of auto transport brokers — leads, vehicles, routes, quotes, and follow-ups.",
  },
  {
    icon: Shield,
    title: "Your Mailbox, Your Identity",
    desc: "Emails go out from your own mailbox. No shared sending IPs. No forced watermarks or signatures. Your recipients see your business, not ours.",
  },
  {
    icon: Target,
    title: "Precision Over Volume",
    desc: "We're not a blast-and-pray platform. We help brokers send personalized, professional outreach that actually gets responses — because the auto transport industry is built on relationships.",
  },
  {
    icon: Zap,
    title: "Fast to Deploy",
    desc: "Upload your leads, pick a template, review, and send. No complex setup. No marketing degree required. Most brokers are sending within their first session.",
  },
  {
    icon: BarChart3,
    title: "Track What Matters",
    desc: "See who opened, who clicked, and what happened — so you know which leads to follow up with and which quotes to push harder on.",
  },
  {
    icon: Users,
    title: "Made for Real Brokers",
    desc: "Not built in a bubble. BrokerMAIL AI was designed by talking to working brokers about the tools they actually wish they had.",
  },
];

export default function About() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="py-20 px-5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b from-blue-50 dark:from-blue-950/30 to-transparent rounded-full blur-3xl -z-10 pointer-events-none opacity-60" />
        <div className="container mx-auto max-w-3xl text-center">
          <FadeUp>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-medium mb-6">
              <Truck className="h-3.5 w-3.5" />
              About BrokerMAIL AI
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-5 text-slate-900 dark:text-slate-100">
              Built for the people moving America's vehicles
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
              BrokerMAIL AI is an AI-powered email outreach platform built specifically for auto transport brokers — because generic marketing tools were never designed for the speed, volume, and specificity of transport brokerage.
            </p>
          </FadeUp>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 px-5 bg-slate-50 dark:bg-slate-900/50">
        <div className="container mx-auto max-w-4xl">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <FadeUp>
              <div className="space-y-5">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">Our Mission</h2>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  To give auto transport brokers the same outreach capabilities that enterprise sales teams have — without the complexity, the monthly SaaS bloat, or the learning curve that comes with tools built for a different industry.
                </p>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Every lead you have is a real opportunity. A vehicle that needs to move. A family waiting for their car. A business counting on their fleet. We help you reach those leads with professional, personalized outreach — fast.
                </p>
              </div>
            </FadeUp>
            <FadeUp delay={0.1}>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 shadow-sm">
                <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mb-5">
                  <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <blockquote className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed italic">
                  "Auto transport brokers are some of the hardest-working people in logistics — juggling quotes, routes, customers, and carriers all day. They deserve outreach tools that work as fast as they do."
                </blockquote>
                <p className="text-slate-400 dark:text-slate-500 text-xs mt-4">— BrokerMAIL AI Team</p>
              </div>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* What it is */}
      <section className="py-16 px-5">
        <div className="container mx-auto max-w-4xl">
          <FadeUp className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">What BrokerMAIL AI Does</h2>
            <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto leading-relaxed text-sm">
              At its core, BrokerMAIL AI solves one problem: turning a list of leads into personalized, professional outreach — quickly and at scale.
            </p>
          </FadeUp>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              { step: "01", title: "Upload your leads", desc: "Drop in a CSV or XLSX file with your prospect list — names, vehicles, routes, quote IDs, whatever data you have." },
              { step: "02", title: "Pick or build a template", desc: "Use one of our AI-optimized templates for auto transport, or create your own with variable placeholders." },
              { step: "03", title: "Send from your own mailbox", desc: "Connect your SMTP or Gmail account. Emails go out from your address, with your branding — nothing from BrokerMAIL AI shows." },
              { step: "04", title: "Track opens and clicks", desc: "See which recipients opened and clicked. Focus your follow-up where the interest actually is." },
            ].map((item, i) => (
              <FadeUp key={item.step} delay={i * 0.07}>
                <div className="bg-white dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
                  <span className="text-4xl font-black text-slate-100 dark:text-slate-700 block mb-3">{item.step}</span>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{item.title}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-16 px-5 bg-slate-50 dark:bg-slate-900/50">
        <div className="container mx-auto max-w-5xl">
          <FadeUp className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">Why BrokerMAIL AI Exists</h2>
            <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto text-sm leading-relaxed">
              Generic email marketing tools weren't built for this industry. We were.
            </p>
          </FadeUp>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {values.map((v, i) => (
              <FadeUp key={v.title} delay={i * 0.06}>
                <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-6 shadow-sm h-full">
                  <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center mb-4">
                    <v.icon className="h-4.5 w-4.5 text-blue-600 dark:text-blue-400 h-[18px] w-[18px]" />
                  </div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 text-sm">{v.title}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{v.desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="py-16 px-5">
        <div className="container mx-auto max-w-3xl text-center">
          <FadeUp>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-5">Who Is It For?</h2>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
              BrokerMAIL AI is built exclusively for <strong className="text-slate-800 dark:text-slate-200">auto transport brokers</strong> — individuals and teams who source vehicle shipping leads, quote customers, and coordinate carriers across the United States.
            </p>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-8">
              Whether you're a solo broker working 80 leads a week or a dispatch team processing thousands — BrokerMAIL AI scales with you. Starter plans for individuals, Growth for teams, Agency for multi-user shops.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="rounded-xl h-11 px-7 font-medium">
                <Link href="/register">Get Started Free</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="rounded-xl h-11 px-7 font-medium dark:border-slate-700 dark:text-slate-300">
                <Link href="/pricing">View Pricing</Link>
              </Button>
            </div>
          </FadeUp>
        </div>
      </section>
    </PublicLayout>
  );
}
