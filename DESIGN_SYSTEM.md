# Design System — Quimibond Intelligence

**Single source of truth for UI patterns.** If something isn't documented here, it shouldn't exist in the codebase.

## Core principle

**No hardcoded colors. No custom replicas of shadcn components. Reuse or add to the design system.**

When in doubt:
1. Check `src/components/ui/*` (shadcn primitives)
2. Check `src/components/shared/*` (app-specific primitives)
3. Only then add a new shared component

---

## Semantic color tokens

All colors in this app are defined as CSS variables in `src/app/globals.css`. **Never use raw Tailwind colors** (`bg-red-500`, `text-amber-600`, etc.).

### Base (shadcn)
| Token | Usage |
|-------|-------|
| `primary` | Main brand/action color |
| `secondary` | Subtle background accents |
| `muted` | Disabled/inactive backgrounds |
| `muted-foreground` | Secondary/helper text |
| `card` / `card-foreground` | Card surfaces |
| `background` / `foreground` | Page base |
| `border` | All borders |
| `ring` | Focus rings |
| `destructive` | Delete/destructive actions |

### Semantic status (custom)
| Token | Usage |
|-------|-------|
| `success` / `success-foreground` | Positive state (paid, improved, on-time) |
| `warning` / `warning-foreground` | Attention needed (overdue 1-30d, medium severity) |
| `danger` / `danger-foreground` | Critical state (overdue 60d+, high severity) |
| `info` / `info-foreground` | Informational / neutral highlight |

### Domain colors (agent areas)
| Token | Domain |
|-------|--------|
| `domain-sales` | Comercial / ventas |
| `domain-finance` | Financiero / cobranza |
| `domain-operations` | Operaciones / logística |
| `domain-relationships` | Equipo / relaciones |
| `domain-risk` | Riesgo |
| `domain-growth` | Crecimiento |
| `domain-meta` | Meta-agent |

### ❌ Forbidden
```tsx
// ❌ Raw Tailwind colors
<div className="bg-red-500 text-amber-600 border-emerald-400">

// ✅ Semantic tokens
<div className="bg-danger text-warning border-success/30">
```

---

## Component catalog

### shadcn primitives (`src/components/ui/`)

| Component | When to use |
|-----------|-------------|
| `Button` | All clickable buttons. Never `<button>` directly. |
| `Input` | Text input. Never `<input type="text">`. |
| `Textarea` | Multi-line text. Never `<textarea>`. |
| `Select` | Dropdown. Never `<select>`. |
| `Label` | Form labels with `htmlFor`. Never `<label>`. |
| `Checkbox` | Checkboxes. Never `<input type="checkbox">`. |
| `Card` / `CardContent` / `CardHeader` / `CardTitle` | Content containers |
| `Badge` | Status pills, counts, tags |
| `Dialog` | Modals |
| `Sheet` | Side panels (mobile menus) |
| `Tabs` / `TabsList` / `TabsTrigger` | Tabbed interfaces |
| `Table` | Data tables |
| `Skeleton` | Loading placeholders |
| `Separator` | Dividers |
| `Switch` | On/off toggles |
| `Progress` | Progress bars (not status bars — use `role="meter"`) |
| `Avatar` | User/company avatars |
| `Tooltip` | Hover hints |
| `DropdownMenu` | Action menus |

### App primitives (`src/components/shared/`)

| Component | Purpose |
|-----------|---------|
| `PageHeader` | Title + description at top of every page |
| `EmptyState` | When a list is empty (always show, never blank) |
| `LoadingGrid` | Placeholder rows during async loads |
| `StatCard` / `MiniStatCard` | KPI tiles (use `MiniStatCard` for dense layouts) |
| `SeverityBadge` | critical/high/medium/low/info status |
| `RiskBadge` | high/critical risk contact indicator |
| `StateBadge` | Action/insight state (new/seen/acted_on/dismissed/expired) |
| `TrendBadge` | ↑ / ↓ with % and color |
| `FeedbackButtons` | was_useful yes/no thumbs |
| `Breadcrumbs` | Navigation trail on detail pages |
| `DataFreshness` | "Hace X min" timestamp |
| `EntityLink` | Clickable chip that links to a company/contact |
| `AssigneeSelect` | Dropdown for assigning to an employee |
| `LinkCard` | **Clickable card** — link, button, or anchor variants. Use this instead of div+custom-styles |
| `FilterBar` | Consistent filter/search row |
| `HealthRadar` | Radial chart for health score |
| `HealthTrendChart` | Line chart for score over time |
| `RevenueChart` | Bar chart for monthly revenue |
| `AgingChart` | Cartera aging visualization |
| `InvoiceTable` | Reusable invoice table |
| `ActivityList` | Activity feed with icons |

---

## LinkCard pattern (the one you'll use most)

