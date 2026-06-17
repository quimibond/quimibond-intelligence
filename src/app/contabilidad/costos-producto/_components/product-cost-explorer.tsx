"use client";

import { useMemo, useState } from "react";
import type {
  ProductCostCatalog,
  ProductCostRow,
} from "@/lib/queries/sp13/finanzas/product-cost-catalog";
import { DataCsvButton } from "@/components/patterns";
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

const FAMILIAS = [
  "Todas",
  "Tela acabado (m)",
  "Tela greige (kg)",
  "Entretela tejida",
  "Entretela carda",
  "importado",
  "Otro",
];

const LIMIT = 200;

export function ProductCostExplorer({ data }: { data: ProductCostCatalog }) {
  const [q, setQ] = useState("");
  const [fam, setFam] = useState("Todas");

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
        <strong>margen absorbido</strong> = precio − costo total con fijos.
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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Clave</th>
              <th className="px-3 py-2 text-left">Familia</th>
              <th className="px-3 py-2 text-right">UoM</th>
              <th className="px-3 py-2 text-right">MP</th>
              <th className="px-3 py-2 text-right">Energía</th>
              <th className="px-3 py-2 text-right">Costo var.</th>
              <th className="px-3 py-2 text-right">Fab. abs.</th>
              <th className="px-3 py-2 text-right">Costo abs. (s/op)</th>
              <th className="px-3 py-2 text-right">Precio</th>
              <th className="px-3 py-2 text-right">Contrib.</th>
              <th className="px-3 py-2 text-right">CM %</th>
              <th className="px-3 py-2 text-right">Margen abs.</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r: ProductCostRow) => (
              <tr key={r.internalRef} className="border-t align-top">
                <td className="px-3 py-1.5">
                  <div className="font-medium">{r.internalRef}</div>
                  <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                    {r.name}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-xs">{r.familia}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{r.uom}</td>
                <td className="px-3 py-1.5 text-right">{fM(r.mpUnitMxn)}</td>
                <td className="px-3 py-1.5 text-right">{fM(r.energiaUnitMxn)}</td>
                <td className="px-3 py-1.5 text-right font-medium">{fM(r.costoVariableUnitMxn)}</td>
                <td className="px-3 py-1.5 text-right">{fM(r.fabAbsorbidoUnitMxn)}</td>
                <td className="px-3 py-1.5 text-right">{fM(r.costoProdAbsorbidoUnitMxn)}</td>
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
                <td className="px-3 py-1.5 text-right">{fM(r.contribucionUnitMxn)}</td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right font-semibold",
                    (r.cmPct ?? 0) < 0 ? "text-red-600" : "text-emerald-600",
                  )}
                >
                  {fP(r.cmPct)}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right",
                    (r.margenAbsorbidoPct ?? 0) < 0
                      ? "text-red-600"
                      : "text-muted-foreground",
                  )}
                >
                  {fP(r.margenAbsorbidoPct)}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">
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
