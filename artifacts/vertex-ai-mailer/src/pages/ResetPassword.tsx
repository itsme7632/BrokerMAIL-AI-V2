import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, EyeOff, Check, X, ShieldCheck, AlertTriangle, Clock } from "lucide-react";

// ─── Password strength helpers ────────────────────────────────────────────────

interface PasswordChecks {
  minLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number:    boolean;
  special:   boolean;
}

function getPasswordChecks(pw: string): PasswordChecks {
  return {
    minLength: pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    number:    /[0-9]/.test(pw),
    special:   /[^A-Za-z0-9]/.test(pw),
  };
}

function getStrengthScore(checks: PasswordChecks): number {
  return Object.values(checks).filter(Boolean).length;
}

function getStrengthLabel(score: number): { label: string; color: string } {
  if (score <= 1) return { label: "Very weak",  color: "bg-red-500"    };
  if (score === 2) return { label: "Weak",       color: "bg-orange-500" };
  if (score === 3) return { label: "Fair",       color: "bg-yellow-500" };
  if (score === 4) return { label: "Good",       color: "bg-blue-500"   };
  return              { label: "Strong",      color: "bg-green-500"  };
}

function Req({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {met
        ? <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
        : <X    className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 flex-shrink-0" />}
      <span className={`text-xs transition-colors ${met ? "text-green-600 dark:text-green-400" : "text-slate-500 dark:text-slate-400"}`}>
        {label}
      </span>
    </div>
  );
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const schema = z.object({
  password:        z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine(d => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
type FormValues = z.infer<typeof schema>;

// ─── Token states ─────────────────────────────────────────────────────────────
type TokenState = "verifying" | "valid" | "invalid" | "expired";

// ─── Component ────────────────────────────────────────────────────────────────

export default function ResetPassword() {
  const [, setLocation]  = useLocation();
  const [tokenState, setTokenState]         = useState<TokenState>("verifying");
  const [isSubmitting, setIsSubmitting]     = useState(false);
  const [success, setSuccess]               = useState(false);
  const [showPassword, setShowPassword]     = useState(false);
  const [showConfirm, setShowConfirm]       = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [apiError, setApiError]             = useState<string | null>(null);

  // Extract token from URL
  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") ?? "";
  }, []);

  // Verify token on mount
  useEffect(() => {
    if (!token) {
      setTokenState("invalid");
      return;
    }
    fetch(`/api/auth/verify-reset-token?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then((data: { valid: boolean; reason?: string }) => {
        if (data.valid) {
          setTokenState("valid");
        } else if (data.reason === "expired") {
          setTokenState("expired");
        } else {
          setTokenState("invalid");
        }
      })
      .catch(() => setTokenState("invalid"));
  }, [token]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
    mode: "onChange",
  });

  const watchedPassword = form.watch("password");
  const watchedConfirm  = form.watch("confirmPassword");
  const checks          = useMemo(() => getPasswordChecks(watchedPassword), [watchedPassword]);
  const score           = getStrengthScore(checks);
  const { label: strengthLabel, color: strengthColor } = getStrengthLabel(score);
  const passwordsMatch   = watchedPassword.length > 0 && watchedConfirm.length > 0 && watchedPassword === watchedConfirm;
  const passwordMismatch = watchedConfirm.length > 0 && watchedPassword !== watchedConfirm;

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    setApiError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, password: data.password }),
      });
      const body = await res.json();
      if (!res.ok) {
        const code = body?.error;
        if (code === "expired_token") { setTokenState("expired"); return; }
        if (code === "invalid_token") { setTokenState("invalid"); return; }
        setApiError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSuccess(true);
      // Redirect to login after 3 seconds
      setTimeout(() => setLocation("/login"), 3000);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (tokenState === "verifying") {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Verifying your reset link…</p>
        </div>
      </AuthLayout>
    );
  }

  // ── Invalid token ───────────────────────────────────────────────────────────
  if (tokenState === "invalid") {
    return (
      <AuthLayout>
        <div className="space-y-6">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Invalid reset link</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              This password reset link is invalid or has already been used.
              Please request a new one.
            </p>
          </div>
          <Link href="/forgot-password">
            <Button className="w-full h-11 rounded-xl font-medium">Request a new link</Button>
          </Link>
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            <Link href="/login" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium">
              Back to login
            </Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  // ── Expired token ───────────────────────────────────────────────────────────
  if (tokenState === "expired") {
    return (
      <AuthLayout>
        <div className="space-y-6">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <Clock className="h-8 w-8 text-amber-500" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Link expired</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              This reset link has expired. Reset links are valid for 60 minutes.
              Please request a new one.
            </p>
          </div>
          <Link href="/forgot-password">
            <Button className="w-full h-11 rounded-xl font-medium">Request a new link</Button>
          </Link>
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            <Link href="/login" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium">
              Back to login
            </Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  if (success) {
    return (
      <AuthLayout>
        <div className="space-y-6">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
              <ShieldCheck className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Password updated!</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Your password has been changed successfully.
              You'll be redirected to the login page in a moment.
            </p>
          </div>
          <Link href="/login">
            <Button className="w-full h-11 rounded-xl font-medium">Go to login</Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  // ── Reset form ──────────────────────────────────────────────────────────────
  return (
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Set new password</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            Choose a strong password to secure your account.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" autoComplete="off">

            {/* New Password */}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700 dark:text-slate-300 text-sm font-medium">New Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        className="h-11 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-blue-500 text-slate-900 dark:text-white pr-11"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          setPasswordTouched(true);
                        }}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />

                  {/* Strength meter */}
                  {passwordTouched && watchedPassword.length > 0 && (
                    <div className="mt-2.5 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex gap-1">
                          {[1, 2, 3, 4, 5].map(i => (
                            <div
                              key={i}
                              className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                                i <= score ? strengthColor : "bg-slate-100 dark:bg-slate-700"
                              }`}
                            />
                          ))}
                        </div>
                        <span className={`text-xs font-medium transition-colors ${
                          score <= 1 ? "text-red-500" :
                          score === 2 ? "text-orange-500" :
                          score === 3 ? "text-yellow-600" :
                          score === 4 ? "text-blue-600" : "text-green-600"
                        }`}>
                          {strengthLabel}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-700">
                        <Req met={checks.minLength} label="8+ characters" />
                        <Req met={checks.uppercase}  label="Uppercase letter" />
                        <Req met={checks.lowercase}  label="Lowercase letter" />
                        <Req met={checks.number}     label="Number" />
                        <Req met={checks.special}    label="Special character" />
                      </div>
                    </div>
                  )}
                </FormItem>
              )}
            />

            {/* Confirm Password */}
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700 dark:text-slate-300 text-sm font-medium">Confirm New Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showConfirm ? "text" : "password"}
                        placeholder="Re-enter your new password"
                        autoComplete="new-password"
                        className={`h-11 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-blue-500 text-slate-900 dark:text-white pr-11 transition-colors ${
                          passwordsMatch   ? "border-green-400 focus:border-green-500" :
                          passwordMismatch ? "border-red-400 focus:border-red-500"     : ""
                        }`}
                        {...field}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowConfirm(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5"
                        aria-label={showConfirm ? "Hide password" : "Show password"}
                      >
                        {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>

                  {watchedConfirm.length > 0 && (
                    <p className={`text-xs mt-1 flex items-center gap-1.5 ${passwordsMatch ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                      {passwordsMatch
                        ? <><Check className="h-3.5 w-3.5" /> Passwords match</>
                        : <><X className="h-3.5 w-3.5" /> Passwords do not match</>}
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* API-level error (not token-related) */}
            {apiError && (
              <div className="flex items-start gap-2.5 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl">
                <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-600 dark:text-red-400">{apiError}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 rounded-xl font-medium shadow-sm mt-2"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Updating password…</>
                : "Update password"}
            </Button>
          </form>
        </Form>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          <Link href="/login" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium">
            Back to login
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
