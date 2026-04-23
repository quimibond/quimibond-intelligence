import { Mail, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/patterns/section-header";
import { AgingBuckets, type AgingData } from "@/components/patterns/aging-buckets";
import { Chart } from "@/components/patterns/chart";

export interface PanoramaRecentOrder {
  canonical_id: string;
  name: string | null;
  amount_total_mxn: number | null;
  date_order: string | null;
}

export interface PanoramaEvidenceItem {
  kind: "email" | "fact";
  key: string;
  title: string;
  body: string;
  at: string;
}

export interface PanoramaTabProps {
  detail: {
    aging?: AgingData | null;
    revenueTrend?: Array<{ month_start: string; total_mxn: number }> | null;
    recentSaleOrders?: PanoramaRecentOrder[] | null;
    recentEvidence?: PanoramaEvidenceItem[] | null;
  };
}

function fmtMxn(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

function agingTotal(a?: AgingData | null): number {
  if (!a) return 0;
  return a.current + a.d1_30 + a.d31_60 + a.d61_90 + a.d90_plus;
}

export function PanoramaTab({ detail }: PanoramaTabProps) {
  const { aging, revenueTrend, recentSaleOrders, recentEvidence } = detail;

  return (
    <div className="space-y-6">
      {aging && agingTotal(aging) > 0 && (
        <section className="space-y-3">
          <SectionHeader title="Cartera abierta" />
          <Card className="p-4">
            <AgingBuckets data={aging} ariaLabel="Aging de cartera de este cliente" />
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeader title="Revenue 12 meses" />
        <Card className="p-4">
          {revenueTrend && revenueTrend.length > 1 ? (
            <Chart
              type="area"
              data={revenueTrend}
              xKey="month_start"
              series={[{ key: "total_mxn", label: "Ingresos", color: "positive" }]}
              ariaLabel="Ingresos mensuales 12 meses"
              height={200}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin datos de ingresos en los últimos 12 meses.
            </p>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader title="Pedidos recientes" />
        <Card className="p-4">
          {recentSaleOrders && recentSaleOrders.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {recentSaleOrders.slice(0, 3).map((o) => (
                <li key={o.canonical_id} className="flex items-center justify-between gap-2">
                  <span className="font-medium">{o.name ?? "(sin folio)"}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {fmtMxn(o.amount_total_mxn)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Sin pedidos recientes.</p>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader title="Actividad reciente" />
        <Card className="p-4">
          {recentEvidence && recentEvidence.length > 0 ? (
            <ol className="space-y-2">
              {recentEvidence.slice(0, 5).map((ev) => {
                const Icon = ev.kind === "email" ? Mail : Sparkles;
                return (
                  <li key={ev.key} className="flex gap-2 text-sm">
                    <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="font-medium">{ev.title}</div>
                      <div className="text-xs text-muted-foreground">{ev.body}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Sin actividad reciente.</p>
          )}
        </Card>
      </section>
    </div>
  );
}
