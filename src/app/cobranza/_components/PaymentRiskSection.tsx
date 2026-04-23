"use client";

import { Flame } from "lucide-react";

import {
  Currency,
  EmptyState,
  StatusBadge,
} from "@/components/patterns";
import { RowCheckbox } from "@/components/patterns/row-checkbox";
import { SelectionProvider } from "@/components/patterns/selection-context";
import type { PaymentPredictionRow } from "@/lib/queries/unified/invoices";

import { PaymentRiskBatchActions } from "./payment-risk-batch-actions";

const RISK_LABEL: Record<string, string> = {
  critical: "Crítico",
  abnormal: "Anormal",
  watch: "Vigilar",
};

interface PaymentRiskSectionProps {
  rows: PaymentPredictionRow[];
}

export function PaymentRiskSection({ rows }: PaymentRiskSectionProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Flame}
        title="Sin clientes con patrón anormal"
        description="Todos los clientes muestran patrón de pago dentro de norma."
        compact
      />
    );
  }

  const idToName: Record<string, string> = {};
  for (const r of rows) {
    idToName[String(r.company_id)] = r.company_name ?? "";
  }

  return (
    <SelectionProvider>
      <ul className="space-y-2">
        {rows.map((r) => {
          const riskLabel = RISK_LABEL[r.payment_risk] ?? r.payment_risk;
          const idStr = String(r.company_id);
          return (
            <li
              key={r.company_id}
              className="flex items-start gap-3 rounded-lg border bg-card p-3"
            >
              <RowCheckbox
                rowId={idStr}
                label={`Seleccionar ${r.company_name ?? "cliente"}`}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.company_name ?? "—"}</span>
                  <StatusBadge kind="generic" value={riskLabel} density="compact" />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                  <span>
                    Pendiente: <Currency amount={r.total_pending} />
                  </span>
                  <span>{r.pending_count} facturas</span>
                  {r.avg_days_to_pay != null && (
                    <span>Pago promedio: {r.avg_days_to_pay}d</span>
                  )}
                  {r.max_days_overdue != null && (
                    <span>Máx vencidas: {r.max_days_overdue}d</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <PaymentRiskBatchActions idToName={idToName} />
    </SelectionProvider>
  );
}
