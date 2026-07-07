import React, { useState } from "react";
import { Eye, EyeOff, Loader2, CheckCircle2, Zap } from "lucide-react";

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Mocking the submit action for interactivity demonstration
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeout(() => setIsSubmitting(false), 2000);
  };

  return (
    <div className="min-h-screen w-full flex bg-white font-sans">
      {/* Left Panel: Form */}
      <div className="w-full lg:w-[480px] flex flex-col justify-center px-8 py-12 sm:px-12 lg:px-16 shrink-0 relative z-10">
        <div className="w-full max-w-sm mx-auto">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-10">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 shadow-sm flex items-center justify-center">
              <Zap className="w-4 h-4 text-white fill-white" />
            </div>
            <span className="text-xl tracking-tight">
              <span className="font-bold text-slate-900">BrokerMAIL</span>
              <span className="font-bold text-blue-600 ml-1">AI</span>
            </span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
              Welcome back
            </h1>
            <p className="text-sm text-slate-500">
              Please enter your details to sign in to your account.
            </p>
          </div>

          {/* OAuth */}
          <button
            type="button"
            className="w-full h-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium flex items-center justify-center gap-2.5 transition-all duration-150 shadow-sm mb-6"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-4 mb-6">
            <div className="h-px bg-slate-200 flex-1"></div>
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Or
            </span>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field with Error State */}
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
                defaultValue="invalid-email@"
                className="w-full h-11 px-4 rounded-xl border border-red-500 bg-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 text-slate-900 placeholder:text-slate-400 shadow-sm transition-all duration-150"
              />
              <p className="text-xs text-red-500 mt-1">
                Please enter a valid email address.
              </p>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-slate-700"
                >
                  Password
                </label>
                <a
                  href="#"
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline underline-offset-4"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="w-full h-11 pl-4 pr-11 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-slate-900 placeholder:text-slate-400 shadow-sm transition-all duration-150"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors rounded-r-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center pt-1 pb-1">
              <button
                type="button"
                role="checkbox"
                aria-checked={rememberMe}
                onClick={() => setRememberMe(!rememberMe)}
                className={`w-4 h-4 rounded flex items-center justify-center border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-1 ${
                  rememberMe
                    ? "bg-blue-600 border-blue-600"
                    : "bg-white border-slate-300"
                }`}
              >
                {rememberMe && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>
              <label
                className="ml-2.5 text-sm text-slate-600 cursor-pointer select-none"
                onClick={() => setRememberMe(!rememberMe)}
              >
                Remember me
              </label>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all duration-150 shadow-sm flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-slate-600">
            Don't have an account?{" "}
            <a
              href="#"
              className="font-medium text-blue-600 hover:text-blue-700 hover:underline underline-offset-4"
            >
              Sign up
            </a>
          </p>
        </div>
      </div>

      {/* Right Panel: Marketing */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-[#1D4ED8] via-[#2563EB] to-[#1E40AF] p-16 flex-col justify-between relative overflow-hidden">
        {/* Abstract shapes / lighting for background texture */}
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-white opacity-[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-blue-400 opacity-[0.1] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none"></div>
        
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/10 backdrop-blur-sm mb-8">
            <Zap className="w-4 h-4 text-blue-200 fill-blue-200" />
            <span className="text-sm font-medium text-white tracking-wide">
              AI-Powered Outreach for Auto Transport
            </span>
          </div>

          <h2 className="text-4xl xl:text-5xl font-bold text-white tracking-tight mb-6 leading-[1.1]">
            Scale your outreach. <br />
            <span className="text-blue-200">Close more transport deals.</span>
          </h2>
          
          <p className="text-lg text-blue-100 max-w-xl leading-relaxed mb-16 font-medium">
            Turn raw lead sheets into highly personalized, ready-to-send Gmail
            drafts in minutes — not hours.
          </p>

          <div className="space-y-6">
            {[
              "Import thousands of leads from CSV or XLSX",
              "Generate hyper-personalized emails with AI",
              "Sync directly to your Gmail drafts folder",
              "Full campaign tracking & analytics",
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-6 h-6 rounded-full bg-blue-500/30 flex items-center justify-center shrink-0 border border-blue-400/30">
                  <CheckCircle2 className="w-4 h-4 text-white" />
                </div>
                <span className="text-white font-medium text-lg">{feature}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonial / Social proof placeholder */}
        <div className="relative z-10 mt-auto pt-16">
          <div className="p-6 rounded-2xl bg-white/10 border border-white/10 backdrop-blur-md max-w-lg">
            <div className="flex gap-1 mb-4">
              {[...Array(5)].map((_, i) => (
                <svg key={i} className="w-5 h-5 text-yellow-400 fill-yellow-400" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <p className="text-blue-50 italic text-base mb-4 leading-relaxed">
              "BrokerMAIL has completely transformed how we handle carrier outreach. 
              We're pushing 5x the volume of emails and getting far better response rates 
              because the AI actually sounds like us."
            </p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-300 flex items-center justify-center text-blue-900 font-bold overflow-hidden shadow-sm">
                MJ
              </div>
              <div>
                <div className="text-white font-semibold text-sm">Marcus Johnson</div>
                <div className="text-blue-200 text-xs">Logistics Coordinator</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
