"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type {
  CashFlowCategoryTotal,
  CashProjection,
  MonteCarloResult,
} from "@/lib/queries/sp13/finanzas";

interface Props {
  projection: CashProjection;
  monteCarlo: MonteCarloResult;
}

const CATEGORY_LABELS: Record<string, { label: string; hint: string }> = {
  ar_cobranza: {
    label: "Cobranza AR (factura emitida)",
    hint: "Bajar ⇒ clientes pagan menos / más tarde de lo esperado.",
  },
  ar_intercompania: {
    label: "AR a partes relacionadas",
    hint: "Cobranza intercompañía. Normalmente fuera del horizonte (180d push).",
  },
  ventas_confirmadas: {
    label: "SO pipeline (delivered + undelivered)",
    hint: "Pipeline ya comprometido. Bajar = cancelaciones / retrasos.",
  },
  runrate_clientes: {
    label: "Run rate clientes (demanda nueva)",
    hint: "Compras esperadas no comprometidas. Más volátil.",
  },
  ap_proveedores: {
    label: "AP a proveedores",
    hint: "Bajar ⇒ extender plazos. Subir ⇒ pagar a tiempo o anticipado.",
  },
  ap_intercompania: {
    label: "AP intercompañía",
    hint: "Pagos a partes relacionadas. Default fuera del horizonte.",
  },
  runrate_proveedores: {
    label: "Run rate proveedores (compras nuevas)",
    hint: "Compras nuevas esperadas. Bajar = freno operativo.",
  },
  nomina: {
    label: "Nómina (sueldos)",
    hint: "Crítico operativo. Variar solo en escenarios extremos.",
  },
  renta: { label: "Renta del local", hint: "Recurrente operativo." },
  servicios: {
    label: "Servicios (energía, agua, mtto)",
    hint: "Recurrente operativo.",
  },
  arrendamiento: {
    label: "Arrendamiento financiero",
    hint: "Pago a leasings. Difícil de variar.",
  },
  impuestos_sat: {
    label: "Impuestos SAT (IMSS + ISR)",
    hint: "Día 17. Atrasarlo genera intereses moratorios.",
  },
  sar_infonavit: {
    label: "SAR + INFONAVIT (bimestral)",
    hint: "Cuotas patronales bimestrales.",
  },
};

const PRESETS: Array<{
  name: string;
  description: string;
  apply: (cats: string[]) => Record<string, number>;
}> = [
  {
    name: "Reset",
    description: "Vuelve al baseline (todos los multiplicadores = 1.0).",
    apply: () => ({}),
  },
  {
    name: "Stress moderado",
    description:
      "Cobranza −20%, SO −10%, run rate clientes −15%, AP +0%, sueldos +0%. Simula deterioro AR.",
    apply: () => ({
      ar_cobranza: 0.8,
      ventas_confirmadas: 0.9,
      runrate_clientes: 0.85,
    }),
  },
  {
    name: "Stress agresivo",
    description:
      "Cobranza −35%, SO −20%, run rate −25%, AP +10% (proveedores cobran más rápido). Crisis AR + presión liquidez.",
    apply: () => ({
      ar_cobranza: 0.65,
      ventas_confirmadas: 0.8,
      runrate_clientes: 0.75,
      ap_proveedores: 1.1,
      runrate_proveedores: 1.05,
    }),
  },
  {
    name: "Optimista",
    description:
      "Cobranza +10%, SO +5%, run rate +10%. Si todos los inflows mejoran 5-10%.",
    apply: () => ({
      ar_cobranza: 1.1,
      ventas_confirmadas: 1.05,
      runrate_clientes: 1.1,
    }),
  },
  {
    name: "Recesión textil",
    description:
      "Run rate clientes −30%, SO pipeline −20%, run rate proveedores −20%. Demanda baja generalizada.",
    apply: () => ({
      runrate_clientes: 0.7,
      ventas_confirmadas: 0.8,
      runrate_proveedores: 0.8,
    }),
  },
];

