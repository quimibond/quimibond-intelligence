"use client";

import React, { useState } from "react";
import { Copy, Check, Receipt, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * Card de "Asiento de ajuste sugerido" para llevar 501.01.01 (AVCO al
 * despacho) al costo primo BOM-MP recursivo.
 *
 * IMPORTANTE — anti-duplicación de CAPA:
 *   El saldo de 501.01.01 que viene de canonical_account_balances YA
 *   INCLUYE las líneas posteadas en el journal "CAPA DE VALORACIÓN" del
 *   período. Por eso el `residual = cogs501_01_01 − costoPrimo_BOM` es
 *   YA el ajuste pendiente NETO (no hay que restar CAPA otra vez).
 *
 *   Se muestra explícitamente la CAPA ya posteada para que el contador
 *   sepa cuánto ya se ajustó en el período y no duplique. Si CAPA ya
 *   posteada > 0 y residual también > 0, falta más ajuste. Si CAPA > 0
 *   y residual < 0, ya se sobre-ajustó.
 *
 * Validación: invariante "Δ utilidad neta = residual 501.01.01" debe
 * cuadrar al peso. Si no, el cálculo upstream tiene un bug.
 */
export interface DupBreakdownItem {
  prefix: string;
  label: string;
  amount: number;
  nLines: number;
}

export function PnlAdjustmentEntryCard({
  residual,
  netaContable,
  netaLimpio,
  cogs501_01_01,
  costoPrimo,
  capaPosteada,
  dupInventoryAmount,
  dupBreakdown,
  shrinkRefaccionesAmount,
  periodLabel,
  monthEndIso,
}: {
  residual: number; // = cogs501_01_01 − costoPrimo  (POST-CAPA)
  netaContable: number;
  netaLimpio: number;
  cogs501_01_01: number; // saldo 501.01.01 post-CAPA (lo que ve Odoo)
  costoPrimo: number; // BOM-MP recursivo
  capaPosteada: number; // SUM(amount_total) journal CAPA DE VALORACIÓN período
  dupInventoryAmount: number; // duplicación inventario→501.01.02 total (TVAR+ENC+SP+REQP+otros)
  dupBreakdown: DupBreakdownItem[]; // desglose por prefijo
  shrinkRefaccionesAmount: number; // refacciones duplicadas en 501.01.08 (shrinkage)
  periodLabel: string;
  monthEndIso: string;
}) {
  const [copied, setCopied] = useState(false);
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const deltaNeta = netaLimpio - netaContable;
  // Δ utilidad neta = residual 501.01.01 + reverso 501.01.02 dup + reverso 501.01.08 refacciones
  const expectedDelta = residual + dupInventoryAmount + shrinkRefaccionesAmount;
  const invariantOk = Math.abs(deltaNeta - expectedDelta) < 10;
  const isPositive = residual >= 0;
  const absResidual = Math.abs(residual);
  const hasDup = dupInventoryAmount > 100;
  const hasShrinkRef = Math.abs(shrinkRefaccionesAmount) > 100;
  // Saldo bruto pre-CAPA (informacional). canonical_account_balances ya
  // refleja el neto post-CAPA, así que el bruto = post + capa_posteada.
  const saldoBrutoPreCapa = cogs501_01_01 + capaPosteada;
  const hasCapa = capaPosteada > 100;

  // Status del período:
  // - "stable": |residual| < $100, no requiere ajuste
  // - "over_corrected": CAPA ya posteada > 0 y residual < 0 → ajustó DE MÁS
  // - "pending_after_capa": CAPA > 0 y residual > 0 → falta MÁS ajuste
  // - "pending_no_capa": CAPA == 0 y residual ≠ 0 → ajuste fresco
  type Status = "stable" | "over_corrected" | "pending_after_capa" | "pending_no_capa";
  const status: Status =
    Math.abs(residual) < 100
      ? "stable"
      : hasCapa && residual < 0
        ? "over_corrected"
        : hasCapa && residual > 0
          ? "pending_after_capa"
          : "pending_no_capa";

  const statusBadge: Record<Status, { label: string; cls: string }> = {
    stable: { label: "Régimen estable", cls: "border-success/40 bg-success/10 text-success" },
    over_corrected: {
      label: "⚠ Over-corrected",
      cls: "border-warning/40 bg-warning/10 text-warning",
    },
    pending_after_capa: {
      label: "Pendiente (post-CAPA)",
      cls: "border-info/40 bg-info/10 text-info",
    },
    pending_no_capa: {
      label: "Pendiente (sin CAPA aún)",
      cls: "border-info/40 bg-info/10 text-info",
    },
  };

  const asientoLines: string[] = [
    `Journal:    CAPA DE VALORACIÓN  (o "Ajustes contables")`,
    `Fecha:      ${monthEndIso}`,
    `Concepto:   Ajustes 501.01 (período ${periodLabel})`,
    ``,
    `═══ ASIENTO 1: Ajuste 501.01.01 → BOM-MP recursivo ═══`,
    isPositive
      ? `  Cr  501.01.01  Cost of sales                          ${fmtFull(absResidual)}`
      : `  Dr  501.01.01  Cost of sales                          ${fmtFull(absResidual)}`,
    isPositive
      ? `  Dr  __________  [tu cuenta contraparte]                ${fmtFull(absResidual)}`
      : `  Cr  __________  [tu cuenta contraparte]                ${fmtFull(absResidual)}`,
    ``,
    `Contexto del período:`,
    `  Saldo bruto 501.01.01 pre-CAPA:  ${fmtFull(saldoBrutoPreCapa)}`,
    `  CAPA ya posteada en el período:  ${fmtFull(capaPosteada)}`,
    `  Saldo neto 501.01.01 post-CAPA:  ${fmtFull(cogs501_01_01)}  ← lo que ve Odoo`,
    `  − Costo primo BOM-MP recursivo:  ${fmtFull(costoPrimo)}`,
    `  = Ajuste pendiente neto:         ${fmtFull(residual)}  ← NO duplica CAPA`,
  ];
  if (hasShrinkRef) {
    const sign = shrinkRefaccionesAmount >= 0 ? "Cr" : "Dr";
    const opp = shrinkRefaccionesAmount >= 0 ? "Dr" : "Cr";
    const abs = Math.abs(shrinkRefaccionesAmount);
    asientoLines.push(
      ``,
      `═══ ASIENTO 3: Reverso refacciones en 501.01.08 ═══`,
      `  ${sign}  501.01.08  DIFERENCIAS POR CONTEO              ${fmtFull(abs)}`,
      `  ${opp}  __________  [cuenta puente / nueva cuenta de    ${fmtFull(abs)}`,
      `                       inventario operativo dedicada]`,
      ``,
      `Contexto:`,
      `  Ajustes manuales de inventario (Cantidad de producto`,
      `  actualizada) sobre productos refacción/operativos en`,
      `  501.01.08. Mismo bug que TVAR: las refacciones ya se`,
      `  contabilizaron al comprar como gasto, así que pegar`,
      `  el faltante a P&L es triple conteo.`,
      `  El shrinkage textil/MP real (~$200k YTD) sí se mantiene`,
      `  en el P&L como pérdida legítima.`
    );
  }
  if (hasDup) {
    asientoLines.push(
      ``,
      `═══ ASIENTO 2: Reverso duplicación inventario→501.01.02 ═══`,
      `  Cr  501.01.02  COSTO PRIMO                            ${fmtFull(dupInventoryAmount)}`,
      `  Dr  __________  [cuenta puente / nueva cuenta de       ${fmtFull(dupInventoryAmount)}`,
      `                   inventario operativo dedicada]`,
      ``,
      `Desglose por origen del movimiento:`,
      ...dupBreakdown.map(
        (b) =>
          `  ${(b.label + ":").padEnd(46)}${fmtFull(b.amount)}  (${b.nLines} líneas)`
      ),
      ``,
      `Contexto:`,
      `  Toda entrada Dr 501.01.02 / Cr 115.* duplica el costo`,
      `  bajo régimen actual: el P&L limpio usa BOM-MP recursivo`,
      `  que ya incluye estas MPs/refacciones/empaque vía AVCO`,
      `  de compras. Post-1-abril (RSI56 archivado), 501.01.02`,
      `  debería estar prácticamente vacía.`,
      `  Pending action:`,
      `  refacciones-tvar-doble-conteo-501-01-02`
    );
  }
  asientoLines.push(
    ``,
    `═══ EFECTO TOTAL EN UTILIDAD NETA ═══`,
    `  Antes (contable Odoo):     ${fmtFull(netaContable)}`,
    `  Después de los ajustes:    ${fmtFull(netaLimpio)}`,
    `  Δ:                          ${deltaNeta >= 0 ? "+" : ""}${fmtFull(deltaNeta)}`,
    hasDup || hasShrinkRef
      ? `      └─ ${fmtFull(residual)} (501.01.01)${hasDup ? ` + ${fmtFull(dupInventoryAmount)} (501.01.02 dup)` : ""}${hasShrinkRef ? ` + ${fmtFull(shrinkRefaccionesAmount)} (501.01.08 refacciones)` : ""}`
      : ``
  );
  const asiento = asientoLines.join("\n");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(asiento);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  if (status === "stable") {
    return (
      <Card className="border-success/40 bg-success/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" />
            Asiento de ajuste — {periodLabel}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            <strong>No requiere ajuste.</strong> El residual entre 501.01.01
            AVCO ({fmtFull(cogs501_01_01)}) y BOM-MP recursivo (
            {fmtFull(costoPrimo)}) es despreciable ({fmtFull(residual)}).
            Régimen estable.
            {hasCapa &&
              ` (Ya se posteó CAPA por ${fmtFull(capaPosteada)} en el período.)`}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        status === "over_corrected" ? "border-warning/40" : "border-info/40"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" />
              Asiento de ajuste sugerido — {periodLabel}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Δ utilidad neta entre P&L contable Odoo y P&L limpio (régimen
              BOM-MP). El ajuste sugerido <strong>NO duplica CAPA</strong> ya
              posteada — el residual está calculado sobre el saldo post-CAPA.
            </p>
          </div>
          <Badge variant="outline" className={statusBadge[status].cls}>
            {statusBadge[status].label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Hero: monto del ajuste */}
        <div className="rounded-md border bg-muted/30 px-3 py-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Monto a postear (NETO de CAPA ya aplicada)
          </div>
          <div
            className={cn(
              "mt-1 text-2xl font-bold tabular-nums",
              status === "over_corrected" ? "text-warning" : "text-info"
            )}
          >
            {fmtFull(absResidual)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {isPositive ? (
              <>Cr 501.01.01 (reduce el costo) / Dr cuenta contraparte</>
            ) : (
              <>Dr 501.01.01 (aumenta el costo) / Cr cuenta contraparte (reverso)</>
            )}
          </div>
        </div>

        {/* Desglose del cálculo */}
        <div className="rounded-md border bg-card px-3 py-3 text-xs">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Cálculo paso a paso
          </div>
          <div className="grid grid-cols-2 gap-y-1 tabular-nums">
            <span className="text-muted-foreground">Saldo bruto 501.01.01 pre-CAPA</span>
            <span className="text-right">{fmtFull(saldoBrutoPreCapa)}</span>

            <span className={cn("text-muted-foreground", hasCapa && "font-medium text-warning")}>
              − CAPA ya posteada en el período
            </span>
            <span
              className={cn(
                "text-right",
                hasCapa && "font-medium text-warning"
              )}
            >
              {fmtFull(capaPosteada)}
            </span>

            <span className="font-medium border-t pt-1">= Saldo neto 501.01.01 post-CAPA</span>
            <span className="text-right font-medium border-t pt-1">
              {fmtFull(cogs501_01_01)}
            </span>

            <span className="text-muted-foreground">− Costo primo BOM-MP recursivo</span>
            <span className="text-right">{fmtFull(costoPrimo)}</span>

            <span
              className={cn(
                "font-bold border-t pt-1",
                isPositive ? "text-info" : "text-warning"
              )}
            >
              = Ajuste pendiente neto
            </span>
            <span
              className={cn(
                "text-right font-bold border-t pt-1 tabular-nums",
                isPositive ? "text-info" : "text-warning"
              )}
            >
              {residual >= 0 ? "+" : ""}
              {fmtFull(residual)}
            </span>
          </div>
        </div>

        {/* Duplicación inventario→501.01.02 (TVAR + ENC + SP + REQP + otros) */}
        {hasDup && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-destructive text-sm">
                    Duplicación inventario → 501.01.02
                  </strong>
                  <Badge
                    variant="outline"
                    className="border-destructive/40 bg-destructive/10 text-destructive text-[10px]"
                  >
                    Asiento adicional
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Movimientos Dr 501.01.02 / Cr 115.* (refacciones, empaque,
                  encogimientos, requisiciones) que ya se contabilizaron al
                  comprar. Bajo el régimen actual (P&L limpio = BOM-MP
                  recursivo) son DOBLE CONTEO. Post-1-abril 2026 (RSI56
                  archivado), 501.01.02 debería estar prácticamente vacía.
                  Pending action:{" "}
                  <code className="text-[10px]">
                    refacciones-tvar-doble-conteo-501-01-02
                  </code>
                </p>
              </div>
            </div>
            <div className="rounded-md bg-card border px-3 py-2 mt-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Reverso a postear (todos los patrones del período)
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-destructive">
                {fmtFull(dupInventoryAmount)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Cr 501.01.02 (reduce duplicado) / Dr cuenta de inventario
                operativo dedicada (o cuenta puente provisional)
              </div>
            </div>
            {dupBreakdown.length > 0 && (
              <div className="mt-2 rounded-md bg-card border px-3 py-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Desglose por origen
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-[11px] tabular-nums">
                  {dupBreakdown.map((b) => (
                    <React.Fragment key={b.prefix}>
                      <span className="text-muted-foreground">
                        <code className="text-[10px] mr-1.5 px-1 rounded bg-muted">
                          {b.prefix}
                        </code>
                        {b.label}
                      </span>
                      <span className="text-right text-muted-foreground">
                        {b.nLines} líneas
                      </span>
                      <span className="text-right font-medium">
                        {fmtFull(b.amount)}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Refacciones duplicadas en 501.01.08 (shrinkage manual) */}
        {hasShrinkRef && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-destructive text-sm">
                    Refacciones duplicadas en 501.01.08 (shrinkage manual)
                  </strong>
                  <Badge
                    variant="outline"
                    className="border-destructive/40 bg-destructive/10 text-destructive text-[10px]"
                  >
                    Asiento adicional
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Ajustes manuales (&quot;Cantidad de producto actualizada&quot;)
                  sobre productos refacción/operativos. Mismo bug que TVAR:
                  ya se gastaron al comprar, así que pegar el faltante al
                  P&L es triple conteo. El shrinkage textil/MP real
                  (~$200k YTD) sí queda como pérdida legítima en el P&L.
                </p>
              </div>
            </div>
            <div className="rounded-md bg-card border px-3 py-2 mt-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Reverso 501.01.08 refacciones del período
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-destructive">
                {fmtFull(shrinkRefaccionesAmount)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {shrinkRefaccionesAmount >= 0
                  ? "Cr 501.01.08 / Dr cuenta puente (faltante neto)"
                  : "Dr 501.01.08 / Cr cuenta puente (sobrante neto, reverso)"}
              </div>
            </div>
          </div>
        )}

        {/* Aviso si over-corrected */}
        {status === "over_corrected" && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-[12px]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
              <div>
                <strong className="text-warning">
                  Atención: ya se posteó CAPA DE MÁS en este período.
                </strong>
                <p className="mt-1 text-muted-foreground">
                  Se posteó CAPA por {fmtFull(capaPosteada)} pero el residual
                  teórico vs BOM-MP es {fmtFull(saldoBrutoPreCapa - costoPrimo)}.
                  Excedente: {fmtFull(absResidual)}. Si quieres alinear
                  exactamente al BOM-MP, postear el reverso (Dr 501.01.01
                  / Cr contraparte) por {fmtFull(absResidual)}.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Aviso si pending after CAPA */}
        {status === "pending_after_capa" && (
          <div className="rounded-md border border-info/40 bg-info/5 p-3 text-[12px]">
            <strong>Ya se posteó CAPA por {fmtFull(capaPosteada)}</strong>{" "}
            pero falta más ajuste para alinear al BOM-MP. El monto de arriba
            ({fmtFull(absResidual)}) es lo que falta — NO incluye la CAPA ya
            posteada.
          </div>
        )}

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
          debe igualar residual 501.01.01 ({fmtFull(residual)})
          {hasDup &&
            ` + reverso 501.01.02 dup (${fmtFull(dupInventoryAmount)})`}
          {hasShrinkRef &&
            ` + reverso 501.01.08 refacciones (${fmtFull(shrinkRefaccionesAmount)})`}
          {" "}={" "}
          {fmtFull(expectedDelta)}.
          {invariantOk
            ? " ✓ Cuadra al peso."
            : ` ⚠ Drift de ${fmtFull(deltaNeta - expectedDelta)} — revisar.`}
        </div>

        <p className="text-[11px] text-muted-foreground leading-snug">
          <strong>Cuenta contraparte:</strong> la decide el contador.
          Opciones comunes:{" "}
          <code>504.01.0099 Overhead absorbido</code> (cuenta de cierre);{" "}
          <code>115.04.01 Inventario PT</code> (revaluación PT);{" "}
          <code>701.99 Otros ingresos extraordinarios</code> (one-off).
        </p>
      </CardContent>
    </Card>
  );
}
