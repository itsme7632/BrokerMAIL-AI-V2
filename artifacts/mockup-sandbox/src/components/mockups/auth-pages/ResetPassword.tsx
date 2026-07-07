import React, { useState } from "react";
import { Eye, EyeOff, CheckCircle2, Check, AlertCircle, ArrowLeft, Zap, KeyRound } from "lucide-react";

export default function ResetPassword() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isExpired, setIsExpired] = useState(false);

  // Default populated dummy state
  const password = "SuperSecretPassword123!";
  const confirmPassword = "SuperSecretPassword123!";

  return (
    <div className="min-h-screen flex bg-white font-sans text-slate-900">
      {/* LEFT PANEL */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 lg:px-8 relative">
        {/* Top left logo for mobile only */}
        <div className="absolute top-6 left-6 lg:hidden flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight">BrokerMAIL <span className="text-blue-600">AI</span></span>
        </div>

        <div className="w-full max-w-[380px]">
          {isSuccess ? (
            <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-300">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-6 shadow-sm">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Password updated!</h2>
              <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                Your password has been successfully reset. You can now sign in with your new password.
              </p>
              <button
                type="button"
                className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all duration-150 shadow-sm"
              >
                Sign in to your account
              </button>
            </div>
          ) : (
            <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300">
              <a href="#" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 mb-8 transition-colors w-fit">
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Back to sign in
              </a>

              <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Set new password</h2>
              <p className="text-sm text-slate-500 mb-8">Choose a strong password for your account.</p>

              {isExpired && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800">This reset link has expired or is invalid.</p>
                    <button className="text-sm font-medium text-red-600 hover:text-red-700 underline mt-1 transition-colors">
                      Request a new link &rarr;
                    </button>
                  </div>
                </div>
              )}

              <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); setIsSuccess(true); }}>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">New Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      readOnly
                      className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-slate-900 placeholder:text-slate-400 focus-visible:outline-none transition-all shadow-sm"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  
                  {/* Password Strength Indicator */}
                  <div className="mt-4 space-y-3">
                    <div className="flex gap-1.5 h-1.5">
                      <div className="flex-1 bg-green-500 rounded-full"></div>
                      <div className="flex-1 bg-green-500 rounded-full"></div>
                      <div className="flex-1 bg-green-500 rounded-full"></div>
                      <div className="flex-1 bg-green-500 rounded-full"></div>
                    </div>
                    <p className="text-xs font-medium text-green-600 flex items-center justify-between">
                      <span>Strong password</span>
                    </p>
                    <div className="grid grid-cols-2 gap-y-2 text-xs text-slate-500">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> At least 8 characters
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> One uppercase letter
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> One number
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> One special character
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm Password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      readOnly
                      className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-slate-900 placeholder:text-slate-400 focus-visible:outline-none transition-all shadow-sm"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="mt-2 text-xs font-medium text-green-600 flex items-center gap-1">
                    Passwords match ✓
                  </p>
                </div>

                <button
                  type="submit"
                  className="w-full h-11 mt-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all duration-150 shadow-sm"
                >
                  Reset password
                </button>
              </form>
            </div>
          )}

          {/* Dev toggles */}
          <div className="mt-12 pt-6 border-t border-slate-100 flex flex-wrap gap-4 justify-center text-sm">
            <button
              onClick={() => { setIsSuccess(!isSuccess); setIsExpired(false); }}
              className="text-slate-500 hover:text-slate-900 font-medium transition-colors"
            >
              Toggle success state &rarr;
            </button>
            <button
              onClick={() => { setIsExpired(!isExpired); setIsSuccess(false); }}
              className="text-slate-500 hover:text-slate-900 font-medium transition-colors"
            >
              Toggle expired link &rarr;
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL - Marketing */}
      <div className="hidden lg:flex w-[480px] xl:w-[560px] bg-gradient-to-br from-[#1D4ED8] via-[#2563EB] to-[#1E40AF] p-12 flex-col justify-between text-white relative overflow-hidden">
        {/* Background decorative elements */}
        <div className="absolute top-0 right-0 -translate-y-1/4 translate-x-1/4 w-[500px] h-[500px] bg-white/10 rounded-full blur-3xl opacity-50 pointer-events-none" />
        <div className="absolute bottom-0 left-0 translate-y-1/4 -translate-x-1/4 w-[400px] h-[400px] bg-blue-400/20 rounded-full blur-3xl opacity-50 pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center gap-2.5 mb-20">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
              <Zap className="w-5 h-5 text-blue-600" />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">BrokerMAIL <span className="text-blue-300">AI</span></span>
          </div>

          <div className="space-y-6 max-w-md">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-sm font-medium backdrop-blur-sm shadow-sm mb-2">
              <Zap className="w-4 h-4" />
              AI-Powered Outreach for Auto Transport
            </div>
            
            <h1 className="text-4xl font-bold tracking-tight leading-tight">
              Almost there!
            </h1>
            <p className="text-lg text-blue-100 leading-relaxed">
              Create a strong password to keep your BrokerMAIL AI account secure.
            </p>

            <div className="mt-12 space-y-5">
              {[
                "Use 12+ characters for best security",
                "Mix letters, numbers and symbols",
                "Avoid using personal information",
                "Don't reuse passwords from other sites"
              ].map((tip, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0 mt-0.5 border border-white/20">
                    <Check className="w-3.5 h-3.5 text-blue-100" />
                  </div>
                  <span className="text-blue-50 leading-relaxed font-medium">{tip}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between pt-8 border-t border-white/10 mt-12">
          <p className="text-sm text-blue-200">© {new Date().getFullYear()} BrokerMAIL AI</p>
          <div className="flex gap-4 text-sm text-blue-200 font-medium">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
          </div>
        </div>
      </div>
    </div>
  );
}
