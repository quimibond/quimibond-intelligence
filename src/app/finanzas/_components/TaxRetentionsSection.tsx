import { Suspense } from "react";
import { Receipt } from "lucide-react";

import {
  getTaxRetentionsByPeriod,
  getRecentTaxRetentions,
} from "@/lib/queries/fiscal/tax-retentions";
import {
  SectionHeader,
  LoadingTable,
  EmptyState,
  Currency,
} from "@/components/patterns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

/** Human-readable label for SAT tax type codes */
function taxTypeLabel(code: string): string {
  if (code === "001") return "ISR";
  if (code === "002") return "IVA";
  return code;
}

/** Short label for SAT retention type code (tipo_retencion) */
function tipoLabel(code: string | null): string {
  if (!code) return "—";
  const MAP: Record<string, string> = {
    "1": "Arrendamiento",
    "2": "Honorarios",
    "3": "Dividendos",
    "5": "Adquisición bienes",
    "6": "Enajenación acciones",
    "7": "Oper. con derivados",
    "16": "Intereses",
    "17": "Intereses real",
    "18": "Fideicomisos no emp.",
    "20": "Pagos al extranjero",
    "21": "Premios",
    "22": "Derivados",
    "23": "Salarios",
  };
  return MAP[code] ?? `Tipo ${code}`;
}

async function TaxRetentionsContent() {
  const [aggregates, recent] = await Promise.all([
    getTaxRetentionsByPeriod(12),
    getRecentTaxRetentions(10),
  ]);

  if (aggregates.length === 0 && recent.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="Sin retenciones registradas"
        description="syntage_tax_retentions está vacío. Los CFDIs de retención del SAT se sincronizan vía Syntage webhook."
        compact
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Period aggregates */}
      {aggregates.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Últimos 12 meses · Retenciones por período
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">CFDIs</TableHead>
                <TableHead className="text-right">ISR ret.</TableHead>
                <TableHead className="text-right">IVA ret.</TableHead>
                <TableHead className="text-right">Total retenido</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Base gravada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aggregates.map((a) => (
                <TableRow key={a.period}>
                  <TableCell className="font-mono text-xs">{a.period}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.count}</TableCell>
                  <TableCell className="text-right">
                    <Currency amount={a.total_isr}  />
                  </TableCell>
                  <TableCell className="text-right">
                    <Currency amount={a.total_iva}  />
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Currency amount={a.total_retenido}  />
                  </TableCell>
                  <TableCell className="text-right hidden sm:table-cell text-muted-foreground">
                    <Currency amount={a.total_operacion}  />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Recent CFDIs */}
      {recent.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            CFDIs recientes · últimos {recent.length}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Emisor</TableHead>
                <TableHead className="hidden md:table-cell">Tipo</TableHead>
                <TableHead>UUID</TableHead>
                <TableHead className="text-right">Monto operación</TableHead>
                <TableHead className="text-right">Retenido</TableHead>
                <TableHead className="hidden sm:table-cell">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((r) => (
                <TableRow key={r.syntage_id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {r.fecha_emision
                      ? new Date(r.fecha_emision).toLocaleDateString("es-MX", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <div>{r.emisor_rfc ?? "—"}</div>
                    {r.emisor_nombre && (
                      <div className="text-muted-foreground truncate max-w-[160px] text-[10px]">
                        {r.emisor_nombre}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs">
                    {tipoLabel(r.tipo_retencion)}
                  </TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-[120px]">
                    {r.uuid.slice(0, 8)}…
                  </TableCell>
                  <TableCell className="text-right">
                    <Currency amount={r.monto_total_operacion ?? 0}  />
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Currency amount={r.monto_total_retenido ?? 0}  />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {r.estado_sat ? (
                      <Badge
                        variant={r.estado_sat === "vigente" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {r.estado_sat}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* Tax breakdown note */}
          <p className="mt-2 text-[11px] text-muted-foreground">
            ISR = taxType 001 · IVA = taxType 002 · base: syntage_tax_retentions ·{" "}
            {recent.length} CFDIs mostrados
          </p>
        </div>
      )}
    </div>
  );
}

export function TaxRetentionsSection() {
  return (
    <section id="tax-retentions" className="scroll-mt-24 space-y-3">
      <SectionHeader
        title="Retenciones fiscales SAT"
        description="CFDIs de retención ISR/IVA reportados al SAT vía Syntage (source: syntage_tax_retentions)"
      />
      <Suspense fallback={<LoadingTable rows={8} columns={6} />}>
        <TaxRetentionsContent />
      </Suspense>
    </section>
  );
}
