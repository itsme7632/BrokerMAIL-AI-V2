import { useState } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { FileText } from "lucide-react";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

const LAST_UPDATED = "June 1, 2025";

interface Section { id: string; title: string; content: React.ReactNode }

const sections: Section[] = [
  {
    id: "account",
    title: "Account Responsibilities",
    content: (
      <>
        <p>When you create an account with BrokerMAIL AI, you are responsible for maintaining the security of your account credentials. You agree to:</p>
        <ul>
          <li>Provide accurate and complete registration information</li>
          <li>Maintain the confidentiality of your password and account access credentials</li>
          <li>Promptly notify us at <a href="mailto:support@brokermail.ai">support@brokermail.ai</a> of any unauthorized use of your account</li>
          <li>Be solely responsible for all activities that occur under your account</li>
          <li>Not share your account with any third party or allow concurrent unauthorized sessions</li>
        </ul>
        <p>BrokerMAIL AI reserves the right to terminate accounts that violate these responsibilities or exhibit suspicious activity that may indicate unauthorized access.</p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use",
    content: (
      <>
        <p>BrokerMAIL AI is designed exclusively for legitimate business outreach in the auto transport industry. You agree not to use the platform to:</p>
        <ul>
          <li>Send unsolicited bulk email (spam) to recipients who have not opted in or who have no reasonable expectation of contact</li>
          <li>Impersonate any person, entity, or organization</li>
          <li>Distribute malware, phishing links, or fraudulent content</li>
          <li>Violate any applicable law or regulation, including CAN-SPAM, CASL, or GDPR</li>
          <li>Harvest, scrape, or collect email addresses without consent</li>
          <li>Attempt to reverse-engineer, decompile, or access the underlying source code of BrokerMAIL AI</li>
          <li>Resell or sublicense access to BrokerMAIL AI without written permission</li>
        </ul>
        <p>Violations of this policy may result in immediate account suspension without refund.</p>
      </>
    ),
  },
  {
    id: "billing",
    title: "Subscription & Billing",
    content: (
      <>
        <p>BrokerMAIL AI offers subscription plans on a monthly or annual basis. All subscriptions are managed manually — there is no automatic self-service upgrade. To change your plan:</p>
        <ul>
          <li>Submit an upgrade request from the Plans page inside your dashboard</li>
          <li>An administrator will review and activate your plan change within 1–2 business days</li>
          <li>You will receive an email confirmation when your plan is approved</li>
        </ul>
        <p>Billing terms:</p>
        <ul>
          <li>Subscription fees are charged in advance for the billing period</li>
          <li>Plan changes take effect upon admin approval, not upon request submission</li>
          <li>Usage limits are reset on the first day of each calendar month</li>
          <li>We reserve the right to adjust pricing with 30 days' advance notice to existing subscribers</li>
        </ul>
      </>
    ),
  },
  {
    id: "email-policy",
    title: "Email Sending Policy",
    content: (
      <>
        <p>BrokerMAIL AI is a sending tool that transmits emails through your own mailbox using your own credentials. You are solely responsible for:</p>
        <ul>
          <li>The content of every email you send through the platform</li>
          <li>Ensuring your sending list is legally obtained and recipients have a reasonable expectation of contact</li>
          <li>Compliance with all applicable anti-spam laws in your jurisdiction</li>
          <li>Honoring unsubscribe requests and opt-out mechanisms</li>
          <li>Not sending to addresses obtained through deceptive or illegal means</li>
        </ul>
        <p>BrokerMAIL AI may monitor aggregate sending patterns (not message content) to detect abuse. Accounts generating an unusually high bounce or spam-complaint rate may be suspended pending review.</p>
      </>
    ),
  },
  {
    id: "smtp",
    title: "SMTP Responsibility",
    content: (
      <>
        <p>When you connect an SMTP mailbox to BrokerMAIL AI, you grant the platform permission to send emails through that mailbox on your behalf. You acknowledge:</p>
        <ul>
          <li>Your SMTP credentials are stored encrypted at rest and never transmitted in plain text</li>
          <li>BrokerMAIL AI accesses your mailbox only to send emails and (if IMAP is enabled) to save sent copies</li>
          <li>You are responsible for ensuring you have authorization to use the provided SMTP server</li>
          <li>Any abuse of the SMTP connection that results in your mailbox being blocked or blacklisted is your responsibility</li>
          <li>BrokerMAIL AI is not liable for deliverability issues caused by your email provider's policies or sending reputation</li>
        </ul>
      </>
    ),
  },
  {
    id: "anti-spam",
    title: "Anti-Spam Policy",
    content: (
      <>
        <p>BrokerMAIL AI has a zero-tolerance policy for spam. We define spam as any unsolicited bulk email sent to recipients who have not consented to receive it. Specifically:</p>
        <ul>
          <li>You must only email contacts who have a legitimate business relationship with you, have inquired about your services, or have otherwise consented to receive outreach</li>
          <li>Every email sent through BrokerMAIL AI must include a clear way for recipients to request no further contact</li>
          <li>You must promptly honor all opt-out and unsubscribe requests</li>
          <li>Purchased, rented, or harvested email lists are prohibited</li>
        </ul>
        <p>Accounts found to be sending spam will be permanently terminated and reported to relevant anti-abuse organizations. No refund will be issued in such cases.</p>
      </>
    ),
  },
  {
    id: "cancellation",
    title: "Cancellation",
    content: (
      <>
        <p>You may cancel your BrokerMAIL AI subscription at any time by contacting support at <a href="mailto:support@brokermail.ai">support@brokermail.ai</a>. Upon cancellation:</p>
        <ul>
          <li>Your account will remain active until the end of the current billing period</li>
          <li>You will not be billed for subsequent periods</li>
          <li>Your data (campaigns, templates, leads) will be retained for 30 days after cancellation, after which it will be permanently deleted</li>
          <li>You may export your data before the retention period expires by contacting support</li>
        </ul>
        <p>Downgrading to the free plan is not considered cancellation — your account remains active under the free plan's limits.</p>
      </>
    ),
  },
  {
    id: "suspension",
    title: "Account Suspension",
    content: (
      <>
        <p>BrokerMAIL AI may suspend or terminate your account without notice if:</p>
        <ul>
          <li>You violate any provision of these Terms</li>
          <li>We detect activity consistent with spam, phishing, or abuse</li>
          <li>Your account poses a risk to the security or performance of our platform</li>
          <li>Your payment is declined or a chargeback is filed</li>
          <li>We receive a valid legal order requiring suspension</li>
        </ul>
        <p>In cases of non-abusive violations, we will attempt to provide prior notice and an opportunity to remedy the issue. In cases of abuse or legal requirement, suspension may be immediate. You may appeal a suspension by contacting <a href="mailto:support@brokermail.ai">support@brokermail.ai</a>.</p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Intellectual Property",
    content: (
      <>
        <p>All rights, title, and interest in and to BrokerMAIL AI — including its software, interface, branding, and documentation — are owned exclusively by BrokerMAIL AI and its licensors. These Terms grant you a limited, non-exclusive, non-transferable license to use the platform as a subscriber.</p>
        <p>You retain ownership of all content you create, upload, or send through BrokerMAIL AI (email templates, lead data, campaign content). By using the platform, you grant us a limited license to process and transmit that content solely for the purpose of delivering the service.</p>
        <p>You may not copy, reproduce, distribute, or create derivative works of any BrokerMAIL AI software, branding, or documentation without our prior written consent.</p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Limitation of Liability",
    content: (
      <>
        <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:</p>
        <ul>
          <li>BROKERMAIL AI IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE</li>
          <li>WE DO NOT GUARANTEE UNINTERRUPTED, ERROR-FREE, OR FULLY SECURE SERVICE</li>
          <li>WE ARE NOT LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THE PLATFORM, INCLUDING LOSS OF BUSINESS, REVENUE, OR DATA</li>
          <li>OUR AGGREGATE LIABILITY TO YOU FOR ANY CLAIM ARISING UNDER THESE TERMS SHALL NOT EXCEED THE TOTAL FEES PAID BY YOU IN THE 3 MONTHS PRECEDING THE CLAIM</li>
        </ul>
        <p>Some jurisdictions do not allow exclusions of implied warranties or limitations of liability. In such jurisdictions, these limitations apply to the maximum extent permitted by law.</p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact Information",
    content: (
      <>
        <p>If you have any questions about these Terms, please contact us:</p>
        <ul>
          <li>Email: <a href="mailto:legal@brokermail.ai">legal@brokermail.ai</a></li>
          <li>Support: <a href="mailto:support@brokermail.ai">support@brokermail.ai</a></li>
        </ul>
        <p>We reserve the right to update these Terms at any time. Material changes will be communicated via email to active subscribers at least 14 days before they take effect. Continued use of BrokerMAIL AI after the effective date constitutes acceptance of the updated Terms.</p>
      </>
    ),
  },
];

export default function Terms() {
  const [active, setActive] = useState(sections[0].id);
  const platform = usePlatformSettings();

  const supportEmail  = platform.supportEmail  || "support@brokermail.ai";
  const dynamicSections = sections.map(s => s.id !== "contact" ? s : {
    ...s,
    content: (
      <>
        <p>If you have any questions about these Terms, please contact us:</p>
        <ul>
          <li>Support: <a href={`mailto:${supportEmail}`}>{supportEmail}</a></li>
        </ul>
        <p>We reserve the right to update these Terms at any time. Material changes will be communicated via email to active subscribers at least 14 days before they take effect. Continued use of BrokerMAIL AI after the effective date constitutes acceptance of the updated Terms.</p>
      </>
    ),
  });

  return (
    <PublicLayout>
      <div className="py-14 px-5">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-medium mb-5">
              <FileText className="h-3.5 w-3.5" />
              Legal
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mb-3">Terms & Conditions</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Last updated: {LAST_UPDATED}</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-3 max-w-2xl leading-relaxed">
              Please read these Terms carefully before using BrokerMAIL AI. By creating an account or using the platform, you agree to be bound by these Terms.
            </p>
          </div>

          <div className="flex gap-12">
            {/* Sticky TOC */}
            <aside className="hidden lg:block w-52 shrink-0">
              <div className="sticky top-24 space-y-1">
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">On this page</p>
                {dynamicSections.map(s => (
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

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-bold prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-ul:my-3 prose-li:my-1 prose-p:leading-relaxed">
                {dynamicSections.map(s => (
                  <section key={s.id} id={s.id} className="mb-10 scroll-mt-28">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">{s.title}</h2>
                    <div className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-blue-600 [&_a:hover]:underline">
                      {s.content}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
