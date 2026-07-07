import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, MailCheck } from "lucide-react";

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
});
type FormValues = z.infer<typeof schema>;

export default function ForgotPassword() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted]       = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: data.email }),
      });
      // Always show success (server never reveals whether email exists)
      setSubmittedEmail(data.email);
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      {submitted ? (
        /* ── Success state ───────────────────────────────────────────────── */
        <div className="space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <MailCheck className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
          </div>

          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Check your email</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              If an account exists for <strong className="text-slate-700 dark:text-slate-300">{submittedEmail}</strong>,
              we've sent a password reset link. It expires in 60 minutes.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed text-center">
              Didn't receive the email? Check your spam folder, or make sure you entered the right address.
            </p>
          </div>

          <Button
            variant="outline"
            className="w-full h-11 rounded-xl"
            onClick={() => {
              setSubmitted(false);
              form.reset();
            }}
          >
            Try a different email
          </Button>

          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            <Link href="/login" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium inline-flex items-center gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to login
            </Link>
          </p>
        </div>
      ) : (
        /* ── Request form ────────────────────────────────────────────────── */
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Forgot password?</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
              Enter your account email and we'll send you a secure reset link.
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700 dark:text-slate-300 text-sm font-medium">Email address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="you@example.com"
                        type="email"
                        autoComplete="email"
                        autoFocus
                        className="h-11 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-blue-500 text-slate-900 dark:text-white"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full h-11 rounded-xl font-medium shadow-sm"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</>
                  : "Send reset link"}
              </Button>
            </form>
          </Form>

          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            <Link href="/login" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium inline-flex items-center gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to login
            </Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
