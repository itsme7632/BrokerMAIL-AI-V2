import { ReactNode } from "react";
import { Link } from "wouter";
import { CheckCircle, Zap } from "lucide-react";

const FEATURES = [
  "Import thousands of leads from CSV or XLSX",
  "Generate hyper-personalized emails with AI",
  "Sync directly to your Gmail drafts folder",
  "Full campaign tracking & analytics",
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-white">
      {/* Left: form panel */}
      <div className="flex flex-col justify-center w-full lg:w-[480px] flex-shrink-0 px-8 py-12 lg:px-16 border-r border-slate-100">
        <div className="w-full max-w-sm mx-auto">
          {/* Logo */}
          <Link href="/" className="flex items-center mb-10">
            <img
              src="/logo-horizontal.png"
              alt="BrokerMail AI"
              className="h-11 w-auto object-contain"
              style={{ maxWidth: "200px" }}
            />
          </Link>
          {children}
        </div>
      </div>

      {/* Right: marketing panel */}
      <div className="hidden lg:flex flex-1 flex-col justify-center bg-gradient-to-br from-blue-600 to-blue-800 px-16 py-12 relative overflow-hidden">
        {/* Subtle background shapes */}
        <div className="absolute top-[-10%] right-[-5%] w-96 h-96 rounded-full bg-white/5 blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-5%] left-[-5%] w-80 h-80 rounded-full bg-blue-400/20 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-lg">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 text-white/90 text-xs font-medium mb-8 border border-white/20">
            <Zap className="h-3.5 w-3.5" />
            AI-Powered Outreach for Auto Transport
          </div>

          <h2 className="text-4xl font-bold text-white leading-[1.15] mb-5">
            Scale your outreach.
            <br />
            Close more transport deals.
          </h2>
          <p className="text-blue-100 text-lg leading-relaxed mb-12">
            Turn raw lead sheets into highly personalized, ready-to-send Gmail drafts in minutes — not hours.
          </p>

          <div className="space-y-4">
            {FEATURES.map((feature, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-white/90 text-sm font-medium">{feature}</span>
              </div>
            ))}
          </div>

          {/* Decorative card mockup using square logo icon */}
          <div className="mt-14 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl overflow-hidden flex-shrink-0 bg-white/10 flex items-center justify-center">
                <img
                  src="/logo-icon.png"
                  alt="BrokerMail AI"
                  className="h-8 w-8 object-contain rounded-lg"
                />
              </div>
              <div>
                <div className="h-2.5 w-28 bg-white/40 rounded-full mb-1.5" />
                <div className="h-2 w-20 bg-white/20 rounded-full" />
              </div>
              <div className="ml-auto">
                <div className="h-6 w-16 bg-white/20 rounded-full" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-2 w-full bg-white/15 rounded-full" />
              <div className="h-2 w-5/6 bg-white/15 rounded-full" />
              <div className="h-2 w-4/6 bg-white/15 rounded-full" />
            </div>
            <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-3">
              <div className="h-2 w-1/3 bg-white/20 rounded-full" />
              <div className="h-2 w-1/4 bg-white/20 rounded-full" />
              <div className="ml-auto h-7 w-20 bg-white/25 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
