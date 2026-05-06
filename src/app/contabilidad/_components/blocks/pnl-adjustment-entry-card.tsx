"use client";

import { useState } from "react";
import { Copy, Check, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * Card de "Asiento de ajuste sugerido" para llevar 501.01.01 (AVCO al
 * despacho) al costo primo BOM-MP recursivo.
 *
 * Se basa en el residual = cogs501_01_01_actual − costoPrimo_BOM. Si el
 * residual es positivo, AVCO está por encima del BOM-MP (contaminación
 * AVCO histórica del PT pre-1-abril vía RSI56 + drift entre
 * canonical.avg_cost y MP real al despacho); el ajuste lo "limpia".
 *
 * IMPORTANTE: la cuenta contraparte la decide el contador según política.
 * El componente NO sugiere una específica para no inducir un asiento mal.
 *
 * Validación: invariante "Δ utilidad neta = residual 501.01.01" debe
 * cuadrar al peso. Si no, el cálculo upstream tiene un bug.
 */
export function PnlAdjustmentEntryCard({
  residual,
  netaContable,
  netaLimpio,
  cogs501_01_01,
  costoPrimo,
  periodLabel,
  monthEndIso,
}: {
  residual: number; // = cogs501_01_01 − costoPrimo
  netaContable: number;
  netaLimpio: number;
  cogs501_01_01: number;
  costoPrimo: number;
  periodLabel: string;
  monthEndIso: string; // YYYY-MM-DD del último día del período
}) {
  const [copied, setCopied] = useState(false);
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const deltaNeta = netaLimpio - netaContable;
  const invariantOk = Math.abs(deltaNeta - residual) < 10;
  const isPositive = residual >= 0;
  const absResidual = Math.abs(residual);

  // Asiento contable. Cr/Dr depende del signo:
  // - residual > 0: AVCO > BOM-MP → reducir 501.01.01 (Cr) y la contraparte (Dr)
  // - residual < 0: AVCO < BOM-MP → aumentar 501.01.01 (Dr) y la contraparte (Cr)
  const asiento = [
    `Journal:    CAPA DE VALORACIÓN  (o "Ajustes contables")`,
    `Fecha:      ${monthEndIso}`,
    `Concepto:   Ajuste 501.01.01 a costo primo BOM-MP recursivo (${periodLabel})`,
    ``,
    `Líneas:`,
    isPositive
      ? `  Cr  501.01.01  Cost of sales                          ${fmtFull(absResidual)}`
      : `  Dr  501.01.01  Cost of sales                          ${fmtFull(absResidual)}`,
    isPositive
      ? `  Dr  __________  [tu cuenta contraparte]                ${fmtFull(absResidual)}`
      : `  Cr  __________  [tu cuenta contraparte]                ${fmtFull(absResidual)}`,
    ``,
    `Efecto en utilidad neta:`,
    `  Antes (contable Odoo):  ${fmtFull(netaContable)}`,
    `  Después del ajuste:     ${fmtFull(netaLimpio)}`,
    `  Δ:                      ${deltaNeta >= 0 ? "+" : ""}${fmtFull(deltaNeta)}`,
  ].join("\n");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(asiento);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore (browser without clipboard API or denied)
    }
  };

  if (Math.abs(residual) < 100) {
    // Régimen estable: AVCO ≈ BOM. No hay ajuste útil.
    return (
      <Card className="border-success/40 bg-success/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" />
            Asiento de ajuste — ${periodLabel}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            <strong>No requiere ajuste.</strong> El residual entre 501.01.01
            AVCO ({fmtFull(cogs501_01_01)}) y el BOM-MP recursivo (
            {fmtFull(costoPrimo)}) es despreciable ({fmtFull(residual)}).
            Régimen estable.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(isPositive ? "border-warning/40" : "border-info/40")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" />
          Asiento de ajuste sugerido — {periodLabel}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Δ utilidad neta entre P&L contable Odoo y P&L limpio (régimen
          BOM-MP). Postear este asiento en Odoo deja la utilidad neta
          alineada al costo primo recursivo, eliminando contaminación AVCO
          histórica + drift de canonical.avg_cost vs MP real.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Hero: monto del ajuste */}
        <div className="rounded-md border bg-muted/30 px-3 py-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Monto a postear
          </div>
          <div
            className={cn(
              "mt-1 text-2xl font-bold tabular-nums",
              isPositive ? "text-warning" : "text-info"
            )}
          >
            {fmtFull(absResidual)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Cálculo: 501.01.01 AVCO {fmtFull(cogs501_01_01)} − BOM-MP{" "}
            {fmtFull(costoPrimo)} ={" "}
            <span
              className={cn(
                "font-medium",
                isPositive ? "text-warning" : "text-info"
              )}
            >
              {residual >= 0 ? "+" : ""}
              {fmtFull(residual)}
            </span>
          </div>
        </div>

        {/* Asiento sugerido */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Asiento contable</span>
            <Button
              variant="outline"
              size="sm"
              onClick={onCopy}
              className="h-7 gap-1.5 text-xs"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-success" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copiar al portapapeles
                </>
              )}
            </Button>
          </div>
          <pre className="rounded-md bg-muted/50 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {asiento}
          </pre>
        </div>

        {/* Validación de invariante */}
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-[11px]",
            invariantOk
              ? "border-success/40 bg-success/5 text-success"
              : "border-destructive/40 bg-destructive/5 text-destructive"
          )}
        >
          <strong>Invariante:</strong> Δ utilidad neta ({fmtFull(deltaNeta)}){" "}
          debe igualar residual 501.01.01 ({fmtFull(residual)}).
          {invariantOk
            ? " ✓ Cuadra al peso."
            : ` ⚠ Drift de ${fmtFull(deltaNeta - residual)} — revisar.`}
        </div>

        <p className="text-[11px] text-muted-foreground leading-snug">
          <strong>Cuenta contraparte:</strong> la elige el contador según
          política. Opciones comunes: <code>504.01.0099 Overhead absorbido</code>{" "}
          (cuenta de cierre, refleja MOD+OH absorbido vía RSI56 pre-abril);{" "}
          <code>115.04.01 Inventario PT</code> (revaluación PT en almacén);
          o <code>701.99 Otros ingresos extraordinarios</code> (one-off del
          período). NO sugerimos una específica para no inducir un asiento
          mal-clasificado.
        </p>
      </CardContent>
    </Card>
  );
}
