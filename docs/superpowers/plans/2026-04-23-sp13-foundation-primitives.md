# SP13.0 — Foundation Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 7 new primitives + extended `KpiCard` + shared types/helpers that every SP13.x per-page rebuild will consume. Each primitive is isolated, tested, and demonstrated on `/showcase/sp13`.

**Architecture:** TypeScript types + composable React primitives in `src/components/patterns/`, backed by a new `src/lib/kpi/` module that defines the `KpiResult<T>` / `TimeSeries<T>` contracts and pure helper functions (format, drift calculation, delta computation). Every primitive uses shadcn/ui underneath (`Card`, `Badge`, `Popover`, `Tooltip`) and follows the existing patterns catalog conventions. Tests use vitest + `@testing-library/react` + `axe-core` (already configured).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, lucide-react, vitest, @testing-library/react, axe-core.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/kpi/types.ts` | `SourceKind`, `KpiResult<T>`, `TimeSeries<T>`, `Comparison`, `DriftInfo`, `MetricDefinition` types |
| `src/lib/kpi/format.ts` | Pure helpers: `sourceLabel`, `sourceColor`, `computeDelta`, `driftSeverity` |
| `src/lib/kpi/index.ts` | Barrel re-export |
| `src/components/patterns/source-badge.tsx` | `<SourceBadge source>` pill |
| `src/components/patterns/drift-pill.tsx` | `<DriftPill sources>` clickable popover |
| `src/components/patterns/metric-tooltip.tsx` | `<MetricTooltip definition>` wrapper for labels |
| `src/components/patterns/comparison-cell.tsx` | `<ComparisonCell>` table cell with value + delta |
| `src/components/patterns/drift-alert.tsx` | `<DriftAlert>` page-level banner |
| `src/components/patterns/history-selector.tsx` | `<HistorySelector>` MTD/YTD/LTM/3y/5y/All URL-state control |
| `src/components/patterns/question-section.tsx` | `<QuestionSection title question>` Section wrapper |
| `src/app/showcase/sp13/page.tsx` | Visual catalog of all primitives |
| `src/__tests__/sp13/types.test.ts` | Type-level tests |
| `src/__tests__/sp13/format.test.ts` | Pure helper tests |
| `src/__tests__/sp13/source-badge.test.tsx` | Render + a11y |
| `src/__tests__/sp13/drift-pill.test.tsx` | Render + interaction + a11y |
| `src/__tests__/sp13/metric-tooltip.test.tsx` | Render + a11y |
| `src/__tests__/sp13/comparison-cell.test.tsx` | Render + a11y |
| `src/__tests__/sp13/drift-alert.test.tsx` | Render + a11y |
| `src/__tests__/sp13/history-selector.test.tsx` | URL state + a11y |
| `src/__tests__/sp13/question-section.test.tsx` | Render + a11y |
| `src/__tests__/sp13/kpi-card-sp13.test.tsx` | Extended KpiCard render + a11y |

### Modified files

| Path | Change |
|---|---|
| `src/components/patterns/kpi-card.tsx` | Extend props with optional `sources`, `comparison`, `definition`, `asOfDate` (backwards compatible) |
| `src/components/patterns/index.ts` | Export 7 new primitives |

### Not touched

- `src/components/ui/DataSourceBadge.tsx` — existing page-level data lineage badge (different concept from SP13 per-KPI source). Stays.
- Existing `KpiCard` consumers do NOT change in SP13.0; they keep using the old prop signature (backwards compat).

---

## Execution notes

- Run each task end-to-end (failing test → impl → passing test → commit) before starting the next.
- After every commit, run `npm run test` to confirm no regression.
- After Task 11, run `npm run build` to catch server-only barrier issues (per feedback_sp6_dod_build memory).
- Axe tests follow the existing pattern in `src/__tests__/patterns/axe-a11y.test.tsx` — import components directly (not via barrel) to avoid `server-only` transitive imports.

---

## Task 1: Shared types in `src/lib/kpi/types.ts`

**Files:**
- Create: `src/lib/kpi/types.ts`
- Create: `src/lib/kpi/index.ts`
- Test: `src/__tests__/sp13/types.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
// src/__tests__/sp13/types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  SourceKind,
  Comparison,
  MetricDefinition,
  DriftInfo,
  KpiResult,
  TimeSeries,
  TimeSeriesPoint,
} from "@/lib/kpi";

describe("SP13 KPI types", () => {
  it("SourceKind is a union of the 4 canonical labels", () => {
    expectTypeOf<SourceKind>().toEqualTypeOf<"sat" | "pl" | "odoo" | "canonical">();
  });

  it("KpiResult is generic over value type", () => {
    const numeric: KpiResult<number> = {
      value: 7_379_304.29,
      asOfDate: "2026-04-23",
      source: "pl",
      definition: {
        title: "Ingresos del mes",
        description: "Suma del P&L del mes actual.",
        formula: "SUM(gold_pl_statement.total_income) WHERE period = YYYY-MM",
        table: "gold_pl_statement",
      },
      comparison: null,
      sources: undefined,
      drift: null,
    };
    expectTypeOf(numeric.value).toBeNumber();
    expectTypeOf(numeric.source).toEqualTypeOf<SourceKind>();
  });

  it("Comparison carries direction enum", () => {
    expectTypeOf<Comparison["direction"]>().toEqualTypeOf<"up" | "down" | "flat">();
  });

  it("TimeSeries carries a selected range and a full range", () => {
    const series: TimeSeries<number> = {
      points: [{ period: "2026-04", value: 8_314_094, source: "sat" }],
      fullRange: { earliest: "2021-01", latest: "2026-04" },
      selectedRange: { from: "2025-05", to: "2026-04" },
      source: "sat",
    };
    expectTypeOf(series.points).toEqualTypeOf<TimeSeriesPoint<number>[]>();
  });
});
```

- [ ] **Step 1.2: Run test — expect FAIL**

Run: `npx vitest run src/__tests__/sp13/types.test.ts`
Expected: FAIL with `Cannot find module '@/lib/kpi'` or similar.

- [ ] **Step 1.3: Create `src/lib/kpi/types.ts`**

```ts
// src/lib/kpi/types.ts

/** Canonical data source labels for SP13. Keep small; extend only if a
 *  sub-spec truly needs more granularity. */
export type SourceKind = "sat" | "pl" | "odoo" | "canonical";

/** Human-readable metadata so every KPI can self-explain. */
export interface MetricDefinition {
  title: string;
  description: string;
  formula: string;
  table: string;
}

