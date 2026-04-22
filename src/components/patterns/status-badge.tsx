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
