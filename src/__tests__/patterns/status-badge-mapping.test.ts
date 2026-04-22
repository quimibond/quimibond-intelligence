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
