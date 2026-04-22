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
    | "alert-circle"
    | "ban"
    | "ghost"
    | "check-circle-2"
    | "x-circle"
    | "clock"
    | "file-check"
    | "file-x"
    | "link"
    | "unlink";
};

export function resolveStatusBadge(
  input: StatusBadgeInput
): StatusBadgeResolved | null {
  switch (input.kind) {
    case "severity": {
      const colorMap = {
        critical: "critical",
        high:     "warning",
        medium:   "warning",
        low:      "muted",
      } as const satisfies Record<typeof input.value, StatusColor>;
      const labelMap = {
        critical: "Severidad crítica",
        high:     "Severidad alta",
        medium:   "Severidad media",
        low:      "Severidad baja",
      } as const;
      const label = labelMap[input.value];
      return { color: colorMap[input.value], label, ariaLabel: label, icon: "alert-circle" };
    }

    case "blacklist": {
      if (input.value === "none") return null;
      const label =
        input.value === "69b_definitivo"
          ? "Lista negra 69B definitivo"
          : "Lista negra 69B presunto";
      const color: StatusColor =
        input.value === "69b_definitivo" ? "critical" : "warning";
      return { color, label, ariaLabel: label, icon: "ban" };
    }

    case "shadow": {
      if (!input.value) return null;
      const label = "Empresa sombra — no confirmada en Odoo";
      return { color: "warning", label, ariaLabel: label, icon: "ghost" };
    }

    case "payment": {
      const map = {
        paid:       { color: "ok"       as const, label: "Pagada",             icon: "check-circle-2" as const },
        partial:    { color: "warning"  as const, label: "Pago parcial",       icon: "clock"          as const },
        not_paid:   { color: "critical" as const, label: "Sin pagar",          icon: "x-circle"       as const },
        in_payment: { color: "info"     as const, label: "En proceso de pago", icon: "clock"          as const },
      } as const;
      const e = map[input.value];
      return { ...e, ariaLabel: e.label };
    }

    case "estado_sat": {
      const map = {
        vigente:   { color: "ok"       as const, label: "CFDI vigente",   icon: "file-check" as const },
        cancelado: { color: "critical" as const, label: "CFDI cancelado", icon: "file-x"     as const },
      } as const;
      const e = map[input.value];
      return { ...e, ariaLabel: e.label };
    }

    case "match": {
      const color: StatusColor =
        input.value >= 0.9 ? "ok"
        : input.value >= 0.6 ? "warning"
        : "critical";
      const label =
        input.value >= 0.9 ? "Match de alta confianza"
        : input.value >= 0.6 ? "Match de confianza media"
        : "Match de baja confianza";
      const icon = color === "ok" ? "link" : ("unlink" as const);
      return { color, label, ariaLabel: label, icon };
    }

    case "staleness": {
      if (input.value === "fresh") {
        return { color: "ok", label: "Datos recientes", ariaLabel: "Datos recientes", icon: "clock" };
      }
      return { color: "critical", label: "Datos desactualizados", ariaLabel: "Datos desactualizados", icon: "clock" };
    }

    case "reconciliation": {
      if (input.value === "matched") {
        return { color: "ok", label: "Reconciliado", ariaLabel: "Reconciliado", icon: "link" };
      }
      return { color: "info", label: "Sin reconciliar", ariaLabel: "Sin reconciliar", icon: "unlink" };
    }

    case "generic":
      return { color: "muted", label: input.value, ariaLabel: input.value };
  }
}
