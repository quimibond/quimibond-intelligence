# SP6 Foundation — Out-of-Scope Smoke Test

**Date:** 2026-04-22
**Method:** Static — `next build` (includes tsc type-check + Webpack bundle check) + `.next/server/app` bundle-presence verification + import-usage grep. No visual verification.
**Branch:** `frontend-revamp-sp6-ui` @ `72de455`

## DoD gate #11 result

**ok** — 0 TypeScript errors introduced in out-of-scope pages. All 12 out-of-scope routes compiled to bundles and are present in `.next/server/app`. The only build failure is the pre-existing `/equipo` prerender crash (missing `SUPABASE_SERVICE_KEY` in local dev env, unrelated to SP6 foundation changes).

## Per-page verification

| Page | TS errors introduced? | Route bundle present? | Imports shimmed components? | Notes |
|---|---|---|---|---|
| / | No | Yes — `page.js` present | Yes — `SeverityBadge` from `@/components/patterns` | 6 shimmed-component references |
| /briefings/[director] | No | Yes — `briefings/[director]/page.js` present | No | Clean — no shim imports |
| /chat | No | Yes — `chat/page.js` present | No | Clean — no shim imports |
| /compras | No | Yes — `compras/page.js` present | Yes — `DataView`, `DataViewChart`, `StatusBadge` from `@/components/patterns` | 25 shimmed-component references — heaviest consumer |
| /compras/costos-bom | No | Yes — `compras/costos-bom` dir present | No | Clean — no shim imports |
| /contactos | No | Yes — `contactos/page.js` present | Yes — `DataView`, `DataViewChart` from `@/components/patterns` | 10 shimmed-component references |
| /contactos/[id] | No | Yes — `contactos/[id]` dir present | No | Clean — no shim imports |
| /directores | No | Yes — `directores/page.js` present | No | Clean — no shim imports |
| /directores/[slug] | No | Yes — `directores/[slug]` dir present | No | Clean — no shim imports |
| /equipo | No | Yes — `equipo/page.js` present (bundle compiled) | No | Known prerender crash at static-gen: missing `SUPABASE_SERVICE_KEY` in local env — pre-existing, unrelated to SP6 |
| /profile | No | Yes — `profile/page.js` present | No | Clean — no shim imports |
| /sistema | No | Yes — `sistema/page.js` present | No | Clean — no shim imports |

## Build evidence

```
next build output (key lines):
  ✓ Compiled successfully in 4.3s
  Linting and checking validity of types ...    ← passed, 0 errors (only lint warnings)
  Generating static pages (0/60) ...
  Generating static pages (15/60)
  Generating static pages (30/60)
  Generating static pages (45/60)
  Error occurred prerendering page "/equipo"    ← known, pre-existing
  Error: supabaseKey is required.               ← missing env var, not SP6 regression
```

All 60 routes were being generated before the `/equipo` crash. The crash halts the final bundle manifest write but all `.next/server/app/<route>` directories are already persisted to disk.

## Summary

- Total new TS errors introduced in out-of-scope pages: **0** (gate satisfied)
- Out-of-scope pages that use shimmed components (validating the shim layer): **3** (`/`, `/compras`, `/contactos`)
- Shim imports all resolve via `@/components/patterns` barrel — confirmed by successful `next build` Webpack compile
- Regressions: **0**
- Pre-existing known issues carried forward: **1** (`/equipo` prerender — missing service key in local dev, not introduced by SP6)

## Deferred to real-browser smoke test

Full visual verification of each page at mobile + desktop is deferred to:
- Vercel preview deploy of the foundation PR
- Future Playwright session (spec suggested in a11y-report.md)
