"use client";

import { Fragment, useMemo, useState } from "react";
import type {
  PoolComponent,
  ProductCostCatalog,
  ProductCostRow,
} from "@/lib/queries/sp13/finanzas/product-cost-catalog";
import { DataCsvButton } from "@/components/patterns/report-export";
import { cn } from "@/lib/utils";

const CSV_COLUMNS = [
  { key: "ref", label: "Clave" },
  { key: "nombre", label: "Producto" },
  { key: "familia", label: "Familia" },
  { key: "uom", label: "UoM" },
  { key: "kg_por_unidad", label: "Kg por unidad" },
  { key: "mp", label: "MP (último costo)" },
  { key: "energia", label: "Energía (variable)" },
  { key: "costo_variable", label: "Costo variable" },
  { key: "costo_variable_kg", label: "Costo variable $/kg" },
  { key: "contribucion_kg", label: "Contribución $/kg" },
  { key: "fab_absorbido", label: "Fabricación absorbida" },
  { key: "costo_abs_sin_op", label: "Costo absorbido (sin op)" },
  { key: "operacion", label: "Operación" },
  { key: "costo_total_absorbido", label: "Costo total absorbido" },
  { key: "precio", label: "Precio referencia" },
  { key: "precio_fuente", label: "Fuente precio" },
  { key: "contribucion", label: "Contribución unit" },
  { key: "cm_pct", label: "Margen contribución %" },
  { key: "margen_absorbido_pct", label: "Margen absorbido %" },
  { key: "mp_fuente", label: "Fuente MP" },
];

function toCsvRows(rows: ProductCostRow[]): Record<string, unknown>[] {
  const r2 = (v: number | null) =>
    v == null ? "" : Math.round(v * 100) / 100;
  return rows.map((r) => ({
    ref: r.internalRef ?? "",
    nombre: r.name ?? "",
    familia: r.familia ?? "",
    uom: r.uom ?? "",
    kg_por_unidad: r.kgPerUnit ?? "",
    mp: r2(r.mpUnitMxn),
    energia: r2(r.energiaUnitMxn),
    costo_variable: r2(r.costoVariableUnitMxn),
    costo_variable_kg: r2(perKg(r.costoVariableUnitMxn, r.kgPerUnit)),
    contribucion_kg: r2(perKg(r.contribucionUnitMxn, r.kgPerUnit)),
    fab_absorbido: r2(r.fabAbsorbidoUnitMxn),
    costo_abs_sin_op: r2(r.costoProdAbsorbidoUnitMxn),
    operacion: r2(r.opUnitMxn),
    costo_total_absorbido: r2(r.costoTotalAbsorbidoUnitMxn),
    precio: r2(r.precioRefMxn),
    precio_fuente: r.precioFuente ?? "",
    contribucion: r2(r.contribucionUnitMxn),
    cm_pct: r.cmPct ?? "",
    margen_absorbido_pct: r.margenAbsorbidoPct ?? "",
    mp_fuente: r.mpSource ?? "",
  }));
}

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fM = (v: number | null) => (v == null ? "—" : money.format(v));
const fP = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
/** Convierte un valor $/unidad a $/kg usando el peso del producto. */
const perKg = (v: number | null, kg: number | null) =>
  v == null || !kg || kg <= 0 ? null : v / kg;

const FAMILIAS = [
  "Todas",
  "Tela acabado (m)",
  "Tela por kg",
  "Entretela tejida",
  "Entretela carda",
  "importado",
  "Otro",
];

const LIMIT = 200;

