import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/button";
import { Zap, Lock, Shield, Mail, Eye, KeyRound, Smartphone, Server, CheckCircle2, Globe } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

function FadeUp({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay, duration: 0.4 }} className={className}>
      {children}
    </motion.div>
  );
}

const badges = [
  { icon: Lock,       label: "Encrypted Credentials",  color: "bg-blue-50 text-blue-600 border-blue-100" },
  { icon: Shield,     label: "SMTP Secure",             color: "bg-violet-50 text-violet-600 border-violet-100" },
  { icon: Server,     label: "IMAP Compatible",         color: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  { icon: Globe,      label: "White-Label Ready",       color: "bg-amber-50 text-amber-600 border-amber-100" },
  { icon: Smartphone, label: "Mobile Friendly",         color: "bg-pink-50 text-pink-600 border-pink-100" },
];

const sections = [
  {
    icon: Lock,
    color: "bg-blue-50 text-blue-600",
    title: "Password Encryption",
    body: "All SMTP and IMAP passwords are encrypted at rest using AES-256 encryption before being stored in the database. Credentials are decrypted only at the moment of connection establishment and are never written to logs, error messages, or API responses. Your password is never visible once saved.",
    bullets: [
      "AES-256 encryption at rest",
      "Decrypted only at connection time",
      "Never logged or exposed in API responses",
      "Separate encryption key per environment",
    ],
  },
  {
    icon: Shield,
    color: "bg-violet-50 text-violet-600",
    title: "Secure SMTP & IMAP Handling",
    body: "All outbound connections use TLS/SSL (port 465) or STARTTLS (port 587). IMAP connections use TLS on port 993. BrokerMail AI does not downgrade connections or use plaintext authentication. Connection timeouts and error handling are designed to prevent credential exposure on failure.",
    bullets: [
      "TLS/SSL enforced on all SMTP connections",
      "STARTTLS supported as a fallback",
      "IMAP TLS on port 993",
      "No plaintext authentication fallback",
    ],
  },
  {
    icon: Eye,
    color: "bg-emerald-50 text-emerald-600",
    title: "No Inbox Reading",
    body: "IMAP access in BrokerMail AI is strictly write-only for the purpose of saving sent email copies to your Sent folder. Your inbox, drafts, and other folders are never read, scanned, indexed, or stored. We do not access any messages you have received.",
    bullets: [
      "IMAP used only to APPEND to Sent folder",
      "Inbox is never read or scanned",
      "No message content is stored server-side",
      "Sent copies are written, not synced",
    ],
  },
  {
    icon: Globe,
    color: "bg-amber-50 text-amber-600",
    title: "White-Label Email Privacy",
    body: "Every email you send goes out from your own business mailbox with your own domain, name, and branding. BrokerMail AI never inserts its own branding, tracking pixels, footers, or 'Sent via' attributions into outgoing messages. Your recipients see only your company.",
    bullets: [
      "Zero forced branding or footers",
      "No 'Sent via BrokerMail AI' attribution",
      "No tracking pixels injected into emails",
      "Sent from your own domain and identity",
    ],
  },
  {
    icon: KeyRound,
    color: "bg-pink-50 text-pink-600",
    title: "Secure Authentication",
    body: "User accounts are protected with JWT-based authentication with short-lived tokens. Sessions expire automatically. Passwords are hashed using bcrypt with a high work factor. The admin panel uses a separate authentication flow with additional protection.",
    bullets: [
      "JWT tokens with short expiry",
      "Passwords hashed with bcrypt",
      "Session expiry enforced server-side",
      "Admin panel uses separate auth flow",
    ],
  },
  {
    icon: Mail,
    color: "bg-cyan-50 text-cyan-600",
    title: "Transport Industry Focus",
    body: "BrokerMail AI is purpose-built for auto transport brokers — not a generic email tool. Every feature is designed around how vehicle shipping teams generate and work leads. There is no third-party data sharing, advertising, or resale of any lead or contact data you upload.",
    bullets: [
      "No third-party data sharing",
      "Lead data is yours — not resold",
      "Built specifically for transport workflows",
      "No advertising or analytics profiling",
    ],
  },
];

export default function Trust() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="py-20 px-5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-b from-blue-50 to-transparent rounded-full blur-3xl -z-10 pointer-events-none opacity-70" />
        <div className="container mx-auto max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium mb-6">
              <Shield className="h-3.5 w-3.5" />
              Security &amp; Trust
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 text-slate-900">
              Built for real transport businesses
            </h1>
            <p className="text-slate-500 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
              Your credentials, your emails, your data — handled securely and never shared.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Trust badges */}
      <section className="pb-16 px-5">
        <div className="container mx-auto max-w-4xl">
          <div className="flex flex-wrap justify-center gap-3">
            {badges.map((badge, i) => (
              <FadeUp key={badge.label} delay={i * 0.07}>
                <div className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl border bg-white shadow-sm ${badge.color}`}>
                  <badge.icon className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-semibold">{badge.label}</span>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Security sections */}
      <section className="pb-24 px-5">
        <div className="container mx-auto max-w-5xl">
          <div className="grid md:grid-cols-2 gap-6">
            {sections.map((sec, i) => (
              <FadeUp key={sec.title} delay={i * 0.07}>
                <div className="bg-white rounded-2xl border border-slate-200 p-7 shadow-sm hover:shadow-md transition-shadow h-full">
                  <div className="flex items-start gap-4 mb-5">
                    <div className={`h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0 ${sec.color}`}>
                      <sec.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 mb-1">{sec.title}</h3>
                      <p className="text-sm text-slate-500 leading-relaxed">{sec.body}</p>
                    </div>
                  </div>
                  <ul className="space-y-2 border-t border-slate-100 pt-4">
                    {sec.bullets.map(b => (
                      <li key={b} className="flex items-center gap-2.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                        <span className="text-xs text-slate-600">{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Dark trust section */}
      <section className="py-20 px-5 bg-slate-900">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Our commitments to you</h2>
            <p className="text-slate-400 max-w-lg mx-auto text-sm sm:text-base">
              We built BrokerMail AI on principles of privacy, transparency, and full white-label control.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              "We never read your inbox",
              "We never sell your lead data",
              "Your emails carry only your branding",
              "Credentials stored encrypted — never in plaintext",
              "No forced 'Sent via' attribution ever",
              "IMAP is write-only — Sent folder only",
            ].map((item, i) => (
              <FadeUp key={item} delay={i * 0.06}>
                <div className="flex items-start gap-3 bg-slate-800/50 rounded-2xl p-5 border border-slate-700/50 hover:border-slate-600 transition-colors">
                  <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400 flex-shrink-0 mt-0.5" style={{ height: 18, width: 18 }} />
                  <span className="text-sm text-slate-200 font-medium leading-snug">{item}</span>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-5">
        <div className="container mx-auto max-w-xl text-center">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 mx-auto mb-5 flex items-center justify-center shadow-lg shadow-blue-200">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Questions about security?</h2>
          <p className="text-slate-500 mb-7 text-sm leading-relaxed">
            Reach out to our team — we're happy to answer any questions about how your data is handled.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" className="h-11 px-7 rounded-xl shadow-md font-medium" asChild>
              <Link href="/register">Get Started</Link>
            </Button>
            <Button size="lg" variant="outline" className="h-11 px-7 rounded-xl border-slate-200 font-medium text-slate-700" asChild>
              <Link href="/contact">Contact Us</Link>
            </Button>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
