import {
  AlertTriangle,
  Check,
  FileText,
  Flame,
  History,
  Mail,
  Package,
  ShoppingCart,
  Target,
  Truck,
  TrendingDown,
  TrendingUp,
  User,
  Users,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatters";

import { Currency } from "./currency";
import { DateDisplay } from "./date-display";
import { CompanyLink } from "./company-link";
import { TrendIndicator } from "./trend-indicator";
import { MiniChart } from "./mini-chart";
import { EvidenceChip } from "./evidence-chip";
import { InvoiceDetailView } from "./invoice-detail";
import { PredictionCard, type PredictionStatus } from "./prediction-card";
import type {
  EvidencePack,
  EvidencePackFinancials,
  EvidencePackOrders,
  EvidencePackCommunication,
  EvidencePackDeliveries,
  EvidencePackActivities,
  EvidencePackHistory,
  EvidencePackPredictions,
} from "@/lib/queries/evidence";

interface Props {
  pack: EvidencePack;
}

/**
 * EvidencePack — vista ejecutiva de todas las dimensiones que el agente
 * consideró al generar un insight. Cada sección muestra evidencia cruzada
 * (facturas, pedidos, emails, entregas, actividades, historial).
 *
 * Server Component — todas las subsecciones renderizan server-side.
 */
export function EvidencePackView({ pack }: Props) {
  return (
    <div className="space-y-4">
      <EvidenceHeader pack={pack} />
      {pack.predictions && <PredictionsSection data={pack.predictions} />}
      <FinancialsSection data={pack.financials} />
      <OrdersSection data={pack.orders} />
      <CommunicationSection data={pack.communication} />
      <DeliveriesSection data={pack.deliveries} />
      <ActivitiesSection data={pack.activities} />
      <HistorySection data={pack.history} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Header — empresa + tier + RFC + crédito
// ──────────────────────────────────────────────────────────────────────────
function tierVariant(
  tier: string | null
): "success" | "warning" | "secondary" {
  if (tier === "strategic") return "success";
  if (tier === "important") return "warning";
  return "secondary";
}

function tierLabel(tier: string | null): string {
  const map: Record<string, string> = {
    strategic: "Estratégico",
    important: "Importante",
    standard: "Estándar",
  };
  return tier ? (map[tier] ?? tier) : "—";
}

function capitalize(s: string | null | undefined): string {
  if (!s) return "—";
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function EvidenceHeader({ pack }: { pack: EvidencePack }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {pack.tier && (
              <Badge variant={tierVariant(pack.tier)}>
                {tierLabel(pack.tier)}
              </Badge>
            )}
            {pack.is_customer && (
              <Badge variant="info" className="text-[10px]">
                Cliente
              </Badge>
            )}
            {pack.is_supplier && (
              <Badge variant="secondary" className="text-[10px]">
                Proveedor
              </Badge>
            )}
            {pack.rfc && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {pack.rfc}
              </span>
            )}
          </div>
          <CompanyLink
            companyId={pack.company_id}
            name={capitalize(pack.company_name)}
            truncate
          />
        </div>
        {pack.credit_limit != null && pack.credit_limit > 0 && (
          <div className="text-right">
            <div className="text-[10px] uppercase text-muted-foreground">
              Límite de crédito
            </div>
            <div className="text-sm font-semibold tabular-nums">
              <Currency amount={pack.credit_limit} compact />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Financials — facturas vencidas, promedio histórico, payables
// ──────────────────────────────────────────────────────────────────────────
function FinancialsSection({ data: f }: { data: EvidencePackFinancials }) {
  const overdue = f.overdue_invoices ?? [];
  const hasOverdue = f.total_overdue_mxn > 0;
  const creditExposureNote =
    f.avg_days_to_pay != null
      ? `Avg pago histórico: ${f.avg_days_to_pay} días`
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
          Financials
          {hasOverdue && (
            <Badge variant="critical" className="ml-auto">
              <Currency amount={f.total_overdue_mxn} compact /> vencido
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <Stat
            label="Facturado 12m"
            value={<Currency amount={f.total_invoiced_12m} compact />}
          />
          <Stat
            label="Cartera vencida"
            value={<Currency amount={f.total_overdue_mxn} compact />}
            danger={hasOverdue}
          />
          <Stat
            label="Notas de crédito"
            value={<Currency amount={f.credit_notes_12m} compact />}
          />
          <Stat
            label="Por pagar (AP)"
            value={<Currency amount={f.payables_overdue_mxn} compact />}
            danger={f.payables_overdue_mxn > 0}
          />
        </div>

        {creditExposureNote && (
          <div className="text-[11px] text-muted-foreground">
            {creditExposureNote}
          </div>
        )}

        {overdue.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Facturas vencidas
            </div>
            <div className="flex flex-wrap gap-1.5">
              {overdue.map((inv) => (
                <EvidenceChip
                  key={inv.name}
                  type="invoice"
                  reference={inv.name}
                  amount={inv.amount_mxn}
                  status="overdue"
                  hint={`${inv.days_overdue}d`}
                  detail={<InvoiceDetailView reference={inv.name} />}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Orders — trend, top products, salesperson
// ──────────────────────────────────────────────────────────────────────────
function OrdersSection({ data: o }: { data: EvidencePackOrders }) {
  const trendPct =
    o.revenue_trend.prev_3m > 0
      ? ((o.revenue_trend.last_3m - o.revenue_trend.prev_3m) /
          o.revenue_trend.prev_3m) *
        100
      : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShoppingCart className="h-4 w-4 text-muted-foreground" aria-hidden />
          Pedidos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <Stat label="Pedidos 12m" value={formatNumber(o.total_orders_12m)} />
          <Stat
            label="Ticket promedio"
            value={<Currency amount={o.avg_order_mxn} compact />}
          />
          <Stat
            label="Último pedido"
            value={
              o.days_since_last_order != null
                ? `hace ${o.days_since_last_order}d`
                : "—"
            }
            danger={
              o.days_since_last_order != null && o.days_since_last_order > 60
            }
          />
          <Stat
            label="Tendencia 3m vs 3m"
            value={
              o.revenue_trend.prev_3m > 0 ? (
                <TrendIndicator value={trendPct} good="up" />
              ) : (
                "—"
              )
            }
          />
        </div>

        {o.salesperson && (
          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
            <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="font-medium">{o.salesperson}</span>
            {o.salesperson_email && (
              <a
                href={`mailto:${o.salesperson_email}`}
                className="truncate text-[11px] text-muted-foreground hover:text-primary"
              >
                {o.salesperson_email}
              </a>
            )}
          </div>
        )}

        {o.top_products && o.top_products.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Top productos
            </div>
            <div className="space-y-1">
              {o.top_products.slice(0, 5).map((p) => (
                <div
                  key={p.ref}
                  className="flex items-center justify-between gap-2 border-b border-border/60 py-1 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Package
                      className="h-3 w-3 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {p.ref}
                    </span>
                    <span className="truncate text-xs">{p.product}</span>
                  </div>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    <Currency amount={p.total_mxn} compact />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Communication — threads, key contacts
// ──────────────────────────────────────────────────────────────────────────
function CommunicationSection({
  data: c,
}: {
  data: EvidencePackCommunication;
}) {
  const silenceAlert =
    c.days_since_last_email != null && c.days_since_last_email > 30;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
          Comunicación
          {silenceAlert && (
            <Badge variant="warning" className="ml-auto">
              Silencio {c.days_since_last_email}d
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Emails totales" value={formatNumber(c.total_emails)} />
          <Stat
            label="Sin responder"
            value={formatNumber(c.unanswered_threads)}
            danger={c.unanswered_threads > 0}
          />
          <Stat
            label="Último email"
            value={
              c.days_since_last_email != null
                ? `hace ${c.days_since_last_email}d`
                : "—"
            }
            danger={silenceAlert}
          />
        </div>

        {c.recent_threads && c.recent_threads.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Threads recientes
            </div>
            <div className="space-y-1">
              {c.recent_threads.slice(0, 5).map((t, i) => (
                <div
                  key={`${t.subject}-${i}`}
                  className="flex items-start gap-2 border-b border-border/60 py-1.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">
                      {t.subject}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="truncate">{t.last_sender}</span>
                      {t.hours_waiting > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-warning-foreground">
                            {Math.round(t.hours_waiting)}h esperando
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {t.has_our_reply ? (
                    <Check
                      className="h-3 w-3 shrink-0 text-success"
                      aria-hidden
                    />
                  ) : (
                    <AlertTriangle
                      className="h-3 w-3 shrink-0 text-warning-foreground"
                      aria-hidden
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {c.key_contacts && c.key_contacts.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Contactos clave
            </div>
            <div className="flex flex-wrap gap-1.5">
              {c.key_contacts.map((contact, i) => (
                <a
                  key={`${contact.email}-${i}`}
                  href={`mailto:${contact.email}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] hover:bg-accent"
                >
                  <Users className="h-3 w-3" aria-hidden />
                  <span className="font-medium">{contact.name}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="truncate">{contact.email}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Deliveries
// ──────────────────────────────────────────────────────────────────────────
function DeliveriesSection({ data: d }: { data: EvidencePackDeliveries }) {
  if (d.total_deliveries_90d === 0 && d.pending_shipments === 0) return null;
  const otdTone =
    d.otd_rate == null
      ? ""
      : d.otd_rate >= 90
        ? "success"
        : d.otd_rate >= 75
          ? "warning"
          : "critical";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
          Entregas (90d)
          {d.otd_rate != null && otdTone && (
            <Badge
              variant={
                otdTone as "success" | "warning" | "critical"
              }
              className="ml-auto"
            >
              OTD {d.otd_rate.toFixed(0)}%
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Total 90d" value={formatNumber(d.total_deliveries_90d)} />
          <Stat
            label="Tarde"
            value={formatNumber(d.late_deliveries)}
            danger={d.late_deliveries > 0}
          />
          <Stat
            label="Pendientes"
            value={formatNumber(d.pending_shipments)}
          />
        </div>

        {d.late_details && d.late_details.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Entregas tarde
            </div>
            <div className="space-y-1">
              {d.late_details.slice(0, 5).map((l, i) => (
                <div
                  key={`${l.name}-${i}`}
                  className="flex items-center justify-between gap-2 border-b border-border/60 py-1 last:border-b-0 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[10px]">{l.name}</span>
                    {l.origin && (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {l.origin}
                      </span>
                    )}
                  </div>
                  <DateDisplay
                    date={l.scheduled}
                    className="text-[10px] text-warning-foreground"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Activities — overdue tasks
// ──────────────────────────────────────────────────────────────────────────
function stripHtml(s: string): string {
  // Remove HTML tags and decode common entities. Simple enough for Odoo mail.activity summaries.
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function ActivitiesSection({ data: a }: { data: EvidencePackActivities }) {
  if (a.total_pending === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Flame className="h-4 w-4 text-muted-foreground" aria-hidden />
          Actividades
          {a.overdue > 0 && (
            <Badge variant="critical" className="ml-auto">
              {a.overdue} vencidas
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <div className="grid grid-cols-2 gap-3 text-center">
          <Stat label="Pendientes" value={formatNumber(a.total_pending)} />
          <Stat
            label="Vencidas"
            value={formatNumber(a.overdue)}
            danger={a.overdue > 0}
          />
        </div>

        {a.overdue_detail && a.overdue_detail.length > 0 && (
          <div className="space-y-1.5">
            {a.overdue_detail.slice(0, 5).map((act, i) => {
              const summary = stripHtml(act.summary);
              const truncated =
                summary.length > 120 ? summary.slice(0, 120) + "…" : summary;
              return (
                <div
                  key={`${act.deadline}-${i}`}
                  className="rounded-md border border-border/60 p-2 text-xs"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[9px]">
                      {act.type}
                    </Badge>
                    <span className="text-[10px] text-danger">
                      Vence {act.deadline}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">
                    {truncated}
                  </p>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <User className="h-3 w-3" aria-hidden />
                    {act.assigned_to}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// History — recent insights + health trend
// ──────────────────────────────────────────────────────────────────────────
function stateVariant(
  state: string
): "success" | "info" | "warning" | "critical" | "secondary" {
  if (state === "acted_on") return "success";
  if (state === "new") return "info";
  if (state === "seen") return "info";
  if (state === "dismissed") return "secondary";
  if (state === "expired") return "warning";
  if (state === "archived") return "secondary";
  return "secondary";
}

function HistorySection({ data: h }: { data: EvidencePackHistory }) {
  const insights = h.recent_insights ?? [];
  const trend = h.health_trend ?? [];

  // Dedupe health trend to 1 per day. The RPC returns newest-first,
  // so we dedupe in that order and then reverse for left-to-right plotting.
  const dedupedTrend: Array<{ date: string; score: number; value: number }> =
    [];
  const seenDates = new Set<string>();
  for (const point of trend) {
    if (!seenDates.has(point.date)) {
      seenDates.add(point.date);
      dedupedTrend.push({ ...point, value: point.score });
    }
  }
  // Reverse so oldest is first (chronological) for the MiniChart
  dedupedTrend.reverse();

  if (insights.length === 0 && dedupedTrend.length === 0) return null;

  // Count expired insights to flag re-reporting
  const expiredCount = insights.filter((i) => i.state === "expired").length;
  const escalateAlert = expiredCount >= 2;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden />
          Historial
          {escalateAlert && (
            <Badge variant="critical" className="ml-auto">
              Escalar — {expiredCount} expirados
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {dedupedTrend.length > 1 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Health score
              </span>
              <HealthTrendDelta points={dedupedTrend} />
            </div>
            <MiniChart
              data={dedupedTrend}
              height={40}
              color={
                dedupedTrend[dedupedTrend.length - 1].score >= 70
                  ? "success"
                  : dedupedTrend[dedupedTrend.length - 1].score >= 50
                    ? "warning"
                    : "danger"
              }
            />
          </div>
        )}

        {insights.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Insights previos ({insights.length})
            </div>
            <div className="space-y-1">
              {insights.slice(0, 6).map((i, idx) => (
                <div
                  key={`${i.created}-${idx}`}
                  className="flex items-start gap-2 border-b border-border/60 py-1 last:border-b-0"
                >
                  <Badge
                    variant={stateVariant(i.state)}
                    className="shrink-0 text-[9px]"
                  >
                    {i.state}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px]">{i.title}</div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span>{i.category}</span>
                      <span>·</span>
                      <DateDisplay date={i.created} relative />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HealthTrendDelta({
  points,
}: {
  points: Array<{ score: number }>;
}) {
  if (points.length < 2) return null;
  const first = points[0].score;
  const last = points[points.length - 1].score;
  const delta = last - first;
  if (delta === 0) {
    return (
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {last}
      </span>
    );
  }
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  const color = delta > 0 ? "text-success" : "text-danger";
  return (
    <span className={`flex items-center gap-0.5 text-[10px] tabular-nums ${color}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {first} → {last} ({delta > 0 ? "+" : ""}
      {delta})
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Predictions (solo en briefings) — reorder / payment / cashflow / churn
// ──────────────────────────────────────────────────────────────────────────
function customerStatusVariant(
  status: string
): "success" | "warning" | "critical" | "secondary" {
  if (status === "active") return "success";
  if (status === "cooling") return "warning";
  if (status === "at_risk") return "critical";
  if (status === "churned") return "secondary";
  return "secondary";
}
function customerStatusLabel(status: string): string {
  const map: Record<string, string> = {
    active: "Activo",
    cooling: "Enfriando",
    at_risk: "En riesgo",
    churned: "Perdido",
  };
  return map[status] ?? status;
}

function PredictionsSection({ data: p }: { data: EvidencePackPredictions }) {
  const has =
    p.reorder != null ||
    p.payment != null ||
    p.cashflow != null ||
    p.ltv_health != null;
  if (!has) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Target className="h-4 w-4 text-muted-foreground" aria-hidden />
          Predicciones
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {p.reorder && (
          <div className="space-y-2">
            <PredictionCard
              label="Próximo pedido esperado"
              predicted={
                p.reorder.predicted_next_order
                  ? formatPredictionDate(p.reorder.predicted_next_order)
                  : "Sin predicción"
              }
              basedOn={
                p.reorder.avg_cycle_days != null
                  ? `ciclo ${Math.round(p.reorder.avg_cycle_days)}d · ${
                      p.reorder.days_since_last ?? "?"
                    }d sin pedir${
                      p.reorder.top_product_ref
                        ? ` · top: ${p.reorder.top_product_ref}`
                        : ""
                    }`
                  : undefined
              }
              status={
                reorderStatusToPrediction(p.reorder.reorder_status)
              }
            />
            <div className="grid grid-cols-2 gap-2 px-4 text-[11px] sm:grid-cols-4">
              <Stat
                label="Ciclo promedio"
                value={
                  p.reorder.avg_cycle_days != null
                    ? `${Math.round(p.reorder.avg_cycle_days)}d`
                    : "—"
                }
              />
              <Stat
                label="Sin pedir"
                value={
                  p.reorder.days_since_last != null
                    ? `${p.reorder.days_since_last}d`
                    : "—"
                }
                danger={
                  p.reorder.days_overdue_reorder != null &&
                  p.reorder.days_overdue_reorder > 0
                }
              />
              <Stat
                label="Ticket promedio"
                value={<Currency amount={p.reorder.avg_order_value} compact />}
              />
              <Stat
                label="Días vencido"
                value={
                  p.reorder.days_overdue_reorder != null &&
                  p.reorder.days_overdue_reorder > 0
                    ? `${Math.round(p.reorder.days_overdue_reorder)}d`
                    : "—"
                }
                danger={
                  p.reorder.days_overdue_reorder != null &&
                  p.reorder.days_overdue_reorder > 0
                }
              />
            </div>
          </div>
        )}

        {p.payment && (
          <div className="space-y-2">
            <PredictionCard
              label="Próximo pago esperado"
              predicted={
                p.payment.predicted_payment_date
                  ? formatPredictionDate(p.payment.predicted_payment_date)
                  : "Sin predicción"
              }
              basedOn={buildPaymentBasedOn(p.payment)}
              status={paymentRiskToPrediction(p.payment.payment_risk)}
            />
            <div className="grid grid-cols-2 gap-2 px-4 text-[11px] sm:grid-cols-4">
              <Stat
                label="Prom histórico"
                value={
                  p.payment.avg_days_to_pay != null
                    ? `${Math.round(p.payment.avg_days_to_pay)}d`
                    : "—"
                }
              />
              <Stat
                label="Reciente 6m"
                value={
                  p.payment.avg_recent_6m != null
                    ? `${Math.round(p.payment.avg_recent_6m)}d`
                    : "—"
                }
              />
              <Stat
                label="Máx vencido"
                value={
                  p.payment.max_days_overdue != null
                    ? `${p.payment.max_days_overdue}d`
                    : "—"
                }
                danger={
                  p.payment.max_days_overdue != null &&
                  p.payment.max_days_overdue > 30
                }
              />
              <Stat
                label="Pendiente"
                value={<Currency amount={p.payment.total_pending} compact />}
              />
            </div>
          </div>
        )}

        {p.cashflow && p.cashflow.total_receivable != null && (
          <div className="rounded-md border border-border/60 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Cashflow esperado
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <Stat
                label="Por cobrar"
                value={
                  <Currency amount={p.cashflow.total_receivable} compact />
                }
              />
              <Stat
                label="Esperado"
                value={
                  <Currency amount={p.cashflow.expected_collection} compact />
                }
              />
              <Stat
                label="Probabilidad"
                value={
                  p.cashflow.collection_probability != null
                    ? `${Math.round(p.cashflow.collection_probability * 100)}%`
                    : "—"
                }
              />
            </div>
          </div>
        )}

        {p.ltv_health && (
          <div className="rounded-md border border-border/60 p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Health cliente
              </span>
              {p.ltv_health.customer_status && (
                <Badge
                  variant={customerStatusVariant(p.ltv_health.customer_status)}
                >
                  {customerStatusLabel(p.ltv_health.customer_status)}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <Stat
                label="Churn risk"
                value={p.ltv_health.churn_risk_score ?? "—"}
                danger={(p.ltv_health.churn_risk_score ?? 0) > 70}
              />
              <Stat
                label="Overdue risk"
                value={p.ltv_health.overdue_risk_score ?? "—"}
                danger={(p.ltv_health.overdue_risk_score ?? 0) > 70}
              />
              <Stat
                label="Trend vs Q ant"
                value={
                  p.ltv_health.trend_pct != null ? (
                    <TrendIndicator
                      value={p.ltv_health.trend_pct}
                      good="up"
                    />
                  ) : (
                    "—"
                  )
                }
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Prediction helpers (bridge RPC statuses → PredictionCard status enum)
// ──────────────────────────────────────────────────────────────────────────
function reorderStatusToPrediction(status: string): PredictionStatus {
  if (status === "on_track") return "on_track";
  if (status === "at_risk") return "at_risk";
  if (status === "overdue") return "overdue";
  if (status === "critical") return "critical";
  if (status === "lost") return "lost";
  return "at_risk";
}

function paymentRiskToPrediction(raw: string): PredictionStatus {
  const upper = raw.toUpperCase();
  if (upper.startsWith("CRITICO")) return "critical";
  if (upper.startsWith("ALTO")) return "at_risk";
  if (upper.startsWith("MEDIO")) return "overdue";
  if (upper.startsWith("NORMAL")) return "on_track";
  return "at_risk";
}

function formatPredictionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function buildPaymentBasedOn(p: {
  avg_days_to_pay: number | null;
  avg_recent_6m: number | null;
  avg_older: number | null;
  payment_trend: string | null;
  max_days_overdue: number | null;
}): string | undefined {
  const parts: string[] = [];
  if (p.avg_days_to_pay != null) {
    parts.push(`avg histórico ${Math.round(p.avg_days_to_pay)}d`);
  }
  if (p.avg_recent_6m != null && p.avg_recent_6m !== p.avg_days_to_pay) {
    parts.push(`reciente ${Math.round(p.avg_recent_6m)}d`);
  }
  if (p.payment_trend) {
    parts.push(`tendencia ${p.payment_trend}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Shared stat block
// ──────────────────────────────────────────────────────────────────────────
function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-sm font-bold tabular-nums",
          danger && "text-danger"
        )}
      >
        {value}
      </div>
    </div>
  );
}
