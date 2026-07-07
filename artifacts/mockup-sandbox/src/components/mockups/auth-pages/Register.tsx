import React, { useState } from "react";
import { Eye, EyeOff, CheckCircle2, Circle, Zap, Check, ArrowRight } from "lucide-react";

export default function Register() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // State for interactivity (mocking validation)
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("Pa");
  const [confirmPassword, setConfirmPassword] = useState("Pa");

  // Determine password strength based on length/chars (mocked but interactive)
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  const score = [hasMinLength, hasUpper, hasNumber, hasSpecial].filter(Boolean).length;
  
  let strengthLabel = "Weak";
  let strengthColor = "text-red-500";
  let barColors = ["bg-red-500", "bg-slate-200", "bg-slate-200", "bg-slate-200"];
  
  if (score === 2) {
    strengthLabel = "Fair";
    strengthColor = "text-orange-500";
    barColors = ["bg-orange-500", "bg-orange-500", "bg-slate-200", "bg-slate-200"];
  } else if (score === 3) {
    strengthLabel = "Strong";
    strengthColor = "text-green-500";
    barColors = ["bg-green-500", "bg-green-500", "bg-green-500", "bg-slate-200"];
  } else if (score === 4) {
    strengthLabel = "Very strong";
    strengthColor = "text-green-500";
    barColors = ["bg-green-500", "bg-green-500", "bg-green-500", "bg-green-500"];
  }

  const passwordsMatch = password.length > 0 && password === confirmPassword;

  return (
    <div className="min-h-screen w-full flex bg-white font-sans">
      {/* Left Panel: Form */}
      <div className="w-full lg:w-[480px] shrink-0 flex flex-col justify-center px-8 sm:px-12 py-12">
        <div className="w-full max-w-sm mx-auto">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-10">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-sm">
              <Zap className="w-4 h-4 text-white fill-white" />
            </div>
            <div className="text-xl tracking-tight flex">
              <span className="font-bold text-slate-900">BrokerMAIL</span>
              <span className="font-bold text-blue-600 ml-1">AI</span>
            </div>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Create an account</h1>
            <p className="text-sm text-slate-500 mt-2">
              Join thousands of auto transport brokers scaling their outreach.
            </p>
          </div>

          <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="name">
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  placeholder="Alex Johnson"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-slate-900 placeholder:text-slate-400 shadow-sm transition-all"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-slate-900 placeholder:text-slate-400 shadow-sm transition-all"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-11 pl-3.5 pr-10 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-slate-900 placeholder:text-slate-400 shadow-sm transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                
                {/* Strength Indicator */}
                {password.length > 0 && (
                  <div className="mt-3">
                    <div className="flex gap-1.5 mb-1.5">
                      {barColors.map((color, i) => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${color}`} />
                      ))}
                    </div>
                    <div className={`text-xs font-medium ${strengthColor} mb-3`}>
                      {strengthLabel}
                    </div>
                    
                    {/* Requirements Checklist */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        {hasMinLength ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 fill-green-50" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-slate-300" />
                        )}
                        <span className={hasMinLength ? "text-slate-700" : "text-slate-500"}>8+ characters</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {hasUpper ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 fill-green-50" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-slate-300" />
                        )}
                        <span className={hasUpper ? "text-slate-700" : "text-slate-500"}>Uppercase letter</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {hasNumber ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 fill-green-50" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-slate-300" />
                        )}
                        <span className={hasNumber ? "text-slate-700" : "text-slate-500"}>Number</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {hasSpecial ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 fill-green-50" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-slate-300" />
                        )}
                        <span className={hasSpecial ? "text-slate-700" : "text-slate-500"}>Special character</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="confirmPassword">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full h-11 pl-3.5 pr-10 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-slate-900 placeholder:text-slate-400 shadow-sm transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  >
                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {passwordsMatch && (
                  <div className="mt-2 text-xs font-medium text-green-600 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> Passwords match
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all duration-150 shadow-sm mt-2 flex items-center justify-center gap-2"
            >
              Create account <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center space-y-4">
            <p className="text-sm text-slate-600">
              Already have an account?{" "}
              <a href="#" className="font-semibold text-blue-600 hover:text-blue-700 hover:underline">
                Sign in
              </a>
            </p>
            <p className="text-[11px] leading-relaxed text-slate-500 max-w-xs mx-auto">
              By creating an account, you agree to our{" "}
              <a href="#" className="underline hover:text-slate-700">Terms of Service</a>{" "}
              and{" "}
              <a href="#" className="underline hover:text-slate-700">Privacy Policy</a>.
            </p>
          </div>
        </div>
      </div>

      {/* Right Panel: Marketing */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-[#1D4ED8] via-[#2563EB] to-[#1E40AF] relative overflow-hidden items-center justify-center p-12">
        {/* Abstract decorative elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-[20%] -right-[10%] w-[70%] h-[70%] rounded-full bg-white/5 blur-3xl" />
          <div className="absolute -bottom-[20%] -left-[10%] w-[60%] h-[60%] rounded-full bg-blue-400/20 blur-3xl" />
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
        </div>

        <div className="relative z-10 max-w-lg">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-md mb-8">
            <Zap className="w-4 h-4 text-blue-300 fill-blue-300" />
            <span className="text-xs font-semibold text-white tracking-wide">
              AI-Powered Outreach for Auto Transport
            </span>
          </div>

          <h2 className="text-4xl lg:text-5xl font-bold text-white tracking-tight leading-[1.1] mb-6">
            Scale your outreach.<br />
            <span className="text-blue-200">Close more transport deals.</span>
          </h2>
          
          <p className="text-lg text-blue-100 leading-relaxed mb-10 max-w-md">
            Turn raw lead sheets into highly personalized, ready-to-send Gmail drafts in minutes — not hours.
          </p>

          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-6 h-6 mt-0.5 rounded-full bg-blue-500/30 flex items-center justify-center shrink-0 border border-blue-400/30">
                <Check className="w-3.5 h-3.5 text-blue-100" />
              </div>
              <p className="text-blue-50 font-medium">Import thousands of leads from CSV or XLSX</p>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-6 h-6 mt-0.5 rounded-full bg-blue-500/30 flex items-center justify-center shrink-0 border border-blue-400/30">
                <Check className="w-3.5 h-3.5 text-blue-100" />
              </div>
              <p className="text-blue-50 font-medium">Generate hyper-personalized emails with AI</p>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-6 h-6 mt-0.5 rounded-full bg-blue-500/30 flex items-center justify-center shrink-0 border border-blue-400/30">
                <Check className="w-3.5 h-3.5 text-blue-100" />
              </div>
              <p className="text-blue-50 font-medium">Sync directly to your Gmail drafts folder</p>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-6 h-6 mt-0.5 rounded-full bg-blue-500/30 flex items-center justify-center shrink-0 border border-blue-400/30">
                <Check className="w-3.5 h-3.5 text-blue-100" />
              </div>
              <p className="text-blue-50 font-medium">Full campaign tracking & analytics</p>
            </div>
          </div>
          
          {/* Testimonial snippet */}
          <div className="mt-16 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
            <div className="flex gap-1 mb-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <svg key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <p className="text-blue-100 text-sm italic leading-relaxed mb-4">
              "BrokerMAIL AI completely transformed how we pitch carriers. We went from sending 50 emails a day to 500, all personalized."
            </p>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-800 flex items-center justify-center text-xs font-bold text-white">
                JD
              </div>
              <div>
                <p className="text-xs font-semibold text-white">James D.</p>
                <p className="text-[10px] text-blue-300">Senior Freight Broker</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
