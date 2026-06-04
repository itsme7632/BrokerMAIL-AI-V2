---
name: Dark mode architecture
description: How dark mode is implemented — CSS layers, ThemeContext, toggle location, coverage strategy
---

## Architecture

**ThemeContext** (`src/context/ThemeContext.tsx`): reads/writes `localStorage("theme")`, falls back to `prefers-color-scheme`, adds/removes `dark` class on `document.documentElement`. Wrapped above QueryClientProvider in App.tsx.

**Trigger mechanism**: `@custom-variant dark (&:is(.dark *))` in index.css — applying `dark` to `<html>` makes ALL descendants eligible for `dark:` utility classes.

**Two-layer coverage strategy:**
1. CSS variable overrides in `.dark { --background: ...; --card: ...; }` in index.css — covers all shadcn/ui components that use CSS variables (`bg-background`, `bg-card`, etc.) automatically.
2. `@layer utilities { .dark .bg-white { ... } ... }` — CSS specificity (0,2,0) overrides Tailwind's (0,1,0) utilities for hardcoded Tailwind color classes (`bg-white`, `bg-slate-50/100/200`, `text-slate-900/800/700/600/500`, all status color backgrounds/text). Covers all pages without touching each page file.

**Why specificity works**: Within `@layer utilities`, `.dark .bg-white` (two class selectors = 0,2,0) overrides `.bg-white` (one class selector = 0,1,0). My overrides also appear AFTER Tailwind's in the cascade (same layer, later position), so they win on both fronts.

**Toggle location**: In `TopHeader` inside `AppLayout.tsx` — visible on all authenticated pages. Public/auth pages (Login, Register) do NOT have the toggle but inherit dark mode from localStorage preference.

**Coverage gaps intentionally left alone:**
- Vibrant "500" colors (`bg-blue-500`, `text-emerald-500` etc.) — visible on dark bg without change
- Opacity variants (`bg-blue-50/40`) — added `.dark .bg-blue-50\/40` to CSS
- `border-white` on badges — added `.dark .border-white` to CSS

**Files changed:**
- `src/context/ThemeContext.tsx` (new)
- `src/App.tsx` — added ThemeProvider wrapper
- `src/components/layout/AppLayout.tsx` — Moon/Sun toggle + explicit dark: on sidebar/header/nav
- `src/index.css` — .dark CSS vars + comprehensive @layer utilities overrides
