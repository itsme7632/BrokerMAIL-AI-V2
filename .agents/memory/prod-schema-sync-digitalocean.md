---
name: Production schema sync (DigitalOcean, not Replit-managed Postgres)
description: This project's production DB is self-hosted on DigitalOcean, not Replit's managed Postgres — hand-written SQL migrations are the correct (only) path here, unlike the default Replit-publish-diff guidance.
---

Production for this project runs on DigitalOcean PostgreSQL (confirmed via connection string the user supplied), even though dev uses Replit's built-in Postgres. This means the standard Replit "database" skill guidance — that schema sync happens automatically via the Publish-time diff, and the agent must never write custom migration scripts for production — does not apply here. There is no Publish-time diff for this prod DB.

**Why:** the user explicitly confirmed this and asked for hand-written SQL migration files under `migrations/` that they run manually against production. Defaulting to "just re-publish" would be wrong advice for this project.

**How to apply:** when production schema drift comes up again for this project, skip the "recommend re-publish" step from the database skill and go straight to: read-only diff dev vs. prod via `information_schema`/`pg_constraint`/`pg_indexes` (ask the user for a `PROD_DATABASE_URL` secret to connect with `psql`), then write an idempotent SQL file under `migrations/` for them to run by hand. Also keep `production-auth-migration.sql` (legacy hand-maintained bootstrap script) roughly in sync so fresh provisioning doesn't regress.
