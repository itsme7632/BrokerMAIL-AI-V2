---
name: Admin Analytics (Phase 11) data conventions
description: How "trial vs paying", provider grouping, and revenue placeholders are derived for the admin analytics dashboard — reuse these conventions rather than re-deriving them.
---

- No billing processor is connected (Lemon Squeezy planned but not wired). Revenue/MRR/ARR must stay explicit `null`/"Billing integration required" placeholders on every analytics surface — never estimate them from `plansTable.price` or `subscriptionsTable`.
- "Trial Users" = `usersTable.plan === 'free'`; "Paying Users" = `plan != 'free'`, both scoped to `status = 'active'`. There is no dedicated trial flag/table in the schema.
- Seeded plan slugs (from `seedPlans()` in api-server `app.ts`): `free`, `starter`, `growth`, `enterprise`. Treat `free` as the only non-paying slug.
- `mailboxesTable` has no explicit provider column — provider is inferred from `smtpHost` substring matching (Google/Microsoft/GoDaddy/Hostinger/Namecheap/Zoho/etc). The frontend helper is `inferProvider()` in `AdminMailboxes.tsx`; the backend duplicates it as `inferMailboxProvider()` in `admin.ts` since it's only needed there for aggregation — keep both in sync if the provider list changes.
- Gmail-sent volume comes from `draftsTable` (status='success'), SMTP-sent volume from `emailQueueTable` (status='success') — these are two separate send pipelines in this app and must always be summed together for any "total emails sent" metric, never queried from one table alone.
