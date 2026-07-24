"use client";

import { useMemo, useState } from "react";
import type { CotizadorData } from "@/lib/queries/sp13/finanzas/cotizador";
import type { ProductCostRow } from "@/lib/queries/sp13/finanzas/product-cost-catalog";
import { cn } from "@/lib/utils";

/* ---------- formatters ---------- */
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});
const mxn = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const fU = (v: number | null) => (v == null ? "—" : usd.format(v));
const fM = (v: number | null) => (v == null ? "—" : mxn.format(v));
const fP = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;

const OP_PCT_FALLBACK = 0.18; // si el producto no tiene precio ref para derivar op%

/* ---------- small UI atoms ---------- */
function NumField({
  label,
  value,
  onChange,
  suffix,
  step = "any",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full rounded-md border px-2 py-1.5 text-sm tabular-nums"
        />
        {suffix && (
          <span className="text-xs text-muted-foreground">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "default",
  big = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "bad" | "warn";
  big?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "font-semibold tabular-nums",
          big ? "text-xl" : "text-base",
          tone === "good" && "text-emerald-600",
          tone === "bad" && "text-red-600",
          tone === "warn" && "text-amber-600",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ---------- main ---------- */
export function CotizadorClient({ data }: { data: CotizadorData }) {
  const { catalog, factors, fxMxnPerUsd, fxDate } = data;

  const [q, setQ] = useState("");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  // inputs de cotización
  const [fx, setFx] = useState<number>(Math.round(fxMxnPerUsd * 100) / 100);
  const [priceUsd, setPriceUsd] = useState<number>(1.8);
  const [rebatePct, setRebatePct] = useState<number>(5);
  const [marginPct, setMarginPct] = useState<number>(12);
  const [projVolume, setProjVolume] = useState<number>(0); // unidades/mes del proyecto
  const [useDilution, setUseDilution] = useState<boolean>(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return catalog.rows
      .filter(
        (r) =>
          (r.internalRef ?? "").toLowerCase().includes(needle) ||
          (r.name ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 30);
  }, [catalog.rows, q]);

  const row: ProductCostRow | null = useMemo(
    () => catalog.rows.find((r) => r.internalRef === selectedRef) ?? null,
    [catalog.rows, selectedRef],
  );

  /* -------- cálculo de cotización (por unidad, en USD) -------- */
  const calc = useMemo(() => {
    if (!row || !fx || fx <= 0) return null;
    const variableMxn = row.costoVariableUnitMxn ?? 0;
    const fabRefMxn = row.fabAbsorbidoUnitMxn ?? 0;
    const opRefMxn = row.opUnitMxn ?? 0;
    const precioRefMxn = row.precioRefMxn ?? 0;
    const kgPerUnit = row.kgPerUnit ?? 0;

    // op% = op_unit / precio_ref (el modelo reparte op como op_pct × precio).
    const opPct = precioRefMxn > 0 ? opRefMxn / precioRefMxn : OP_PCT_FALLBACK;

    // Dilución: el pool de fabricación es FIJO; si entra volumen nuevo, el mismo
    // pool se divide entre más kg → el factor (y el fab/unidad) baja proporcional.
    const addedKg =
      useDilution && projVolume > 0 && kgPerUnit > 0
        ? projVolume * kgPerUnit
        : 0;
    const D = factors?.kgInspeccion ?? 0;
    const dilutionRatio =
      addedKg > 0 && D > 0 ? D / (D + addedKg) : 1; // ≤ 1
    const fabMxn = fabRefMxn * dilutionRatio;

    const variableUsd = variableMxn / fx;
    const fabUsd = fabMxn / fx;
    const costoProdUsd = variableUsd + fabUsd;

    const rebate = (rebatePct || 0) / 100;
    const margin = (marginPct || 0) / 100;
    const netPriceUsd = (priceUsd || 0) * (1 - rebate);
    const opUsd = opPct * netPriceUsd;
    const costoTotalUsd = costoProdUsd + opUsd;

    const contributionUsd = netPriceUsd - variableUsd;
    const cmPct = netPriceUsd > 0 ? contributionUsd / netPriceUsd : null;
    const netMarginUsd = netPriceUsd - costoTotalUsd;
    const netMarginPct = netPriceUsd > 0 ? netMarginUsd / netPriceUsd : null;

    const pisoOciosoUsd = variableUsd; // neto mínimo con planta ociosa
    const pisoLlenoUsd = opPct < 1 ? costoProdUsd / (1 - opPct) : null; // neto margen 0
    const denom = 1 - opPct - margin;
    const precioSugeridoNetoUsd = denom > 0 ? costoProdUsd / denom : null;
    const precioListaSugeridoUsd =
      precioSugeridoNetoUsd != null && rebate < 1
        ? precioSugeridoNetoUsd / (1 - rebate)
        : precioSugeridoNetoUsd;

    return {
      opPct,
      dilutionRatio,
      addedKg,
      variableUsd,
      fabUsd,
      opUsd,
      costoProdUsd,
      costoTotalUsd,
      netPriceUsd,
      contributionUsd,
      cmPct,
      netMarginUsd,
      netMarginPct,
      pisoOciosoUsd,
      pisoLlenoUsd,
      precioSugeridoNetoUsd,
      precioListaSugeridoUsd,
    };
  }, [
    row,
    fx,
    priceUsd,
    rebatePct,
    marginPct,
    projVolume,
    useDilution,
    factors,
  ]);

  return (
    <div className="space-y-6">
      {/* --- barra de contexto --- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Catálogo:{" "}
          <strong className="text-foreground">
            {catalog.rows.length.toLocaleString("es-MX")}
          </strong>{" "}
          productos · costos del período{" "}
          <strong className="text-foreground">{catalog.period}</strong>
        </span>
        <span>
          FX de referencia:{" "}
          <strong className="text-foreground">
            {fxMxnPerUsd.toFixed(2)} MXN/USD
          </strong>
          {fxDate ? ` (${fxDate})` : ""}
        </span>
        {factors && (
          <span>
            Pool y volumen de <strong className="text-foreground">{factors.mes}</strong>
          </span>
        )}
      </div>

      {/* --- 1. Pool de gastos ÷ volumen --- */}
      {factors && (
        <section className="rounded-lg border bg-muted/20 p-4">
          <h2 className="mb-1 text-sm font-semibold">
            Gastos totales y el volumen entre el que se dividen
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            El pool de fabricación es <strong>fijo</strong> (MOD, overhead,
            arrendamiento de maquinaria, depreciación). Se reparte entre los kg
            producidos. Si entra volumen nuevo y llena capacidad ociosa, el mismo
            pool se divide entre más kg → el costo de fabricación por unidad{" "}
            <strong>baja</strong> para todos (dilución).
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Pool fabricación / mes"
              value={fM(factors.gastosFabMxn)}
              sub="fijo (MOD + OH + arrend. + deprec.)"
            />
            <Stat
              label="Volumen (denominador)"
              value={`${int.format(factors.kgInspeccion)} kg`}
              sub="kg inspeccionados / mes"
            />
            <Stat
              label="Factor fabricación"
              value={fM(factors.factorFabKg)}
              sub="por kg (suavizado 12m)"
            />
            <Stat
              label="Pool operación / mes"
              value={fM(factors.gastosOpMxn)}
              sub="6xx admin/ventas — escala con ventas"
            />
          </div>
        </section>
      )}

      {/* --- 2. Buscar producto --- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">1 · Elige el producto</h2>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Busca por clave o nombre (ej. WM4032, interlock, rib)…"
          className="w-full max-w-md rounded-md border px-3 py-2 text-sm"
        />
        {filtered.length > 0 && (
          <div className="max-h-56 max-w-md overflow-y-auto rounded-md border">
            {filtered.map((r) => (
              <button
                key={r.internalRef}
                onClick={() => {
                  setSelectedRef(r.internalRef);
                  setQ("");
                }}
                className="flex w-full items-center justify-between gap-2 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/50"
              >
                <span>
                  <span className="font-medium">{r.internalRef}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {r.name}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.familia} · {r.uom}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* --- 3. Producto seleccionado: costo + cotización --- */}
      {row && calc && (
        <>
          <section className="rounded-lg border p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">{row.internalRef}</h2>
                <p className="text-xs text-muted-foreground">{row.name}</p>
              </div>
              <span className="text-xs text-muted-foreground">
                {row.familia} · unidad: {row.uom} ·{" "}
                {row.kgPerUnit ? `${row.kgPerUnit.toFixed(3)} kg/u` : "sin peso"}
              </span>
            </div>

            {/* costo desglosado (vivo, BOM recursiva ya explotada) */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat
                label="MP (BOM recursiva)"
                value={fU(row.mpUnitMxn != null ? row.mpUnitMxn / fx : null)}
                sub={row.mpSource ?? undefined}
              />
              <Stat
                label="Energía"
                value={fU(
                  row.energiaUnitMxn != null ? row.energiaUnitMxn / fx : null,
                )}
                sub="variable"
              />
              <Stat
                label="Costo variable"
                value={fU(calc.variableUsd)}
                sub="= piso ocioso"
              />
              <Stat
                label={useDilution ? "Fabricación (diluida)" : "Fabricación"}
                value={fU(calc.fabUsd)}
                sub={
                  useDilution && calc.dilutionRatio < 1
                    ? `×${calc.dilutionRatio.toFixed(2)} por volumen`
                    : "absorbida"
                }
              />
              <Stat
                label="Operación"
                value={fU(calc.opUsd)}
                sub={`${fP(calc.opPct)} del precio`}
              />
              <Stat
                label="Precio ref. actual"
                value={fU(
                  row.precioRefMxn != null ? row.precioRefMxn / fx : null,
                )}
                sub={row.precioFuente ?? undefined}
              />
            </div>
            {row.mpBuckets.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                MP por receta:{" "}
                {row.mpBuckets
                  .map((b) => `${b.bucket} ${fU(b.costUnitMxn / fx)}`)
                  .join(" · ")}
              </p>
            )}
          </section>

          {/* inputs de cotización */}
          <section className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">
              2 · Cotiza (todo en USD por unidad)
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <NumField
                label="Precio lista"
                value={priceUsd}
                onChange={setPriceUsd}
                suffix="USD"
              />
              <NumField
                label="Rebate"
                value={rebatePct}
                onChange={setRebatePct}
                suffix="%"
              />
              <NumField
                label="Margen objetivo"
                value={marginPct}
                onChange={setMarginPct}
                suffix="%"
              />
              <NumField label="FX" value={fx} onChange={setFx} suffix="MXN/USD" />
              <NumField
                label={`Volumen proyecto (${row.uom}/mes)`}
                value={projVolume}
                onChange={setProjVolume}
              />
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-muted-foreground">
                  Diluir fabricación
                </span>
                <button
                  onClick={() => setUseDilution((v) => !v)}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-sm font-medium",
                    useDilution
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "text-muted-foreground",
                  )}
                >
                  {useDilution ? "Con volumen adentro" : "A volumen actual"}
                </button>
              </label>
            </div>
            {useDilution && calc.addedKg > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                +{int.format(calc.addedKg)} kg/mes al denominador → factor de
                fabricación ×{calc.dilutionRatio.toFixed(3)}. Válido si el
                proyecto llena capacidad <strong>ociosa</strong> sin fijos nuevos.
              </p>
            )}
          </section>

          {/* resultados */}
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Precio neto (post-rebate)"
                value={fU(calc.netPriceUsd)}
                tone="default"
              />
              <Stat
                label="Contribución"
                value={fU(calc.contributionUsd)}
                sub={`CM ${fP(calc.cmPct)}`}
                tone={
                  calc.contributionUsd != null && calc.contributionUsd < 0
                    ? "bad"
                    : "good"
                }
              />
              <Stat
                label="Margen neto"
                value={fP(calc.netMarginPct)}
                sub={fU(calc.netMarginUsd) + " / u"}
                tone={
                  calc.netMarginPct != null && calc.netMarginPct < 0
                    ? "bad"
                    : "good"
                }
              />
              <Stat
                label="Costo total"
                value={fU(calc.costoTotalUsd)}
                sub="variable + fab + op"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Piso ocioso"
                value={fU(calc.pisoOciosoUsd)}
                sub="no bajes de aquí (planta ociosa)"
                tone="warn"
              />
              <Stat
                label="Piso lleno (margen 0)"
                value={fU(calc.pisoLlenoUsd)}
                sub="no bajes de aquí (planta llena)"
                tone="warn"
              />
              <Stat
                label="Precio sugerido (neto)"
                value={fU(calc.precioSugeridoNetoUsd)}
                sub={`con ${marginPct}% de margen`}
              />
              <Stat
                label="Precio lista sugerido"
                value={fU(calc.precioListaSugeridoUsd)}
                sub="esto cotizas (antes del rebate)"
                tone="good"
                big
              />
            </div>

            <div
              className={cn(
                "rounded-lg border-l-4 bg-card px-4 py-3 text-sm font-medium",
                calc.netMarginPct != null && calc.netMarginPct >= 0
                  ? "border-emerald-500 text-emerald-700"
                  : calc.netPriceUsd > calc.variableUsd
                    ? "border-amber-500 text-amber-700"
                    : "border-red-500 text-red-700",
              )}
            >
              Veredicto a {fU(priceUsd)} lista / {rebatePct}% rebate:{" "}
              {calc.netMarginPct != null && calc.netMarginPct >= 0
                ? "Utilidad real — el precio cubre todo."
                : calc.netPriceUsd > calc.variableUsd
                  ? "Solo cubre con planta ociosa: aporta contribución pero no absorbe todos los fijos."
                  : "Pierdes dinero: el precio no cubre ni el costo variable."}
            </div>
          </section>
        </>
      )}

      {!row && (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Busca y elige un producto arriba para ver su costo vivo (BOM recursiva
          ya explotada) y cotizarlo.
        </p>
      )}

      <p className="text-[11px] leading-snug text-muted-foreground">
        Todo se lee en vivo del modelo de costos (mismo motor que{" "}
        <strong>/contabilidad/costos-producto</strong>): MP por explosión
        recursiva de la lista de materiales (sin captura manual), fabricación
        absorbida por proceso y operación como % de ventas. Contribución = precio
        − costo variable (decide con planta ociosa). Margen neto incluye los
        fijos absorbidos (decide con planta llena). La dilución reparte el pool
        fijo de fabricación entre el volumen nuevo del proyecto.
      </p>
    </div>
  );
}
