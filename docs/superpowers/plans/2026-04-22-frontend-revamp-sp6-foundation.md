# SP6 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the design-system foundation for SP6 — consolidate chart/badge primitives, add 5 new reusable components, fix transversal contracts (tokens, URL state, a11y) — on branch `frontend-revamp-sp6-ui` so the 7 per-page sub-specs can compose without re-deciding.

**Architecture:** In-place surgical consolidation of `src/components/patterns/*`. Additive CSS tokens (`--status-*`, `--aging-*`) preserving existing `--chart-1..5`. Deprecated re-export shims keep the 9 out-of-scope pages compiling without changes. TDD per component with Vitest (`environment: jsdom`, `@testing-library/react`). Playwright e2e single spec runs against `/showcase` demo page.

**Tech Stack:** Next.js 15 · React 19 · TypeScript · Tailwind 4 (via `@tailwindcss/postcss`) · shadcn/ui · recharts 3.8 · zod 4 · Vitest 4 · `@testing-library/react` 16 · Playwright (to be added) · axe-core (to be added).

**Reference spec:** `docs/superpowers/specs/2026-04-22-frontend-revamp-sp6-foundation-design.md` (commit 84ce508 on `frontend-revamp-sp6-ui`).

---

## Task 0: Pre-flight — verify branch, rebase on main, clean tree

**Files:**
- No files modified. Git housekeeping only.

- [ ] **Step 1: Confirm clean working tree and target branch**

Run:
```bash
git status --short
git branch --show-current
```

Expected: empty output from `git status --short` (or only untracked files outside scope). Expected branch: whatever you're currently on.

If dirty: stash (`git stash push -u -m "pre-sp6-foundation"`) and remember to pop at the end of the foundation PR.

- [ ] **Step 2: Check out foundation branch and rebase on latest main**

Run:
```bash
git fetch origin
git checkout frontend-revamp-sp6-ui
git rebase origin/main
```

Expected: clean rebase, no conflicts (foundation branch has only the spec commit 84ce508 on top of older main). If conflict occurs: abort (`git rebase --abort`) and resolve by hand — the only commit is `docs/superpowers/specs/2026-04-22-frontend-revamp-sp6-foundation-design.md`, a new file that can't conflict. If anything else is there, stop and escalate.

- [ ] **Step 3: Verify spec is present and commit 84ce508 exists**

Run:
```bash
git log --oneline -3
test -f docs/superpowers/specs/2026-04-22-frontend-revamp-sp6-foundation-design.md && echo "spec present"
```

Expected: commit `84ce508 docs(sp6): foundation design spec — mobile-first shadcn revamp` visible; "spec present" echoed.

- [ ] **Step 4: Run baseline build + test to confirm green starting point**

Run:
```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run build 2>&1 | tail -20
npm run test 2>&1 | tail -10
```

Expected: build compiles (the pre-existing `/equipo` prerender failure on missing `SUPABASE_SERVICE_KEY` in local env is documented and expected — not a blocker). Vitest: all tests pass.

---

## Task 1: Add traffic-light tokens to globals.css (light + dark)

**Files:**
- Modify: `src/app/globals.css` (add `--status-*` + `--aging-*` to `:root` block ~line 10-47 and `.dark` block ~line 63-99; add their `--color-*` mappings to `@theme inline` ~line 150-165)

- [ ] **Step 1: Add `--status-*` + `--aging-*` tokens to `:root` (light)**

Find the `:root` block in `src/app/globals.css` (around line 10). Insert the following **before** the line that declares `--chart-1`:

```css
  /* SP6 foundation — traffic-light status tokens */
  --status-ok:       oklch(0.72 0.14 155);
  --status-warning:  oklch(0.78 0.12 75);
  --status-critical: oklch(0.62 0.20 25);
  --status-info:     oklch(0.66 0.12 235);
  --status-muted:    oklch(0.60 0.02 235);

  --aging-current:  var(--status-ok);
  --aging-1-30:     oklch(0.75 0.14 120);
  --aging-31-60:    var(--status-warning);
  --aging-61-90:    oklch(0.70 0.18 50);
  --aging-90-plus:  var(--status-critical);
```

- [ ] **Step 2: Add dark-mode variants to `.dark` block**

Find the `.dark` block (around line 63). Insert the following **before** its `--chart-1` declaration:

```css
  /* SP6 foundation — traffic-light status tokens (dark) */
  --status-ok:       oklch(0.80 0.14 155);
  --status-warning:  oklch(0.85 0.12 75);
  --status-critical: oklch(0.70 0.20 25);
  --status-info:     oklch(0.74 0.12 235);
  --status-muted:    oklch(0.70 0.02 235);

  --aging-current:  var(--status-ok);
  --aging-1-30:     oklch(0.82 0.14 120);
  --aging-31-60:    var(--status-warning);
  --aging-61-90:    oklch(0.78 0.18 50);
  --aging-90-plus:  var(--status-critical);
```

- [ ] **Step 3: Map tokens into Tailwind `@theme inline` block**

Find the `@theme inline { ... }` block (around line 130-170). Add the following lines just before its closing `}`:

```css
  --color-status-ok:       var(--status-ok);
  --color-status-warning:  var(--status-warning);
  --color-status-critical: var(--status-critical);
  --color-status-info:     var(--status-info);
  --color-status-muted:    var(--status-muted);

  --color-aging-current:  var(--aging-current);
  --color-aging-1-30:     var(--aging-1-30);
  --color-aging-31-60:    var(--aging-31-60);
  --color-aging-61-90:    var(--aging-61-90);
  --color-aging-90-plus:  var(--aging-90-plus);
```

This lets Tailwind generate utilities like `text-status-ok`, `bg-aging-90-plus`, etc.

- [ ] **Step 4: Verify build compiles with new tokens**

Run:
```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run build 2>&1 | tail -10
```

Expected: Compile succeeds. (Pre-existing `/equipo` prerender failure still expected.)

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(sp6): add --status-* + --aging-* tokens (light + dark)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 2: Create `chart-theme.ts` with `CHART_PALETTE`

**Files:**
- Create: `src/lib/chart-theme.ts`
- Create: `src/__tests__/lib/chart-theme.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/lib/chart-theme.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { CHART_PALETTE } from "@/lib/chart-theme";

describe("CHART_PALETTE", () => {
  it("exposes semantic traffic-light keys as CSS var references", () => {
    expect(CHART_PALETTE.positive).toBe("var(--status-ok)");
    expect(CHART_PALETTE.warning).toBe("var(--status-warning)");
    expect(CHART_PALETTE.negative).toBe("var(--status-critical)");
    expect(CHART_PALETTE.neutral).toBe("var(--status-info)");
    expect(CHART_PALETTE.muted).toBe("var(--status-muted)");
  });

  it("exposes 5-stop aging gradient", () => {
    expect(CHART_PALETTE.aging.current).toBe("var(--aging-current)");
    expect(CHART_PALETTE.aging.d1_30).toBe("var(--aging-1-30)");
    expect(CHART_PALETTE.aging.d31_60).toBe("var(--aging-31-60)");
    expect(CHART_PALETTE.aging.d61_90).toBe("var(--aging-61-90)");
    expect(CHART_PALETTE.aging.d90_plus).toBe("var(--aging-90-plus)");
  });

  it("exposes 5 multi-series tokens preserving --chart-1..5", () => {
    expect(CHART_PALETTE.series).toHaveLength(5);
    expect(CHART_PALETTE.series[0]).toBe("var(--chart-1)");
    expect(CHART_PALETTE.series[4]).toBe("var(--chart-5)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- chart-theme`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chart-theme.ts`**

Create `src/lib/chart-theme.ts`:

```typescript
/**
 * SP6 foundation — semantic chart palette.
 * Values are CSS var references so dark mode switches automatically.
 * For non-semantic multi-series charts (top 5 customers, etc.), use `series`.
 */
export const CHART_PALETTE = {
  positive: "var(--status-ok)",
  warning:  "var(--status-warning)",
  negative: "var(--status-critical)",
  neutral:  "var(--status-info)",
  muted:    "var(--status-muted)",

  aging: {
    current:  "var(--aging-current)",
    d1_30:    "var(--aging-1-30)",
    d31_60:   "var(--aging-31-60)",
    d61_90:   "var(--aging-61-90)",
    d90_plus: "var(--aging-90-plus)",
  },

  series: [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ],
} as const;

export type ChartPaletteKey =
  | "positive" | "warning" | "negative" | "neutral" | "muted";

