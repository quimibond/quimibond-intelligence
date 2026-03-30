"use client";

import {
  CheckCircle2,
  CreditCard,
  Package,
  PackageX,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import type { Contact } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TabComercialProps {
  contact: Contact;
}

export function TabComercial({ contact }: TabComercialProps) {
  const ctx = contact.odoo_context ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pp = ctx.purchase_patterns as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inv = ctx.inventory_intelligence as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pay = ctx.payment_behavior as any;

  const hasData = pp || inv || pay;

  if (!hasData) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Sin datos comerciales"
        description="No hay datos de compras, inventario o pagos disponibles para este contacto."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Purchase Patterns */}
      {pp && <PurchasePatterns pp={pp} />}

      {/* Inventory Intelligence */}
      {inv && <InventoryIntelligence inv={inv} />}

      {/* Payment Behavior */}
      {pay && <PaymentBehavior pay={pay} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PurchasePatterns({ pp }: { pp: any }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShoppingCart className="h-4 w-4" />
          Patrones de Compra
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.isArray(pp.top_products) && pp.top_products.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Ordenes</TableHead>
                  <TableHead className="text-right">Revenue 12m</TableHead>
                  <TableHead className="text-right">Freq (dias)</TableHead>
                  <TableHead className="text-right">Tendencia</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pp.top_products.map((p: Record<string, unknown>, i: number) => {
                  const trend = Number(p.volume_trend_pct ?? 0);
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{String(p.name ?? p.product_name ?? "—")}</TableCell>
                      <TableCell className="text-right tabular-nums">{String(p.orders ?? p.order_count ?? "—")}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(Number(p.revenue_12m ?? p.total_revenue ?? 0))}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.avg_days_between_orders ? `${Math.round(Number(p.avg_days_between_orders))}d` : "—"}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={trend > 0 ? "success" : trend < -30 ? "critical" : trend < 0 ? "warning" : "secondary"}>
                          {trend > 0 ? "+" : ""}{trend.toFixed(0)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.current_stock != null ? String(p.current_stock) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {Array.isArray(pp.volume_drops) && pp.volume_drops.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <TrendingDown className="h-3.5 w-3.5 text-red-500" />
              Caidas de Volumen
            </p>
            <div className="flex flex-wrap gap-2">
              {pp.volume_drops.map((d: Record<string, unknown>, i: number) => (
                <Badge key={i} variant="critical" className="gap-1">
                  {String(d.product_name ?? d.name ?? "Producto")}
                  {d.drop_pct != null && ` (${Number(d.drop_pct).toFixed(0)}%)`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {Array.isArray(pp.cross_sell) && pp.cross_sell.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              Oportunidades Cross-sell
            </p>
            <div className="flex flex-wrap gap-2">
              {pp.cross_sell.map((cs: Record<string, unknown>, i: number) => (
                <Badge key={i} variant="success" className="gap-1">
                  {String(cs.product_name ?? cs.name ?? "Producto")}
                  {cs.adoption_rate != null && ` (${Math.round(Number(cs.adoption_rate) * 100)}% adopcion)`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {Array.isArray(pp.discount_anomalies) && pp.discount_anomalies.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Descuentos Inusuales</p>
            <div className="flex flex-wrap gap-2">
              {pp.discount_anomalies.map((da: Record<string, unknown>, i: number) => (
                <Badge key={i} variant="warning">
                  {String(da.product_name ?? da.name ?? "Producto")}: {String(da.discount_applied ?? da.discount ?? "?")}%
                  {da.avg_discount != null && ` (prom ${Number(da.avg_discount).toFixed(1)}%)`}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function InventoryIntelligence({ inv }: { inv: any }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Package className="h-4 w-4" />
          Inteligencia de Inventario
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          {inv.can_fulfill_next_order != null && (
            <div className="flex items-center gap-1.5">
              {inv.can_fulfill_next_order ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              <span className="text-sm">
                {inv.can_fulfill_next_order ? "Puede cumplir proximo pedido" : "No puede cumplir proximo pedido"}
              </span>
            </div>
          )}
          {inv.estimated_next_order_days != null && (
            <Badge variant="info">
              Proximo pedido en ~{Math.round(Number(inv.estimated_next_order_days))} dias
            </Badge>
          )}
        </div>

        {Array.isArray(inv.products) && inv.products.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Dias Inventario</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.products.map((p: Record<string, unknown>, i: number) => {
                  const status = String(p.status ?? "unknown");
                  const statusVariant: Record<string, "success" | "warning" | "critical" | "secondary"> = {
                    healthy: "success",
                    low: "warning",
                    critical: "critical",
                    stockout: "critical",
                  };
                  const Icon = status === "stockout" ? PackageX : undefined;
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{String(p.name ?? p.product_name ?? "—")}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.qty_available != null ? String(p.qty_available) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.days_of_inventory != null ? `${Math.round(Number(p.days_of_inventory))}d` : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[status] ?? "secondary"} className="gap-1">
                          {Icon && <Icon className="h-3 w-3" />}
                          {status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PaymentBehavior({ pay }: { pay: any }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CreditCard className="h-4 w-4" />
          Comportamiento de Pago
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {pay.compliance_score != null && (
            <div>
              <p className="text-xs text-muted-foreground">Compliance</p>
              <div className="mt-1 flex items-center gap-2">
                <Progress value={Number(pay.compliance_score)} className="flex-1" />
                <span className="text-sm font-bold tabular-nums">{Math.round(Number(pay.compliance_score))}%</span>
              </div>
            </div>
          )}
          {pay.avg_days_late != null && (
            <div>
              <p className="text-xs text-muted-foreground">Prom. dias tarde</p>
              <p className={cn(
                "mt-1 text-2xl font-bold tabular-nums",
                Number(pay.avg_days_late) > 15 ? "text-red-600 dark:text-red-400" :
                Number(pay.avg_days_late) > 5 ? "text-amber-600 dark:text-amber-400" :
                "text-emerald-600 dark:text-emerald-400"
              )}>
                {Math.round(Number(pay.avg_days_late))}d
              </p>
            </div>
          )}
          {pay.trend && (
            <div>
              <p className="text-xs text-muted-foreground">Tendencia</p>
              <p className="mt-1 text-lg font-bold">
                {pay.trend === "improving" ? "↑ Mejorando" :
                 pay.trend === "declining" ? "↓ Declinando" : "→ Estable"}
              </p>
            </div>
          )}
          {pay.payment_term && (
            <div>
              <p className="text-xs text-muted-foreground">Termino de pago</p>
              <p className="mt-1 text-sm font-medium">
                {String(pay.payment_term.name ?? pay.payment_term)}
                {pay.payment_term.days != null && ` (${pay.payment_term.days}d)`}
              </p>
            </div>
          )}
        </div>

        {Array.isArray(pay.recent_invoices) && pay.recent_invoices.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factura</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Pago</TableHead>
                  <TableHead className="text-right">Dias Dif.</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pay.recent_invoices.slice(0, 10).map((inv: Record<string, unknown>, i: number) => {
                  const daysDiff = Number(inv.days_diff ?? inv.days_late ?? 0);
                  const status = String(inv.status ?? inv.payment_state ?? "—");
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{String(inv.name ?? inv.number ?? `#${i + 1}`)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{String(inv.due_date ?? inv.date_due ?? "—")}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{String(inv.payment_date ?? "—")}</TableCell>
                      <TableCell className={cn(
                        "text-right tabular-nums",
                        daysDiff > 15 ? "text-red-600 dark:text-red-400 font-medium" :
                        daysDiff > 0 ? "text-amber-600 dark:text-amber-400" : ""
                      )}>
                        {daysDiff > 0 ? `+${daysDiff}` : daysDiff}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          status === "paid" ? "success" :
                          status === "overdue" ? "critical" :
                          status === "partial" ? "warning" : "secondary"
                        }>
                          {status === "paid" ? "Pagada" :
                           status === "overdue" ? "Vencida" :
                           status === "partial" ? "Parcial" :
                           status === "not_paid" ? "Pendiente" : status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {Array.isArray(pay.worst_offenders) && pay.worst_offenders.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Facturas mas retrasadas</p>
            <div className="flex flex-wrap gap-2">
              {pay.worst_offenders.map((wo: Record<string, unknown>, i: number) => (
                <Badge key={i} variant="critical">
                  {String(wo.name ?? wo.number ?? `#${i + 1}`)} — {String(wo.days_late ?? wo.days_diff ?? "?")}d tarde
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
