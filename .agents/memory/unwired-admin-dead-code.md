---
    name: Unwired admin dead-code pattern
    description: How to check whether a seemingly-new admin page component is actually wired into the app, and common wiring bugs found in this codebase
    ---

    Before building any "new" admin page/tab, grep whether the component file is already imported anywhere. This codebase had a fully-built, more polished admin Support Center component (tabbed Tickets/Bugs/Features) sitting unused while an older, worse inline implementation was live in Admin.tsx. This is the second time in this project unwired-but-complete code was discovered instead of a real gap — always grep for imports before assuming "needs to be built".

    **Why:** Building from scratch when a better implementation already exists wastes effort and risks diverging from established patterns (e.g. this app's convention of extracting each admin tab into its own file under pages/admin/ and importing it into Admin.tsx).

    **How to apply:** When asked to build/improve an admin feature, grep the component name across the codebase for imports. If found but unused, audit it for wiring bugs (wrong API base path, wrong HTTP method, wrong response field names) before wiring it in — these bugs are common in never-tested dead code:
    - One admin page's local `apiFetch` helper hardcoded a single base path (`/api/admin/`) but some entities it managed (bug reports, feature requests) actually live under a different router (`/api/product-hub/admin/`) and use PUT, not PATCH.
    - An overview card read `ov.recentActivity?.pendingPlanRequests` but the real dashboard-overview endpoint returns data under `ov.recent` (not `recentActivity`), and had no dedicated open-ticket/bug/feature counts at all — added lightweight `count()` queries to the endpoint's existing Promise.all rather than creating a new endpoint.
    - Reused an existing table's spare `category` column (e.g. `category: "contact"`, `userId: null`) for a new use case (public contact form submissions) instead of creating a new table — check nullable/optional columns on existing tables before adding schema.
    