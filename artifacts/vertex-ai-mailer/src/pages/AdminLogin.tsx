import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck } from "lucide-react";

export default function AdminLogin() {
  const { login, logout, user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (user?.role === "admin") {
    setLocation("/admin/dashboard");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    setIsSubmitting(true);
    try {
      const loggedInUser = await login({ email, password });
      if (loggedInUser.role !== "admin") {
        await logout();
        setError("This login portal is for admin accounts only.");
        setIsSubmitting(false);
        return;
      }
      setLocation("/admin/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Invalid credentials. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4 p-3 rounded-2xl bg-muted border border-border">
            <img
              src="/logo-icon.png"
              alt="BrokerMail AI"
              className="h-16 w-16 object-contain rounded-xl"
            />
          </div>
          <img
            src="/logo-horizontal.png"
            alt="BrokerMail AI"
            className="h-9 w-auto object-contain dark:brightness-0 dark:invert"
            style={{ maxWidth: "180px" }}
          />
          <div className="flex items-center gap-1.5 mt-3">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-primary text-xs font-medium tracking-wider uppercase">Admin Portal</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          <h2 className="text-foreground text-lg font-semibold mb-1">Sign in to Admin</h2>
          <p className="text-muted-foreground text-sm mb-6">Restricted access — admin accounts only.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@brokermail.ai"
                required
                autoComplete="email"
                className="h-11 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="h-11 rounded-xl"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                <span className="text-destructive text-sm">{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 rounded-xl font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 mt-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in to Admin"}
            </Button>
          </form>
        </div>

        <p className="text-center text-muted-foreground text-xs mt-6">
          Not an admin?{" "}
          <a href="/login" className="text-foreground hover:text-muted-foreground transition-colors">
            Go to user login →
          </a>
        </p>
      </div>
    </div>
  );
}
