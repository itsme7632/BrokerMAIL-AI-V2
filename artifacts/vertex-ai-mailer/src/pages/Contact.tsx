import { useState } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Zap, Mail, MessageSquare, Briefcase, Monitor, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

function FadeUp({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay, duration: 0.4 }} className={className}>
      {children}
    </motion.div>
  );
}

type FormState = "idle" | "submitting" | "success";

export default function Contact() {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [status, setStatus] = useState<FormState>("idle");

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) return;
    setStatus("submitting");
    await new Promise(r => setTimeout(r, 900));
    setStatus("success");
  }

  const contactCards = [
    {
      icon: Mail,
      title: "Support",
      desc: "Questions about setup, mailbox configuration, or sending issues.",
      detail: "support@brokermail.ai",
      color: "bg-blue-50 text-blue-600",
    },
    {
      icon: Briefcase,
      title: "Business Inquiries",
      desc: "Partnerships, integrations, and enterprise plans.",
      detail: "partnerships@brokermail.ai",
      color: "bg-violet-50 text-violet-600",
    },
    {
      icon: Monitor,
      title: "Request a Demo",
      desc: "See BrokerMail AI live — we'll walk you through the full workflow.",
      detail: "Fill out the form and mention 'demo' in your message.",
      color: "bg-emerald-50 text-emerald-600",
    },
  ];

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="py-20 px-5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-b from-blue-50 to-transparent rounded-full blur-3xl -z-10 pointer-events-none opacity-70" />
        <div className="container mx-auto max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium mb-6">
              <Zap className="h-3.5 w-3.5" />
              Get in Touch
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 text-slate-900">
              We're here to help
            </h1>
            <p className="text-slate-500 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
              Whether you need help with setup, want to request a demo, or have a business inquiry — reach out below.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact cards */}
      <section className="pb-16 px-5">
        <div className="container mx-auto max-w-5xl">
          <div className="grid sm:grid-cols-3 gap-5">
            {contactCards.map((card, i) => (
              <FadeUp key={card.title} delay={i * 0.08}>
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow h-full">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center mb-4 ${card.color}`}>
                    <card.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mb-1.5">{card.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed mb-3">{card.desc}</p>
                  <p className="text-xs font-semibold text-blue-600">{card.detail}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Contact form */}
      <section className="pb-24 px-5">
        <div className="container mx-auto max-w-xl">
          <FadeUp>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
              {status === "success" ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className="flex flex-col items-center text-center py-8 gap-4"
                >
                  <div className="h-16 w-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">Message sent!</h3>
                  <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
                    Thanks for reaching out. We'll get back to you within one business day.
                  </p>
                  <button
                    onClick={() => { setStatus("idle"); setForm({ name: "", email: "", company: "", message: "" }); }}
                    className="mt-2 text-blue-600 text-sm font-medium hover:underline"
                  >
                    Send another message
                  </button>
                </motion.div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-7">
                    <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center">
                      <MessageSquare className="h-4.5 w-4.5 text-blue-600" style={{ height: 18, width: 18 }} />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Send us a message</h2>
                      <p className="text-xs text-slate-400">We usually respond within 24 hours.</p>
                    </div>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Name <span className="text-red-400">*</span></label>
                        <Input
                          name="name"
                          value={form.name}
                          onChange={handleChange}
                          placeholder="John Smith"
                          required
                          className="h-10 rounded-xl border-slate-200 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Email <span className="text-red-400">*</span></label>
                        <Input
                          name="email"
                          type="email"
                          value={form.email}
                          onChange={handleChange}
                          placeholder="you@company.com"
                          required
                          className="h-10 rounded-xl border-slate-200 text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Company</label>
                      <Input
                        name="company"
                        value={form.company}
                        onChange={handleChange}
                        placeholder="Your brokerage or company name"
                        className="h-10 rounded-xl border-slate-200 text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Message <span className="text-red-400">*</span></label>
                      <textarea
                        name="message"
                        value={form.message}
                        onChange={handleChange}
                        placeholder="Tell us what you need help with, or mention 'demo' to schedule a walkthrough..."
                        required
                        rows={5}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors"
                      />
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      disabled={status === "submitting"}
                      className="w-full h-11 rounded-xl font-medium shadow-sm"
                    >
                      {status === "submitting" ? "Sending…" : "Send Message"}
                    </Button>
                  </form>
                </>
              )}
            </div>
          </FadeUp>
        </div>
      </section>
    </PublicLayout>
  );
}