/** Contextual delta for a KPI: vs prior period, vs target, etc. */
export interface Comparison {
  label: string; // e.g. "vs mes anterior", "YoY"
  priorValue: number;
  delta: number;
  deltaPct: number | null; // null when priorValue is 0
  direction: "up" | "down" | "flat";
}

/** Cross-source drift signal. Surfaces when sources disagree. */
export interface DriftInfo {
  severity: "info" | "warning" | "critical";
  message: string;
}

/** Single-value KPI result. */
export interface KpiResult<T = number> {
  value: T;
  asOfDate: string; // ISO date
  source: SourceKind;
  definition: MetricDefinition;
  comparison: Comparison | null;
  /** Present when the metric has multiple data sources to compare. */
  sources?: Array<{
    source: SourceKind;
    value: T;
    diffFromPrimary: T;
    diffPct: number; // (diffFromPrimary / primary) * 100
  }>;
  drift: DriftInfo | null;
}

/** One point on a time series. */
export interface TimeSeriesPoint<T = number> {
  period: string; // "YYYY-MM" or "YYYY-MM-DD" per caller
  value: T;
  source: SourceKind;
}

/** Time-series result. Carries both the selected and the full available range. */
export interface TimeSeries<T = number> {
  points: TimeSeriesPoint<T>[];
  fullRange: { earliest: string; latest: string };
  selectedRange: { from: string; to: string };
  source: SourceKind;
}
```

- [ ] **Step 1.4: Create `src/lib/kpi/index.ts`**

```ts
// src/lib/kpi/index.ts
export type {
  SourceKind,
  MetricDefinition,
  Comparison,
  DriftInfo,
  KpiResult,
  TimeSeriesPoint,
  TimeSeries,
} from "./types";
```

- [ ] **Step 1.5: Run test — expect PASS**

Run: `npx vitest run src/__tests__/sp13/types.test.ts`
Expected: PASS (4 type tests).

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/kpi/types.ts src/lib/kpi/index.ts src/__tests__/sp13/types.test.ts
git commit -m "feat(sp13): KPI contract types (KpiResult, TimeSeries, SourceKind)"
```

---

## Task 2: Pure helpers in `src/lib/kpi/format.ts`

**Files:**
- Create: `src/lib/kpi/format.ts`
- Modify: `src/lib/kpi/index.ts`
- Test: `src/__tests__/sp13/format.test.ts`

- [ ] **Step 2.1: Write the failing test**

```ts
// src/__tests__/sp13/format.test.ts
import { describe, it, expect } from "vitest";
import {
  sourceLabel,
  sourceShortLabel,
  computeDelta,
  driftSeverity,
} from "@/lib/kpi/format";

describe("sourceLabel", () => {
  it("maps each source to its Spanish display label", () => {
    expect(sourceLabel("sat")).toBe("SAT (fiscal)");
    expect(sourceLabel("pl")).toBe("P&L contable");
    expect(sourceLabel("odoo")).toBe("Odoo operativo");
    expect(sourceLabel("canonical")).toBe("Canonical");
  });
});

describe("sourceShortLabel", () => {
  it("returns compact labels for badges", () => {
    expect(sourceShortLabel("sat")).toBe("SAT");
    expect(sourceShortLabel("pl")).toBe("P&L");
    expect(sourceShortLabel("odoo")).toBe("Odoo");
    expect(sourceShortLabel("canonical")).toBe("Canon.");
  });
});

describe("computeDelta", () => {
  it("returns up when current > prior", () => {
    const c = computeDelta({ current: 110, prior: 100, label: "vs mes" });
    expect(c).toEqual({
      label: "vs mes",
      priorValue: 100,
      delta: 10,
      deltaPct: 10,
      direction: "up",
    });
  });
  it("returns down when current < prior", () => {
    const c = computeDelta({ current: 90, prior: 100, label: "vs mes" });
    expect(c?.direction).toBe("down");
    expect(c?.deltaPct).toBe(-10);
  });
  it("returns flat when equal", () => {
    const c = computeDelta({ current: 100, prior: 100, label: "vs mes" });
    expect(c?.direction).toBe("flat");
    expect(c?.deltaPct).toBe(0);
  });
  it("returns deltaPct null when prior is 0 (avoid Infinity)", () => {
    const c = computeDelta({ current: 50, prior: 0, label: "vs mes" });
    expect(c?.deltaPct).toBeNull();
    expect(c?.direction).toBe("up");
  });
  it("returns null for null inputs", () => {
    expect(computeDelta({ current: null, prior: 100, label: "vs" })).toBeNull();
    expect(computeDelta({ current: 100, prior: null, label: "vs" })).toBeNull();
  });
});

describe("driftSeverity", () => {
  it("info for diffs under 5%", () => {
    expect(driftSeverity(0.02)).toBe("info");
    expect(driftSeverity(-0.04)).toBe("info");
  });
  it("warning for 5% to 15%", () => {
    expect(driftSeverity(0.1)).toBe("warning");
    expect(driftSeverity(-0.12)).toBe("warning");
  });
  it("critical for over 15%", () => {
    expect(driftSeverity(0.2)).toBe("critical");
    expect(driftSeverity(-0.5)).toBe("critical");
  });
});
```

- [ ] **Step 2.2: Run test — expect FAIL**

Run: `npx vitest run src/__tests__/sp13/format.test.ts`
Expected: FAIL with "Cannot find module" for `@/lib/kpi/format`.

- [ ] **Step 2.3: Create `src/lib/kpi/format.ts`**

```ts
// src/lib/kpi/format.ts
import type { Comparison, SourceKind } from "./types";

const LONG: Record<SourceKind, string> = {
  sat: "SAT (fiscal)",
  pl: "P&L contable",
  odoo: "Odoo operativo",
  canonical: "Canonical",
};

const SHORT: Record<SourceKind, string> = {
  sat: "SAT",
  pl: "P&L",
  odoo: "Odoo",
  canonical: "Canon.",
};

export function sourceLabel(s: SourceKind): string {
  return LONG[s];
}

export function sourceShortLabel(s: SourceKind): string {
  return SHORT[s];
}

/** Maps source to a Tailwind text color token. Used by SourceBadge. */
export function sourceColorClass(s: SourceKind): string {
  switch (s) {
    case "sat":
      return "text-primary"; // fiscal = primary accent
    case "pl":
      return "text-warning"; // P&L = orange/yellow to flag "contable, no fiscal"
    case "odoo":
      return "text-info";
    case "canonical":
      return "text-success"; // canonical = reconciled truth
  }
}

export interface DeltaInput {
  current: number | null;
  prior: number | null;
  label: string;
}

/** Compute a Comparison. Returns null when either input is null. */
export function computeDelta(input: DeltaInput): Comparison | null {
  const { current, prior, label } = input;
  if (current == null || prior == null) return null;
  const delta = current - prior;
  const deltaPct = prior === 0 ? null : (delta / prior) * 100;
  const direction: Comparison["direction"] =
    delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { label, priorValue: prior, delta, deltaPct, direction };
}

/** Drift severity bucket for a signed fraction (e.g. 0.15 = +15%). */
export function driftSeverity(diffFraction: number): "info" | "warning" | "critical" {
  const abs = Math.abs(diffFraction);
  if (abs < 0.05) return "info";
  if (abs <= 0.15) return "warning";
  return "critical";
}
```

