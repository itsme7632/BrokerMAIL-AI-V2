import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Loader2, MailCheck, ArrowLeft, RefreshCw, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const RESEND_COOLDOWN = 60;

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function apiVerifyEmail(code: string): Promise<{ message: string }> {
  const res = await fetch("/api/auth/verify-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Verification failed");
  return data;
}

async function apiSendVerificationCode(): Promise<{
  message: string;
  expiresAt: string;
  remainingSeconds?: number;
}> {
  const res = await fetch("/api/auth/send-verification-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 429 && data.remainingSeconds) {
      const err = new Error(data.error ?? "Please wait before resending") as any;
      err.remainingSeconds = data.remainingSeconds;
      throw err;
    }
    throw new Error(data.error ?? "Failed to send code");
  }
  return data;
}

export default function VerifyEmail() {
  const { user, isLoading, refreshUser, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [code, setCode]               = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSending, setIsSending]     = useState(false);
  const [verified, setVerified]       = useState(false);
  const [countdown, setCountdown]     = useState(0);
  const countdownRef                  = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCountdown = useCallback((seconds: number) => {
    setCountdown(seconds);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  useEffect(() => {
    if (!isLoading && !user) setLocation("/login");
    if (!isLoading && user?.emailVerified) setLocation("/dashboard");
  }, [user, isLoading, setLocation]);

  const handleVerify = async () => {
    if (code.length !== 6) return;
    setIsVerifying(true);
    try {
      await apiVerifyEmail(code);
      setVerified(true);
      await refreshUser();
      setTimeout(() => setLocation("/dashboard"), 1800);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Invalid code",
        description: err.message || "The code is incorrect or has expired.",
      });
      setCode("");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || isSending) return;
    setIsSending(true);
    try {
      await apiSendVerificationCode();
      toast({
        title: "Code sent",
        description: "A new verification code has been sent to your email.",
      });
      startCountdown(RESEND_COOLDOWN);
    } catch (err: any) {
      if (err.remainingSeconds) {
        startCountdown(err.remainingSeconds);
        toast({
          variant: "destructive",
          title: "Please wait",
          description: err.message,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Couldn't resend",
          description: err.message || "Failed to send a new code. Please try again.",
        });
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setLocation("/login");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  if (verified) {
    return (
      <AuthLayout>
        <div className="space-y-6 text-center">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Email verified!</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Redirecting you to your dashboard…</p>
          </div>
          <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="h-16 w-16 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
            <MailCheck className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          </div>
        </div>

        {/* Heading */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Check your email</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            We sent a 6-digit code to{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">{user.email}</span>.
            <br />Enter it below to verify your account.
          </p>
        </div>

        {/* OTP input */}
        <div className="flex flex-col items-center gap-3">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            onComplete={handleVerify}
            disabled={isVerifying}
            autoFocus
          >
            <InputOTPGroup className="gap-2">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="h-12 w-11 text-lg font-semibold rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <p className="text-xs text-slate-400 dark:text-slate-500">Code expires in 10 minutes</p>
        </div>

        {/* Verify button */}
        <Button
          className="w-full h-11 rounded-xl font-medium shadow-sm"
          disabled={code.length !== 6 || isVerifying}
          onClick={handleVerify}
        >
          {isVerifying
            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Verifying…</>
            : "Verify email"}
        </Button>

        {/* Resend block */}
        <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 rounded-xl p-4 space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 text-center leading-relaxed">
            Didn't receive a code? Check your spam folder, or request a new one.
          </p>
          <Button
            variant="outline"
            className="w-full h-10 rounded-xl text-sm"
            disabled={countdown > 0 || isSending}
            onClick={handleResend}
          >
            {isSending ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Sending…</>
            ) : countdown > 0 ? (
              <><RefreshCw className="h-3.5 w-3.5 mr-2 opacity-50" />Resend in {countdown}s</>
            ) : (
              <><RefreshCw className="h-3.5 w-3.5 mr-2" />Resend code</>
            )}
          </Button>
        </div>

        {/* Footer links */}
        <div className="text-center space-y-2">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Wrong account?{" "}
            <button
              type="button"
              onClick={handleSignOut}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
            >
              Sign out
            </button>
          </p>
          <p className="text-xs">
            <Link href="/login" className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium">
              <ArrowLeft className="h-3 w-3" />
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
