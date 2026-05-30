# Vertex AI Mailer

A production-ready AI SaaS for vehicle shipping brokers — upload CSV/XLSX leads, generate AI-personalized outreach emails, and sync them as Gmail drafts (never auto-send).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000/8080)
- `pnpm --filter @workspace/vertex-ai-mailer run dev` — run the frontend (Vite)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — build composite libs (run before api-server typecheck)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `SESSION_SECRET`, `OPENAI_API_KEY`
- Optional (for Gmail/Google OAuth): `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind + shadcn/ui + Framer Motion + wouter
- API: Express 5 + JWT auth (bcryptjs + jsonwebtoken)
- DB: PostgreSQL + Drizzle ORM
- AI: OpenAI gpt-4o-mini (personalized email generation)
- Gmail: googleapis (draft creation ONLY — never auto-send)
- File parsing: papaparse (CSV) + xlsx (XLSX)
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for all routes)
- `lib/db/src/schema/` — Drizzle schema files (users, campaigns, leads, templates, drafts, activity)
- `lib/api-zod/src/generated/` — Generated Zod validators (from codegen)
- `lib/api-client-react/src/generated/` — Generated React Query hooks (from codegen)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/` — auth.ts, gmail.ts, ai.ts helper modules
- `artifacts/vertex-ai-mailer/src/pages/` — All frontend pages
- `artifacts/vertex-ai-mailer/src/context/AuthContext.tsx` — JWT auth context

## Architecture decisions

- JWT tokens stored in localStorage; injected via `setAuthTokenGetter` from `@workspace/api-client-react`
- Gmail NEVER auto-sends — all email creation uses `gmail.users.drafts.create`
- AI uses `gpt-4o-mini` with `response_format: json_object` for reliable structured output
- OpenAPI spec is the single source of truth; never edit generated files directly
- Run `pnpm run typecheck:libs` before `api-server typecheck` — DB lib must emit declarations first

## Product

- Landing page + auth (email/password + Google OAuth)
- Campaign management with CSV/XLSX lead import
- AI-personalized email generation with tone selector (professional/friendly/sales/followup/urgent)
- Gmail draft creation with batch processing and retry on failure
- Email template system with variable chips ({name}, {vehicle}, {route}, etc.)
- Dashboard with stats, activity feed, Gmail status
- Admin panel (role=admin only)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Never import from deep `@workspace/<pkg>/src/...` paths in the frontend — use the package root only
- `pnpm run typecheck:libs` must run before api-server typecheck or DB exports will appear missing
- Gmail OAuth requires `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI` env vars to work
- `useGetRecentCampaigns` returns an array directly, not `{ data: [...] }`
- Any query hook that uses `enabled` must also pass `queryKey`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
