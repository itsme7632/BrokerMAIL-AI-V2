import React, { useState } from "react";
import { 
  KeyRound, 
  CheckCircle2, 
  Check, 
  Zap, 
  ArrowLeft,
  Mail
} from "lucide-react";

export default function ForgotPassword() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setIsSubmitted(true);
    }, 800);
  };

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900 font-sans">
      {/* LEFT PANEL */}
      <div className="w-full lg:w-[480px] flex flex-col relative shrink-0 border-r border-slate-100">
        {/* Header / Logo */}
        <div className="p-8 pb-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center shadow-sm">
              <Mail className="w-4 h-4 text-white" />
            </div>
            <div className="text-xl tracking-tight flex items-center">
              <span className="font-bold text-slate-900">BrokerMAIL</span>
              <span className="font-bold text-blue-600 ml-1">AI</span>
            </div>
          </div>
        </div>

        {/* Form Container */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-[360px] mx-auto">
            {!isSubmitted ? (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center mb-6 shadow-sm">
                  <KeyRound className="w-6 h-6 text-slate-500" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
                  Forgot your password?
                </h1>
                <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                  No worries. Enter your email and we'll send you a reset link to regain access to your account.
                </p>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-1.5">
                    <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                      Email address
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all duration-150 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      "Send reset link"
                    )}
                  </button>
                </form>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-6">
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                </div>
                
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
                  Check your inbox
                </h1>
                
                <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                  We've sent a password reset link to
                  <br />
                  <span className="inline-flex items-center justify-center px-3 py-1 mt-3 bg-slate-100 text-slate-700 rounded-md font-medium text-sm">
                    {email || "you@example.com"}
                  </span>
                  <br />
                  <span className="inline-block mt-3">The link expires in 60 minutes.</span>
                </p>

                <div className="flex flex-col w-full gap-3">
                  <button
                    onClick={() => setIsSubmitted(false)}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline transition-all"
                  >
                    Resend email
                  </button>
                </div>
              </div>
            )}

            <div className="mt-8 flex justify-center">
              <a href="#" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to sign in
              </a>
            </div>

            {/* Toggle button for mockup purposes */}
            <div className="mt-16 pt-8 border-t border-slate-100 flex justify-center">
              <button
                type="button"
                onClick={() => setIsSubmitted(!isSubmitted)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200"
              >
                Preview {isSubmitted ? "form" : "success"} state &rarr;
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL - Marketing/Value Prop */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-[#1D4ED8] via-[#2563EB] to-[#1E40AF] flex-col justify-between p-12 relative overflow-hidden">
        {/* Abstract shapes/glows for background texture */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-white opacity-5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-white opacity-[0.03] rounded-full blur-3xl translate-y-1/2 -translate-x-1/4"></div>

        <div className="flex justify-end relative z-10">
          <div className="inline-flex items-center rounded-full bg-white/10 border border-white/10 px-4 py-1.5 backdrop-blur-sm">
            <Zap className="w-4 h-4 text-blue-200 mr-2" fill="currentColor" />
            <span className="text-sm font-medium text-white shadow-sm">AI-Powered Outreach for Auto Transport</span>
          </div>
        </div>

        <div className="relative z-10 max-w-[520px] mb-12">
          <h2 className="text-4xl font-bold text-white tracking-tight mb-5 leading-tight">
            Recover your account
          </h2>
          <p className="text-lg text-blue-100 mb-10 leading-relaxed font-medium">
            We take security seriously. Reset links expire after 60 minutes and are single-use.
          </p>

          <div className="space-y-5">
            {[
              "Secure one-time link",
              "Expires in 60 minutes",
              "Email verification required",
              "Instant account recovery"
            ].map((feature, i) => (
              <div key={i} className="flex items-center text-blue-50">
                <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center mr-4 shrink-0">
                  <Check className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-[15px] font-medium">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