/** Detalle desglosado de un producto: MP por receta + componentes de fab y op. */
function CostDetail({
  row,
  fabComposition,
  opComposition,
}: {
  row: ProductCostRow;
  fabComposition: PoolComponent[];
  opComposition: PoolComponent[];
}) {
  const mpTotal = row.mpUnitMxn ?? 0;
  const fab = row.fabAbsorbidoUnitMxn ?? 0;
  const op = row.opUnitMxn ?? 0;
  const Bar = ({ items }: { items: { label: string; v: number; pct: number }[] }) => (
    <table className="w-full text-xs">
      <tbody>
        {items.map((it) => (
          <tr key={it.label} className="border-t border-border/40">
            <td className="py-1 pr-2">{it.label}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{fM(it.v)}</td>
            <td className="w-24 py-1 text-right text-muted-foreground tabular-nums">
              {it.pct.toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const mpItems = row.mpBuckets.map((b) => ({
    label: b.bucket,
    v: b.costUnitMxn,
    pct: mpTotal ? (b.costUnitMxn / mpTotal) * 100 : 0,
  }));
  const fabItems = fab
    ? fabComposition.map((c) => ({
        label: c.component,
        v: fab * c.share,
        pct: c.share * 100,
      }))
    : [];
  const opItems = op
    ? opComposition.map((c) => ({
        label: c.component,
        v: op * c.share,
        pct: c.share * 100,
      }))
    : [];
  return (
    <div className="grid gap-6 bg-muted/30 px-4 py-4 md:grid-cols-3">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          Materia prima · {fM(mpTotal)}/u
        </div>
        {mpItems.length ? (
          <Bar items={mpItems} />
        ) : (
          <p className="text-xs text-muted-foreground">Sin desglose de receta.</p>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          Fabricación · {fM(fab)}/u
        </div>
        {fabItems.length ? (
          <Bar items={fabItems} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Sin fabricación (importado / sin proceso).
          </p>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          Operación · {fM(op)}/u
        </div>
        {opItems.length ? <Bar items={opItems} /> : <p className="text-xs text-muted-foreground">—</p>}
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          Fabricación y operación se desglosan en proporción al pool GL (mismo mix
          para todos). La energía (luz+gas+agua) es la porción variable dentro de
          fabricación.
        </p>
      </div>
    </div>
  );
}

export function ProductCostExplorer({ data }: { data: ProductCostCatalog }) {
  const [q, setQ] = useState("");
  const [fam, setFam] = useState("Todas");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (fam !== "Todas" && r.familia !== fam) return false;
      if (!needle) return true;
      return (
        (r.internalRef ?? "").toLowerCase().includes(needle) ||
        (r.name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data.rows, q, fam]);

  const shown = filtered.slice(0, LIMIT);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {data.rows.length.toLocaleString("es-MX")} productos · costos del período{" "}
        <strong>{data.period}</strong>. Costo variable = MP (último costo) +
        energía. Fabricación absorbida por proceso (tela/entretela). Precio =
        promedio realizado 12m (o lista/AVCO si no se ha vendido).{" "}
        <strong>Contribución</strong> = precio − costo variable (decisión);{" "}
        <strong>margen absorbido</strong> = precio − costo total con fijos.{" "}
        <span className="text-foreground">
          Haz clic en un producto para ver el desglose completo (MP por receta,
          fabricación y operación por componente).
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por clave o nombre…"
          className="w-72 rounded-md border px-3 py-2 text-sm"
        />
        <select
          value={fam}
          onChange={(e) => setFam(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {FAMILIAS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {filtered.length.toLocaleString("es-MX")} resultados
          {filtered.length > LIMIT ? ` (mostrando ${LIMIT})` : ""}
        </span>
        <DataCsvButton
          rows={toCsvRows(filtered)}
          columns={CSV_COLUMNS}
          filename="costos-por-producto"
          label="Exportar CSV"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Decisión = margen de contribución</strong> (precio − costo
        variable). Las columnas marcadas con * son de <strong>absorción</strong>:
        incluyen el prorrateo de costos FIJOS (MOD plantilla, renta, depreciación)
        por unidad — sirven para el P&L de largo plazo, NO para decidir si vender
        un metro más. <strong>Costo total*</strong> = MP + fabricación + operación
        (todo incluido); <strong>Margen total*</strong> = precio − costo total.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Clave</th>
              <th className="px-3 py-2 text-left">Familia</th>
              <th className="px-3 py-2 text-right">UoM</th>
              <th className="px-3 py-2 text-right">Precio</th>
              <th className="px-3 py-2 text-right">MP</th>
              <th className="px-3 py-2 text-right">Energía</th>
              <th className="px-3 py-2 text-right">Costo variable</th>
              <th className="px-3 py-2 text-right">Costo var. $/kg</th>
              <th className="px-3 py-2 text-right">Contribución</th>
              <th className="px-3 py-2 text-right">Contrib. $/kg</th>
              <th className="px-3 py-2 text-right">CM %</th>
              <th className="border-l px-3 py-2 text-right">Fab. fijos*</th>
              <th className="px-3 py-2 text-right">Operación*</th>
              <th className="px-3 py-2 text-right">Costo total*</th>
              <th className="px-3 py-2 text-right">Margen total*</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r: ProductCostRow) => (
              <Fragment key={r.internalRef}>
              <tr
                className="cursor-pointer border-t align-top hover:bg-muted/40"
                onClick={() =>
                  setExpanded(expanded === r.internalRef ? null : r.internalRef)
                }
              >
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1 font-medium">
                    <span className="text-muted-foreground">
                      {expanded === r.internalRef ? "▾" : "▸"}
                    </span>
                    {r.internalRef}
                  </div>
                  <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                    {r.name}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-xs">{r.familia}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{r.uom}</td>
                <td className="px-3 py-1.5 text-right">
                  {fM(r.precioRefMxn)}
                  {r.precioFuente && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {r.precioFuente === "venta_prom_12m"
                        ? "venta"
                        : r.precioFuente}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">{fM(r.mpUnitMxn)}</td>
                <td className="px-3 py-1.5 text-right">{fM(r.energiaUnitMxn)}</td>
                <td className="px-3 py-1.5 text-right font-medium">{fM(r.costoVariableUnitMxn)}</td>
                <td className="px-3 py-1.5 text-right">{fM(perKg(r.costoVariableUnitMxn, r.kgPerUnit))}</td>
                <td className="px-3 py-1.5 text-right font-semibold">{fM(r.contribucionUnitMxn)}</td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right font-semibold",
                    (perKg(r.contribucionUnitMxn, r.kgPerUnit) ?? 0) < 0
                      ? "text-red-600"
                      : "text-emerald-600",
                  )}
                >
                  {fM(perKg(r.contribucionUnitMxn, r.kgPerUnit))}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right font-semibold",
                    (r.cmPct ?? 0) < 0 ? "text-red-600" : "text-emerald-600",
                  )}
                >
                  {fP(r.cmPct)}
                </td>
                <td className="border-l px-3 py-1.5 text-right text-muted-foreground">{fM(r.fabAbsorbidoUnitMxn)}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{fM(r.opUnitMxn)}</td>
                <td className="px-3 py-1.5 text-right font-semibold">{fM(r.costoTotalAbsorbidoUnitMxn)}</td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right",
                    (r.margenAbsorbidoPct ?? 0) < 0
                      ? "text-red-600/70"
                      : "text-muted-foreground",
                  )}
                >
                  {fP(r.margenAbsorbidoPct)}
                </td>
              </tr>
              {expanded === r.internalRef && (
                <tr className="border-t-0">
                  <td colSpan={15} className="p-0">
                    <CostDetail
                      row={r}
                      fabComposition={data.fabComposition}
                      opComposition={data.opComposition}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-6 text-center text-muted-foreground">
                  Sin resultados. Prueba otra búsqueda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