**Problem:** 25+ places in the codebase had custom `<div>` / `<Link>` / `<button>` with `rounded-xl border bg-card shadow-sm hover:bg-muted/50 transition` classes — all slightly different.

**Solution:** `<LinkCard>` in `src/components/shared/link-card.tsx`.

```tsx
// Next.js Link (default)
<LinkCard href={`/inbox/insight/${id}`} className="flex items-center gap-3 p-3">
  <Icon className="h-4 w-4 text-primary" />
  <div>
    <p className="text-sm font-medium">{title}</p>
    <p className="text-xs text-muted-foreground">{description}</p>
  </div>
</LinkCard>

// Mailto / external link
<LinkCard as="a" href="mailto:..." onClick={handler} className="flex items-center gap-3 p-3">
  ...
</LinkCard>

// Button (no href, action only)
<LinkCard as="button" onClick={handler} disabled={loading} className="flex items-center gap-3 p-3">
  ...
</LinkCard>
```

All variants share:
- `rounded-xl border bg-card text-card-foreground shadow-sm`
- Hover: `bg-muted/50` + `border-primary/30`
- Focus-visible: `ring-2 ring-ring ring-offset-1` (keyboard a11y)
- Automatic transition

Add `interactive={false}` for static display (no hover/focus effects).

---

## Form pattern

```tsx
<div className="space-y-1.5">
  <Label htmlFor="my-field">Field name</Label>
  <Input
    id="my-field"
    type="text"
    value={value}
    onChange={(e) => setValue(e.target.value)}
    placeholder="..."
  />
</div>
```

- Always `Label` + `htmlFor` (a11y requirement)
- Use `space-y-1.5` between label and input
- Use `space-y-4` between form fields
- Error message: `<p className="text-sm text-destructive">{error}</p>`
- Never inline `<input>` without shadcn wrapper

---

## Icon pattern

Every `lucide-react` icon inside an interactive element needs a label:

```tsx
// ❌ Icon-only button with no label
<button onClick={close}><X className="h-4 w-4" /></button>

// ✅ Icon-only button with aria-label
<button onClick={close} aria-label="Cerrar panel">
  <X className="h-4 w-4" />
</button>

// ✅ Decorative icon next to text (no label needed)
<button>
  <Save className="h-4 w-4 mr-1" />
  Guardar
</button>

// ✅ Icon as status indicator (role="img" + aria-label)
<Paperclip className="h-3.5 w-3.5" aria-label="Tiene adjuntos" />
```

---

## Status meter pattern (not progress)

For "X of Y" health indicators use `role="meter"`:

```tsx
<div
  role="meter"
  aria-label={`Salud ${score} de 100`}
  aria-valuenow={score}
  aria-valuemin={0}
  aria-valuemax={100}
>
  <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
    <div className="h-full bg-success" style={{ width: `${score}%` }} />
  </div>
</div>
```

Use `<Progress>` from shadcn only for task progress (% of completion).

---

## State machine patterns

Every list should handle 3+ states:

```tsx
if (loading) return <LoadingGrid rows={5} />;
if (error) return <EmptyState icon={AlertTriangle} title="Error al cargar" description={error} />;
if (rows.length === 0) return <EmptyState icon={MyIcon} title="Sin resultados" description="..." />;
return <YourList rows={rows} />;
```

---

## Adding a new shared component

Before creating a new file in `src/components/shared/`:

1. **Is it reused in 3+ places?** If no, keep it inline.
2. **Does a shadcn primitive exist?** Use that first.
3. **Can it extend an existing shared component?** Prefer composition.
4. **Does it have clear props?** Define a TypeScript interface.

When you do add one:
- Add entry to this doc (component catalog table)
- Include JSDoc with usage example
- Use semantic tokens only
- Support light/dark mode automatically (no hardcoded colors)
- Keyboard accessible (focus-visible ring)
- Screen reader accessible (aria-labels on icons)

---

## Current state (2026-04-12)

✅ **Clean:**
- 0 raw Tailwind colors (except test files)
- 0 raw `<input>` / `<textarea>` / `<select>` elements in `src/app/`
- All directors use semantic domain tokens
- All forms use `Label` + `htmlFor`
- All pages use `PageHeader` + `EmptyState` + `LoadingGrid`

🚧 **In progress:**
- Migrating 20+ remaining div-card duplicates to `<LinkCard>`
- Tokenizing chart colors in `recharts` components
- Adding `aria-label` sweep to icon-only buttons

**Enforcement:** Every PR should not increase hardcoded color count or add raw HTML form elements. Run:
```bash
grep -rnE "bg-(red|blue|green|yellow|orange|amber|emerald)-\d+" src/ | grep -v test
grep -rn "<input type" src/app
```
Both should return zero results.
