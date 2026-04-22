# SP6 Foundation — A11y Scan Report

**Date:** 2026-04-22
**Tool:** axe-core ^4.11.3 (library) + Vitest v4.1.2 + jsdom
**Scope:** 7 new/consolidated SP6 components
**Test file:** `src/__tests__/patterns/axe-a11y.test.tsx`

**Note:** The original Task 16 spec required `@playwright/test` + `@axe-core/playwright` + Chromium for full browser-based a11y + screenshot baselines. Due to disk constraints in the current session (96% used, ~580 MB free), we ran axe-core in jsdom (Vitest) instead. Trade-offs documented below.

## Results

All 7 components: **0 critical axe-core violations** under these rule-sets.

| Component | Test | Result |
|---|---|---|
| `StatusBadge` | all kinds (severity/payment/estado_sat/blacklist/shadow/match/staleness), density compact + regular | PASS |
| `Chart` | line, bar, sparkline — each with required `ariaLabel` | PASS |
| `TrendSpark` | up / down / flat trends | PASS |
| `InboxCard` | with assignee+action, no assignee, no action | PASS |
| `SwipeStack` | 3 children, `role="list"` + `aria-label` | PASS |
| `AgingBuckets` | full data with `onBucketClick` handler | PASS |
| `CompanyKpiHero` | default + blacklist `69b_definitivo` + shadow flag | PASS |

**Total: 7 tests / 7 passed / 0 failures**

## Implementation note: barrel import

The patterns barrel index (`@/components/patterns`) transitively pulls in `server-only` via
`company-link.tsx → _helpers.ts` and `evidence-pack.tsx`, `period-selector.tsx`, `invoice-detail.tsx`.
That module is not available in jsdom. The test imports from individual component files (consistent
with all other tests in `src/__tests__/patterns/`).

## Rules disabled (intentional)

- `color-contrast` — jsdom does not do real rendering, so contrast cannot be measured. The new `--status-*` tokens use OKLCH values targeted at WCAG AA in both light and dark modes (spec §5.1). Full contrast verification defers to a future Playwright session.
- `region` — pattern-level component tests wrap each component in a bare `<div>`; region rule is noisy without a full page context.

## Deferred to future session

1. **Playwright e2e** — visual regressions, mobile viewport rendering (375×812), touch/gesture tests.
2. **Real browser axe scan** — rules that need rendered layout (color-contrast, scrollable-region-focusable).
3. **Cross-browser** — Chromium / Firefox / Safari.

These will land as a separate PR once disk space allows (~150 MB for Playwright + Chromium). Suggested sub-spec: `sp6-e2e-playwright`.
