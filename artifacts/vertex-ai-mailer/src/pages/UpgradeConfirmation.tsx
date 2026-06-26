import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, CreditCard, Copy, ArrowLeft, Mail,
  Clock, ExternalLink, AlertCircle, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PaymentMethod {
  id: number;
  displayName: string;
  type: string;
  instructions: string | null;
  accountDetails: string | null;
  walletAddress: string | null;
  qrCodeUrl: string | null;
  sortOrder: number;
}

function fmtPrice(cents: number) {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

function CopyButton({ text }: { text: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    toast({ title: "Copied!", description: "Copied to clipboard." });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={copy}
      className="flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
    >
      {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function PaymentMethodCard({ method }: { method: PaymentMethod }) {
  const typeIcon: Record<string, string> = {
    paypal: "🅿️",
    bank: "🏦",
    wise: "💸",
    crypto: "₿",
    other: "💳",
  };
  const icon = typeIcon[method.type.toLowerCase()] ?? typeIcon.other;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
        <span className="text-xl">{icon}</span>
        <p className="font-semibold text-slate-900 text-sm">{method.displayName}</p>
      </div>
      <div className="p-4 space-y-3">
        {method.instructions && (
          <p className="text-sm text-slate-600">{method.instructions}</p>
        )}
        {method.accountDetails && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Account Details</p>
            <div className="flex items-start gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <p className="text-sm font-mono text-slate-800 flex-1 break-all">{method.accountDetails}</p>
              <CopyButton text={method.accountDetails} />
            </div>
          </div>
        )}
        {method.walletAddress && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Wallet Address</p>
            <div className="flex items-start gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <p className="text-sm font-mono text-slate-800 flex-1 break-all">{method.walletAddress}</p>
              <CopyButton text={method.walletAddress} />
            </div>
          </div>
        )}
        {method.qrCodeUrl && (
          <div className="flex justify-center pt-1">
            <img src={method.qrCodeUrl} alt="QR Code" className="h-32 w-32 rounded-xl border border-slate-200 object-contain" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function UpgradeConfirmation() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const params = new URLSearchParams(window.location.search);
  const planName = params.get("planName") ?? "Selected Plan";
  const price = parseInt(params.get("price") ?? "0", 10);
  const priceLabel = params.get("priceLabel") ?? (price > 0 ? fmtPrice(price) + "/mo" : "Free");
  const requestId = params.get("requestId") ?? "";
  const isFree = price === 0;

  useEffect(() => {
    fetch("/api/billing/payment-methods")
      .then(r => r.json())
      .then(setPaymentMethods)
      .catch(() => setPaymentMethods([]))
      .finally(() => setLoading(false));
  }, []);

  const referenceCode = requestId ? `UPG-${requestId.toString().padStart(6, "0")}` : `UPG-${Date.now().toString().slice(-6)}`;

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-4">

      {/* Success header */}
      <div className="bg-white rounded-2xl border border-emerald-200 p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Upgrade Request Submitted!</h1>
            <p className="text-sm text-slate-500 mt-1">
              Your request to upgrade to <strong>{planName}</strong> has been received.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 text-center">
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-400 mb-1">Plan</p>
            <p className="text-sm font-bold text-slate-800">{planName}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-400 mb-1">Monthly Price</p>
            <p className="text-sm font-bold text-blue-700">{isFree ? "Free" : priceLabel}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-400 mb-1">Reference</p>
            <div className="flex items-center justify-center gap-1">
              <p className="text-xs font-mono font-bold text-slate-800">{referenceCode}</p>
              <CopyButton text={referenceCode} />
            </div>
          </div>
        </div>
      </div>

      {/* Steps */}
      {!isFree && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-slate-400" />
            <p className="text-sm font-semibold text-slate-800">What Happens Next</p>
          </div>
          <div className="space-y-3">
            {[
              { n: 1, title: "Complete Payment", desc: `Send ${priceLabel} using one of the payment methods below. Include your reference code: ${referenceCode}` },
              { n: 2, title: "Notify Support", desc: "After payment, contact us with your reference code and payment confirmation." },
              { n: 3, title: "Admin Verification", desc: "Our team verifies your payment — typically within a few hours." },
              { n: 4, title: "Plan Activated", desc: `Your ${planName} plan is activated and you can start using all features.` },
            ].map(step => (
              <div key={step.n} className="flex items-start gap-3">
                <span className="h-6 w-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step.n}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{step.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment methods */}
      {!isFree && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-slate-400" />
            <p className="text-sm font-semibold text-slate-800">Payment Methods</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : paymentMethods.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Payment methods not configured yet</p>
                <p className="text-xs text-amber-700 mt-1">
                  Please contact support directly to arrange payment. Your upgrade request has been received and we will reach out to you.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {paymentMethods.map(method => (
                <PaymentMethodCard key={method.id} method={method} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Contact support */}
      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
        <Mail className="h-5 w-5 text-slate-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">Questions? Contact Support</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Reference code: <strong>{referenceCode}</strong>
            {!isFree && " — Include this in your payment message."}
          </p>
        </div>
      </div>

      {/* Back button */}
      <div className="flex gap-3">
        <Button variant="outline" className="gap-2 rounded-xl" onClick={() => navigate("/plans")}>
          <ArrowLeft className="h-4 w-4" /> Back to Plans
        </Button>
        <Button variant="outline" className="gap-2 rounded-xl" onClick={() => navigate("/dashboard")}>
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
