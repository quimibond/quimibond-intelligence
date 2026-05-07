"use client";

import { useState } from "react";
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
export function PnlAdjustmentEntryCard({
  residual,
  netaContable,
  netaLimpio,
  cogs501_01_01,
  costoPrimo,
  capaPosteada,
  periodLabel,
  monthEndIso,
}: {
  residual: number; // = cogs501_01_01 − costoPrimo  (POST-CAPA)
  netaContable: number;
  netaLimpio: number;
  cogs501_01_01: number; // saldo 501.01.01 post-CAPA (lo que ve Odoo)
  costoPrimo: number; // BOM-MP recursivo
  capaPosteada: number; // SUM(amount_total) journal CAPA DE VALORACIÓN período
  periodLabel: string;
  monthEndIso: string;
}) {
  const [copied, setCopied] = useState(false);
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const deltaNeta = netaLimpio - netaContable;
  const invariantOk = Math.abs(deltaNeta - residual) < 10;
  const isPositive = residual >= 0;
  const absResidual = Math.abs(residual);
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
    `Contexto del período:`,
    `  Saldo bruto 501.01.01 pre-CAPA:  ${fmtFull(saldoBrutoPreCapa)}`,
    `  CAPA ya posteada en el período:  ${fmtFull(capaPosteada)}`,
    `  Saldo neto 501.01.01 post-CAPA:  ${fmtFull(cogs501_01_01)}  ← lo que ve Odoo`,
    `  − Costo primo BOM-MP recursivo:  ${fmtFull(costoPrimo)}`,
    `  = Ajuste pendiente neto:         ${fmtFull(residual)}  ← este monto NO duplica CAPA`,
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
          debe igualar residual 501.01.01 ({fmtFull(residual)}).
          {invariantOk
            ? " ✓ Cuadra al peso."
            : ` ⚠ Drift de ${fmtFull(deltaNeta - residual)} — revisar.`}
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
