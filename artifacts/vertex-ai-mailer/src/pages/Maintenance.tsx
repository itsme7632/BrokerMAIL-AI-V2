import { useQuery } from "@tanstack/react-query";
import { Wrench, RefreshCw, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PublicSettings {
  platformName?: string;
  maintenanceMode?: string;
  maintenanceMessage?: string;
  maintenanceReturnTime?: string;
  supportEmail?: string;
}

async function fetchPublicSettings(): Promise<PublicSettings> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/admin/public-settings`);
  if (!res.ok) return {};
  return res.json();
}

export default function Maintenance() {
  const { data: settings } = useQuery<PublicSettings>({
    queryKey: ["public-settings"],
    queryFn: fetchPublicSettings,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const message =
    settings?.maintenanceMessage ||
    "We're currently performing system upgrades and improvements. Please check back shortly.";

  const returnTime = settings?.maintenanceReturnTime;
  const contactEmail = settings?.supportEmail;
  const platformName = settings?.platformName || "BrokerMAIL AI";

  let formattedReturn: string | null = null;
  if (returnTime) {
    try {
      formattedReturn = new Date(returnTime).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      formattedReturn = returnTime;
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <img
            src={`${import.meta.env.BASE_URL}brokermail-logo.png`}
            alt={platformName}
            className="h-10 object-contain"
            onError={e => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-3xl bg-blue-100 flex items-center justify-center shadow-sm">
            <Wrench className="h-12 w-12 text-blue-600" strokeWidth={1.5} />
          </div>
        </div>

        {/* Content */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            Platform Under Maintenance
          </h1>
          <p className="text-slate-500 text-base leading-relaxed">
            {message}
          </p>
        </div>

        {/* Details card */}
        {(formattedReturn || contactEmail) && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 text-left space-y-3 shadow-sm">
            {formattedReturn && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
                  <span className="text-green-600 text-xs font-bold">↩</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Estimated Return
                  </p>
                  <p className="text-sm font-medium text-slate-800 mt-0.5">
                    {formattedReturn}
                  </p>
                </div>
              </div>
            )}
            {contactEmail && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                  <Mail className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Need Help?
                  </p>
                  <a
                    href={`mailto:${contactEmail}`}
                    className="text-sm font-medium text-blue-600 hover:underline mt-0.5 block"
                  >
                    {contactEmail}
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Refresh button */}
        <Button
          variant="outline"
          className="gap-2 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="h-4 w-4" />
          Check Again
        </Button>

        <p className="text-xs text-slate-400">
          &copy; {new Date().getFullYear()} {platformName}. All rights reserved.
        </p>
      </div>
    </div>
  );
}
