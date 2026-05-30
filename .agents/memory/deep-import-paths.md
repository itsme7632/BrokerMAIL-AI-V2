---
name: Deep import paths in workspace libs
description: Why deep src/ imports from workspace libs break Vite bundling and how to fix them
---

# Deep import paths gotcha

## Rule
Never import from `@workspace/<pkg>/src/...` in the frontend. Only import from the package root `@workspace/<pkg>`.

## Why
Vite resolves workspace package imports via the `exports` field in `package.json`. If a path is not listed in `exports`, Vite throws "Missing specifier" at build/dev time. Deep `src/` paths bypass the exports map.

## How to fix
1. Check if the symbol is already re-exported from the package's `src/index.ts`.
2. If yes: change the import to `@workspace/<pkg>` (the root export).
3. If no: add the symbol to `src/index.ts` and optionally add an `exports` entry in `package.json`.

## Example (api-client-react)
`setAuthTokenGetter`, all generated hooks, and all TypeScript types are already exported from `lib/api-client-react/src/index.ts` — import them from `@workspace/api-client-react` directly.