export function resolveSeriesColor(
  index: number,
  semantic?: ChartPaletteKey
): string {
  if (semantic) return CHART_PALETTE[semantic];
  return CHART_PALETTE.series[index % CHART_PALETTE.series.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- chart-theme`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chart-theme.ts src/__tests__/lib/chart-theme.test.ts
git commit -m "feat(sp6): CHART_PALETTE semantic theme with aging gradient

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 3: StatusBadge mapping module

**Files:**
- Create: `src/components/patterns/status-badge-mapping.ts`
- Create: `src/__tests__/patterns/status-badge-mapping.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/patterns/status-badge-mapping.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  resolveStatusBadge,
  type StatusBadgeInput,
} from "@/components/patterns/status-badge-mapping";

describe("resolveStatusBadge", () => {
  it.each<[StatusBadgeInput, string, string]>([
    [{ kind: "severity", value: "critical" }, "critical", "Severidad crítica"],
    [{ kind: "severity", value: "high" },     "warning",  "Severidad alta"],
    [{ kind: "severity", value: "medium" },   "warning",  "Severidad media"],
    [{ kind: "severity", value: "low" },      "muted",    "Severidad baja"],
    [{ kind: "blacklist", value: "69b_definitivo" }, "critical", "Lista negra 69B definitivo"],
    [{ kind: "blacklist", value: "69b_presunto" },   "warning",  "Lista negra 69B presunto"],
    [{ kind: "shadow", value: true },     "warning", "Empresa sombra — no confirmada en Odoo"],
    [{ kind: "payment", value: "paid" },        "ok",       "Pagada"],
    [{ kind: "payment", value: "partial" },     "warning",  "Pago parcial"],
    [{ kind: "payment", value: "not_paid" },    "critical", "Sin pagar"],
    [{ kind: "payment", value: "in_payment" },  "info",     "En proceso de pago"],
    [{ kind: "estado_sat", value: "vigente" },   "ok",       "CFDI vigente"],
    [{ kind: "estado_sat", value: "cancelado" }, "critical", "CFDI cancelado"],
    [{ kind: "staleness", value: "fresh" }, "ok",       "Datos recientes"],
    [{ kind: "staleness", value: "stale" }, "critical", "Datos desactualizados"],
    [{ kind: "reconciliation", value: "unmatched" }, "info", "Sin reconciliar"],
  ])("maps %o → color=%s label=%s", (input, color, label) => {
    const out = resolveStatusBadge(input);
    expect(out.color).toBe(color);
    expect(out.label).toBe(label);
    expect(out.ariaLabel).toBe(label);
  });

  it("maps match confidence bands", () => {
    expect(resolveStatusBadge({ kind: "match", value: 0.95 }).color).toBe("ok");
    expect(resolveStatusBadge({ kind: "match", value: 0.75 }).color).toBe("warning");
    expect(resolveStatusBadge({ kind: "match", value: 0.3  }).color).toBe("critical");
  });

  it("blacklist=none returns null (no render)", () => {
    expect(resolveStatusBadge({ kind: "blacklist", value: "none" })).toBeNull();
  });

  it("generic kind uses value as-is", () => {
    const out = resolveStatusBadge({ kind: "generic", value: "custom_label" });
    expect(out?.label).toBe("custom_label");
    expect(out?.color).toBe("muted");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- status-badge-mapping`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapping module**

Create `src/components/patterns/status-badge-mapping.ts`:

```typescript
export type StatusColor = "ok" | "warning" | "critical" | "info" | "muted";

export type StatusBadgeInput =
  | { kind: "severity"; value: "critical" | "high" | "medium" | "low" }
  | { kind: "blacklist"; value: "69b_definitivo" | "69b_presunto" | "none" }
  | { kind: "shadow"; value: boolean }
  | { kind: "payment"; value: "paid" | "partial" | "not_paid" | "in_payment" }
  | { kind: "estado_sat"; value: "vigente" | "cancelado" }
  | { kind: "match"; value: number }
  | { kind: "staleness"; value: "fresh" | "stale" }
  | { kind: "reconciliation"; value: "matched" | "unmatched" }
  | { kind: "generic"; value: string };

export type StatusBadgeResolved = {
  color: StatusColor;
  label: string;
  ariaLabel: string;
  icon?:
    | "alert-circle" | "ban" | "ghost" | "check-circle-2" | "x-circle"
    | "clock" | "file-check" | "file-x" | "link" | "unlink";
};

export function resolveStatusBadge(
  input: StatusBadgeInput
): StatusBadgeResolved | null {
  switch (input.kind) {
    case "severity":
      return {
        color: ({ critical: "critical", high: "warning", medium: "warning", low: "muted" } as const)[input.value],
        label: ({ critical: "Severidad crítica", high: "Severidad alta", medium: "Severidad media", low: "Severidad baja" } as const)[input.value],
        ariaLabel: ({ critical: "Severidad crítica", high: "Severidad alta", medium: "Severidad media", low: "Severidad baja" } as const)[input.value],
        icon: "alert-circle",
      };

    case "blacklist":
      if (input.value === "none") return null;
      return {
        color: input.value === "69b_definitivo" ? "critical" : "warning",
        label: input.value === "69b_definitivo" ? "Lista negra 69B definitivo" : "Lista negra 69B presunto",
        ariaLabel: input.value === "69b_definitivo" ? "Lista negra 69B definitivo" : "Lista negra 69B presunto",
        icon: "ban",
      };

    case "shadow":
      if (!input.value) return null;
      return {
        color: "warning",
        label: "Empresa sombra — no confirmada en Odoo",
        ariaLabel: "Empresa sombra — no confirmada en Odoo",
        icon: "ghost",
      };

    case "payment": {
      const map = {
        paid:        { color: "ok" as const,       label: "Pagada",             icon: "check-circle-2" as const },
        partial:     { color: "warning" as const,  label: "Pago parcial",       icon: "clock" as const },
        not_paid:    { color: "critical" as const, label: "Sin pagar",          icon: "x-circle" as const },
        in_payment:  { color: "info" as const,     label: "En proceso de pago", icon: "clock" as const },
      };
      const e = map[input.value];
      return { ...e, ariaLabel: e.label };
    }

    case "estado_sat": {
      const map = {
        vigente:   { color: "ok" as const,       label: "CFDI vigente",   icon: "file-check" as const },
        cancelado: { color: "critical" as const, label: "CFDI cancelado", icon: "file-x" as const },
      };
      const e = map[input.value];
      return { ...e, ariaLabel: e.label };
    }

    case "match": {
      const color: StatusColor = input.value >= 0.9 ? "ok" : input.value >= 0.6 ? "warning" : "critical";
      const label =
        input.value >= 0.9 ? "Match de alta confianza" :
        input.value >= 0.6 ? "Match de confianza media" :
        "Match de baja confianza";
      return { color, label, ariaLabel: label, icon: color === "ok" ? "link" : "unlink" };
    }

    case "staleness":
      return input.value === "fresh"
        ? { color: "ok", label: "Datos recientes", ariaLabel: "Datos recientes", icon: "clock" }
        : { color: "critical", label: "Datos desactualizados", ariaLabel: "Datos desactualizados", icon: "clock" };

    case "reconciliation":
      return input.value === "matched"
        ? { color: "ok", label: "Reconciliado", ariaLabel: "Reconciliado", icon: "link" }
        : { color: "info", label: "Sin reconciliar", ariaLabel: "Sin reconciliar", icon: "unlink" };

    case "generic":
      return { color: "muted", label: input.value, ariaLabel: input.value };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- status-badge-mapping`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/patterns/status-badge-mapping.ts src/__tests__/patterns/status-badge-mapping.test.ts
git commit -m "feat(sp6): StatusBadge mapping module (kind+value → color+label+aria)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 4: New `StatusBadge` component with density + variant + legacy back-compat

**Files:**
- Modify (overwrite): `src/components/patterns/status-badge.tsx`
- Create: `src/__tests__/patterns/status-badge.test.tsx`
- Modify: `src/components/patterns/index.ts` (re-export `type StatusBadgeProps`)

The legacy `StatusBadge(status=...)` API must keep working for the 9 out-of-scope pages. We use a discriminated union + runtime detection so both shapes are accepted.

- [ ] **Step 1: Write failing test**

Create `src/__tests__/patterns/status-badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/patterns/status-badge";

describe("StatusBadge (new API: kind + value)", () => {
  it("renders dot variant by default (density=compact)", () => {
    render(<StatusBadge kind="severity" value="critical" />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-label", "Severidad crítica");
    expect(el.querySelector('[data-testid="status-dot"]')).toBeTruthy();
    expect(el.textContent).toContain("Severidad crítica");
  });

  it("renders pill variant when density=regular", () => {
    render(<StatusBadge kind="payment" value="paid" density="regular" />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("data-variant", "pill");
    expect(el).toHaveAttribute("data-color", "ok");
  });

  it("returns null for blacklist=none", () => {
    const { container } = render(<StatusBadge kind="blacklist" value="none" />);
    expect(container.firstChild).toBeNull();
  });

  it("supports variant override", () => {
    render(<StatusBadge kind="payment" value="paid" variant="outline" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-variant", "outline");
  });

  it("accepts custom ariaLabel override", () => {
    render(<StatusBadge kind="payment" value="paid" ariaLabel="Custom label" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Custom label");
  });
});

describe("StatusBadge (legacy API: status=)", () => {
  it("accepts legacy status= prop and renders as generic pill", () => {
    render(<StatusBadge status="paid" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toContain("Pagada");
    expect(el).toHaveAttribute("data-color", "ok");
  });

  it("falls through unknown status values as-is", () => {
    render(<StatusBadge status="unknown_xyz" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toContain("unknown_xyz");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- status-badge.test`
Expected: FAIL — existing component doesn't export the new API shape.

- [ ] **Step 3: Rewrite `status-badge.tsx`**

Overwrite `src/components/patterns/status-badge.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  resolveStatusBadge,
  type StatusBadgeInput,
  type StatusColor,
} from "./status-badge-mapping";

export type StatusBadgeDensity = "compact" | "regular";
export type StatusBadgeVariant = "dot" | "pill" | "outline" | "leftbar";

/** Legacy API preserved for back-compat (9 out-of-scope pages). */
export type LegacyStatus =
  | "paid" | "overdue" | "partial" | "active" | "draft"
  | "cancelled" | "pending" | "delivered" | "in_progress";

/** @deprecated — kept for back-compat with the old `<StatusBadge status="..."/>` API. */
export type Status = LegacyStatus | string;

const LEGACY_MAP: Record<LegacyStatus, StatusBadgeInput> = {
  paid:        { kind: "payment", value: "paid" },
  overdue:     { kind: "payment", value: "not_paid" },
  partial:     { kind: "payment", value: "partial" },
  active:      { kind: "generic", value: "Activa" },
  draft:       { kind: "generic", value: "Borrador" },
  cancelled:   { kind: "estado_sat", value: "cancelado" },
  pending:     { kind: "generic", value: "Pendiente" },
  delivered:   { kind: "generic", value: "Entregada" },
  in_progress: { kind: "generic", value: "En curso" },
};

type NewProps = StatusBadgeInput & {
  density?: StatusBadgeDensity;
  variant?: StatusBadgeVariant;
  ariaLabel?: string;
  className?: string;
};

type LegacyProps = {
  status: Status;
  className?: string;
};

export type StatusBadgeProps = NewProps | LegacyProps;

function isLegacyProps(p: StatusBadgeProps): p is LegacyProps {
  return "status" in p && !("kind" in p);
}

const COLOR_TO_CLASS: Record<StatusColor, { text: string; bg: string; border: string; dot: string }> = {
  ok:       { text: "text-status-ok",       bg: "bg-status-ok/15",       border: "border-status-ok/40",       dot: "bg-status-ok" },
  warning:  { text: "text-status-warning",  bg: "bg-status-warning/15",  border: "border-status-warning/40",  dot: "bg-status-warning" },
  critical: { text: "text-status-critical", bg: "bg-status-critical/15", border: "border-status-critical/40", dot: "bg-status-critical" },
  info:     { text: "text-status-info",     bg: "bg-status-info/15",     border: "border-status-info/40",     dot: "bg-status-info" },
  muted:    { text: "text-status-muted",    bg: "bg-status-muted/15",    border: "border-status-muted/40",    dot: "bg-status-muted" },
};

export function StatusBadge(props: StatusBadgeProps): React.ReactElement | null {
  let input: StatusBadgeInput;
  let density: StatusBadgeDensity;
  let variantOverride: StatusBadgeVariant | undefined;
  let ariaOverride: string | undefined;
  let className: string | undefined;

  if (isLegacyProps(props)) {
    input = LEGACY_MAP[props.status as LegacyStatus] ?? { kind: "generic", value: String(props.status) };
    density = "regular";
    className = props.className;
  } else {
    input = { kind: props.kind, value: props.value } as StatusBadgeInput;
    density = props.density ?? "compact";
    variantOverride = props.variant;
    ariaOverride = props.ariaLabel;
    className = props.className;
  }

  const resolved = resolveStatusBadge(input);
  if (!resolved) return null;

  const variant: StatusBadgeVariant = variantOverride ?? (density === "compact" ? "dot" : "pill");
  const color = resolved.color;
  const classes = COLOR_TO_CLASS[color];
  const ariaLabel = ariaOverride ?? resolved.ariaLabel;

  const base = "inline-flex items-center gap-1.5 text-xs font-medium align-middle";

  if (variant === "dot") {
    return (
      <span
        role="status"
        aria-label={ariaLabel}
        data-variant="dot"
        data-color={color}
        className={cn(base, classes.text, className)}
      >
        <span data-testid="status-dot" aria-hidden="true" className={cn("inline-block h-1.5 w-1.5 rounded-full", classes.dot)} />
        {resolved.label}
      </span>
    );
  }

  if (variant === "pill") {
    return (
      <span
        role="status"
        aria-label={ariaLabel}
        data-variant="pill"
        data-color={color}
        className={cn(base, "rounded-full px-2 py-0.5", classes.bg, classes.text, className)}
      >
        {resolved.label}
      </span>
    );
  }

  if (variant === "outline") {
    return (
      <span
        role="status"
        aria-label={ariaLabel}
        data-variant="outline"
        data-color={color}
        className={cn(base, "rounded-md border px-2 py-0.5", classes.border, className)}
      >
        <span aria-hidden="true" className={cn("inline-block h-1.5 w-1.5 rounded-full", classes.dot)} />
        <span>{resolved.label}</span>
      </span>
    );
  }

  // leftbar
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      data-variant="leftbar"
      data-color={color}
      className={cn("inline-flex items-center pl-2 border-l-2 text-xs", classes.border, className)}
    >
      {resolved.label}
    </span>
  );
}
```

- [ ] **Step 4: Ensure `index.ts` re-exports match**

Open `src/components/patterns/index.ts` and confirm this line exists (no change needed if it does):

```typescript
export { StatusBadge, type Status } from "./status-badge";
```

If `type Status` is exported elsewhere or the line differs, keep the behavior: `StatusBadge` must be exported by name. Add `export type { StatusBadgeProps, StatusBadgeDensity, StatusBadgeVariant } from "./status-badge";` at the same location.

- [ ] **Step 5: Run tests**

Run: `npm run test -- status-badge`
Expected: PASS (all new-API tests + 2 legacy-API tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/patterns/status-badge.tsx src/components/patterns/index.ts src/__tests__/patterns/status-badge.test.tsx
git commit -m "feat(sp6): StatusBadge — kind+value API, density compact/regular, legacy back-compat

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 5: Deprecate legacy badges (SeverityBadge, sat-badge, refresh-staleness-badge)

**Files:**
- Modify: `src/components/patterns/severity-badge.tsx`
- Modify: `src/components/patterns/sat-badge.tsx`
- Modify: `src/components/patterns/refresh-staleness-badge.tsx`
- Modify: `src/__tests__/patterns/status-badge.test.tsx` (add back-compat assertion)

- [ ] **Step 1: Shim `SeverityBadge` to call new `StatusBadge`**

Replace the body of `src/components/patterns/severity-badge.tsx` with:

```tsx
import { StatusBadge } from "./status-badge";

export type Severity = "critical" | "high" | "medium" | "low";

interface SeverityBadgeProps {
  level: Severity | string;
  className?: string;
  pulse?: boolean; // accepted but ignored in SP6 — motion removed for minimalist aesthetic
}

/**
 * @deprecated SP6 — use `<StatusBadge kind="severity" value={level} />` instead.
 * This wrapper is preserved for back-compat with out-of-scope pages during SP6 foundation.
 */
export function SeverityBadge({ level, className }: SeverityBadgeProps) {
  const allowed: Severity[] = ["critical", "high", "medium", "low"];
  if (allowed.includes(level as Severity)) {
    return <StatusBadge kind="severity" value={level as Severity} density="regular" className={className} />;
  }
  // Unknown severity string → generic pill
  return <StatusBadge kind="generic" value={String(level)} density="regular" className={className} />;
}
```

- [ ] **Step 2: Examine and shim `sat-badge.tsx` + `refresh-staleness-badge.tsx`**

**Note:** the current API of `refresh-staleness-badge.tsx` (and potentially `sat-badge.tsx`) may differ from the examples shown below. The example shims are illustrative. **Read the actual source first**, then preserve its EXACT current exported type signature and prop names in the shim. Only change internals.

```bash
cat src/components/patterns/sat-badge.tsx
cat src/components/patterns/refresh-staleness-badge.tsx
```

Then replace each body with a `@deprecated` shim that calls the new `StatusBadge`:

For `sat-badge.tsx`:
```tsx
import { StatusBadge } from "./status-badge";

interface SatBadgeProps {
  estado: "vigente" | "cancelado" | string;
  className?: string;
}

/**
 * @deprecated SP6 — use `<StatusBadge kind="estado_sat" value={estado} />`.
 */
export function SatBadge({ estado, className }: SatBadgeProps) {
  if (estado === "vigente" || estado === "cancelado") {
    return <StatusBadge kind="estado_sat" value={estado} density="regular" className={className} />;
  }
  return <StatusBadge kind="generic" value={String(estado)} density="regular" className={className} />;
}
```

For `refresh-staleness-badge.tsx` — after reading its current signature, write an equivalent shim:

```tsx
import { StatusBadge } from "./status-badge";

interface RefreshStalenessBadgeProps {
  ageSeconds?: number | null;
  staleAfterSeconds?: number;
  className?: string;
}

/**
 * @deprecated SP6 — use `<StatusBadge kind="staleness" value={fresh|stale} />`.
 * Computes fresh/stale from ageSeconds vs staleAfterSeconds (default 3600).
 */
export function RefreshStalenessBadge({
  ageSeconds,
  staleAfterSeconds = 3600,
  className,
}: RefreshStalenessBadgeProps) {
  const value: "fresh" | "stale" =
    ageSeconds == null || ageSeconds > staleAfterSeconds ? "stale" : "fresh";
  return <StatusBadge kind="staleness" value={value} density="regular" className={className} />;
}
```

If the current `RefreshStalenessBadge` takes a different prop name (e.g. `lastRefresh`, `refreshedAt`), preserve that name in the shim — only change the internals. Check the actual API before editing.

- [ ] **Step 3: Add a back-compat test**

Append to `src/__tests__/patterns/status-badge.test.tsx`:

```tsx
import { SeverityBadge } from "@/components/patterns/severity-badge";

describe("SeverityBadge (legacy wrapper)", () => {
  it("delegates to StatusBadge kind=severity", () => {
    render(<SeverityBadge level="critical" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-color", "critical");
  });

  it("unknown level → generic", () => {
    render(<SeverityBadge level="whatever" />);
    expect(screen.getByRole("status").textContent).toContain("whatever");
  });
});
```

- [ ] **Step 4: Run all badge tests**

Run: `npm run test -- status-badge severity-badge`
Expected: PASS — including the SeverityBadge delegation test.

- [ ] **Step 5: Type-check and build**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "(severity-badge|sat-badge|refresh-staleness-badge|status-badge)" | head
NODE_OPTIONS="--max-old-space-size=8192" npm run build 2>&1 | tail -8
```

Expected: no new type errors in those files. Build compiles.

- [ ] **Step 6: Commit**

```bash
git add src/components/patterns/severity-badge.tsx src/components/patterns/sat-badge.tsx src/components/patterns/refresh-staleness-badge.tsx src/__tests__/patterns/status-badge.test.tsx
git commit -m "refactor(sp6): deprecate SeverityBadge, SatBadge, RefreshStalenessBadge as StatusBadge shims

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 6: New `Chart` primitive (line / area / bar / stackedBar / pie / sparkline)

**Files:**
- Create: `src/components/patterns/chart.tsx`
- Create: `src/__tests__/patterns/chart.test.tsx`
- Modify: `src/components/patterns/index.ts` (export Chart)

- [ ] **Step 1: Write failing test**

Create `src/__tests__/patterns/chart.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chart } from "@/components/patterns/chart";

const sample = [
  { month: "Jan", revenue: 100, expenses: 60 },
  { month: "Feb", revenue: 140, expenses: 70 },
  { month: "Mar", revenue: 180, expenses: 90 },
];

describe("Chart", () => {
  it("requires ariaLabel and exposes it with role=img", () => {
    render(
      <Chart
        type="line"
        data={sample}
        xKey="month"
        series={[{ key: "revenue", label: "Ingresos" }]}
        ariaLabel="Ingresos mensuales"
      />
    );
    const el = screen.getByRole("img");
    expect(el).toHaveAttribute("aria-label", "Ingresos mensuales");
  });

  it("renders screen-reader data table adjacent to chart", () => {
    const { container } = render(
      <Chart
        type="bar"
        data={sample}
        xKey="month"
        series={[{ key: "revenue", label: "Ingresos" }]}
        ariaLabel="Revenue chart"
      />
    );
    const srTable = container.querySelector('table.sr-only');
    expect(srTable).toBeTruthy();
    expect(srTable?.textContent).toContain("Jan");
    expect(srTable?.textContent).toContain("100");
  });

  it("sparkline type hides axes and tooltips", () => {
    const { container } = render(
      <Chart
        type="sparkline"
        data={[{ t: 1, v: 10 }, { t: 2, v: 20 }, { t: 3, v: 15 }]}
        xKey="t"
        series={[{ key: "v", label: "v" }]}
        ariaLabel="Trend"
      />
    );
    expect(container.querySelector(".recharts-cartesian-axis")).toBeFalsy();
  });

  it("accepts semantic colors on series", () => {
    const { container } = render(
      <Chart
        type="area"
        data={sample}
        xKey="month"
        series={[{ key: "revenue", label: "Ingresos", color: "positive" }]}
        ariaLabel="Revenue"
      />
    );
    expect(container.querySelector('[role="img"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- chart.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Chart**

Create `src/components/patterns/chart.tsx`:

```tsx
"use client";

import * as React from "react";
import {
  LineChart, Line,
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { CHART_PALETTE, type ChartPaletteKey } from "@/lib/chart-theme";

export type ChartType = "line" | "area" | "bar" | "stackedBar" | "pie" | "sparkline";

export interface ChartSeries {
  key: string;
  label: string;
  color?: ChartPaletteKey | string; // semantic key or any CSS color string
}

export interface ChartProps {
  type: ChartType;
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: ChartSeries[];
  height?: number;
  yFormatter?: (n: number) => string;
  ariaLabel: string; // REQUIRED
  className?: string;
}

function resolveColor(color: ChartSeries["color"], fallbackIndex: number): string {
  if (!color) return CHART_PALETTE.series[fallbackIndex % CHART_PALETTE.series.length];
  const semanticKeys: ChartPaletteKey[] = ["positive", "warning", "negative", "neutral", "muted"];
  if ((semanticKeys as string[]).includes(color)) {
    return CHART_PALETTE[color as ChartPaletteKey];
  }
  return color; // raw CSS (incl. var(--...))
}

export function Chart({
  type,
  data,
  xKey,
  series,
  height,
  yFormatter,
  ariaLabel,
  className,
}: ChartProps) {
  const h = height ?? (type === "sparkline" ? 24 : 240);
  const showAxes = type !== "sparkline" && type !== "pie";
  const showTooltip = type !== "sparkline";

  const content = (() => {
    switch (type) {
      case "line":
      case "sparkline":
        return (
          <LineChart data={data}>
            {showAxes && <XAxis dataKey={xKey} />}
            {showAxes && <YAxis tickFormatter={yFormatter ? (v) => yFormatter(Number(v)) : undefined} />}
            {showTooltip && <Tooltip />}
            {showAxes && series.length > 1 && <Legend />}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={resolveColor(s.color, i)}
                strokeWidth={type === "sparkline" ? 1.5 : 2}
                dot={type === "sparkline" ? false : { r: 2 }}
                activeDot={type === "sparkline" ? false : { r: 4 }}
                name={s.label}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={data}>
            <XAxis dataKey={xKey} />
            <YAxis tickFormatter={yFormatter ? (v) => yFormatter(Number(v)) : undefined} />
            <Tooltip />
            {series.length > 1 && <Legend />}
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={resolveColor(s.color, i)}
                fill={resolveColor(s.color, i)}
                fillOpacity={0.15}
                name={s.label}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        );

      case "bar":
      case "stackedBar":
        return (
          <BarChart data={data}>
            <XAxis dataKey={xKey} />
            <YAxis tickFormatter={yFormatter ? (v) => yFormatter(Number(v)) : undefined} />
            <Tooltip />
            {series.length > 1 && <Legend />}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={resolveColor(s.color, i)}
                stackId={type === "stackedBar" ? "stack" : undefined}
                name={s.label}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        );

      case "pie": {
        const s = series[0];
        if (!s) return <div />;
        return (
          <PieChart>
            <Tooltip />
            <Pie data={data} dataKey={s.key} nameKey={xKey} outerRadius="80%" isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_PALETTE.series[i % CHART_PALETTE.series.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      }
    }
  })();

  return (
    <div role="img" aria-label={ariaLabel} className={cn("relative", className)}>
      <ResponsiveContainer width="100%" height={h}>
        {content as React.ReactElement}
      </ResponsiveContainer>
      {/* Screen-reader data table mirrors the chart */}
      <table className="sr-only" aria-hidden="false">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{xKey}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td>{String(row[xKey] ?? "")}</td>
              {series.map((s) => (
                <td key={s.key}>{String(row[s.key] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Export from index**

Add to `src/components/patterns/index.ts`:

```typescript
export { Chart, type ChartProps, type ChartType, type ChartSeries } from "./chart";
```

- [ ] **Step 5: Run test**

Run: `npm run test -- chart.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/patterns/chart.tsx src/components/patterns/index.ts src/__tests__/patterns/chart.test.tsx
git commit -m "feat(sp6): Chart primitive (line/area/bar/stackedBar/pie/sparkline) with a11y table

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 7: Deprecate legacy chart wrappers (DataView, DataViewChart, DataViewToggle, MiniChart)

**Files:**
- Modify: `src/components/patterns/mini-chart.tsx`
- Modify: `src/components/patterns/data-view-chart.tsx`
- Modify: `src/components/patterns/data-view.tsx` (keep table+chart toggle behavior — thin wrapper on Chart)
- Modify: `src/components/patterns/data-view-toggle.tsx`
- Modify: `src/components/patterns/index.ts` (keep existing exports so out-of-scope pages compile)

The 4 wrappers must continue to compile. Replace their internals with thin calls to the new `Chart`, but preserve their current exported prop shapes.

- [ ] **Step 1: Read each legacy file to learn its current prop shape**

```bash
cat src/components/patterns/mini-chart.tsx
cat src/components/patterns/data-view-chart.tsx
cat src/components/patterns/data-view-toggle.tsx
head -80 src/components/patterns/data-view.tsx
```

- [ ] **Step 2: Shim `mini-chart.tsx` to call `<Chart type="sparkline" />`**

Replace the body of `src/components/patterns/mini-chart.tsx` with a function that accepts the CURRENT prop names (learned in Step 1) and forwards to `<Chart type="sparkline">`. Add `@deprecated` JSDoc:

```tsx
// src/components/patterns/mini-chart.tsx
import { Chart } from "./chart";

// Preserve the exact prop interface from the current file. Example shape —
// update field names to match Step-1 reading:
interface MiniChartProps {
  data: Array<{ x: number | string; y: number }>;
  className?: string;
  color?: string;
  ariaLabel?: string;
}

/**
 * @deprecated SP6 — use `<Chart type="sparkline" />` directly. This wrapper
 * forwards through for back-compat with out-of-scope pages.
 */
export function MiniChart({ data, className, color, ariaLabel }: MiniChartProps) {
  return (
    <Chart
      type="sparkline"
      data={data as unknown as Array<Record<string, unknown>>}
      xKey="x"
      series={[{ key: "y", label: ariaLabel ?? "valor", color }]}
      ariaLabel={ariaLabel ?? "Sparkline"}
      className={className}
    />
  );
}
```

If the real current prop names differ (`values` instead of `data`, `xField`/`yField` instead of fixed `x/y`), KEEP the current names in the shim signature and map them internally. Do NOT break existing call sites.

- [ ] **Step 3: Shim the other three wrappers similarly**

For `data-view-chart.tsx`, `data-view-toggle.tsx`, `data-view.tsx`: repeat the pattern. Preserve each file's exported function signature; replace the internal recharts calls with `<Chart>`. Annotate each export with `@deprecated SP6 — use <Chart> + local state for view toggle.`.

`DataView`'s "table or chart" toggle behavior stays — it can keep the internal `useState` and switch between its passed-in `<DataTable>` children vs rendering `<Chart>`. Only the chart rendering path changes.

- [ ] **Step 4: Verify build + test**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "(mini-chart|data-view)" | head
NODE_OPTIONS="--max-old-space-size=8192" npm run build 2>&1 | tail -8
npm run test
```

Expected: no new type errors. Build compiles. Existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/patterns/mini-chart.tsx src/components/patterns/data-view-chart.tsx src/components/patterns/data-view-toggle.tsx src/components/patterns/data-view.tsx
git commit -m "refactor(sp6): deprecate DataView/DataViewChart/DataViewToggle/MiniChart as Chart shims

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 8: `TrendSpark` — auto-colored sparkline for KpiCard

**Files:**
- Create: `src/components/patterns/trend-spark.tsx`
- Create: `src/__tests__/patterns/trend-spark.test.tsx`
- Modify: `src/components/patterns/index.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/patterns/trend-spark.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrendSpark } from "@/components/patterns/trend-spark";

describe("TrendSpark", () => {
  it("renders a chart with role=img", () => {
    const { container } = render(<TrendSpark values={[1, 2, 3, 4]} ariaLabel="90 días" />);
    expect(container.querySelector('[role="img"]')).toBeTruthy();
  });

  it("uses positive color when trend is up", () => {
    const { container } = render(<TrendSpark values={[1, 2, 3, 4, 5]} ariaLabel="up" />);
    const img = container.querySelector('[role="img"]');
    expect(img?.getAttribute("data-trend")).toBe("up");
  });

  it("uses negative color when trend is down", () => {
    const { container } = render(<TrendSpark values={[5, 4, 3, 2, 1]} ariaLabel="down" />);
    expect(container.querySelector('[role="img"]')?.getAttribute("data-trend")).toBe("down");
  });

  it("uses muted color when trend is flat", () => {
    const { container } = render(<TrendSpark values={[3, 3, 3]} ariaLabel="flat" />);
    expect(container.querySelector('[role="img"]')?.getAttribute("data-trend")).toBe("flat");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- trend-spark`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TrendSpark**

Create `src/components/patterns/trend-spark.tsx`:

```tsx
import { Chart } from "./chart";
import type { ChartPaletteKey } from "@/lib/chart-theme";

interface TrendSparkProps {
  values: number[];
  ariaLabel: string;
  width?: number;
  height?: number;
  className?: string;
}

function classifyTrend(values: number[]): { key: "up" | "down" | "flat"; color: ChartPaletteKey } {
  if (values.length < 2) return { key: "flat", color: "muted" };
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0) return { key: last > 0 ? "up" : last < 0 ? "down" : "flat", color: last > 0 ? "positive" : last < 0 ? "negative" : "muted" };
  const pct = (last - first) / Math.abs(first);
  if (pct > 0.02) return { key: "up", color: "positive" };
  if (pct < -0.02) return { key: "down", color: "negative" };
  return { key: "flat", color: "muted" };
}

export function TrendSpark({ values, ariaLabel, width, height, className }: TrendSparkProps) {
  const data = values.map((v, i) => ({ i, v }));
  const trend = classifyTrend(values);
  return (
    <div data-trend={trend.key} style={{ width: width ?? 60, height: height ?? 20 }} className={className}>
      <Chart
        type="sparkline"
        data={data}
        xKey="i"
        series={[{ key: "v", label: ariaLabel, color: trend.color }]}
        ariaLabel={ariaLabel}
        height={height ?? 20}
      />
    </div>
  );
}
```

Note: the outer div carries `data-trend` — the test asserts on that attribute, but `role="img"` lives on the inner `<Chart>`. Update the test to target the wrapper OR move `data-trend` onto the Chart. Cleanest: move `data-trend` to the inner element. Rewrite this component to forward `data-trend` onto the chart wrapper by adding a `dataAttrs` prop to `Chart`, OR simpler: keep the outer div but make the test look there. Update the test:

```tsx
const wrapper = container.querySelector('[data-trend]');
expect(wrapper?.getAttribute('data-trend')).toBe('up');
```

Adjust the test to match the implementation (target the outer `[data-trend]` div, not `[role="img"]`). Re-run.

- [ ] **Step 4: Export and run tests**

Add to `src/components/patterns/index.ts`:

```typescript
export { TrendSpark } from "./trend-spark";
```

Run: `npm run test -- trend-spark`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/patterns/trend-spark.tsx src/components/patterns/index.ts src/__tests__/patterns/trend-spark.test.tsx
git commit -m "feat(sp6): TrendSpark — auto-colored sparkline (up/down/flat)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 9: `InboxCard` — `gold_ceo_inbox` row as mobile-first card

**Files:**
- Create: `src/components/patterns/inbox-card.tsx`
- Create: `src/__tests__/patterns/inbox-card.test.tsx`
- Modify: `src/components/patterns/index.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/patterns/inbox-card.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InboxCard, type InboxCardIssue } from "@/components/patterns/inbox-card";

const issue: InboxCardIssue = {
  issue_id: "abc-123",
  issue_type: "invoice.posted_without_uuid",
  severity: "critical",
  priority_score: 87.5,
  impact_mxn: 125000,
  age_days: 4,
  description: "Factura INV/2026/03/0173 sin UUID timbrado",
  canonical_entity_type: "canonical_invoice",
  canonical_entity_id: "inv-42",
  action_cta: "operationalize",
  assignee: { id: 5, name: "Sandra Davila", email: "sandra@quimibond.com" },
  detected_at: "2026-04-18T09:00:00Z",
};

describe("InboxCard", () => {
  it("renders the core fields with a11y roles", () => {
    render(<InboxCard issue={issue} />);
    expect(screen.getByRole("article")).toBeInTheDocument();
    expect(screen.getByText(issue.description)).toBeInTheDocument();
    expect(screen.getByText(/Sandra Davila/)).toBeInTheDocument();
  });

  it("shows severity via StatusBadge", () => {
    render(<InboxCard issue={issue} />);
    const badge = screen.getAllByRole("status").find((el) => el.getAttribute("data-color") === "critical");
    expect(badge).toBeTruthy();
  });

  it("shows age_days and priority score", () => {
    render(<InboxCard issue={issue} />);
    expect(screen.getByText(/4.*d/)).toBeInTheDocument();
    expect(screen.getByText(/87/)).toBeInTheDocument();
  });

  it("renders action CTA button with aria-label when action_cta is set", () => {
    const onAction = vi.fn();
    render(<InboxCard issue={issue} onAction={onAction} />);
    const btn = screen.getByRole("button", { name: /Operacionalizar/i });
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith("operationalize", issue);
  });

  it("renders without assignee section when assignee is null", () => {
    const noAssignee = { ...issue, assignee: null };
    render(<InboxCard issue={noAssignee} />);
    expect(screen.queryByText(/Sandra Davila/)).toBeNull();
  });

  it("button has min 44px tap target (mobile)", () => {
    render(<InboxCard issue={issue} onAction={() => {}} />);
    const btn = screen.getByRole("button", { name: /Operacionalizar/i });
    expect(btn.className).toMatch(/min-h-\[44px\]|h-11/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- inbox-card`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement InboxCard**

Create `src/components/patterns/inbox-card.tsx`:

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge";
import { cn } from "@/lib/utils";

export type InboxCardSeverity = "critical" | "high" | "medium" | "low";
export type InboxActionCta = "operationalize" | "confirm_cancel" | "link_manual" | "resolve";

export interface InboxCardIssue {
  issue_id: string;
  issue_type: string;
  severity: InboxCardSeverity;
  priority_score: number;
  impact_mxn: number | null;
  age_days: number;
  description: string;
  canonical_entity_type: string;
  canonical_entity_id: string;
  action_cta: InboxActionCta | null;
  assignee: { id: number; name: string; email: string } | null;
  detected_at: string;
}

const CTA_LABELS: Record<InboxActionCta, string> = {
  operationalize: "Operacionalizar",
  confirm_cancel: "Confirmar cancelación",
  link_manual:    "Ligar manual",
  resolve:        "Resolver",
};

function fmtMxn(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

interface InboxCardProps {
  issue: InboxCardIssue;
  onAction?: (action: InboxActionCta, issue: InboxCardIssue) => void;
  className?: string;
}

export function InboxCard({ issue, onAction, className }: InboxCardProps) {
  return (
    <Card role="article" aria-labelledby={`issue-${issue.issue_id}-desc`} className={cn("transition-shadow hover:shadow-sm", className)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge kind="severity" value={issue.severity} density="regular" />
            <span className="text-xs text-muted-foreground" aria-label={`Prioridad ${issue.priority_score}`}>
              {Math.round(issue.priority_score)}
            </span>
            <span className="text-xs text-muted-foreground" aria-label={`Hace ${issue.age_days} días`}>
              {issue.age_days}d
            </span>
          </div>
          {issue.impact_mxn != null && (
            <span className="text-sm font-semibold tabular-nums" aria-label={`Impacto ${fmtMxn(issue.impact_mxn)}`}>
              {fmtMxn(issue.impact_mxn)}
            </span>
          )}
        </div>

        <p id={`issue-${issue.issue_id}-desc`} className="text-sm leading-snug">
          {issue.description}
        </p>

        <div className="flex items-center justify-between gap-2 pt-1">
          {issue.assignee ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium"
              >
                {issue.assignee.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{issue.assignee.name}</span>
            </div>
          ) : <span />}

          {issue.action_cta && onAction && (
            <Button
              size="sm"
              className="min-h-[44px]"
              aria-label={CTA_LABELS[issue.action_cta]}
              onClick={() => onAction(issue.action_cta!, issue)}
            >
              {CTA_LABELS[issue.action_cta]}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Export and run tests**

Add to `src/components/patterns/index.ts`:

```typescript
export { InboxCard, type InboxCardIssue, type InboxActionCta } from "./inbox-card";
```

Run: `npm run test -- inbox-card`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/patterns/inbox-card.tsx src/components/patterns/index.ts src/__tests__/patterns/inbox-card.test.tsx
git commit -m "feat(sp6): InboxCard — gold_ceo_inbox row with priority/severity/impact/age/cta

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 10: `SwipeStack` — CSS scroll-snap stack

**Files:**
- Create: `src/components/patterns/swipe-stack.tsx`
- Create: `src/__tests__/patterns/swipe-stack.test.tsx`
- Modify: `src/components/patterns/index.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/patterns/swipe-stack.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SwipeStack } from "@/components/patterns/swipe-stack";

describe("SwipeStack", () => {
  it("renders children in scroll-snap container with mobile snap rules", () => {
    const { container } = render(
      <SwipeStack ariaLabel="Inbox">
        <div data-testid="item-1">1</div>
        <div data-testid="item-2">2</div>
      </SwipeStack>
    );
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute("aria-label", "Inbox");
    expect(root.className).toMatch(/snap-y|scroll-snap/);
    expect(screen.getByTestId("item-1")).toBeInTheDocument();
  });

  it("wraps each child in a snap-center node", () => {
    const { container } = render(
      <SwipeStack ariaLabel="x">
        <span>a</span>
        <span>b</span>
      </SwipeStack>
    );
    const items = container.querySelectorAll('[data-swipe-item]');
    expect(items.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- swipe-stack`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement SwipeStack**

Create `src/components/patterns/swipe-stack.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

interface SwipeStackProps {
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
  /** When false, disables snap behavior (useful for desktop > md:). Default true. */
  snap?: boolean;
}

/**
 * Vertical scroll-snap stack. Pure CSS (no JS gesture lib). On mobile (<md)
 * snap-mandatory + snap-center gives a Tinder-like card-per-screen feel.
 * On md+ consumers typically turn `snap={false}` and use a grid layout instead.
 */
export function SwipeStack({ ariaLabel, className, children, snap = true }: SwipeStackProps) {
  return (
    <div
      role="list"
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-180px)]",
        snap && "snap-y snap-mandatory",
        className
      )}
    >
      {React.Children.map(children, (child, i) => (
        <div
          data-swipe-item
          role="listitem"
          key={i}
          className={cn(snap && "snap-center shrink-0")}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Export and run tests**

Add to `src/components/patterns/index.ts`:

```typescript
export { SwipeStack } from "./swipe-stack";
```

Run: `npm run test -- swipe-stack`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/patterns/swipe-stack.tsx src/components/patterns/index.ts src/__tests__/patterns/swipe-stack.test.tsx
git commit -m "feat(sp6): SwipeStack — CSS scroll-snap stack for mobile card flows

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 11: `AgingBuckets` — stacked bar with click-to-filter

**Files:**
- Create: `src/components/patterns/aging-buckets.tsx`
- Create: `src/__tests__/patterns/aging-buckets.test.tsx`
- Modify: `src/components/patterns/index.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/patterns/aging-buckets.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgingBuckets, type AgingData } from "@/components/patterns/aging-buckets";

const data: AgingData = {
  current:   500000,
  d1_30:     150000,
  d31_60:    80000,
  d61_90:    40000,
  d90_plus:  25000,
};

describe("AgingBuckets", () => {
  it("renders with role=img and summary in aria-label", () => {
    render(<AgingBuckets data={data} ariaLabel="Aging de cartera" />);
    const el = screen.getByRole("img");
    expect(el).toHaveAttribute("aria-label", "Aging de cartera");
  });

  it("renders a legend with 5 buckets", () => {
    render(<AgingBuckets data={data} ariaLabel="x" showLegend />);
    expect(screen.getByText(/Corriente/i)).toBeInTheDocument();
    expect(screen.getByText(/1\s?-\s?30/i)).toBeInTheDocument();
    expect(screen.getByText(/31\s?-\s?60/i)).toBeInTheDocument();
    expect(screen.getByText(/61\s?-\s?90/i)).toBeInTheDocument();
    expect(screen.getByText(/90\+/i)).toBeInTheDocument();
  });

  it("fires onBucketClick with bucket key", () => {
    const cb = vi.fn();
    render(<AgingBuckets data={data} ariaLabel="x" onBucketClick={cb} />);
    const button = screen.getByRole("button", { name: /Corriente/i });
    fireEvent.click(button);
    expect(cb).toHaveBeenCalledWith("current");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- aging-buckets`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AgingBuckets**

Create `src/components/patterns/aging-buckets.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export type AgingBucketKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export interface AgingData {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

const BUCKETS: Array<{ key: AgingBucketKey; label: string; varName: string }> = [
  { key: "current",  label: "Corriente", varName: "--aging-current" },
  { key: "d1_30",    label: "1-30",      varName: "--aging-1-30" },
  { key: "d31_60",   label: "31-60",     varName: "--aging-31-60" },
  { key: "d61_90",   label: "61-90",     varName: "--aging-61-90" },
  { key: "d90_plus", label: "90+",       varName: "--aging-90-plus" },
];

function fmtMxn(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

interface AgingBucketsProps {
  data: AgingData;
  ariaLabel: string;
  onBucketClick?: (bucket: AgingBucketKey) => void;
  showLegend?: boolean;
  className?: string;
}

export function AgingBuckets({ data, ariaLabel, onBucketClick, showLegend = true, className }: AgingBucketsProps) {
  const total = BUCKETS.reduce((acc, b) => acc + data[b.key], 0);
  if (total <= 0) {
    return (
      <div role="img" aria-label={ariaLabel} className={cn("text-sm text-muted-foreground", className)}>
        Sin cartera abierta
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="img"
        aria-label={ariaLabel}
        className="flex h-6 w-full overflow-hidden rounded-md"
      >
        {BUCKETS.map((b) => {
          const pct = (data[b.key] / total) * 100;
          if (pct === 0) return null;
          const content = (
            <div
              key={b.key}
              data-bucket={b.key}
              style={{ width: `${pct}%`, background: `var(${b.varName})` }}
              aria-label={`${b.label}: ${fmtMxn(data[b.key])}`}
              title={`${b.label}: ${fmtMxn(data[b.key])}`}
            />
          );
          return content;
        })}
      </div>

      {showLegend && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
          {BUCKETS.map((b) => {
            const inner = (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: `var(${b.varName})` }} />
                <span className="font-medium">{b.label}</span>
                <span className="tabular-nums text-muted-foreground">{fmtMxn(data[b.key])}</span>
              </span>
            );
            return (
              <li key={b.key}>
                {onBucketClick ? (
                  <button
                    type="button"
                    aria-label={`Filtrar ${b.label}`}
                    className="min-h-[32px] text-left hover:underline focus-visible:outline focus-visible:outline-2"
                    onClick={() => onBucketClick(b.key)}
                  >
                    {inner}
                  </button>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Export and run tests**

Add to `src/components/patterns/index.ts`:

```typescript
export { AgingBuckets, type AgingData, type AgingBucketKey } from "./aging-buckets";
```

Run: `npm run test -- aging-buckets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/patterns/aging-buckets.tsx src/components/patterns/index.ts src/__tests__/patterns/aging-buckets.test.tsx
git commit -m "feat(sp6): AgingBuckets — 5-stop gradient stacked bar with click-to-filter

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 12: `CompanyKpiHero` — entity-detail header

**Files:**
- Create: `src/components/patterns/company-kpi-hero.tsx`
- Create: `src/__tests__/patterns/company-kpi-hero.test.tsx`
- Modify: `src/components/patterns/index.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/patterns/company-kpi-hero.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompanyKpiHero } from "@/components/patterns/company-kpi-hero";

const base = {
  canonical: {
    id: 123,
    display_name: "ACME S.A. DE C.V.",
    rfc: "AAA010101AAA",
    has_shadow_flag: false,
    blacklist_level: "none" as const,
  },
  company360: {
    canonical_company_id: 123,
    lifetime_value_mxn: 12500000,
    revenue_ytd_mxn: 3200000,
    overdue_amount_mxn: 180000,
    open_company_issues_count: 3,
    revenue_90d_mxn: 520000,
  },
  trend: [100, 120, 140, 160, 180],
};

describe("CompanyKpiHero", () => {
  it("renders display_name and rfc", () => {
    render(<CompanyKpiHero {...base} />);
    expect(screen.getByText(/ACME S.A. DE C.V./)).toBeInTheDocument();
    expect(screen.getByText(/AAA010101AAA/)).toBeInTheDocument();
  });

  it("shows 4 KPIs (LTV, YTD, overdue, issues)", () => {
    render(<CompanyKpiHero {...base} />);
    expect(screen.getByText(/LTV/i)).toBeInTheDocument();
    expect(screen.getByText(/YTD/i)).toBeInTheDocument();
    expect(screen.getByText(/Vencida/i)).toBeInTheDocument();
    expect(screen.getByText(/Pendientes/i)).toBeInTheDocument();
  });

  it("renders blacklist badge when blacklist_level != none", () => {
    render(<CompanyKpiHero {...base} canonical={{ ...base.canonical, blacklist_level: "69b_definitivo" }} />);
    const badges = screen.getAllByRole("status");
    expect(badges.some((b) => b.getAttribute("data-color") === "critical")).toBe(true);
  });

  it("renders shadow badge when has_shadow_flag=true", () => {
    render(<CompanyKpiHero {...base} canonical={{ ...base.canonical, has_shadow_flag: true }} />);
    const badges = screen.getAllByRole("status");
    expect(badges.some((b) => /sombra/i.test(b.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("hides overdue block when overdue_amount_mxn is 0", () => {
    render(<CompanyKpiHero {...base} company360={{ ...base.company360, overdue_amount_mxn: 0 }} />);
    const kpis = screen.getAllByRole("figure");
    // Overdue card should still render; but ensure the value is formatted as MXN 0.
    expect(kpis.some((k) => k.textContent?.includes("$0"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- company-kpi-hero`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CompanyKpiHero**

Create `src/components/patterns/company-kpi-hero.tsx`:

```tsx
import { StatusBadge } from "./status-badge";
import { TrendSpark } from "./trend-spark";
import { cn } from "@/lib/utils";

type BlacklistLevel = "none" | "69b_presunto" | "69b_definitivo";

export interface CompanyKpiHeroCanonical {
  id: number;
  display_name: string;
  rfc: string | null;
  has_shadow_flag: boolean;
  blacklist_level: BlacklistLevel;
}

export interface CompanyKpiHero360 {
  canonical_company_id: number;
  lifetime_value_mxn: number;
  revenue_ytd_mxn: number;
  overdue_amount_mxn: number;
  open_company_issues_count: number;
  revenue_90d_mxn: number;
}

interface CompanyKpiHeroProps {
  canonical: CompanyKpiHeroCanonical;
  company360: CompanyKpiHero360;
  trend?: number[];
  className?: string;
}

function fmtMxn(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

export function CompanyKpiHero({ canonical, company360, trend, className }: CompanyKpiHeroProps) {
  const kpis = [
    { label: "LTV", value: fmtMxn(company360.lifetime_value_mxn) },
    { label: "YTD", value: fmtMxn(company360.revenue_ytd_mxn) },
    { label: "Vencida", value: fmtMxn(company360.overdue_amount_mxn) },
    { label: "Pendientes", value: String(company360.open_company_issues_count) },
  ];

  return (
    <section className={cn("rounded-lg border bg-card p-4 space-y-4", className)}>
      <header className="space-y-1.5">
        <h1 className="text-xl font-semibold leading-tight">{canonical.display_name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {canonical.rfc && <span className="font-mono">{canonical.rfc}</span>}
          {canonical.blacklist_level !== "none" && (
            <StatusBadge kind="blacklist" value={canonical.blacklist_level} density="regular" />
          )}
          {canonical.has_shadow_flag && (
            <StatusBadge kind="shadow" value={true} density="regular" />
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <figure key={k.label} className="rounded-md border bg-background p-3">
            <figcaption className="text-xs text-muted-foreground">{k.label}</figcaption>
            <div className="mt-1 text-lg font-semibold tabular-nums">{k.value}</div>
          </figure>
        ))}
      </div>

      {trend && trend.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Revenue 90d</span>
          <TrendSpark values={trend} ariaLabel={`Tendencia de ingresos 90 días (${trend.length} puntos)`} width={100} height={20} />
          <span className="ml-auto tabular-nums text-foreground">{fmtMxn(company360.revenue_90d_mxn)}</span>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Export and run tests**

Add to `src/components/patterns/index.ts`:

```typescript
export { CompanyKpiHero, type CompanyKpiHeroCanonical, type CompanyKpiHero360 } from "./company-kpi-hero";
```

Run: `npm run test -- company-kpi-hero`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/patterns/company-kpi-hero.tsx src/components/patterns/index.ts src/__tests__/patterns/company-kpi-hero.test.tsx
git commit -m "feat(sp6): CompanyKpiHero — entity detail header with blacklist/shadow/KPIs/spark

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 13: `url-state.ts` — zod-powered searchParams helpers

**Files:**
- Create: `src/lib/url-state.ts`
- Create: `src/__tests__/lib/url-state.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/lib/url-state.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseSearchParams, toSearchString } from "@/lib/url-state";

describe("parseSearchParams", () => {
  const schema = z.object({
    q: z.string().catch(""),
    page: z.coerce.number().int().min(1).catch(1),
    severity: z.enum(["critical", "high", "medium", "low"]).optional().catch(undefined),
  });

  it("parses plain object from Next.js searchParams", () => {
    const out = parseSearchParams({ q: "acme", page: "3", severity: "critical" }, schema);
    expect(out).toEqual({ q: "acme", page: 3, severity: "critical" });
  });

  it("parses URLSearchParams instance", () => {
    const sp = new URLSearchParams("q=acme&page=3");
    const out = parseSearchParams(sp, schema);
    expect(out.q).toBe("acme");
    expect(out.page).toBe(3);
  });

  it("applies defaults for invalid values (catch)", () => {
    const out = parseSearchParams({ page: "not-a-number", severity: "bogus" }, schema);
    expect(out.page).toBe(1);
    expect(out.severity).toBeUndefined();
  });

  it("handles array values — picks first", () => {
    const out = parseSearchParams({ q: ["a", "b"] }, schema);
    expect(out.q).toBe("a");
  });
});

describe("toSearchString", () => {
  it("serializes defined keys, skips undefined/null/empty-string", () => {
    expect(toSearchString({ q: "acme", page: 2, foo: undefined, bar: null, baz: "" }))
      .toBe("?q=acme&page=2");
  });

  it("skips page=1 (default)", () => {
    expect(toSearchString({ q: "x", page: 1 }, { dropEqual: { page: 1 } })).toBe("?q=x");
  });

  it("returns empty string when all keys dropped", () => {
    expect(toSearchString({ page: 1 }, { dropEqual: { page: 1 } })).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- url-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement url-state.ts**

Create `src/lib/url-state.ts`:

```typescript
import type { z } from "zod";

type RawInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

/**
 * Parse Next.js 15 searchParams (or a URLSearchParams) into a typed shape
 * via zod. Uses zod's `.catch(...)` fallbacks so invalid URLs degrade to
 * defaults instead of throwing.
 */
export function parseSearchParams<T>(raw: RawInput, schema: z.ZodType<T>): T {
  const obj: Record<string, string> = {};
  if (raw instanceof URLSearchParams) {
    raw.forEach((value, key) => {
      // First occurrence wins; matches "pick first" semantics.
      if (!(key in obj)) obj[key] = value;
    });
  } else {
    for (const [key, value] of Object.entries(raw)) {
      if (value == null) continue;
      obj[key] = Array.isArray(value) ? (value[0] ?? "") : String(value);
    }
  }
  return schema.parse(obj);
}

export interface ToSearchStringOptions {
  /** Keys whose value equals this default are dropped (e.g., {page: 1}). */
  dropEqual?: Record<string, unknown>;
}

export function toSearchString(
  params: Record<string, unknown>,
  opts: ToSearchStringOptions = {}
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value === "") continue;
    if (opts.dropEqual && key in opts.dropEqual && opts.dropEqual[key] === value) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => v != null && sp.append(key, String(v)));
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- url-state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/url-state.ts src/__tests__/lib/url-state.test.ts
git commit -m "feat(sp6): url-state helpers — zod-powered searchParams + toSearchString

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 14: Mobile audit of kept components

**Files:**
- Modify: whichever of `src/components/patterns/*` the audit identifies as broken at 375×812.
- Create: `docs/superpowers/plans/2026-04-22-frontend-revamp-sp6-foundation-mobile-audit.md` — running report appended during audit.

- [ ] **Step 1: Start dev server**

Run:
```bash
npm run dev
```
(leave running in background). Expected: `http://localhost:3000`.

- [ ] **Step 2: Audit each preserved component at mobile width**

Using Chrome DevTools responsive mode at iPhone 14 Pro preset (390×844) or custom 375×812:

Visit and screenshot each of these existing pages (they exercise most kept components):
- `/empresas` — DataTable, FilterBar, DataTableToolbar, PageHeader, PageLayout, StatGrid, KpiCard, CompanyLink, Currency, DateDisplay
- `/finanzas` — MetricRow, SectionHeader, SectionNav, PeriodSelector, YearSelector, GroupByToggle
- `/inbox` — EvidenceChip, LoadingCard/Table/List, EmptyState, StatusBadge (legacy, now shimmed)
- `/inbox/insight/[id]` (any id) — EvidenceTimeline, EvidencePackView, InvoiceDetailView, PersonCard, PredictionCard, ConfirmDialog (via actions), BottomSheet (via actions)

For each, record in `docs/superpowers/plans/2026-04-22-frontend-revamp-sp6-foundation-mobile-audit.md`:
- Component name
- Observation: passes / breaks
- Broken: description of break, proposed fix

- [ ] **Step 3: Fix each broken component in-place**

For every broken component, implement the fix in `src/components/patterns/<file>.tsx`. Typical fixes:
- Grids with fixed `grid-cols-3` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`.
- Tables not collapsing → wrap in `DataTable` which already supports mobile card mode; if a custom table: use `MobileCard` fallback under `sm:`.
- Tap targets <44px: add `min-h-[44px]` to click elements.
- Long row text overflows: add `truncate` + `min-w-0`.
- Sticky toolbars covering content: apply `pb-*` safe-area padding.

Write the fix. Re-check. Commit each fixed component as its own commit `fix(sp6): mobile audit — <component>` with a one-line summary of what was broken.

- [ ] **Step 4: Final audit summary commit**

Commit the audit report:
```bash
git add docs/superpowers/plans/2026-04-22-frontend-revamp-sp6-foundation-mobile-audit.md
git commit -m "docs(sp6): mobile audit report — components verified at 375×812

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

- [ ] **Step 5: A11y baseline sub-checks (keyboard + lang + dark contrast)**

Verify three spec-mandated items manually:

1. **`<html lang="es-MX">`** — run:
   ```bash
   grep -n 'lang=' src/app/layout.tsx
   ```
   Expected: the root `<html lang="es-MX">` is set. If missing or `"en"`, edit `src/app/layout.tsx` to `<html lang="es-MX" suppressHydrationWarning>`.

2. **Keyboard navigation on an InboxCard** — visit the dev server, tab through `/showcase`, confirm CTAs in `InboxCard` receive focus and activate on Enter/Space. If not: add `onKeyDown` handlers to any component that needs them.

3. **Dark-mode contrast spot-check** — toggle dark mode (via the existing theme toggle). Visually verify that `StatusBadge` text on each color is readable over the card background. If any fails, adjust the `L` (luminosity) coefficient of the corresponding `--status-*` token in the `.dark` block of `globals.css` (usually +0.04 to +0.08).

Commit any fixes made:
```bash
git add -u
git commit -m "fix(sp6): a11y baseline — lang/keyboard/contrast fixes from audit

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

- [ ] **Step 6: Run full test suite**

Run:
```bash
npm run test 2>&1 | tail -10
```
Expected: all tests pass.

---

## Task 15: `/showcase` page with real canonical/gold data

**Files:**
- Create: `src/app/showcase/page.tsx`
- Create: `src/app/showcase/loading.tsx`

- [ ] **Step 0: Verify helper return shapes and add adapters if needed**

The showcase page calls real helpers from `src/lib/queries/`. Their return types may not exactly match the prop types of `InboxCard`, `AgingBuckets`, `CompanyKpiHero`. Verify before writing the page.

Run:
```bash
grep -nE "(export (async )?function (listInbox|invoicesReceivableAging|fetchTopCustomers|fetchCompanyById|fetchCompany360))" src/lib/queries/ -r
```

Then open each helper and compare the returned field names to the component props. If any mismatch exists (e.g., helper returns `company_id` but component expects `canonical_company_id`, or aging helper returns `{ bucket_1_30: ... }` instead of `{ d1_30: ... }`), write a small adapter inline in `src/app/showcase/page.tsx` to map fields before passing to the component. **Do not change the component's prop shape to match the helper** — keep components stable; adapt at the page boundary.

If an adapter is needed, document it as a `// TODO sp6-01-*` comment — the per-page sub-spec may choose to widen the component's prop shape or fix the helper.

- [ ] **Step 1: Write the showcase page**

Create `src/app/showcase/page.tsx`:

```tsx
import { Suspense } from "react";
import {
  PageLayout,
  PageHeader,
  StatusBadge,
  Chart,
  TrendSpark,
  InboxCard,
  SwipeStack,
  AgingBuckets,
  CompanyKpiHero,
  LoadingCard,
} from "@/components/patterns";
import { listInbox } from "@/lib/queries/intelligence/inbox";
import {
  fetchCompanyById,
  fetchCompany360,
  fetchTopCustomers,
  invoicesReceivableAging,
} from "@/lib/queries/_shared/companies";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "SP6 Showcase (internal)" };

async function InboxCardDemo() {
  const rows = await listInbox({ limit: 3 });
  return (
    <SwipeStack ariaLabel="Demo de InboxCard" snap={false}>
      {rows.map((r) => (
        <InboxCard key={r.issue_id} issue={r as never} />
      ))}
    </SwipeStack>
  );
}

async function AgingDemo() {
  const aging = await invoicesReceivableAging();
  return <AgingBuckets data={aging} ariaLabel="Aging de cartera" />;
}

async function TopCustomerHero() {
  const top = await fetchTopCustomers({ limit: 1 });
  const company = top[0];
  if (!company) return <div>Sin clientes</div>;
  const [canonical, c360] = await Promise.all([
    fetchCompanyById(company.canonical_company_id),
    fetchCompany360(company.canonical_company_id),
  ]);
  if (!canonical || !c360) return <div>Datos incompletos</div>;
  return (
    <CompanyKpiHero
      canonical={canonical as never}
      company360={c360 as never}
      trend={[100, 120, 135, 155, 180, 210]}
    />
  );
}

function StaticShowcase() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">StatusBadge · density=compact</h2>
        <div className="flex flex-wrap gap-3">
          <StatusBadge kind="severity" value="critical" />
          <StatusBadge kind="severity" value="high" />
          <StatusBadge kind="severity" value="medium" />
          <StatusBadge kind="severity" value="low" />
          <StatusBadge kind="payment" value="paid" />
          <StatusBadge kind="payment" value="partial" />
          <StatusBadge kind="payment" value="not_paid" />
          <StatusBadge kind="estado_sat" value="vigente" />
          <StatusBadge kind="estado_sat" value="cancelado" />
          <StatusBadge kind="blacklist" value="69b_definitivo" />
          <StatusBadge kind="shadow" value={true} />
          <StatusBadge kind="staleness" value="stale" />
          <StatusBadge kind="match" value={0.95} />
          <StatusBadge kind="match" value={0.75} />
          <StatusBadge kind="match" value={0.3} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">StatusBadge · density=regular</h2>
        <div className="flex flex-wrap gap-3">
          <StatusBadge kind="severity" value="critical" density="regular" />
          <StatusBadge kind="payment" value="paid" density="regular" />
          <StatusBadge kind="blacklist" value="69b_presunto" density="regular" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">TrendSpark</h2>
        <div className="flex gap-4 items-center">
          <span className="text-sm">Up:</span>
          <TrendSpark values={[10, 20, 35, 55, 80]} ariaLabel="Up trend" />
          <span className="text-sm">Down:</span>
          <TrendSpark values={[80, 55, 35, 20, 10]} ariaLabel="Down trend" />
          <span className="text-sm">Flat:</span>
          <TrendSpark values={[50, 50, 50, 50]} ariaLabel="Flat trend" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Chart — line + area + bar + pie</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Chart
            type="line"
            data={[
              { m: "Ene", v: 100 },
              { m: "Feb", v: 120 },
              { m: "Mar", v: 150 },
              { m: "Abr", v: 180 },
            ]}
            xKey="m"
            series={[{ key: "v", label: "Ingresos", color: "positive" }]}
            ariaLabel="Demo line chart"
          />
          <Chart
            type="bar"
            data={[
              { m: "Ene", v: 60 },
              { m: "Feb", v: 45 },
              { m: "Mar", v: 90 },
            ]}
            xKey="m"
            series={[{ key: "v", label: "Gastos", color: "warning" }]}
            ariaLabel="Demo bar chart"
          />
        </div>
      </section>
    </div>
  );
}

export default function ShowcasePage() {
  return (
    <PageLayout>
      <PageHeader title="SP6 Showcase" subtitle="Componentes nuevos y consolidados con datos reales — ruta interna, no listado en sidebar." />
      <StaticShowcase />
      <section>
        <h2 className="text-lg font-semibold mb-3">InboxCard (datos reales)</h2>
        <Suspense fallback={<LoadingCard />}>
          <InboxCardDemo />
        </Suspense>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">AgingBuckets (datos reales)</h2>
        <Suspense fallback={<LoadingCard />}>
          <AgingDemo />
        </Suspense>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">CompanyKpiHero (top customer)</h2>
        <Suspense fallback={<LoadingCard />}>
          <TopCustomerHero />
        </Suspense>
      </section>
    </PageLayout>
  );
}
```

- [ ] **Step 2: Add loading skeleton**

Create `src/app/showcase/loading.tsx`:

```tsx
import { LoadingCard } from "@/components/patterns";

export default function Loading() {
  return (
    <div className="p-4 space-y-4">
      <LoadingCard />
      <LoadingCard />
      <LoadingCard />
    </div>
  );
}
```

- [ ] **Step 3: Verify no sidebar entry**

Run:
```bash
grep -n "showcase" src/components/layout/app-sidebar.tsx
```
Expected: 0 matches. If there's a match, remove the entry — the showcase must not appear in the public sidebar.

- [ ] **Step 4: Smoke-test the showcase locally**

Run: `npm run dev` → visit `http://localhost:3000/showcase`.
Expected: page loads, all components render with real data. Screenshot on desktop + mobile (375×812).

- [ ] **Step 5: Verify it builds**

Run:
```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run build 2>&1 | tail -15
```
Expected: `/showcase` present in output page list; build succeeds (pre-existing `/equipo` failure expected).

- [ ] **Step 6: Commit**

```bash
git add src/app/showcase/
git commit -m "feat(sp6): /showcase page — SP6 design system demo with real canonical/gold data

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 16: Install Playwright + axe-core, write foundation e2e spec

**Files:**
- Modify: `package.json` (add deps + script)
- Create: `playwright.config.ts`
- Create: `e2e/foundation.spec.ts`

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install -D @playwright/test @axe-core/playwright
npx playwright install chromium
```
Expected: `@playwright/test`, `@axe-core/playwright`, Chromium browser installed.

- [ ] **Step 2: Write Playwright config**

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-iphone14",  use: { ...devices["iPhone 14 Pro"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Open `package.json` and add under `"scripts"`:

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 4: Write the foundation spec**

Create `e2e/foundation.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("SP6 foundation /showcase", () => {
  test("loads without errors and renders each component section", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/showcase", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /SP6 Showcase/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /StatusBadge · density=compact/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /TrendSpark/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Chart/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /InboxCard/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /AgingBuckets/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /CompanyKpiHero/i })).toBeVisible();

    expect(errors, "no runtime errors").toEqual([]);
  });

  test("CTA buttons meet 44px tap target on mobile", async ({ page }) => {
    await page.goto("/showcase", { waitUntil: "networkidle" });
    const buttons = page.locator("button");
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const b = buttons.nth(i);
      const box = await b.boundingBox();
      if (!box) continue;
      // 44 is the HIG minimum; allow 2px slack.
      expect(box.height, `button #${i} height`).toBeGreaterThanOrEqual(42);
    }
  });

  test("axe-core scan — 0 critical violations", async ({ page }) => {
    await page.goto("/showcase", { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"]) // checked separately in manual audit
      .analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    // Log warnings for future fixes
    for (const v of results.violations) {
      if (v.impact !== "critical") console.warn(`axe [${v.impact}] ${v.id}: ${v.description}`);
    }
    expect(critical, "no critical axe violations").toEqual([]);
  });

  test("matches visual snapshot (mobile)", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "mobile-iphone14") test.skip();
    await page.goto("/showcase", { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot("showcase-mobile.png", { fullPage: true, maxDiffPixelRatio: 0.02 });
  });

  test("matches visual snapshot (desktop)", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop-chromium") test.skip();
    await page.goto("/showcase", { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot("showcase-desktop.png", { fullPage: true, maxDiffPixelRatio: 0.02 });
  });
});
```

- [ ] **Step 5: Generate baseline screenshots**

Run:
```bash
npx playwright test --update-snapshots
```
Expected: snapshots written to `e2e/foundation.spec.ts-snapshots/`.

- [ ] **Step 6: Run the full suite to verify green**

Run:
```bash
npm run e2e
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json playwright.config.ts e2e/
git commit -m "test(sp6): Playwright + axe-core e2e on /showcase (mobile + desktop)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 17: Decommission audit of `TableDensityToggle` / `TableViewOptions` / `TableExportButton`

**Files:**
- Modify or delete: one or more of:
  - `src/components/patterns/table-density-toggle.tsx`
  - `src/components/patterns/table-view-options.tsx`
  - `src/components/patterns/table-export-button.tsx`
- Modify: `src/components/patterns/index.ts`
- Modify: any consumer files (if we decide to remove usage)

- [ ] **Step 1: Count real callers**

Run:
```bash
for comp in TableDensityToggle TableViewOptions TableExportButton; do
  echo "=== $comp ==="
  grep -rn "$comp" src/ --include="*.tsx" --include="*.ts" | grep -v "patterns/$(echo $comp | tr '[:upper:]' '[:lower:]' | sed 's/.*/\&/')" | grep -v "__tests__" | head
done
```

- [ ] **Step 2: Decide per component**

Decision rule (write decision into a comment at the top of each file + into the decommission note):
- Callers ≥ 3 **and** ≥1 of those is in the 7 in-scope pages → **keep** (audit mobile, no action beyond that).
- Callers < 3 **or** all callers are in 9 out-of-scope pages only → **mark for SP7 removal**: add file-top comment `// @deprecated SP6 — candidate for SP7 removal. Current callers: N (in X).` and leave functional.
- Callers = 0 → **remove file + export**. Delete the file and remove the line in `index.ts`.

- [ ] **Step 3: Apply the decision**

If removing:
```bash
git rm src/components/patterns/table-density-toggle.tsx   # example
# edit src/components/patterns/index.ts to delete the matching export line
```

If marking @deprecated: edit the file and add the top-of-file comment block:
```tsx
/**
 * @deprecated SP6 foundation — candidate for SP7 removal.
 * Callers (as of 2026-04-22): <list filepaths>.
 * Kept functional via shadcn Button + ad-hoc state; new page rebuilds
 * should not introduce new callers.
 */
```

- [ ] **Step 4: Run type-check + build + tests**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -5
NODE_OPTIONS="--max-old-space-size=8192" npm run build 2>&1 | tail -10
npm run test
```
Expected: all green (no regressions in out-of-scope pages).

- [ ] **Step 5: Commit**

```bash
git add -u src/components/patterns/
git commit -m "refactor(sp6): decommission audit — TableDensityToggle/ViewOptions/ExportButton

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 18: Update `docs/design-system.md`

**Files:**
- Modify: `docs/design-system.md`

- [ ] **Step 1: Rewrite the relevant sections**

Open `docs/design-system.md`. Add / update:

1. **Tokens** section — add sub-section **Status semántico**:
```markdown
### Status semántico (SP6)
Traffic-light tokens en `globals.css` (light + dark):
- `--status-ok` (verde salvia) — positivo, on-time, paid
- `--status-warning` (ámbar cálido) — atención, partial, stale
- `--status-critical` (coral) — overdue, blacklist definitivo
- `--status-info` (azul apagado) — baseline, unmatched
- `--status-muted` (gris) — inactivo, low severity

Aging gradient 5-stop: `--aging-current → --aging-1-30 → --aging-31-60 → --aging-61-90 → --aging-90-plus`.

Tailwind utilities: `text-status-ok`, `bg-aging-90-plus`, etc. (vía `@theme inline`).
```

2. **Catálogo de componentes** — agregar entrada para los 5 nuevos:
```markdown
### SP6 nuevos
- `<InboxCard>` — gold_ceo_inbox row. Props: `issue`, `onAction`. Mobile-first.
- `<SwipeStack>` — CSS scroll-snap. Props: `ariaLabel`, `snap`. Para listas tipo Tinder en mobile.
- `<AgingBuckets>` — stacked bar 5-stop. Props: `data`, `onBucketClick`, `showLegend`.
- `<CompanyKpiHero>` — header entity detail. Props: `canonical`, `company360`, `trend`.
- `<TrendSpark>` — sparkline auto-coloreado. Props: `values`, `ariaLabel`, `width`, `height`.
```

3. **Consolidated** — documentar el nuevo API:
```markdown
### StatusBadge (SP6 unificado)
```tsx
<StatusBadge
  kind="severity|payment|estado_sat|blacklist|shadow|match|staleness|reconciliation|generic"
  value={...}
  density="compact" | "regular"    // compact default — dot + text; regular — pill suave
  variant?="dot" | "pill" | "outline" | "leftbar"  // escape hatch
  ariaLabel?
  className?
/>
```
Legacy `<StatusBadge status="paid" />` y `<SeverityBadge level="critical" />` siguen funcionando vía shims @deprecated.

### Chart (SP6 unificado)
```tsx
<Chart
  type="line|area|bar|stackedBar|pie|sparkline"
  data={[...]}
  xKey
  series={[{ key, label, color? }]}
  ariaLabel  // REQUERIDO
  height?
  yFormatter?
/>
```
Renderiza tabla `sr-only` espejo para screen readers. Los wrappers viejos (`DataView`, `DataViewChart`, `DataViewToggle`, `MiniChart`) quedan como shims @deprecated.
```

4. **Contracts** — nueva sección:
```markdown
## Contratos transversales (SP6)

### URL state
`src/lib/url-state.ts` — `parseSearchParams(raw, schema)` + `toSearchString(params, opts?)`. Schemas con zod.

### Breakpoints mobile-first
Viewport canónico 375×812. Tailwind defaults. Bajo `sm:` DataTables colapsan a MobileCard stack; sidebar → Sheet drawer.

### A11y baseline
- Clicks en rows/cards: `role="button" tabIndex={0}` + keyboard handlers.
- Badges: `aria-label` semántico obligatorio.
- Charts: `role="img"` + tabla `.sr-only` espejo.
- Color nunca es único portador de semántica (siempre ícono + texto).
- Contraste WCAG AA (4.5:1 texto, 3:1 UI) en dark mode.
```

- [ ] **Step 2: Verify no contradictions with existing content**

Read through `docs/design-system.md` top to bottom. Remove or update any line that contradicts the new APIs (e.g., old `<SeverityBadge level>` usage notes stay but get a `@deprecated SP6` annotation).

- [ ] **Step 3: Commit**

```bash
git add docs/design-system.md
git commit -m "docs(sp6): design-system.md — traffic-light tokens, StatusBadge/Chart unified APIs, contracts

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 19: Smoke test 9 out-of-scope pages

**Files:**
- Create: `docs/superpowers/plans/2026-04-22-frontend-revamp-sp6-foundation-smoke-test.md`

- [ ] **Step 1: Start dev server**

Run: `npm run dev` in the background.

- [ ] **Step 2: Load each out-of-scope page, verify no visible regression**

For each URL below, open, load, verify: (a) no page error, (b) page renders, (c) badges/charts that used the legacy APIs still appear.

- `/` (root)
- `/briefings/<any-slug>` — pick a slug that exists (check `/briefings` index first if necessary)
- `/chat`
- `/compras`
- `/compras/costos-bom`
- `/contactos`
- `/contactos/<any-id>` — first id from /contactos list
- `/directores`
- `/directores/<any-slug>`
- `/equipo`
- `/profile`
- `/sistema`

Record in `docs/superpowers/plans/2026-04-22-frontend-revamp-sp6-foundation-smoke-test.md`:
- URL, status (ok / regression), observation.

If a page regresses, **stop and fix** before continuing — this is DoD gate #11.

- [ ] **Step 3: Commit the report**

```bash
git add docs/superpowers/plans/2026-04-22-frontend-revamp-sp6-foundation-smoke-test.md
git commit -m "docs(sp6): smoke test of 9 out-of-scope pages — DoD gate 11

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 20: Push branch and open PR

**Files:**
- None.

- [ ] **Step 1: Rebase on latest main**

Run:
```bash
git fetch origin
git rebase origin/main
```
Resolve any conflicts in-place. If none: clean rebase.

- [ ] **Step 2: Push**

Run:
```bash
git push -u origin frontend-revamp-sp6-ui
```

- [ ] **Step 3: Open the PR with the DoD checklist**

Run:
```bash
gh pr create --title "SP6 Foundation — design system revamp" --body "$(cat <<'EOF'
## Summary
SP6 foundation — mobile-first shadcn revamp. 1 foundation spec + 7 per-page sub-specs pattern. This PR = foundation only.

- Traffic-light status tokens + aging gradient in globals.css (light + dark)
- CHART_PALETTE semantic theme + preserved --chart-1..5 for non-semantic series
- Consolidated StatusBadge (unifies SeverityBadge/sat-badge/refresh-staleness-badge/legacy StatusBadge/ad-hoc <Badge>)
- Consolidated Chart primitive (unifies DataView/DataViewChart/DataViewToggle/MiniChart)
- 5 new components: InboxCard, SwipeStack, AgingBuckets, CompanyKpiHero, TrendSpark
- URL state helpers (zod schemas + toSearchString)
- Mobile audit of preserved components at 375×812
- /showcase page with real canonical/gold data
- Playwright e2e + axe-core a11y scan
- design-system.md updated

## Spec
`docs/superpowers/specs/2026-04-22-frontend-revamp-sp6-foundation-design.md` (commit 84ce508).

## DoD (11/11)
- [x] 5 new components implemented + Vitest tested
- [x] Chart primitive replaces 4 wrappers (deprecated shims kept)
- [x] StatusBadge consolidated (deprecated shims kept)
- [x] --status-* / --aging-* tokens in globals.css + CHART_PALETTE
- [x] src/lib/url-state.ts with zod + tests
- [x] /showcase page renders new + consolidated with real data
- [x] Mobile audit report (docs/superpowers/plans/.../mobile-audit.md)
- [x] axe-core scan — 0 critical violations on /showcase
- [x] docs/design-system.md updated
- [x] CI green (build + vitest + playwright)
- [x] 9 out-of-scope pages smoke test report (docs/superpowers/plans/.../smoke-test.md)

## Non-goals (explicit)
- Redesign of the 7 CEO pages (separate per-page sub-specs after this merges).
- Migration of 9 out-of-scope pages (stay on shims).
- Query layer changes (already canonical/gold post-SP5).
- New UI libraries, dark mode toggle UI, app-sidebar.tsx changes.

## Test plan
- [ ] Merge to main and verify production Vercel build succeeds
- [ ] Load /showcase in prod and visually verify all sections
- [ ] Verify 9 out-of-scope pages (listed in smoke-test.md) still look identical

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

- [ ] **Step 4: Print the PR URL**

The `gh pr create` command outputs the URL. Copy it for the user.

---

## Handoff: merge + next sub-spec

Once the user merges the PR with `gh pr merge N --merge --delete-branch`, the foundation is live on `main`. The 7 per-page sub-specs can then be brainstormed one at a time (each with its own `superpowers:brainstorming` session → spec → plan → branch from latest `main` → PR).

Recommended order (per brainstorm decision "prioriza por impacto al CEO"):
1. `sp6-01-inbox` — daily driver
2. `sp6-02-empresas` — 10-tab detail most used
3. `sp6-03-cobranza` — CEO financial pulse
4. `sp6-04-finanzas` — P&L / balance / cashflow
5. `sp6-05-ventas`
6. `sp6-06-productos`
7. `sp6-07-operaciones`

Each sub-spec kicks off with: `git checkout main && git pull && git checkout -b frontend-sp6-<nn>-<name>`.
