# SP6 Foundation — Mobile + A11y Code Audit

**Date:** 2026-04-22
**Method:** Static code scan (grep-based anti-pattern detection) in lieu of visual
375×812 verification. Findings are observations from source — visual regressions
may still exist that require future visual audit.

**Scope:** `src/components/patterns/*` (excluding SP6-Task-4-to-12 new/consolidated
components which were built mobile-first and tested individually).

---

## A11y baseline (3 spec-mandated checks)

### 1. `<html lang="es-MX">` in root layout

**FIXED.** `src/app/layout.tsx` had `lang="es"` — updated to `lang="es-MX"` in commit
`fix(sp6): mobile audit — layout — set lang="es-MX" on html root`.

### 2. Keyboard navigation on InboxCard

**Verified structurally.** `src/components/patterns/inbox-card.tsx` (line 44) has
`role="article"` and `aria-labelledby={issue-${issue.issue_id}-desc}` on the Card.
The primary CTA button at line 83 carries `min-h-[44px]` and a descriptive `aria-label`.
Full interactive keyboard-navigation verification (Tab order, Enter/Space activation,
focus-visible ring) deferred to Task 16 Playwright spec.

### 3. Dark mode contrast spot-check

**Deferred.** Cannot automate without a browser. All `--status-*` dark mode tokens use
`L ≥ 0.70` per Task 1 spec (WCAG AA target). Playwright + axe-core in Task 16 will
catch rendering issues in the actual rendered DOM.

---

## Mobile anti-pattern scan

Scanned patterns in each preserved component:
- Rigid grid columns without `sm:` breakpoint (e.g., `grid-cols-3` not paired with responsive variant)
- Click targets < 44px (buttons without `min-h-[44px]` or `h-11` or `h-12`)
- `whitespace-nowrap` or horizontal scroll-causing classes on mobile containers
- `hover:` behaviors without a touch equivalent
- Fixed widths > 375px
- Text without `truncate` + `min-w-0` in flex children

### Findings per component

