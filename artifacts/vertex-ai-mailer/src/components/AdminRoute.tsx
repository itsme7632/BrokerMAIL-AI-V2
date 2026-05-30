import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";

/**
 * Protects routes that require admin role.
 * - Not logged in → /admin/login
 * - Logged in but not admin → /dashboard
 * - Admin → renders children
 */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        setLocation("/admin/login");
      } else if (user.role !== "admin") {
        setLocation("/dashboard");
      }
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!user || user.role !== "admin") return null;

  return <>{children}</>;
}
