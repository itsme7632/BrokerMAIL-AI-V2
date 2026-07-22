import { useState } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Shield } from "lucide-react";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

const LAST_UPDATED = "June 1, 2025";

interface Section { id: string; title: string; content: React.ReactNode }

const sections: Section[] = [
  {
    id: "collected",
    title: "Information We Collect",
    content: (
      <>
        <p>When you use BrokerMAIL AI, we collect the following categories of information:</p>
        <p><strong>Account Information:</strong> Your name, email address, and password (hashed, never stored in plain text) when you create an account.</p>
        <p><strong>Profile & Branding Data:</strong> Business name, company tagline, website URL, phone number, DOT/MC numbers, logo, and accent color you provide in Settings — used to personalize your email templates.</p>
        <p><strong>Email Content & Lead Data:</strong> Email templates, subject lines, and lead CSV/XLSX data you upload. This data is stored to enable campaign sending and analytics. We do not read or analyze your email content for advertising purposes.</p>
        <p><strong>SMTP & Mailbox Credentials:</strong> Server host, port, username, and password for your connected mailbox. Passwords are encrypted at rest using AES-256. We never transmit credentials in plain text.</p>
        <p><strong>Usage & Log Data:</strong> Emails sent, campaigns run, errors, and platform interactions. Used for account limits, support, and platform reliability.</p>
        <p><strong>Payment Information:</strong> Plan requests and billing status. We do not process credit cards directly. Payment arrangements are handled manually by our team.</p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    content: (
      <>
        <p>BrokerMAIL AI uses a minimal set of cookies necessary to operate the platform:</p>
        <ul>
          <li><strong>Session Cookies:</strong> Used to keep you authenticated while logged in. These expire when you close your browser or your session times out.</li>
          <li><strong>Authentication Tokens:</strong> A JWT token stored in your browser's localStorage to maintain your logged-in session across page reloads.</li>
          <li><strong>Preference Cookies:</strong> Stores your theme preference (dark/light mode).</li>
        </ul>
        <p>We do not use advertising cookies, third-party tracking cookies, or behavioral profiling cookies. You can clear cookies through your browser settings at any time, though this will log you out of the platform.</p>
      </>
    ),
  },
  {
    id: "tracking",
    title: "Tracking Pixels",
    content: (
      <>
        <p>BrokerMAIL AI optionally inserts tracking pixels (1×1 transparent images) and click-tracking links into emails you send, if you enable this feature:</p>
        <ul>
          <li><strong>Open Tracking:</strong> A unique tracking image URL is embedded in your sent emails. When a recipient opens the email and their client loads images, we record an "opened" event linked to your campaign.</li>
          <li><strong>Click Tracking:</strong> Links in your emails are optionally replaced with tracked redirect URLs. When a recipient clicks a link, we record the event and redirect them to the original destination.</li>
        </ul>
        <p>These features are opt-in. You can disable them per-email or globally in Settings. When tracking is enabled, you are responsible for disclosing this in your email communications as required by applicable law.</p>
        <p>Tracking data (open timestamps, click counts) is associated with your campaign and is visible only to you. We do not sell or share this data with third parties.</p>
      </>
    ),
  },
  {
    id: "oauth",
    title: "OAuth Data (Google)",
    content: (
      <>
        <p>If you connect your Google account to BrokerMAIL AI via OAuth, we request the following scopes:</p>
        <ul>
          <li><strong>Gmail Send:</strong> To send emails on your behalf directly through Gmail</li>
          <li><strong>Gmail Drafts:</strong> To create email drafts in your Gmail Drafts folder for your review</li>
        </ul>
        <p>We do not request access to read your inbox, contacts, calendar, or any other Google data. OAuth tokens are stored encrypted in our database and are used only for the specific purposes listed above. You can revoke access at any time from your Google Account security settings at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.</p>
      </>
    ),
  },
  {
    id: "analytics",
    title: "Analytics",
    content: (
      <>
        <p>BrokerMAIL AI collects platform-level analytics to improve the product. This includes:</p>
        <ul>
          <li>Aggregate usage metrics (emails sent, campaigns run, templates created)</li>
          <li>Error logs and performance data</li>
          <li>Feature adoption patterns (which features are used most)</li>
        </ul>
        <p>We do not use third-party analytics services (such as Google Analytics) on the authenticated dashboard. All analytics data is collected and processed internally. No personal data is sold to data brokers or advertising networks.</p>
      </>
    ),
  },
  {
    id: "protection",
    title: "How We Protect Your Data",
    content: (
      <>
        <p>We take data security seriously and implement the following measures:</p>
        <ul>
          <li><strong>Encryption at rest:</strong> SMTP passwords and OAuth tokens are encrypted using AES-256 before storage</li>
          <li><strong>Encryption in transit:</strong> All connections to BrokerMAIL AI use TLS 1.2 or higher</li>
          <li><strong>Password hashing:</strong> Account passwords are hashed using bcrypt with a high work factor — we never store plain-text passwords</li>
          <li><strong>Access controls:</strong> Internal access to production data is limited to authorized personnel and logged</li>
          <li><strong>Database security:</strong> Our database is not publicly accessible and is protected by network-level firewalls</li>
        </ul>
        <p>No security measure is 100% foolproof. If you discover a security vulnerability, please report it responsibly to <a href="mailto:security@getbrokermail.com">security@getbrokermail.com</a>.</p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your Rights",
    content: (
      <>
        <p>Depending on your location, you may have certain rights regarding your personal data:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of all data we hold about you</li>
          <li><strong>Correction:</strong> Request correction of inaccurate personal data</li>
          <li><strong>Deletion:</strong> Request deletion of your account and all associated data</li>
          <li><strong>Portability:</strong> Request your data in a machine-readable format</li>
          <li><strong>Objection:</strong> Object to processing of your data in certain circumstances</li>
        </ul>
        <p>To exercise any of these rights, contact us at <a href="mailto:privacy@getbrokermail.com">privacy@getbrokermail.com</a>. We will respond within 30 days. We may need to verify your identity before processing your request.</p>
      </>
    ),
  },
  {
    id: "deletion",
    title: "Deletion Requests",
    content: (
      <>
        <p>If you wish to permanently delete your BrokerMAIL AI account and all associated data:</p>
        <ul>
          <li>Email <a href="mailto:privacy@getbrokermail.com">privacy@getbrokermail.com</a> with the subject line "Account Deletion Request"</li>
          <li>Include the email address associated with your account</li>
          <li>We will confirm receipt within 2 business days and complete the deletion within 30 days</li>
        </ul>
        <p>Deletion is permanent and irreversible. Once completed:</p>
        <ul>
          <li>Your account, campaigns, templates, and lead data will be permanently removed from our systems</li>
          <li>SMTP credentials and OAuth tokens will be permanently revoked and deleted</li>
          <li>Emails already sent before deletion remain in your recipients' inboxes — we cannot retract those</li>
        </ul>
        <p>We may retain aggregate anonymized analytics data that cannot be linked back to your identity.</p>
      </>
    ),
  },
  {
    id: "retention",
    title: "Data Retention",
    content: (
      <>
        <p>We retain your data for as long as your account is active. After account cancellation:</p>
        <ul>
          <li>Account data (profile, settings, credentials) is deleted within 30 days</li>
          <li>Campaign data and email logs are deleted within 30 days</li>
          <li>Billing records may be retained for up to 7 years for legal and accounting purposes</li>
          <li>System logs are retained for 90 days for security and debugging purposes</li>
        </ul>
        <p>You may request expedited deletion at any time (see Deletion Requests above).</p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact Us",
    content: (
      <>
        <p>For any privacy-related questions, requests, or concerns:</p>
        <ul>
          <li>Email: <a href="mailto:privacy@getbrokermail.com">privacy@getbrokermail.com</a></li>
          <li>General support: <a href="mailto:support@getbrokermail.com">support@getbrokermail.com</a></li>
        </ul>
        <p>We will update this Privacy Policy as needed to reflect changes in our practices or applicable law. Material changes will be communicated via email at least 14 days before they take effect.</p>
      </>
    ),
  },
];

export default function Privacy() {
  const [active, setActive] = useState(sections[0].id);
  const platform = usePlatformSettings();

  const supportEmail  = platform.supportEmail  || "support@getbrokermail.com";
  const dynamicSections = sections.map(s => s.id !== "contact" ? s : {
    ...s,
    content: (
      <>
        <p>For any privacy-related questions, requests, or concerns:</p>
        <ul>
          <li>Email: <a href={`mailto:${supportEmail}`}>{supportEmail}</a></li>
        </ul>
        <p>We will update this Privacy Policy as needed to reflect changes in our practices or applicable law. Material changes will be communicated via email at least 14 days before they take effect.</p>
      </>
    ),
  });

  return (
    <PublicLayout>
      <div className="py-14 px-5">
        <div className="max-w-5xl mx-auto">
          <div className="mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-medium mb-5">
              <Shield className="h-3.5 w-3.5" />
              Legal
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mb-3">Privacy Policy</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Last updated: {LAST_UPDATED}</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-3 max-w-2xl leading-relaxed">
              Your privacy matters. This policy explains exactly what data BrokerMAIL AI collects, why we collect it, and how we protect it.
            </p>
          </div>

          <div className="flex gap-12">
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

            <div className="flex-1 min-w-0">
              <div className="space-y-0">
                {dynamicSections.map(s => (
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
      </div>
    </PublicLayout>
  );
}
