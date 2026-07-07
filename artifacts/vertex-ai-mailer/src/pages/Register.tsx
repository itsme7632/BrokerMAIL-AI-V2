import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Check, X } from "lucide-react";
import { useState, useMemo } from "react";

// ─── Password strength helpers ────────────────────────────────────────────────

interface PasswordChecks {
  minLength:  boolean;
  uppercase:  boolean;
  lowercase:  boolean;
  number:     boolean;
  special:    boolean;
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
  return Object.values(checks).filter(Boolean).length; // 0–5
}

function getStrengthLabel(score: number): { label: string; color: string } {
  if (score <= 1) return { label: "Very weak",  color: "bg-red-500"    };
  if (score === 2) return { label: "Weak",       color: "bg-orange-500" };
  if (score === 3) return { label: "Fair",       color: "bg-yellow-500" };
  if (score === 4) return { label: "Good",       color: "bg-blue-500"   };
  return              { label: "Strong",      color: "bg-green-500"  };
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const registerSchema = z.object({
  name:            z.string().min(2, "Name must be at least 2 characters"),
  email:           z.string().email("Please enter a valid email address"),
  password:        z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine(d => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type RegisterFormValues = z.infer<typeof registerSchema>;

// ─── Google icon ──────────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

// ─── Requirement row ──────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function Register() {
  const { register, user } = useAuth();
  const { toast }          = useToast();
  const [, setLocation]    = useLocation();

  const [isSubmitting,       setIsSubmitting]       = useState(false);
  const [showPassword,       setShowPassword]       = useState(false);
  const [showConfirm,        setShowConfirm]        = useState(false);
  const [passwordTouched,    setPasswordTouched]    = useState(false);

  if (user) {
    setLocation(user.role === "admin" ? "/admin/dashboard" : "/dashboard");
    return null;
  }

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    mode: "onChange",
  });

  const watchedPassword = form.watch("password");
  const watchedConfirm  = form.watch("confirmPassword");

  const checks = useMemo(() => getPasswordChecks(watchedPassword), [watchedPassword]);
  const score  = getStrengthScore(checks);
  const { label: strengthLabel, color: strengthColor } = getStrengthLabel(score);
  const passwordsMatch = watchedPassword.length > 0 && watchedConfirm.length > 0 && watchedPassword === watchedConfirm;
  const passwordMismatch = watchedConfirm.length > 0 && watchedPassword !== watchedConfirm;

  const onSubmit = async (data: RegisterFormValues) => {
    try {
      setIsSubmitting(true);
      const res = await register({ name: data.name, email: data.email, password: data.password });
      if (res.requiresVerification) {
        toast({
          title: "Account created!",
          description: "Check your email for a 6-digit verification code.",
        });
        setLocation("/verify-email");
      } else {
        toast({
          title: "Account created!",
          description: "Welcome to BrokerMAIL AI. Let's get started.",
        });
        setLocation(res.user.role === "admin" ? "/admin/dashboard" : "/dashboard");
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Registration failed",
        description: err.message || "An error occurred while creating your account.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Create your account</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">Start generating outreach campaigns in minutes</p>
        </div>

        {/* Google OAuth */}
        <button
          type="button"
          onClick={() => window.location.href = "/api/auth/google"}
          className="w-full h-11 flex items-center justify-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 transition-all shadow-sm"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-100 dark:border-slate-700" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white dark:bg-slate-950 px-3 text-slate-400 uppercase tracking-wider">or</span>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" autoComplete="on">

            {/* Full Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700 dark:text-slate-300 text-sm font-medium">Full Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="John Smith"
                      autoComplete="name"
                      className="h-11 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-blue-500 text-slate-900 dark:text-white"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700 dark:text-slate-300 text-sm font-medium">Email</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="you@example.com"
                      type="email"
                      autoComplete="email"
                      className="h-11 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-blue-500 text-slate-900 dark:text-white"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Password */}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700 dark:text-slate-300 text-sm font-medium">Password</FormLabel>
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

                  {/* Strength meter — shown after user starts typing */}
                  {passwordTouched && watchedPassword.length > 0 && (
                    <div className="mt-2.5 space-y-2.5">
                      {/* Bar */}
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

                      {/* Requirements */}
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
                  <FormLabel className="text-slate-700 dark:text-slate-300 text-sm font-medium">Confirm Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showConfirm ? "text" : "password"}
                        placeholder="Re-enter your password"
                        autoComplete="new-password"
                        className={`h-11 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-blue-500 text-slate-900 dark:text-white pr-11 transition-colors ${
                          passwordsMatch  ? "border-green-400 focus:border-green-500" :
                          passwordMismatch ? "border-red-400 focus:border-red-500" : ""
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

                  {/* Live match indicator */}
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

            <Button
              type="submit"
              className="w-full h-11 rounded-xl font-medium shadow-sm mt-2"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating account…</>
                : "Create account"}
            </Button>
          </form>
        </Form>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium">
            Sign in
          </Link>
        </p>

        <p className="text-center text-xs text-slate-400 leading-relaxed">
          By creating an account you agree to our{" "}
          <Link href="/terms"   className="text-blue-600 hover:underline font-medium">Terms of Service</Link>
          {" "}and{" "}
          <Link href="/privacy" className="text-blue-600 hover:underline font-medium">Privacy Policy</Link>.
        </p>
      </div>
    </AuthLayout>
  );
}
