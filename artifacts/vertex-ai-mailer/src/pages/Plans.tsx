import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, Zap, AlertTriangle, Clock, XCircle,
  RefreshCw, ArrowUpCircle, Mail, Server, BarChart3, Crown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  id: number; name: string; slug: string; description: string;
  monthlyEmailLimit: number; smtpAccountsLimit: number;
  campaignsLimit: number; batchSendLimit: number;
  features: string[]; sortOrder: number;
}

interface Subscription {
  id: number; planId: number; status: string;
  billingStatus: string; stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: string; currentPeriodEnd: string | null;
}

interface Usage {
  emailsSentThisMonth: number;
  smtpAccountsUsed: number;
  campaignsCount: number;
}

interface PendingRequest {
  id: number; toPlanId: number; toPlanName: string;
  status: string; createdAt: string;
}

interface BillingData {
  subscription: Subscription;
  plan: Plan;
  usage: Usage;
  pendingRequest: PendingRequest | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bfetch(path: string, opts?: RequestInit) {
  const t = localStorage.getItem("auth_token") ?? "";
  return fetch(`/api/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...opts?.headers },
  }).then(async r => {
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `Error ${r.status}`); }
    return r.json();
  });
}

function fmt(n: number) { return n === -1 ? "Unlimited" : n.toLocaleString(); }

// ─── Usage bar ────────────────────────────────────────────────────────────────

function UsageBar({ label, used, limit, icon: Icon }: {
  label: string; used: number; limit: number; icon: React.ElementType;
}) {
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : Math.min((used / Math.max(limit, 1)) * 100, 100);
  const color = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-blue-500";
  const textColor = pct >= 90 ? "text-red-600" : pct >= 75 ? "text-amber-600" : "text-slate-900";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-sm text-slate-600 font-medium">{label}</span>
        </div>
        <div className="text-right">
          <span className={`text-sm font-bold ${textColor}`}>{used.toLocaleString()}</span>
          {!unlimited && <span className="text-xs text-slate-400"> / {limit.toLocaleString()}</span>}
          {unlimited && <span className="text-xs font-semibold text-emerald-600 ml-1">∞ Unlimited</span>}
        </div>
      </div>
      {!unlimited && (
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({ plan, isCurrent, isPending, onSelectUpgrade }: {
  plan: Plan; isCurrent: boolean; isPending: boolean;
  onSelectUpgrade: (plan: Plan) => void;
}) {
  const isPopular = plan.slug === "growth";
  const isEnterprise = plan.slug === "enterprise";

  return (
    <div className={`relative bg-white rounded-2xl border-2 p-6 flex flex-col transition-all duration-200 ${
      isCurrent
        ? "border-blue-500 shadow-lg shadow-blue-100"
        : isPopular
          ? "border-blue-200 shadow-md hover:shadow-lg hover:border-blue-300"
          : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
    }`}>
      {isPopular && !isCurrent && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-full shadow">
          Most Popular
        </div>
      )}
      {isCurrent && (
        <div className="absolute top-4 right-4 flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
          <CheckCircle2 className="h-3 w-3" /> Your Plan
        </div>
      )}
      {isEnterprise && (
        <div className="absolute top-4 right-4 flex items-center gap-1">
          <Crown className="h-4 w-4 text-amber-500" />
        </div>
      )}

      <div className="mb-4">
        <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
        <p className="text-sm text-slate-500 mt-0.5">{plan.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-5 text-xs">
        <div className="bg-slate-50 rounded-xl p-2.5 text-center">
          <p className="font-bold text-slate-900">{fmt(plan.monthlyEmailLimit)}</p>
          <p className="text-slate-500 mt-0.5">emails/mo</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-2.5 text-center">
          <p className="font-bold text-slate-900">{fmt(plan.smtpAccountsLimit)}</p>
          <p className="text-slate-500 mt-0.5">mailboxes</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-2.5 text-center">
          <p className="font-bold text-slate-900">{fmt(plan.campaignsLimit)}</p>
          <p className="text-slate-500 mt-0.5">campaigns</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-2.5 text-center">
          <p className="font-bold text-slate-900">{fmt(plan.batchSendLimit)}</p>
          <p className="text-slate-500 mt-0.5">batch size</p>
        </div>
      </div>

      <ul className="space-y-1.5 mb-6 flex-1">
        {plan.features.map(f => (
          <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
      </ul>

      <Button
        className={`w-full rounded-xl gap-2 ${isPopular && !isCurrent ? "" : ""}`}
        variant={isCurrent ? "outline" : isPopular ? "default" : "outline"}
        disabled={isCurrent || isPending}
        onClick={() => onSelectUpgrade(plan)}
      >
        {isCurrent ? (
          <><CheckCircle2 className="h-4 w-4" /> Current Plan</>
        ) : isPending ? (
          <><Clock className="h-4 w-4" /> Request Pending</>
        ) : (
          <><ArrowUpCircle className="h-4 w-4" /> Request Upgrade</>
        )}
      </Button>
    </div>
  );
}

// ─── Upgrade modal ────────────────────────────────────────────────────────────

function UpgradeModal({ from, to, onConfirm, onClose, loading }: {
  from: Plan; to: Plan;
  onConfirm: () => void; onClose: () => void; loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 z-10 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <ArrowUpCircle className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Request Plan Upgrade</h3>
              <p className="text-xs text-slate-500">An admin will review your request</p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1 bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
              <p className="text-xs text-slate-400 mb-1">Current</p>
              <p className="font-bold text-slate-700">{from.name}</p>
              <p className="text-xs text-slate-500">{fmt(from.monthlyEmailLimit)} emails/mo</p>
            </div>
            <ArrowUpCircle className="h-5 w-5 text-blue-500 flex-shrink-0" />
            <div className="flex-1 bg-blue-50 rounded-xl p-3 text-center border border-blue-200">
              <p className="text-xs text-blue-400 mb-1">Upgrading to</p>
              <p className="font-bold text-blue-700">{to.name}</p>
              <p className="text-xs text-blue-500">{fmt(to.monthlyEmailLimit)} emails/mo</p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
            {to.features.map(f => (
              <div key={f} className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                {f}
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
            <Zap className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              No payment required yet. Your request will be reviewed and activated by an admin.
            </p>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <Button className="flex-1 rounded-xl gap-2" onClick={onConfirm} disabled={loading}>
            {loading ? <><RefreshCw className="h-4 w-4 animate-spin" />Submitting…</> : "Confirm Request"}
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={onClose} disabled={loading}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Plans() {
  const { toast } = useToast();
  const [plans, setPlans]             = useState<Plan[]>([]);
  const [billing, setBilling]         = useState<BillingData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [requesting, setRequesting]   = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [plansData, billingData] = await Promise.all([
        bfetch("billing/plans"),
        bfetch("billing/subscription"),
      ]);
      setPlans(plansData);
      setBilling(billingData);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to load billing", description: err.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function requestUpgrade() {
    if (!selectedPlan) return;
    setRequesting(true);
    try {
      await bfetch("billing/request-upgrade", {
        method: "POST",
        body: JSON.stringify({ toPlanId: selectedPlan.id }),
      });
      toast({ title: "Request submitted!", description: "An admin will review your upgrade request." });
      setSelectedPlan(null);
      await load();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setRequesting(false);
    }
  }

  const currentPlan = billing?.plan;
  const usage       = billing?.usage;
  const pending     = billing?.pendingRequest;

  // Usage warning thresholds
  const emailPct = currentPlan && usage && currentPlan.monthlyEmailLimit > 0
    ? (usage.emailsSentThisMonth / currentPlan.monthlyEmailLimit) * 100 : 0;
  const showEmailWarning = emailPct >= 75 && currentPlan?.monthlyEmailLimit !== -1;
  const emailNearLimit   = emailPct >= 90;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Plans & Billing</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage your subscription and view usage</p>
        </div>
        {currentPlan && (
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-2 shadow-sm">
            <span className="text-xs text-slate-500">Current plan</span>
            <span className="text-sm font-bold text-blue-700 capitalize">{currentPlan.name}</span>
            {billing?.subscription?.billingStatus === "paid" && (
              <span className="text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">Active</span>
            )}
            {billing?.subscription?.stripeSubscriptionId && (
              <span className="text-xs bg-slate-100 text-slate-500 font-mono px-2 py-0.5 rounded-full">
                {billing.subscription.stripeSubscriptionId.slice(0, 12)}…
              </span>
            )}
          </div>
        )}
      </div>

      {/* Pending request banner */}
      {pending && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <Clock className="h-5 w-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">Upgrade request pending review</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Your request to upgrade to <strong>{pending.toPlanName}</strong> is being reviewed by an admin.
              Submitted {new Date(pending.createdAt).toLocaleDateString()}.
            </p>
          </div>
          <button onClick={() => bfetch(`billing/request-upgrade`, { method: "POST", body: JSON.stringify({ toPlanId: -1 }) }).catch(() => {})}
            className="text-xs text-amber-600 hover:text-amber-800 underline whitespace-nowrap">
            Cancel
          </button>
        </div>
      )}

      {/* Usage warnings */}
      {showEmailWarning && (
        <div className={`flex items-start gap-3 p-4 rounded-2xl border ${emailNearLimit ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
          <AlertTriangle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${emailNearLimit ? "text-red-500" : "text-amber-500"}`} />
          <div>
            <p className={`text-sm font-semibold ${emailNearLimit ? "text-red-900" : "text-amber-900"}`}>
              {emailNearLimit ? "Email limit almost reached" : "Approaching email limit"}
            </p>
            <p className={`text-xs mt-0.5 ${emailNearLimit ? "text-red-700" : "text-amber-700"}`}>
              You've used <strong>{usage?.emailsSentThisMonth}</strong> of <strong>{currentPlan?.monthlyEmailLimit}</strong> emails
              this month ({Math.round(emailPct)}%). Consider upgrading your plan.
            </p>
          </div>
        </div>
      )}

      {/* Usage card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">Usage This Month</p>
          <Button variant="ghost" size="sm" onClick={load} className="h-7 gap-1.5 rounded-lg text-xs text-slate-500">
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
        {loading || !currentPlan || !usage ? (
          <div className="space-y-4">
            {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="space-y-4">
            <UsageBar label="Emails Sent" used={usage.emailsSentThisMonth} limit={currentPlan.monthlyEmailLimit} icon={Mail} />
            <UsageBar label="SMTP Mailboxes" used={usage.smtpAccountsUsed} limit={currentPlan.smtpAccountsLimit} icon={Server} />
            <UsageBar label="Campaigns" used={usage.campaignsCount} limit={currentPlan.campaignsLimit} icon={BarChart3} />
          </div>
        )}

        {/* Stripe placeholder fields */}
        {billing?.subscription && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-slate-400">Billing Status</p>
              <p className="font-semibold text-slate-700 capitalize mt-0.5">{billing.subscription.billingStatus}</p>
            </div>
            <div>
              <p className="text-slate-400">Stripe Customer ID</p>
              <p className="font-mono text-slate-500 mt-0.5">{billing.subscription.stripeCustomerId ?? "—"}</p>
            </div>
            <div>
              <p className="text-slate-400">Stripe Subscription</p>
              <p className="font-mono text-slate-500 mt-0.5">{billing.subscription.stripeSubscriptionId ?? "—"}</p>
            </div>
          </div>
        )}
      </div>

      {/* Plans grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
        </div>
      ) : (
        <div>
          <p className="text-sm font-semibold text-slate-800 mb-4">Available Plans</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {plans.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrent={billing?.plan.id === plan.id}
                isPending={pending?.toPlanId === plan.id}
                onSelectUpgrade={setSelectedPlan}
              />
            ))}
          </div>
        </div>
      )}

      {/* Coming soon footer */}
      <div className="text-center py-4">
        <p className="text-xs text-slate-400">
          Payments powered by Stripe — coming soon. Upgrade requests are manually reviewed by admins.
        </p>
      </div>

      {/* Upgrade modal */}
      {selectedPlan && currentPlan && (
        <UpgradeModal
          from={currentPlan}
          to={selectedPlan}
          onConfirm={requestUpgrade}
          onClose={() => setSelectedPlan(null)}
          loading={requesting}
        />
      )}
    </div>
  );
}