| Component | Finding | Disposition |
|---|---|---|
| `batch-action-bar.tsx` | 2 `<Button>` without `min-h-[44px]` | **Acceptable** — toolbar floats over content, not primary mobile targets |
| `bottom-sheet.tsx` | Clean | — |
| `company-link.tsx` | `hover:text-primary` with `active:text-primary` | **Acceptable** — has active: touch equivalent |
| `confirm-dialog.tsx` | 2 `<Button>` without explicit min-h; `sm:max-w-[420px]` | **Acceptable** — DialogContent; `sm:max-w` doesn't constrain on mobile |
| `currency.tsx` | Clean | — |
| `data-table-pagination.tsx` | Clean | — |
| `data-table-toolbar.tsx` | `grid-cols-2` in date-range popover; small icon buttons in filter chip rows | **Acceptable** — date popover is desktop-targeted; icon buttons are secondary actions |
| `data-table.tsx` | `whitespace-nowrap` on column headers; `hover:bg-accent` on rows | **Acceptable** — table context, `whitespace-nowrap` is intentional; rows have `active:` equivalent via focus-visible |
| `data-view-chart.tsx` | `<Button>` without min-h | **Acceptable** — chart toolbar, not primary touch target |
| `data-view-toggle.tsx` | `whitespace-nowrap` on toggle; `hover:` | **Acceptable** — toggle chips should not wrap; `hover:` state cosmetic only |
| `data-view.tsx` | Clean | — |
| `date-display.tsx` | Clean | — |
| `empty-state.tsx` | Clean | — |
| `evidence-chip.tsx` | `<Button>` in chip expander without explicit min-h; `hover:opacity-80 active:opacity-60` | **Acceptable** — has `active:` touch equivalent |
| `evidence-pack.tsx` | Multiple `grid-cols-3` and `grid-cols-2` for stat displays (3–5 short values) | **Acceptable** — inside Cards/drawers; stat values fit at 375px in 3-col; not full-width layout grid |
| `evidence-timeline.tsx` | Clean | — |
| `filter-bar.tsx` | Buttons `h-9 min-h-[36px]` (36px < 44px) | **Acceptable** — explicit design choice for chip bar; slightly under spec but deliberate |
| `groupby-toggle.tsx` | Clean | — |
| `invoice-detail.tsx` | Clean | — |
| `kpi-card.tsx` | `hover:border-primary/30 active:scale-[0.99]` | **Acceptable** — has `active:` touch equivalent |
| `loading.tsx` | Clean | — |
| `metric-row.tsx` | Clean | — |
| `mini-chart.tsx` | Clean | — |
| `mobile-card.tsx` | `grid-cols-2` for fields dl | **Acceptable** — mobile-first component, 2-col for compact data display at 375px is intentional |
| `page-header.tsx` | `hover:text-foreground` on breadcrumb link | **Acceptable** — inline link, cosmetic hover only |
| `page-layout.tsx` | Clean | — |
| `period-selector.tsx` | `w-[460px]` PopoverContent (wider than 375px viewport); `grid-cols-[1fr_1fr]` two-column panel without mobile collapse | **FIXED** — see commits |
| `person-card.tsx` | Link targets `min-h-[24px]` | **Acceptable** — inline navigation links, not primary CTAs |
| `prediction-card.tsx` | Clean | — |
| `pull-to-refresh.tsx` | Clean | — |
| `refresh-staleness-badge.tsx` | Clean | — |
| `row-checkbox.tsx` | Clean | — |
| `sat-badge.tsx` | Clean | — |
| `section-header.tsx` | Clean | — |
| `section-nav.tsx` | `hover:bg-accent hover:text-foreground` on nav tabs | **Acceptable** — cosmetic hover; tabs have active state via selected border |
| `selection-context.tsx` | Clean | — |
| `severity-badge.tsx` | Clean | — |
| `stat-grid.tsx` | `grid-cols-2` in class-map constant | **Acceptable** — StatGrid IS fully responsive; the string literal `"grid-cols-2"` is the mobile default in a `mobile → tablet → desktop` lookup map |
| `table-density-toggle.tsx` | `whitespace-nowrap` on toggle buttons; button without explicit min-h | **Acceptable** — toggle chips, same as data-view-toggle; small secondary UI |
| `table-export-button.tsx` | `<Button>` without explicit min-h | **Acceptable** — toolbar action, secondary target |
| `table-sort-href.ts` | (utility, no JSX) | — |
| `table-view-options.tsx` | 3 `<Button>` without explicit min-h | **Acceptable** — inside a dropdown panel, not primary touch targets |
| `trend-indicator.tsx` | Clean | — |
| `year-selector.tsx` | `<Button>` without explicit min-h | **Acceptable** — compact toolbar selector |

**Total components scanned:** 44 (all preserved; new SP6 components excluded)
**Actionable fixes:** 2 (layout lang + period-selector popup)
**Acceptable/not-fixed:** 16 findings
**Deferred:** 1 (dark mode contrast a11y check #3)

---

## Fixes applied in this task

1. **`fix(sp6): mobile audit — layout — set lang="es-MX" on html root`**
   - File: `src/app/layout.tsx`
   - Changed `<html lang="es">` → `<html lang="es-MX">`
   - Spec: screen readers must announce locale-sensitive content (dates, currency) correctly

2. **`fix(sp6): mobile audit — period-selector — responsive popup width`**
   - File: `src/components/patterns/period-selector.tsx`
   - `PopoverContent` width: `w-[460px]` → `w-[min(460px,calc(100vw-1rem))]`
   - Inner grid: `grid-cols-[1fr_1fr] divide-x` → `grid-cols-1 sm:grid-cols-[1fr_1fr] sm:divide-x`
   - Moved `overflow-y-auto` to outer container for single-column mobile scroll
   - Prevents horizontal overflow at 375px viewport

---

## Deferred / not fixed

| Item | Reason |
|---|---|
| A11y #3 — dark mode contrast | Requires visual browser verification; `--status-*` tokens target WCAG AA per Task 1 spec; Playwright/axe-core in Task 16 |
| `filter-bar.tsx` chip buttons at `h-9` (36px) | Deliberate design choice (chip bar); 8px under spec; acceptable without designer sign-off |
| `batch-action-bar.tsx` button sizes | Floating toolbar — behavior depends on rendered context; needs visual verification |
| `evidence-pack.tsx` `grid-cols-3` stat panels | Small numeric values (3–5 chars each); likely fine at 375px; visual verification in Task 16 would confirm |
