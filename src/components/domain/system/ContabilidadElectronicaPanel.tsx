import { Suspense } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/patterns";
import {
  getElectronicAccountingSummary,
  getElectronicAccountingRecent,
} from "@/lib/queries/fiscal/electronic-accounting";

async function SummaryCards() {
  const summary = await getElectronicAccountingSummary();
  if (summary.length === 0) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="Sin registros de contabilidad electrónica"
        description="syntage_electronic_accounting está vacío. Requiere sync vía Syntage webhooks."
        compact
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {summary.map((s) => (
        <Card key={s.record_type}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {s.record_type}
              </span>
              <span className="text-sm font-semibold">{s.count}</span>
            </div>
            <div className="text-sm">{s.description}</div>
            {s.latest_period ? (
              <div className="text-xs text-muted-foreground">
                Último período:{" "}
                <span className="font-mono">{s.latest_period}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function RecentTable() {
  const rows = await getElectronicAccountingRecent(15);
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        Registros recientes
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo</TableHead>
            <TableHead>Ejercicio</TableHead>
            <TableHead>Período</TableHead>
            <TableHead>RFC</TableHead>
            <TableHead>Tipo envío</TableHead>
            <TableHead>Sincronizado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.syntage_id ?? i}>
              <TableCell className="font-mono text-xs">
                {r.record_type ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.ejercicio ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.periodo ?? "—"}
              </TableCell>
              <TableCell className="text-xs">{r.taxpayer_rfc ?? "—"}</TableCell>
              <TableCell className="text-xs">{r.tipo_envio ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.synced_at
                  ? new Date(r.synced_at).toLocaleDateString("es-MX")
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ContabilidadElectronicaPanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          Catálogo de cuentas y balanzas reportados al SAT (source:{" "}
          <span className="font-mono">syntage_electronic_accounting</span>)
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[180px]" />}>
        <SummaryCards />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[300px]" />}>
        <RecentTable />
      </Suspense>
    </div>
  );
}
