import { useState } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { CreditCard } from "lucide-react";
import { Link } from "wouter";

const LAST_UPDATED = "June 1, 2025";

interface Section { id: string; title: string; content: React.ReactNode }

const sections: Section[] = [
  {
    id: "overview",
    title: "Overview",
    content: (
      <>
        <p>BrokerMAIL AI is a Software-as-a-Service (SaaS) product. All subscriptions are digital services that are accessible immediately upon activation. Because access is granted instantly, our refund policy is limited as described below.</p>
        <p>We encourage all prospective customers to take advantage of our free plan and contact us with questions before upgrading to a paid subscription.</p>
      </>
    ),
  },
  {
    id: "monthly",
    title: "Monthly Plans",
    content: (
      <>
        <p>For monthly subscriptions:</p>
        <ul>
          <li>Refunds are available within <strong>7 days</strong> of your plan activation, if you have not materially used the plan (fewer than 100 emails sent on the new plan)</li>
          <li>After 7 days, or if you have used the plan, monthly subscription fees are non-refundable for the current billing period</li>
          <li>You may cancel your subscription at any time — your access continues until the end of the paid period</li>
        </ul>
        <p>To request a refund within the eligibility window, contact <a href="mailto:billing@brokermail.ai">billing@brokermail.ai</a> with your account email and the reason for the request.</p>
      </>
    ),
  },
  {
    id: "annual",
    title: "Annual Plans",
    content: (
      <>
        <p>For annual subscriptions:</p>
        <ul>
          <li>Refunds are available within <strong>14 days</strong> of your plan activation, if you have not materially used the plan (fewer than 500 emails sent on the new plan)</li>
          <li>After 14 days, or upon material usage, no refund will be issued for the remaining term</li>
          <li>In exceptional circumstances, a prorated refund for unused months may be considered at our discretion — contact us to discuss</li>
        </ul>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Refund Eligibility",
    content: (
      <>
        <p>A refund may be approved in the following circumstances:</p>
        <ul>
          <li>Request submitted within the applicable window (7 days for monthly, 14 days for annual)</li>
          <li>Material usage has not occurred (see usage thresholds above)</li>
          <li>Technical failure on our end prevented you from using the service for more than 72 consecutive hours</li>
          <li>Billing error (e.g., double-charged, wrong plan activated)</li>
        </ul>
        <p>Refunds are <strong>not</strong> issued for:</p>
        <ul>
          <li>Dissatisfaction with features that were accurately described prior to purchase</li>
          <li>Forgetting to cancel before a renewal date</li>
          <li>Accounts suspended for Terms of Service violations</li>
          <li>Downgrade to a lower-priced plan</li>
          <li>Unused email credits within a billing period</li>
        </ul>
      </>
    ),
  },
  {
    id: "abuse",
    title: "Abuse & Violations",
    content: (
      <>
        <p>No refunds will be issued if your account is terminated due to:</p>
        <ul>
          <li>Sending spam or violating our Anti-Spam Policy</li>
          <li>Violating our Terms & Conditions</li>
          <li>Abusive, fraudulent, or illegal activity</li>
          <li>Intentional misuse of the platform that harms other users or third parties</li>
        </ul>
        <p>These violations result in immediate account termination, and the decision is final.</p>
      </>
    ),
  },
  {
    id: "chargebacks",
    title: "Chargebacks",
    content: (
      <>
        <p>We ask that you contact us before initiating a chargeback with your bank or payment provider. We take all disputes seriously and will work with you to resolve billing issues quickly.</p>
        <p>Initiating a chargeback without first contacting us may result in:</p>
        <ul>
          <li>Immediate account suspension pending investigation</li>
          <li>Permanent account termination if the chargeback is found to be fraudulent or unjustified</li>
          <li>Reporting of fraudulent chargebacks to payment networks</li>
        </ul>
        <p>To resolve a billing dispute, contact <a href="mailto:billing@brokermail.ai">billing@brokermail.ai</a>. We aim to respond within 1 business day.</p>
      </>
    ),
  },
  {
    id: "trial",
    title: "Trial Plans",
    content: (
      <>
        <p>BrokerMAIL AI offers a free plan that allows you to explore the platform before committing to a paid subscription. No credit card is required for the free plan.</p>
        <p>If a promotional free trial is offered on a paid plan:</p>
        <ul>
          <li>The trial period begins upon plan activation</li>
          <li>You will not be charged during the trial period</li>
          <li>At the end of the trial, your plan activates and payment becomes due (as arranged with our team)</li>
          <li>You may cancel before the trial ends without any charge</li>
        </ul>
      </>
    ),
  },
  {
    id: "process",
    title: "Refund Process",
    content: (
      <>
        <p>All refund requests are reviewed manually by our billing team. Here's how the process works:</p>
        <ul>
          <li>Submit your request to <a href="mailto:billing@brokermail.ai">billing@brokermail.ai</a> with your account email, the plan you're on, and the reason for your request</li>
          <li>We will review your request and respond within 2 business days</li>
          <li>Approved refunds are processed within 5–10 business days, depending on your payment method</li>
          <li>Refunds are issued to the original payment method</li>
        </ul>
        <p>If your request is denied, we will explain why and offer alternatives where possible (such as a plan downgrade or account credit).</p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact Billing",
    content: (
      <>
        <p>For all billing questions, refund requests, or payment disputes:</p>
        <ul>
          <li>Email: <a href="mailto:billing@brokermail.ai">billing@brokermail.ai</a></li>
          <li>Subject line: include your account email and "Refund Request" or "Billing Question"</li>
        </ul>
        <p>For general support: <a href="mailto:support@brokermail.ai">support@brokermail.ai</a></p>
        <p>
          See also:{" "}
          <Link href="/terms"><span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">Terms & Conditions</span></Link>
          {" "}and{" "}
          <Link href="/contact"><span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">Contact Us</span></Link>
        </p>
      </>
    ),
  },
];

export default function Refund() {
  const [active, setActive] = useState(sections[0].id);

  return (
    <PublicLayout>
      <div className="py-14 px-5">
        <div className="max-w-5xl mx-auto">
          <div className="mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-medium mb-5">
              <CreditCard className="h-3.5 w-3.5" />
              Legal
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mb-3">Refund Policy</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Last updated: {LAST_UPDATED}</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-3 max-w-2xl leading-relaxed">
              We want every customer to feel confident using BrokerMAIL AI. This policy explains when refunds are available and how to request one.
            </p>
          </div>

          <div className="flex gap-12">
            <aside className="hidden lg:block w-52 shrink-0">
              <div className="sticky top-24 space-y-1">
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">On this page</p>
                {sections.map(s => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    onClick={() => setActive(s.id)}
                    className={`block text-sm py-1 px-2 rounded-lg transition-colors leading-snug ${
                      active === s.id
                        ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 font-medium"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    {s.title}
                  </a>
                ))}
              </div>
            </aside>

            <div className="flex-1 min-w-0">
              {sections.map(s => (
                <section key={s.id} id={s.id} className="mb-10 scroll-mt-28">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">{s.title}</h2>
                  <div className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a:hover]:underline [&_strong]:text-slate-800 dark:[&_strong]:text-slate-200">
                    {s.content}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