export function ScenarioBuilder({ projection, monteCarlo }: Props) {
  const baselineClosing = projection.closingBalance;
  const opening = projection.openingBalance;
  const cats = projection.categoryTotals;

  const [multipliers, setMultipliers] = useState<Record<string, number>>({});

  const setMultiplier = (cat: string, value: number) => {
    setMultipliers((prev) => ({ ...prev, [cat]: value }));
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setMultipliers(preset.apply(cats.map((c) => c.category)));
  };

  const scenario = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const c of cats) {
      const m = multipliers[c.category] ?? 1.0;
      const adj = c.amountMxn * m;
      if (c.flowType === "inflow") inflow += adj;
      else outflow += adj;
    }
    const closing = opening + inflow - outflow;
    return { inflow, outflow, closing, delta: closing - baselineClosing };
  }, [multipliers, cats, opening, baselineClosing]);

  const safetyFloor = projection.safetyFloor;
  const belowFloor = scenario.closing < safetyFloor;

  // Identify modified components for badge display
  const modifiedCount = Object.values(multipliers).filter(
    (m) => Math.abs(m - 1.0) > 0.001
  ).length;

  return (
    <div className="space-y-4">
      {/* Hero stats: baseline vs scenario */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ScenarioStat
          label="Saldo proyectado · baseline"
          value={baselineClosing}
          hint={`P10 ${formatCurrencyMXN(monteCarlo.closingP10Mxn, { compact: true })} · P90 ${formatCurrencyMXN(monteCarlo.closingP90Mxn, { compact: true })}`}
        />
        <ScenarioStat
          label="Saldo proyectado · escenario"
          value={scenario.closing}
          tone={belowFloor ? "warning" : "default"}
          hint={
            modifiedCount === 0
              ? "Sin ajustes — igual al baseline"
              : `${modifiedCount} ajuste${modifiedCount === 1 ? "" : "s"} aplicado${modifiedCount === 1 ? "" : "s"}`
          }
        />
        <ScenarioStat
          label="Δ vs baseline"
          value={scenario.delta}
          showSign
          tone={
            scenario.delta < -100000
              ? "danger"
              : scenario.delta > 100000
                ? "success"
                : "default"
          }
          hint={
            belowFloor
              ? `⚠ bajo el piso (${formatCurrencyMXN(safetyFloor, { compact: true })})`
              : "Sobre el piso de seguridad"
          }
        />
      </div>

      {/* Presets */}
      <div className="rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Escenarios pre-definidos
        </div>
        <div className="flex flex-wrap gap-2 px-3 py-3 sm:px-4">
          {PRESETS.map((preset) => (
            <Button
              key={preset.name}
              variant="outline"
              size="sm"
              onClick={() => applyPreset(preset)}
              title={preset.description}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Per-category sliders */}
      <div className="rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Ajustes por componente · {cats.length} categorías
        </div>
        <div className="divide-y">
          {cats.map((cat) => {
            const meta = CATEGORY_LABELS[cat.category] ?? {
              label: cat.categoryLabel,
              hint: "",
            };
            const m = multipliers[cat.category] ?? 1.0;
            const isModified = Math.abs(m - 1.0) > 0.001;
            return (
              <CategorySlider
                key={cat.category}
                cat={cat}
                multiplier={m}
                isModified={isModified}
                label={meta.label}
                hint={meta.hint}
                onChange={(v) => setMultiplier(cat.category, v)}
              />
            );
          })}
        </div>
      </div>

      {/* Footer hint */}
      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-info">⚠ Modelo lineal:</span> El
        cálculo asume que escalar una categoría no cambia las otras (no hay
        feedback loops). Para escenarios con interacciones (ej: bajar AP →
        proveedores cancelan crédito → SO falla), iterar manualmente. La banda
        Monte Carlo del baseline (P10-P90) ya considera volatilidad típica.
      </div>
    </div>
  );
}

function ScenarioStat({
  label,
  value,
  hint,
  tone = "default",
  showSign,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "default" | "success" | "warning" | "danger";
  showSign?: boolean;
}) {
  const colorClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  }[tone];
  const sign = showSign ? (value >= 0 ? "+" : "") : "";
  return (
    <div className="rounded-md border bg-card p-3 sm:p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums sm:text-2xl", colorClass)}>
        {sign}
        {formatCurrencyMXN(value, { compact: true })}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function CategorySlider({
  cat,
  multiplier,
  isModified,
  label,
  hint,
  onChange,
}: {
  cat: CashFlowCategoryTotal;
  multiplier: number;
  isModified: boolean;
  label: string;
  hint: string;
  onChange: (v: number) => void;
}) {
  const adjusted = cat.amountMxn * multiplier;
  const delta = adjusted - cat.amountMxn;
  const isInflow = cat.flowType === "inflow";
  const cashImpact = isInflow ? delta : -delta;
  const sliderColor = isInflow ? "accent-success" : "accent-destructive";

  return (
    <div className="px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            <Badge
              variant="outline"
              className={`text-[10px] ${isInflow ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}`}
            >
              {isInflow ? "inflow" : "outflow"}
            </Badge>
            {isModified && (
              <Badge
                variant="outline"
                className="border-warning/40 bg-warning/5 text-[10px] text-warning"
              >
                ajustado
              </Badge>
            )}
          </div>
          {hint && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right text-xs">
          <div className="tabular-nums text-muted-foreground">
            base: {formatCurrencyMXN(cat.amountMxn, { compact: true })}
          </div>
          <div
            className={`tabular-nums font-semibold ${
              !isModified
                ? "text-foreground"
                : cashImpact > 0
                  ? "text-success"
                  : "text-destructive"
            }`}
          >
            {formatCurrencyMXN(adjusted, { compact: true })}
            {isModified && (
              <span className="ml-1 text-[10px] font-normal">
                ({cashImpact >= 0 ? "+" : ""}
                {formatCurrencyMXN(cashImpact, { compact: true })} cash)
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="text-[10px] tabular-nums text-muted-foreground">
          0.5×
        </span>
        <input
          type="range"
          min="0.5"
          max="1.5"
          step="0.05"
          value={multiplier}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className={`h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted ${sliderColor}`}
        />
        <span className="text-[10px] tabular-nums text-muted-foreground">
          1.5×
        </span>
        <span
          className={`w-12 shrink-0 text-right text-xs tabular-nums ${
            isModified ? "font-semibold text-foreground" : "text-muted-foreground"
          }`}
        >
          {(multiplier * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
