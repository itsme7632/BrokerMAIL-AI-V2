import { useEffect, useState } from "react";
import { MailX, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const REASONS = [
  { value: "already_shipped", label: "I already shipped my vehicle" },
  { value: "not_interested", label: "I'm no longer interested" },
  { value: "too_many_emails", label: "Too many emails" },
  { value: "spam", label: "This felt like spam" },
  { value: "other", label: "Other" },
];

type Status = "loading" | "success" | "error";

export default function Unsubscribe() {
  const [status, setStatus] = useState<Status>("loading");
  const [token, setToken] = useState("");
  const [reason, setReason] = useState("");
  const [reasonSaved, setReasonSaved] = useState(false);
  const [savingReason, setSavingReason] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token") ?? "";
    setToken(t);

    if (!t) {
      setStatus("error");
      return;
    }

    fetch(`/api/unsubscribe?token=${encodeURIComponent(t)}`)
      .then(async (res) => {
        if (res.ok) {
          setStatus("success");
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  async function handleReasonSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || !token) return;
    setSavingReason(true);
    try {
      await fetch("/api/unsubscribe/reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, reason }),
      });
      setReasonSaved(true);
    } finally {
      setSavingReason(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-16">
      {/* Logo / Brand */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-slate-800">
          <MailX className="h-8 w-8 text-indigo-500" />
          <span className="text-2xl font-bold tracking-tight">BrokerMAIL AI</span>
        </div>
      </div>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-4 py-16 px-8 text-center">
            <Loader2 className="h-10 w-10 text-indigo-400 animate-spin" />
            <p className="text-slate-500 text-sm">Processing your request…</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-4 py-16 px-8 text-center">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <h1 className="text-xl font-bold text-slate-800">Invalid Link</h1>
            <p className="text-slate-500 text-sm">
              This unsubscribe link is invalid or has expired. If you're still
              receiving emails you don't want, please reply to any email and ask
              to be removed.
            </p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-0 divide-y divide-slate-100">
            {/* Success message */}
            <div className="flex flex-col items-center gap-4 py-10 px-8 text-center w-full">
              <div className="flex items-center justify-center h-16 w-16 rounded-full bg-emerald-50">
                <CheckCircle2 className="h-9 w-9 text-emerald-500" />
              </div>
              <h1 className="text-xl font-bold text-slate-800">
                You have successfully unsubscribed.
              </h1>
              <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
                You will no longer receive marketing emails from this BrokerMAIL AI
                account. This change takes effect immediately.
              </p>
            </div>

            {/* Optional reason */}
            {!reasonSaved ? (
              <form
                onSubmit={handleReasonSubmit}
                className="w-full px-8 py-8 flex flex-col gap-4"
              >
                <p className="text-sm font-medium text-slate-700 text-center">
                  Why are you unsubscribing?{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                </p>
                <div className="flex flex-col gap-2">
                  {REASONS.map((r) => (
                    <label
                      key={r.value}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                        reason === r.value
                          ? "border-indigo-300 bg-indigo-50"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={r.value}
                        checked={reason === r.value}
                        onChange={() => setReason(r.value)}
                        className="accent-indigo-500"
                      />
                      <span className="text-sm text-slate-700">{r.label}</span>
                    </label>
                  ))}
                </div>
                <Button
                  type="submit"
                  disabled={!reason || savingReason}
                  className="w-full rounded-xl"
                >
                  {savingReason ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Submitting…</>
                  ) : (
                    "Submit Feedback"
                  )}
                </Button>
              </form>
            ) : (
              <div className="w-full px-8 py-8 text-center">
                <p className="text-sm text-slate-500">
                  Thank you for your feedback.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="mt-8 text-xs text-slate-400 text-center max-w-sm">
        This is a CAN-SPAM compliant unsubscribe page. Your request is processed
        immediately and we will honor it within 10 business days.
      </p>
    </div>
  );
}
