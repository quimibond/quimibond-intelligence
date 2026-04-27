import { FileText, Inbox, Landmark, Receipt } from "lucide-react";
import {
  StatGrid,
  KpiCard,
  QuestionSection,
  Currency,
  EmptyState,
} from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTaxEvents } from "@/lib/queries/sp13/finanzas";
import type { HistoryRange } from "@/components/patterns/history-range";

/* ── F-Tax (retenciones + declaraciones SAT) ────────────────────────── */
export async function TaxBlock({ range }: { range: HistoryRange }) {
  const tax = await getTaxEvents(range);

  return (
    <QuestionSection
      id="tax"
      question="¿Qué pasa con mi situación fiscal?"
      subtext={`Retenciones recibidas + declaraciones SAT presentadas · ${tax.periodLabel}`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 1, tablet: 3, desktop: 3 }}>
        <KpiCard
          title="Retenciones a favor"
          value={tax.retentionsTotalMxn}
          format="currency"
          compact
          icon={Receipt}
          source="sat"
          tone="success"
          subtitle={`${tax.retentionsCount} CFDIs de retención`}
          definition={{
            title: "Impuestos retenidos por terceros",
            description:
              "Suma de monto_total_retenido en CFDIs tipo retención emitidos a Quimibond. Es saldo a favor frente al SAT.",
            formula: "SUM(monto_total_retenido) WHERE event_type='retention'",
            table: "canonical_tax_events",
          }}
        />
        <KpiCard
          title="Pagado al SAT"
          value={tax.taxReturnsTotalMxn}
          format="currency"
          compact
          icon={Landmark}
          source="sat"
          tone="warning"
          subtitle={`${tax.taxReturnsCount} declaraciones presentadas`}
          definition={{
            title: "Declaraciones SAT pagadas",
            description:
              "Suma de return_monto_pagado en declaraciones presentadas durante el período.",
            formula: "SUM(return_monto_pagado) WHERE event_type='tax_return'",
            table: "canonical_tax_events",
          }}
        />
        <KpiCard
          title="Contabilidad electrónica"
          value={tax.electronicAccountingCount}
          format="number"
          icon={FileText}
          source="sat"
          tone={tax.electronicAccountingCount > 0 ? "success" : "warning"}
          subtitle="balanzas / catálogos enviados"
          definition={{
            title: "Cumplimiento contabilidad electrónica",
            description:
              "Balanzas y catálogos de cuentas enviados al SAT — obligación mensual.",
            formula: "COUNT(*) WHERE event_type='electronic_accounting'",
            table: "canonical_tax_events",
          }}
        />
      </StatGrid>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top retenciones recibidas</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {tax.topRetentions.length === 0 ? (
              <div className="px-4 py-6">
                <EmptyState compact icon={Inbox} title="Sin retenciones en el período" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Emisor</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tax.topRetentions.map((r) => (
                    <TableRow key={r.uuid ?? `${r.emisorRfc}-${r.fechaEmision}`}>
                      <TableCell>
                        <div className="text-sm">{r.emisorNombre ?? "—"}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {r.emisorRfc ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{r.tipoRetencion ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Currency amount={r.monto} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top declaraciones pagadas</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {tax.topReturns.length === 0 ? (
              <div className="px-4 py-6">
                <EmptyState compact icon={Inbox} title="Sin declaraciones en el período" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Pagado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tax.topReturns.map((r, i) => (
                    <TableRow key={r.numeroOperacion ?? `${r.ejercicio}-${r.periodo}-${i}`}>
                      <TableCell>
                        <div className="text-sm">
                          {r.periodo ?? "—"} {r.ejercicio ?? ""}
                        </div>
                        {r.numeroOperacion && (
                          <div className="font-mono text-[11px] text-muted-foreground">
                            #{r.numeroOperacion}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.tipoDeclaracion ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Currency amount={r.montoPagado} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </QuestionSection>
  );
}

