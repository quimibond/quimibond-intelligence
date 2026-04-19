import { getSyntageHealth } from "@/lib/queries/syntage-health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/formatters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const HEALTH_STYLES = {
  healthy: { label: "Saludable", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" },
  warn: { label: "Advertencia", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100" },
  critical: { label: "Crítico", className: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100" },
} as const;

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  waiting: "bg-muted text-muted-foreground",
  running: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  finished: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  failed: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
  stopping: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  stopped: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

export async function SyntageHealthPanel() {
  const report = await getSyntageHealth();
  const healthStyle = HEALTH_STYLES[report.health];

  return (
    <div className="space-y-4">
      {/* Header KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiBox label="Estado general" value={<Badge className={healthStyle.className}>{healthStyle.label}</Badge>} />
        <KpiBox
          label="Cobertura vs Odoo"
          value={`${report.odoo_cross_check.pct_odoo_covered_by_syntage}%`}
          sub={`${formatNumber(report.odoo_cross_check.matched_uuid)} / ${formatNumber(report.odoo_cross_check.odoo_with_uuid)} matched`}
        />
        <KpiBox
          label="Error rate (1h)"
          value={`${report.error_rate.error_rate_pct}%`}
          sub={`${formatNumber(report.error_rate.errors_last_1h)} / ${formatNumber(report.error_rate.webhooks_last_1h)} webhooks`}
        />
        <KpiBox
          label="CFDIs sincronizados"
          value={formatNumber(report.counts.syntage_invoices)}
          sub={`${formatNumber(report.counts.syntage_invoice_line_items)} line items`}
        />
      </div>

      {/* Row counts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filas por tabla</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 md:grid-cols-4">
            {Object.entries(report.counts).map(([table, count]) => (
              <Card key={table} className="p-3">
                <div className="text-xs text-muted-foreground">{table.replace("syntage_", "")}</div>
                <div className="font-mono text-lg tabular-nums">{formatNumber(count)}</div>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Extractions table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Extractions recientes</CardTitle>
          <p className="text-xs text-muted-foreground">
            Comparación Syntage (lo que SAT devolvió) vs nuestra DB (lo que procesamos).
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Extractor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Syntage total</TableHead>
                  <TableHead className="text-right">Created / Updated</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Fin</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.extractions.length === 0 ? (
                  <TableRow>
                    <TableCell className="py-6 text-center text-muted-foreground" colSpan={8}>
                      Sin extractions todavía.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.extractions.map(x => (
                    <TableRow key={x.id}>
                      <TableCell className="font-mono text-xs">{x.id}</TableCell>
                      <TableCell>{x.extractor}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_STYLES[x.status] ?? "bg-muted"}>{x.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatNumber(x.syntage_total)}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatNumber(x.syntage_created)} / {formatNumber(x.syntage_updated)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {x.started_at ? new Date(x.started_at).toLocaleString("es-MX") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {x.finished_at ? new Date(x.finished_at).toLocaleString("es-MX") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-rose-700">{x.error_code ?? ""}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Odoo cross-check */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cross-check Syntage ↔ Odoo</CardTitle>
          <p className="text-xs text-muted-foreground">
            Match por UUID entre CFDIs de Syntage y facturas de Odoo con cfdi_uuid.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            <KpiBox label="Syntage" value={formatNumber(report.odoo_cross_check.syntage_invoices)} />
            <KpiBox label="Odoo con UUID" value={formatNumber(report.odoo_cross_check.odoo_with_uuid)} />
            <KpiBox label="Match UUID" value={formatNumber(report.odoo_cross_check.matched_uuid)} />
            <KpiBox
              label="Solo en Syntage"
              value={formatNumber(report.odoo_cross_check.syntage_only)}
              sub="Posible fuga fiscal"
            />
            <KpiBox
              label="Solo en Odoo"
              value={formatNumber(report.odoo_cross_check.odoo_only)}
              sub="Aún no sincronizado"
            />
          </div>
        </CardContent>
      </Card>

      {/* Yearly distribution */}
      {report.yearly_distribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribución por año</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Año</TableHead>
                    <TableHead className="text-right">Emitidas</TableHead>
                    <TableHead className="text-right">Recibidas</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.yearly_distribution.map(y => (
                    <TableRow key={y.year}>
                      <TableCell className="font-mono tabular-nums">{y.year}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatNumber(y.issued)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatNumber(y.received)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatNumber(y.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error samples */}
      {report.error_rate.sample_errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Errores recientes</CardTitle>
            <p className="text-xs text-muted-foreground">Últimos 5 errores en la última hora.</p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {report.error_rate.sample_errors.map((e, i) => (
                <li key={i} className="rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
                  <div className="font-mono text-xs text-muted-foreground">
                    {new Date(e.at).toLocaleString("es-MX")} · {e.event_type ?? "unknown"}
                  </div>
                  <div className="mt-1 text-xs text-rose-900 dark:text-rose-100">{e.error ?? "(sin mensaje)"}</div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Generado {new Date(report.generated_at).toLocaleString("es-MX")}.
      </p>
    </div>
  );
}

function KpiBox({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}
