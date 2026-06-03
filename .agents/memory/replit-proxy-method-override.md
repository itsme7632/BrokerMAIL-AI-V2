---
name: Replit proxy method override
description: Replit's deployment proxy blocks PATCH/PUT/DELETE — fix pattern for all non-GET/POST routes
---

## Rule
Replit's autoscale deployment proxy only forwards GET and POST to backend services. PATCH, PUT, and DELETE are silently dropped and return an HTML 403 Forbidden page before Express sees them.

**Why:** Confirmed by deployment logs — zero PATCH/PUT/DELETE requests ever appear in the API server logs, while GET and POST work fine. The HTML 403 (not JSON) is the tell.

**How to apply:**
- `lib/api-client-react/src/custom-fetch.ts`: Before the `fetch()` call, convert PATCH/PUT/DELETE → POST and set `X-HTTP-Method-Override: <original method>` header.
- `artifacts/api-server/src/app.ts`: Add middleware (after `cookieParser`, before `maintenanceMiddleware`) that reads `X-HTTP-Method-Override` on POST requests and remaps `req.method` to the original method before routing.
- This covers ALL routes automatically — no per-route changes needed.
- Individual POST aliases on specific routes (e.g. `router.post("/templates/:id", handleUpdateTemplate)`) are an alternative but don't scale.