- [ ] **Step 2.4: Re-export from barrel**

Edit `src/lib/kpi/index.ts` — append:

```ts
export {
  sourceLabel,
  sourceShortLabel,
  sourceColorClass,
  computeDelta,
  driftSeverity,
} from "./format";
export type { DeltaInput } from "./format";
```

- [ ] **Step 2.5: Run test — expect PASS**

Run: `npx vitest run src/__tests__/sp13/format.test.ts`
Expected: PASS (12 assertions).

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/kpi/format.ts src/lib/kpi/index.ts src/__tests__/sp13/format.test.ts
git commit -m "feat(sp13): kpi format helpers (sourceLabel, computeDelta, driftSeverity)"
```

---

## Task 3: `<SourceBadge>` primitive

**Files:**
- Create: `src/components/patterns/source-badge.tsx`
- Test: `src/__tests__/sp13/source-badge.test.tsx`

- [ ] **Step 3.1: Write the failing test**

```tsx
// src/__tests__/sp13/source-badge.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { SourceBadge } from "@/components/patterns/source-badge";

describe("<SourceBadge>", () => {
  it("renders short label for each source", () => {
    render(<SourceBadge source="sat" />);
    expect(screen.getByText("SAT")).toBeInTheDocument();
  });

  it("renders a title attribute with the long label for hover", () => {
    render(<SourceBadge source="pl" />);
    const el = screen.getByText("P&L");
    expect(el.closest("[title]")).toHaveAttribute("title", "P&L contable");
  });

  it("applies the source color class", () => {
    const { container } = render(<SourceBadge source="sat" />);
    expect(container.querySelector(".text-primary")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <>
        <SourceBadge source="sat" />
        <SourceBadge source="pl" />
        <SourceBadge source="odoo" />
        <SourceBadge source="canonical" />
      </>
    );
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
```

- [ ] **Step 3.2: Run test — expect FAIL**

Run: `npx vitest run src/__tests__/sp13/source-badge.test.tsx`
Expected: FAIL (component does not exist).

- [ ] **Step 3.3: Create `src/components/patterns/source-badge.tsx`**

```tsx
// src/components/patterns/source-badge.tsx
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  sourceLabel,
  sourceShortLabel,
  sourceColorClass,
  type SourceKind,
} from "@/lib/kpi";

export interface SourceBadgeProps {
  source: SourceKind;
  className?: string;
}

/**
 * Small pill showing the data source of a KPI value. Hover shows the long
 * label. Use next to every number so users know where it came from.
 */
export function SourceBadge({ source, className }: SourceBadgeProps) {
  return (
    <Badge
      variant="outline"
      title={sourceLabel(source)}
      className={cn(
        "h-4 gap-0 px-1.5 text-[9px] font-semibold tracking-wide",
        sourceColorClass(source),
        className
      )}
    >
      {sourceShortLabel(source)}
    </Badge>
  );
}
```

- [ ] **Step 3.4: Run test — expect PASS**

Run: `npx vitest run src/__tests__/sp13/source-badge.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 3.5: Commit**

```bash
git add src/components/patterns/source-badge.tsx src/__tests__/sp13/source-badge.test.tsx
git commit -m "feat(sp13): SourceBadge primitive with hover long-label"
```

---

## Task 4: `<DriftPill>` primitive

**Files:**
- Create: `src/components/patterns/drift-pill.tsx`
- Test: `src/__tests__/sp13/drift-pill.test.tsx`

- [ ] **Step 4.1: Write the failing test**

```tsx
// src/__tests__/sp13/drift-pill.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";
import { DriftPill } from "@/components/patterns/drift-pill";

const sources = [
  { source: "sat" as const, value: 8_314_094, diffFromPrimary: 0, diffPct: 0 },
  { source: "pl" as const, value: 7_379_304, diffFromPrimary: -934_790, diffPct: -11.2 },
];

describe("<DriftPill>", () => {
  it("shows severity label based on max absolute diffPct", () => {
    render(<DriftPill sources={sources} primary="sat" />);
    // 11.2% → warning
    expect(screen.getByRole("button")).toHaveTextContent(/⚠|diff/i);
  });

  it("opens a popover with the source breakdown on click", async () => {
    render(<DriftPill sources={sources} primary="sat" />);
    fireEvent.click(screen.getByRole("button"));
    // Popover content should show the P&L absolute diff
    expect(await screen.findByText(/P&L/)).toBeInTheDocument();
    expect(screen.getByText(/-934,790|-11.2%/)).toBeInTheDocument();
  });

  it("returns null when there are fewer than 2 sources", () => {
    const { container } = render(
      <DriftPill sources={[sources[0]]} primary="sat" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<DriftPill sources={sources} primary="sat" />);
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
```

- [ ] **Step 4.2: Run test — expect FAIL**

Run: `npx vitest run src/__tests__/sp13/drift-pill.test.tsx`

- [ ] **Step 4.3: Create `src/components/patterns/drift-pill.tsx`**

```tsx
// src/components/patterns/drift-pill.tsx
"use client";

import { AlertTriangle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  driftSeverity,
  sourceLabel,
  type SourceKind,
  type KpiResult,
} from "@/lib/kpi";
import { formatCurrencyMXN } from "@/lib/formatters";

type SourceRow = NonNullable<KpiResult<number>["sources"]>[number];

export interface DriftPillProps {
  sources: SourceRow[];
  primary: SourceKind;
  /** Optional formatter override; default is MXN compact. */
  formatValue?: (v: number) => string;
}

const severityClass = {
  info: "text-muted-foreground",
  warning: "text-warning",
  critical: "text-danger",
} as const;

/**
 * Pill that surfaces divergences between data sources. Rendered only when
 * `sources.length >= 2`. Click opens a popover with per-source values and
 * their diff vs the primary source.
 */
export function DriftPill({
  sources,
  primary,
  formatValue,
}: DriftPillProps) {
  if (sources.length < 2) return null;

  // Max absolute diffPct across non-primary sources → severity.
  const maxAbs = sources
    .filter((s) => s.source !== primary)
    .reduce((max, s) => Math.max(max, Math.abs(s.diffPct)), 0);
  const severity = driftSeverity(maxAbs / 100);
  const fmt = formatValue ?? ((v: number) => formatCurrencyMXN(v, { compact: true }));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-5 gap-1 px-1.5 text-[10px] font-medium",
            severityClass[severity]
          )}
        >
          <AlertTriangle className="size-2.5" aria-hidden />
          <span>diff {maxAbs.toFixed(1)}%</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 text-xs">
        <div className="mb-2 font-semibold uppercase tracking-wide text-muted-foreground">
          Divergencia entre fuentes
        </div>
        <table className="w-full">
          <tbody>
            {sources.map((s) => (
              <tr key={s.source} className="border-b border-border/40 last:border-0">
                <td className="py-1 pr-2 font-medium">{sourceLabel(s.source)}</td>
                <td className="py-1 text-right tabular-nums">{fmt(s.value)}</td>
                <td className="py-1 pl-2 text-right tabular-nums text-muted-foreground">
                  {s.source === primary ? "—" : `${s.diffPct > 0 ? "+" : ""}${s.diffPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4.4: Run test — expect PASS**

Run: `npx vitest run src/__tests__/sp13/drift-pill.test.tsx`

- [ ] **Step 4.5: Commit**

```bash
git add src/components/patterns/drift-pill.tsx src/__tests__/sp13/drift-pill.test.tsx
git commit -m "feat(sp13): DriftPill with popover breakdown by source"
```

---

## Task 5: `<MetricTooltip>` primitive

**Files:**
- Create: `src/components/patterns/metric-tooltip.tsx`
- Test: `src/__tests__/sp13/metric-tooltip.test.tsx`

- [ ] **Step 5.1: Write the failing test**

```tsx
// src/__tests__/sp13/metric-tooltip.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";
import { MetricTooltip } from "@/components/patterns/metric-tooltip";

const definition = {
  title: "Ingresos del mes",
  description: "Suma de facturación SAT timbrada con estado vigente del mes actual.",
  formula: "SUM(amount_total_mxn_resolved) WHERE direction='issued' AND estado_sat='vigente' AND month=CURRENT_MONTH",
  table: "canonical_invoices",
};

describe("<MetricTooltip>", () => {
  it("renders the wrapped label", () => {
    render(
      <MetricTooltip definition={definition}>Ingresos del mes</MetricTooltip>
    );
    expect(screen.getByText("Ingresos del mes")).toBeInTheDocument();
  });

  it("opens the detail panel on click and shows description + formula + table", async () => {
    render(
      <MetricTooltip definition={definition}>Ingresos del mes</MetricTooltip>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/facturación SAT timbrada/)).toBeInTheDocument();
    expect(screen.getByText(/canonical_invoices/)).toBeInTheDocument();
    expect(screen.getByText(/SUM\(amount_total_mxn_resolved\)/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <MetricTooltip definition={definition}>Ingresos del mes</MetricTooltip>
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
```

- [ ] **Step 5.2: Run test — expect FAIL**

Run: `npx vitest run src/__tests__/sp13/metric-tooltip.test.tsx`

- [ ] **Step 5.3: Create `src/components/patterns/metric-tooltip.tsx`**

```tsx
// src/components/patterns/metric-tooltip.tsx
"use client";

import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { MetricDefinition } from "@/lib/kpi";

export interface MetricTooltipProps {
  definition: MetricDefinition;
  children: React.ReactNode;
}

/**
 * Wraps a label or heading with a clickable info icon that opens a popover
 * containing the metric's definition, formula, source table, and optional
 * example. Every KPI heading should be wrapped.
 */
export function MetricTooltip({ definition, children }: MetricTooltipProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{children}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Qué significa: ${definition.title}`}
            className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Info className="size-3" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-2 p-3 text-xs" align="start">
          <div className="font-semibold">{definition.title}</div>
          <p className="text-muted-foreground">{definition.description}</p>
          <div className="pt-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Fórmula
            </div>
            <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">
              {definition.formula}
            </code>
          </div>
          <div className="pt-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Fuente
            </div>
            <code className="font-mono text-[11px]">{definition.table}</code>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}
```

- [ ] **Step 5.4: Run test — expect PASS**

- [ ] **Step 5.5: Commit**

```bash
git add src/components/patterns/metric-tooltip.tsx src/__tests__/sp13/metric-tooltip.test.tsx
git commit -m "feat(sp13): MetricTooltip — every metric self-explains"
```

---

## Task 6: `<ComparisonCell>` primitive

**Files:**
- Create: `src/components/patterns/comparison-cell.tsx`
- Test: `src/__tests__/sp13/comparison-cell.test.tsx`

- [ ] **Step 6.1: Write the failing test**

```tsx
// src/__tests__/sp13/comparison-cell.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { ComparisonCell } from "@/components/patterns/comparison-cell";

describe("<ComparisonCell>", () => {
  it("renders value and delta with up direction", () => {
    render(
      <ComparisonCell
        value={8_314_094}
        comparison={{
          label: "vs mes",
          priorValue: 7_379_304,
          delta: 934_790,
          deltaPct: 12.67,
          direction: "up",
        }}
        format="currency"
      />
    );
    expect(screen.getByText(/8\.3M|8,314/)).toBeInTheDocument();
    expect(screen.getByText(/\+12\.7%/)).toBeInTheDocument();
  });

  it("renders em-dash when comparison is null", () => {
    render(<ComparisonCell value={100} comparison={null} format="number" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ComparisonCell value={100} comparison={null} format="number" />
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
```

- [ ] **Step 6.2: Run test — expect FAIL**

- [ ] **Step 6.3: Create `src/components/patterns/comparison-cell.tsx`**

```tsx
// src/components/patterns/comparison-cell.tsx
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatValue, type FormatKind } from "@/lib/formatters";
import type { Comparison } from "@/lib/kpi";

export interface ComparisonCellProps {
  value: number;
  comparison: Comparison | null;
  format?: FormatKind;
  /** "up" means good (green) / "down" means bad (red). Default: "up". */
  goodDirection?: "up" | "down";
  compact?: boolean;
}

/**
 * Table cell that shows a value plus its delta vs a comparison period.
 * When comparison is null, shows an em-dash for the delta row.
 */
export function ComparisonCell({
  value,
  comparison,
  format = "currency",
  goodDirection = "up",
  compact = true,
}: ComparisonCellProps) {
  const valueDisplay = formatValue(value, format, { compact });
  if (!comparison) {
    return (
      <div className="flex flex-col items-end">
        <span className="tabular-nums">{valueDisplay}</span>
        <span className="text-[10px] text-muted-foreground">—</span>
      </div>
    );
  }
  const isGood =
    comparison.direction === "flat"
      ? null
      : comparison.direction === goodDirection;
  const tone =
    isGood === null
      ? "text-muted-foreground"
      : isGood
        ? "text-success"
        : "text-danger";
  const Icon =
    comparison.direction === "flat"
      ? Minus
      : comparison.direction === "up"
        ? ArrowUp
        : ArrowDown;
  const pct = comparison.deltaPct;
  const pctStr =
    pct == null
      ? "n/a"
      : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
  return (
    <div className="flex flex-col items-end">
      <span className="tabular-nums">{valueDisplay}</span>
      <span className={cn("inline-flex items-center gap-0.5 text-[10px]", tone)}>
        <Icon className="size-2.5" aria-hidden />
        {pctStr}
      </span>
    </div>
  );
}
```

- [ ] **Step 6.4: Run test — expect PASS**

- [ ] **Step 6.5: Commit**

```bash
git add src/components/patterns/comparison-cell.tsx src/__tests__/sp13/comparison-cell.test.tsx
git commit -m "feat(sp13): ComparisonCell for table cells with delta"
```

---

## Task 7: `<DriftAlert>` primitive

**Files:**
- Create: `src/components/patterns/drift-alert.tsx`
- Test: `src/__tests__/sp13/drift-alert.test.tsx`

- [ ] **Step 7.1: Write the failing test**

```tsx
// src/__tests__/sp13/drift-alert.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { DriftAlert } from "@/components/patterns/drift-alert";

describe("<DriftAlert>", () => {
  it("renders with critical severity styling", () => {
    render(
      <DriftAlert
        severity="critical"
        title="$13.4M timbrados sin booking contable en marzo"
        description="SAT y P&L divergen 45%. Revisar con contabilidad."
      />
    );
    expect(screen.getByText(/\$13\.4M timbrados/)).toBeInTheDocument();
    expect(screen.getByText(/SAT y P&L divergen/)).toBeInTheDocument();
  });

  it("supports an action link", () => {
    render(
      <DriftAlert
        severity="warning"
        title="test"
        description="test"
        action={{ label: "Ver detalles", href: "/sistema/drift" }}
      />
    );
    const link = screen.getByRole("link", { name: "Ver detalles" });
    expect(link).toHaveAttribute("href", "/sistema/drift");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <DriftAlert severity="warning" title="t" description="d" />
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
```

- [ ] **Step 7.2: Run test — expect FAIL**

- [ ] **Step 7.3: Create `src/components/patterns/drift-alert.tsx`**

```tsx
// src/components/patterns/drift-alert.tsx
import Link from "next/link";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DriftAlertProps {
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  action?: { label: string; href: string };
  className?: string;
}

const TONE = {
  info: {
    Icon: Info,
    ring: "border-info/40 bg-info/5 text-foreground",
    icon: "text-info",
  },
  warning: {
    Icon: AlertTriangle,
    ring: "border-warning/40 bg-warning/5 text-foreground",
    icon: "text-warning",
  },
  critical: {
    Icon: AlertOctagon,
    ring: "border-danger/40 bg-danger/5 text-foreground",
    icon: "text-danger",
  },
} as const;

/**
 * Page-level banner that surfaces a data divergence the user should act on.
 * Use sparingly — one or two per page max.
 */
export function DriftAlert({
  severity,
  title,
  description,
  action,
  className,
}: DriftAlertProps) {
  const t = TONE[severity];
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        t.ring,
        className
      )}
    >
      <t.Icon className={cn("size-5 shrink-0", t.icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {action && (
        <Link
          href={action.href}
          className="shrink-0 text-xs font-medium underline underline-offset-2 hover:no-underline"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 7.4: Run test — expect PASS**

- [ ] **Step 7.5: Commit**

```bash
git add src/components/patterns/drift-alert.tsx src/__tests__/sp13/drift-alert.test.tsx
git commit -m "feat(sp13): DriftAlert banner for systemic divergences"
```

---

## Task 8: `<HistorySelector>` primitive

**Files:**
- Create: `src/components/patterns/history-selector.tsx`
- Test: `src/__tests__/sp13/history-selector.test.tsx`

- [ ] **Step 8.1: Write the failing test**

```tsx
// src/__tests__/sp13/history-selector.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";
import { HistorySelector, parseHistoryRange } from "@/components/patterns/history-selector";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/ventas",
  useSearchParams: () => new URLSearchParams(),
}));

describe("parseHistoryRange", () => {
  it("defaults to 'ltm' when missing", () => {
    expect(parseHistoryRange(undefined)).toBe("ltm");
  });
  it("passes through valid values", () => {
    expect(parseHistoryRange("mtd")).toBe("mtd");
    expect(parseHistoryRange("ytd")).toBe("ytd");
    expect(parseHistoryRange("3y")).toBe("3y");
    expect(parseHistoryRange("5y")).toBe("5y");
    expect(parseHistoryRange("all")).toBe("all");
    expect(parseHistoryRange("ltm")).toBe("ltm");
  });
  it("falls back to 'ltm' on invalid input", () => {
    expect(parseHistoryRange("garbage")).toBe("ltm");
  });
});

describe("<HistorySelector>", () => {
  it("shows the current range label", () => {
    render(<HistorySelector paramName="rev" defaultRange="ltm" />);
    expect(screen.getByRole("button", { name: /últ\. 12 meses/i })).toBeInTheDocument();
  });

  it("pushes the new param on selection", async () => {
    pushMock.mockClear();
    render(<HistorySelector paramName="rev" defaultRange="ltm" />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(await screen.findByText("Año en curso"));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("rev=ytd"));
  });

  it("has no axe violations", async () => {
    const { container } = render(<HistorySelector paramName="rev" defaultRange="ltm" />);
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
```

- [ ] **Step 8.2: Run test — expect FAIL**

- [ ] **Step 8.3: Create `src/components/patterns/history-selector.tsx`**

```tsx
// src/components/patterns/history-selector.tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type HistoryRange = "mtd" | "ytd" | "ltm" | "3y" | "5y" | "all";

const RANGE_LABEL: Record<HistoryRange, string> = {
  mtd: "Mes en curso",
  ytd: "Año en curso",
  ltm: "Últ. 12 meses",
  "3y": "Últ. 3 años",
  "5y": "Últ. 5 años",
  all: "Todo el historial",
};

const RANGES: HistoryRange[] = ["mtd", "ytd", "ltm", "3y", "5y", "all"];

export function parseHistoryRange(
  raw: string | string[] | undefined,
  fallback: HistoryRange = "ltm"
): HistoryRange {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return fallback;
  return (RANGES as string[]).includes(v) ? (v as HistoryRange) : fallback;
}

export interface HistorySelectorProps {
  paramName: string;
  defaultRange?: HistoryRange;
  className?: string;
}

export function HistorySelector({
  paramName,
  defaultRange = "ltm",
  className,
}: HistorySelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = parseHistoryRange(searchParams.get(paramName) ?? undefined, defaultRange);

  function apply(next: HistoryRange) {
    const p = new URLSearchParams(searchParams.toString());
    if (next === defaultRange) p.delete(paramName);
    else p.set(paramName, next);
    const qs = p.toString();
    router.push(`${pathname}${qs ? "?" + qs : ""}`);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7 gap-1.5 text-xs font-medium", className)}
        >
          <CalendarRange className="h-3 w-3 opacity-70" aria-hidden />
          <span>{RANGE_LABEL[current]}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="end">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => apply(r)}
            className={cn(
              "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
              r === current && "bg-accent font-medium"
            )}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 8.4: Run test — expect PASS**

- [ ] **Step 8.5: Commit**

```bash
git add src/components/patterns/history-selector.tsx src/__tests__/sp13/history-selector.test.tsx
git commit -m "feat(sp13): HistorySelector with MTD/YTD/LTM/3y/5y/All + URL state"
```

---

## Task 9: `<QuestionSection>` primitive

**Files:**
- Create: `src/components/patterns/question-section.tsx`
- Test: `src/__tests__/sp13/question-section.test.tsx`

- [ ] **Step 9.1: Write the failing test**

```tsx
// src/__tests__/sp13/question-section.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { QuestionSection } from "@/components/patterns/question-section";

describe("<QuestionSection>", () => {
  it("renders the question as a heading", () => {
    render(
      <QuestionSection id="quien-compra" question="¿Quién me compra más este trimestre?">
        <div>content</div>
      </QuestionSection>
    );
    expect(
      screen.getByRole("heading", { name: /Quién me compra más/i })
    ).toBeInTheDocument();
  });

  it("renders subtext when provided", () => {
    render(
      <QuestionSection
        id="q"
        question="Q?"
        subtext="Ordenado por facturación SAT del trimestre."
      >
        <div />
      </QuestionSection>
    );
    expect(screen.getByText(/Ordenado por facturación SAT/)).toBeInTheDocument();
  });

  it("wraps children", () => {
    render(
      <QuestionSection id="q" question="Q?">
        <div data-testid="child">hello</div>
      </QuestionSection>
    );
    expect(screen.getByTestId("child")).toHaveTextContent("hello");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <QuestionSection id="q" question="Q?">
        <div />
      </QuestionSection>
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
```

- [ ] **Step 9.2: Run test — expect FAIL**

- [ ] **Step 9.3: Create `src/components/patterns/question-section.tsx`**

```tsx
// src/components/patterns/question-section.tsx
import { cn } from "@/lib/utils";

export interface QuestionSectionProps {
  /** Id used for SectionNav anchoring. */
  id: string;
  /** The question this section answers. Rendered as h2. */
  question: string;
  /** Optional one-line clarification below the question. */
  subtext?: string;
  /** Right-aligned actions (period selector, export button, etc.). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps a page section with a question as the heading. Use this instead of
 * ad-hoc Card + CardTitle when a section answers a concrete user question.
 * Every SP13+ page section should be framed as a question.
 */
export function QuestionSection({
  id,
  question,
  subtext,
  actions,
  children,
  className,
}: QuestionSectionProps) {
  return (
    <section id={id} className={cn("scroll-mt-24 space-y-3", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{question}</h2>
          {subtext && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
```

- [ ] **Step 9.4: Run test — expect PASS**

- [ ] **Step 9.5: Commit**

```bash
git add src/components/patterns/question-section.tsx src/__tests__/sp13/question-section.test.tsx
git commit -m "feat(sp13): QuestionSection — every section answers a question"
```

---

## Task 10: Extend `<KpiCard>` with sources + comparison + definition

**Files:**
- Modify: `src/components/patterns/kpi-card.tsx`
- Test: `src/__tests__/sp13/kpi-card-sp13.test.tsx`

**Backwards compatibility:** Old `KpiCardProps` still works. New props (`sources`, `comparison`, `definition`, `asOfDate`) are all optional.

- [ ] **Step 10.1: Write the failing test**

```tsx
// src/__tests__/sp13/kpi-card-sp13.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { KpiCard } from "@/components/patterns/kpi-card";
import type { KpiResult } from "@/lib/kpi";

const definition = {
  title: "Ingresos del mes",
  description: "SAT timbrado vigente del mes actual.",
  formula: "SUM(amount_total_mxn_resolved)",
  table: "canonical_invoices",
};

describe("<KpiCard> SP13 extensions", () => {
  it("renders without new props (backwards compat)", () => {
    render(<KpiCard title="Old" value={100} format="number" />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("renders SourceBadge when `source` is provided", () => {
    render(
      <KpiCard
        title="Ingresos"
        value={8_314_094}
        format="currency"
        source="sat"
        definition={definition}
      />
    );
    expect(screen.getByText("SAT")).toBeInTheDocument();
  });

  it("renders MetricTooltip icon when `definition` is provided", () => {
    render(
      <KpiCard
        title="Ingresos"
        value={8_314_094}
        format="currency"
        definition={definition}
      />
    );
    // The info button from MetricTooltip
    expect(
      screen.getByRole("button", { name: /Qué significa: Ingresos del mes/i })
    ).toBeInTheDocument();
  });

  it("renders comparison delta when `comparison` is provided", () => {
    render(
      <KpiCard
        title="Ingresos"
        value={110}
        format="number"
        comparison={{
          label: "vs mes",
          priorValue: 100,
          delta: 10,
          deltaPct: 10,
          direction: "up",
        }}
      />
    );
    expect(screen.getByText(/\+10\.0%/)).toBeInTheDocument();
  });

  it("renders DriftPill when multiple `sources` are provided", () => {
    const sources: NonNullable<KpiResult["sources"]> = [
      { source: "sat", value: 8_314_094, diffFromPrimary: 0, diffPct: 0 },
      { source: "pl", value: 7_379_304, diffFromPrimary: -934_790, diffPct: -11.2 },
    ];
    render(
      <KpiCard
        title="Ingresos"
        value={8_314_094}
        format="currency"
        source="sat"
        sources={sources}
        definition={definition}
      />
    );
    expect(screen.getByText(/diff 11\.2%/)).toBeInTheDocument();
  });

  it("has no axe violations with all SP13 props", async () => {
    const { container } = render(
      <KpiCard
        title="Ingresos"
        value={100}
        format="number"
        source="sat"
        definition={definition}
        comparison={{
          label: "vs mes",
          priorValue: 90,
          delta: 10,
          deltaPct: 11.1,
          direction: "up",
        }}
      />
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
```

- [ ] **Step 10.2: Run test — expect FAIL**

Run: `npx vitest run src/__tests__/sp13/kpi-card-sp13.test.tsx`
Expected: FAIL — new props aren't accepted yet.

- [ ] **Step 10.3: Extend `src/components/patterns/kpi-card.tsx`**

Edit the file. Add imports at the top:

```tsx
import type { SourceKind, MetricDefinition, Comparison, KpiResult } from "@/lib/kpi";
import { SourceBadge } from "./source-badge";
import { MetricTooltip } from "./metric-tooltip";
import { DriftPill } from "./drift-pill";
import { ComparisonCell } from "./comparison-cell";
```

Extend `KpiCardProps` — add after the existing `sparkline` prop:

```tsx
  /** SP13 — canonical data source for this KPI. */
  source?: SourceKind;
  /** SP13 — metric definition shown in MetricTooltip next to the title. */
  definition?: MetricDefinition;
  /** SP13 — comparison vs prior period. Replaces `trend` when both present. */
  comparison?: Comparison | null;
  /** SP13 — multi-source breakdown rendered as DriftPill. */
  sources?: KpiResult["sources"];
  /** SP13 — ISO date the value was computed. */
  asOfDate?: string;
```

Replace the title rendering block (currently `<p className="...">{title}</p>`) with:

```tsx
<p
  className={cn(
    "min-w-0 flex-1 truncate font-medium uppercase tracking-wider text-muted-foreground",
    sz.title
  )}
>
  {definition ? (
    <MetricTooltip definition={definition}>{title}</MetricTooltip>
  ) : (
    title
  )}
</p>
```

Replace the icon block with a header-right stack that includes SourceBadge + DriftPill + Icon:

```tsx
<div className="flex shrink-0 items-center gap-1.5">
  {source && <SourceBadge source={source} />}
  {sources && sources.length >= 2 && source && (
    <DriftPill sources={sources} primary={source} />
  )}
  {Icon && (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full transition-colors",
        sz.iconBox,
        styles.iconBg
      )}
      aria-hidden
    >
      <Icon className={sz.icon} />
    </div>
  )}
</div>
```

Replace the `trend` block inside the value row. If `comparison` is provided, render a ComparisonCell-style delta next to the big number (reuse TrendIndicator shape for compact display):

```tsx
{comparison ? (
  <span className={cn(
    "inline-flex items-center gap-0.5 text-xs tabular-nums",
    comparison.direction === "up" ? "text-success"
    : comparison.direction === "down" ? "text-danger"
    : "text-muted-foreground"
  )}>
    {comparison.deltaPct == null
      ? "n/a"
      : `${comparison.deltaPct > 0 ? "+" : ""}${comparison.deltaPct.toFixed(1)}%`}
    <span className="text-muted-foreground text-[10px]">
      {" "}{comparison.label}
    </span>
  </span>
) : trend ? (
  <TrendIndicator value={trend.value} good={trend.good ?? "up"} />
) : null}
```

Preserve the existing `subtitle` / clickable chevron rendering unchanged.

- [ ] **Step 10.4: Run tests — expect PASS**

Run: `npx vitest run src/__tests__/sp13/kpi-card-sp13.test.tsx`
Run: `npx vitest run src/components/patterns` (make sure old KpiCard callers still pass)

Expected: all PASS. If any consumer test fails, the change is not backwards compatible — investigate before proceeding.

- [ ] **Step 10.5: Commit**

```bash
git add src/components/patterns/kpi-card.tsx src/__tests__/sp13/kpi-card-sp13.test.tsx
git commit -m "feat(sp13): extend KpiCard with source/comparison/definition/sources (backwards compat)"
```

---

## Task 11: Barrel exports

**Files:**
- Modify: `src/components/patterns/index.ts`

- [ ] **Step 11.1: Add exports**

At the bottom of `src/components/patterns/index.ts`, append:

```ts
// SP13 primitives
export { SourceBadge, type SourceBadgeProps } from "./source-badge";
export { DriftPill, type DriftPillProps } from "./drift-pill";
export { MetricTooltip, type MetricTooltipProps } from "./metric-tooltip";
export { ComparisonCell, type ComparisonCellProps } from "./comparison-cell";
export { DriftAlert, type DriftAlertProps } from "./drift-alert";
export {
  HistorySelector,
  parseHistoryRange,
  type HistoryRange,
  type HistorySelectorProps,
} from "./history-selector";
export { QuestionSection, type QuestionSectionProps } from "./question-section";
```

- [ ] **Step 11.2: Run full test suite — expect PASS**

Run: `npm run test`
Expected: All tests pass, including existing ones.

- [ ] **Step 11.3: Run type check — expect PASS**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11.4: Commit**

```bash
git add src/components/patterns/index.ts
git commit -m "chore(sp13): export new primitives from patterns barrel"
```

---

## Task 12: Showcase page `/showcase/sp13`

**Files:**
- Create: `src/app/showcase/sp13/page.tsx`

- [ ] **Step 12.1: Create the showcase page**

```tsx
// src/app/showcase/sp13/page.tsx
import { TrendingUp } from "lucide-react";
import {
  PageLayout,
  PageHeader,
  StatGrid,
  KpiCard,
  SourceBadge,
  DriftPill,
  DriftAlert,
  MetricTooltip,
  ComparisonCell,
  HistorySelector,
  QuestionSection,
} from "@/components/patterns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KpiResult } from "@/lib/kpi";

export const metadata = { title: "SP13 primitives" };

const definicionIngresos = {
  title: "Ingresos del mes",
  description:
    "Suma de facturación SAT timbrada con estado vigente del mes actual.",
  formula:
    "SUM(amount_total_mxn_resolved) WHERE direction='issued' AND estado_sat='vigente' AND invoice_date IN CURRENT_MONTH",
  table: "canonical_invoices",
};

const sourcesDual: NonNullable<KpiResult["sources"]> = [
  { source: "sat", value: 8_314_094, diffFromPrimary: 0, diffPct: 0 },
  {
    source: "pl",
    value: 7_379_304,
    diffFromPrimary: -934_790,
    diffPct: -11.2,
  },
];

const comparisonMoM = {
  label: "vs marzo",
  priorValue: 29_492_624,
  delta: -21_178_530,
  deltaPct: -71.8,
  direction: "down" as const,
};

export default function Sp13ShowcasePage() {
  return (
    <PageLayout>
      <PageHeader
        title="SP13 primitives"
        subtitle="Catálogo visual de los building blocks SP13 (data-first)."
        actions={<HistorySelector paramName="sp13_range" defaultRange="ltm" />}
      />

      <QuestionSection
        id="drift-alert"
        question="¿Cómo se ve un DriftAlert crítico?"
        subtext="Úsalo cuando una divergencia sistémica entre SAT y P&L requiere acción."
      >
        <DriftAlert
          severity="critical"
          title="$13.4M timbrados sin booking contable en marzo 2026"
          description="SAT y P&L divergen 45.5%. Revisar con contabilidad antes de cerrar el mes."
          action={{ label: "Ver detalle", href: "/sistema/drift" }}
        />
        <DriftAlert
          severity="warning"
          title="DSO subió 6 días respecto al promedio LTM"
          description="Cartera vencida 30+ creció 18% este trimestre."
        />
        <DriftAlert
          severity="info"
          title="Ticket promedio en línea con LTM"
          description="Sin desviaciones relevantes."
        />
      </QuestionSection>

      <QuestionSection
        id="kpis"
        question="¿Cómo se ve un KpiCard con todas las piezas SP13?"
        subtext="Source badge + MetricTooltip + DriftPill + Comparison."
      >
        <StatGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }}>
          <KpiCard
            title="Ingresos del mes"
            value={8_314_094}
            format="currency"
            compact
            icon={TrendingUp}
            source="sat"
            definition={definicionIngresos}
            comparison={comparisonMoM}
            sources={sourcesDual}
            asOfDate="2026-04-23"
          />
          <KpiCard
            title="Solo con source (sin definition)"
            value={285_147_145}
            format="currency"
            compact
            source="canonical"
            comparison={{
              label: "vs mes",
              priorValue: 275_000_000,
              delta: 10_147_145,
              deltaPct: 3.7,
              direction: "up",
            }}
          />
          <KpiCard
            title="Legacy (old API, no SP13 props)"
            value={67_167_696}
            format="currency"
            compact
            icon={TrendingUp}
            tone="warning"
            subtitle="Cartera vencida"
            trend={{ value: 18, good: "down" }}
          />
        </StatGrid>
      </QuestionSection>

      <QuestionSection
        id="badges"
        question="¿Cómo se ven los SourceBadges por tipo?"
      >
        <div className="flex flex-wrap gap-2">
          <SourceBadge source="sat" />
          <SourceBadge source="pl" />
          <SourceBadge source="odoo" />
          <SourceBadge source="canonical" />
        </div>
      </QuestionSection>

      <QuestionSection
        id="drift-pill"
        question="¿Cómo se ve DriftPill suelto?"
        subtext="Click abre popover con el breakdown."
      >
        <DriftPill sources={sourcesDual} primary="sat" />
      </QuestionSection>

      <QuestionSection
        id="metric-tooltip"
        question="¿Cómo se ve MetricTooltip suelto?"
      >
        <MetricTooltip definition={definicionIngresos}>
          <span className="text-sm font-medium">Ingresos del mes</span>
        </MetricTooltip>
      </QuestionSection>

      <QuestionSection
        id="comparison-cell"
        question="¿Cómo se ve ComparisonCell en una tabla?"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tabla de ejemplo</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Ingresos</TableHead>
                  <TableHead className="text-right">Utilidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Abril 2026 MTD</TableCell>
                  <TableCell className="text-right">
                    <ComparisonCell
                      value={8_314_094}
                      comparison={comparisonMoM}
                      format="currency"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <ComparisonCell value={2_615_206} comparison={null} format="currency" />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </QuestionSection>
    </PageLayout>
  );
}
```

- [ ] **Step 12.2: Verify the page builds and renders**

Run: `npm run build`
Expected: build succeeds, no errors.

Run `npm run dev` then open `http://localhost:3000/showcase/sp13` manually. Verify:
- Every section heading is a question.
- DriftAlerts show with correct severity colors.
- KpiCard (first) shows SAT badge, info icon, DriftPill "diff 11.2%", -71.8% comparison.
- KpiCard (legacy) renders exactly like before (no new decorations).
- Click the DriftPill → popover shows SAT 8.3M, P&L 7.4M, -11.2%.
- Click the MetricTooltip info icon → popover shows title/description/formula/table.
- Click HistorySelector → dropdown with 6 ranges.

- [ ] **Step 12.3: Commit**

```bash
git add src/app/showcase/sp13/page.tsx
git commit -m "feat(sp13): showcase page /showcase/sp13 with all primitives"
```

---

## Task 13: Final verification

- [ ] **Step 13.1: Run the full test suite**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 13.2: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 13.3: Run production build**

Run: `npm run build`
Expected: build succeeds. If the `server-only` barrier causes failures (per feedback_sp6_dod_build memory), investigate which primitive pulls `server-only` transitively. None of the SP13 primitives should — they are all client or pure.

- [ ] **Step 13.4: Smoke test the showcase page**

Run: `npm run dev` and open `/showcase/sp13`. Click through every interactive primitive. No runtime errors in console.

- [ ] **Step 13.5: Final commit (if any fixes needed)**

If any of Steps 13.1–13.4 required fixes:

```bash
git add <changed files>
git commit -m "fix(sp13): <what was broken>"
```

Otherwise, nothing to commit.

---

## Self-review notes (post-plan write)

- **Spec coverage:** P1 QuestionSection ✓, P2 SourceBadge+DriftPill ✓, P3 comparison in KpiCard ✓, P4 MetricTooltip ✓, P5 (tables) deferred to SP13.1+ (primitive itself is not here), P6 HistorySelector ✓, P7 DriftAlert ✓, P8 (no bronze) not applicable at primitives layer. All applicable principles covered.
- **KpiResult contract:** types in Task 1, helpers in Task 2, consumed by KpiCard in Task 10 and Showcase in Task 12.
- **Tests:** every primitive has render + a11y + relevant interaction. Type tests via `expectTypeOf`.
- **Backwards compat:** KpiCard old prop signature preserved. Existing consumers pass their current tests in Step 10.4.
- **No placeholders:** every code block is complete. No "TODO" or "implement later".
- **Commits:** one per task, 13 total.

---

## Out of scope (do NOT add in SP13.0)

- Data helpers that return `KpiResult` for real pages — those live in SP13.1+ per-page plans.
- Replacing existing `DataSourceBadge` — that's a page-level lineage badge, different concept.
- Touching `PeriodSelector` — `HistorySelector` is additive; old pages keep using PeriodSelector until migrated.
- Meta/target comparison — deferred per foundation spec decision #3.
- CEO question catalog — each per-page spec proposes its own.
