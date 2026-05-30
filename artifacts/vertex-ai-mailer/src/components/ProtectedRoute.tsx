import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

interface PublicSettings {
  maintenanceMode?: string;
}

async function fetchPublicSettings(): Promise<PublicSettings> {
  const base = import.meta.env.BASE_URL ?? "/";
  const res = await fetch(`${base}api/admin/public-settings`);
  if (!res.ok) return {};
  return res.json();
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  const { data: publicSettings } = useQuery<PublicSettings>({
    queryKey: ["public-settings"],
    queryFn: fetchPublicSettings,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const maintenanceOn = publicSettings?.maintenanceMode === "true";
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
      return;
    }
    if (!isLoading && user && maintenanceOn && !isAdmin) {
      setLocation("/maintenance");
    }
  }, [user, isLoading, maintenanceOn, isAdmin, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;
  if (maintenanceOn && !isAdmin) return null;

  return <>{children}</>;
}
