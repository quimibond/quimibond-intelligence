import { Suspense } from "react";
import { Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/patterns";
import {
  getWebhookEventsSummary,
  getWebhookEventsRecent,
} from "@/lib/queries/fiscal/webhook-events";

function formatFreshness(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 2) return "justo ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

async function SummaryStats() {
  const s = await getWebhookEventsSummary();
  if (s.total === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="Sin eventos de webhook"
        description="syntage_webhook_events está vacío."
        compact
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Total
          </div>
          <div className="text-xl font-semibold">
            {s.total.toLocaleString("es-MX")}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Últimas 24h
          </div>
          <div className="text-xl font-semibold">
            {s.last_24h.toLocaleString("es-MX")}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            7 días
          </div>
          <div className="text-xl font-semibold">
            {s.last_7d.toLocaleString("es-MX")}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Más reciente
          </div>
          <div className="text-sm font-semibold">
            {formatFreshness(s.most_recent)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

async function EventTypesTable() {
  const s = await getWebhookEventsSummary();
  if (s.by_type.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        Por tipo (últimos 30 días)
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo de evento</TableHead>
            <TableHead className="text-right">Eventos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.by_type.map((t) => (
            <TableRow key={t.event_type}>
              <TableCell className="font-mono text-xs">{t.event_type}</TableCell>
              <TableCell className="text-right">
                {t.count.toLocaleString("es-MX")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

async function RecentEventsTable() {
  const rows = await getWebhookEventsRecent(15);
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        Últimos 15 eventos
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Fuente</TableHead>
            <TableHead>Event ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.event_id ?? i}>
              <TableCell className="text-xs text-muted-foreground">
                {r.received_at
                  ? new Date(r.received_at).toLocaleString("es-MX")
                  : "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.event_type ?? "—"}
              </TableCell>
              <TableCell className="text-xs">{r.source ?? "—"}</TableCell>
              <TableCell className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">
                {r.event_id ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function WebhookEventsPanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          Eventos recibidos via webhook de Syntage (source:{" "}
          <span className="font-mono">syntage_webhook_events</span>).
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[120px]" />}>
        <SummaryStats />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[300px]" />}>
        <EventTypesTable />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[300px]" />}>
        <RecentEventsTable />
      </Suspense>
    </div>
  );
}
