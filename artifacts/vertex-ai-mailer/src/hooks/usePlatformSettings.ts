import { useQuery } from "@tanstack/react-query";

export interface PlatformSettings {
  platformName: string;
  legalCompanyName: string;
  supportEmail: string;
  salesEmail: string;
  billingEmail: string;
  contactPhone: string;
  companyAddress: string;
  websiteUrl: string;
  businessHours: string;
  timezone: string;
  supportResponseTime: string;
  facebook: string;
  linkedin: string;
  twitter: string;
  whatsapp: string;
  telegram: string;
  footerText: string;
  allowRegistrations: string;
  maintenanceMode: string;
  [key: string]: string;
}

const DEFAULTS: PlatformSettings = {
  platformName:        "BrokerMail AI",
  legalCompanyName:    "BrokerMAIL AI LLC",
  supportEmail:        "support@getbrokermail.com",
  salesEmail:          "sales@getbrokermail.com",
  billingEmail:        "billing@getbrokermail.com",
  contactPhone:        "",
  companyAddress:      "",
  websiteUrl:          "https://getbrokermail.com",
  businessHours:       "Mon–Fri, 9am–6pm EST",
  timezone:            "EST",
  supportResponseTime: "1 business day",
  facebook:            "",
  linkedin:            "",
  twitter:             "",
  whatsapp:            "",
  telegram:            "",
  footerText:          "Built for the auto transport industry.",
  allowRegistrations:  "true",
  maintenanceMode:     "false",
};

async function fetchSettings(): Promise<PlatformSettings> {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const res = await fetch(`${base}/api/admin/public-settings`);
  if (!res.ok) return DEFAULTS;
  const data = await res.json();
  return { ...DEFAULTS, ...data };
}

export function usePlatformSettings() {
  const { data } = useQuery<PlatformSettings>({
    queryKey: ["platform-settings"],
    queryFn:  fetchSettings,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return data ?? DEFAULTS;
}
