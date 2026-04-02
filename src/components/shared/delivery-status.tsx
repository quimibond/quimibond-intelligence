"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScoreGauge } from "@/components/shared/score-gauge";

interface Delivery {
  name: string;
  picking_type: string | null;
  origin: string | null;
  scheduled_date: string | null;
  state: string;
  is_late: boolean;
}

interface DeliveryPerformance {
  total_delivered: number;
  on_time_rate: number | null;
  avg_lead_time_days: number | null;
}

export function DeliveryStatus({
  pending,
  performance,
  lateCount,
}: {
  pending: Delivery[];
  performance: DeliveryPerformance | null;
  lateCount: number;
}) {
  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="flex items-start justify-around gap-4">
        <ScoreGauge
          value={performance?.on_time_rate ?? null}
          label="OTD Rate"
          size="lg"
        />
        <div className="flex flex-col items-center gap-1">
          <span className="text-3xl font-bold tabular-nums">
            {pending.length}
          </span>
          <span className="text-xs text-muted-foreground">Pendientes</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-3xl font-bold tabular-nums text-danger-foreground">
            {lateCount}
          </span>
          <span className="text-xs text-muted-foreground">Atrasadas</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-3xl font-bold tabular-nums">
            {performance?.avg_lead_time_days != null
              ? `${performance.avg_lead_time_days}d`
              : "—"}
          </span>
          <span className="text-xs text-muted-foreground">Lead Time Prom.</span>
        </div>
      </div>

      {/* Pending deliveries table */}
      {pending.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referencia</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Fecha Programada</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((d, i) => (
                <TableRow
                  key={i}
                  className={d.is_late ? "bg-danger/5" : undefined}
                >
                  <TableCell className="font-medium text-sm">
                    {d.name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {d.picking_type ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {d.origin ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {d.scheduled_date ?? "—"}
                  </TableCell>
                  <TableCell>
                    {d.is_late ? (
                      <Badge variant="critical">Atrasada</Badge>
                    ) : (
                      <Badge variant="secondary">{d.state}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pending.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-4">
          Sin entregas pendientes
        </div>
      )}
    </div>
  );
}
