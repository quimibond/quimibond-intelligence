"use client";

import {
  TrendingDown,
  Sparkles,
  Brain,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Company, Fact } from "@/lib/types";
import type { ResolvedRelationship } from "./types";
import { EntityLink } from "@/components/shared/entity-link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TabResumenProps {
  company: Company;
  relationships: ResolvedRelationship[];
}

export function TabResumen({ company, relationships }: TabResumenProps) {
  const riskSignals = Array.isArray(company.risk_signals)
    ? (company.risk_signals as string[])
    : [];
  const opportunitySignals = Array.isArray(company.opportunity_signals)
    ? (company.opportunity_signals as string[])
    : [];

  return (
    <div className="space-y-6">
      {/* Description & business type */}
      <Card>
        <CardHeader>
          <CardTitle>Informacion General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {company.description && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Descripcion
              </p>
              <p className="mt-1 text-sm">{company.description}</p>
            </div>
          )}
          {company.business_type && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Tipo de negocio
              </p>
              <p className="mt-1 text-sm">{company.business_type}</p>
            </div>
          )}
          {company.relationship_summary && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Resumen de relacion
              </p>
              <p className="mt-1 text-sm">
                {company.relationship_summary}
              </p>
            </div>
          )}
          {company.relationship_type && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Tipo de relacion
              </p>
              <Badge variant="outline">{company.relationship_type}</Badge>
            </div>
          )}
          {company.strategic_notes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Notas estrategicas
              </p>
              <p className="mt-1 text-sm">{company.strategic_notes}</p>
            </div>
          )}
          {!company.description &&
            !company.business_type &&
            !company.relationship_summary &&
            !company.strategic_notes && (
              <p className="text-sm text-muted-foreground">
                Sin informacion general disponible. Usa el boton Enriquecer
                para obtener datos.
              </p>
            )}
        </CardContent>
      </Card>

      {/* Risk signals */}
      {riskSignals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">
              Senales de Riesgo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-red-600 dark:text-red-400">
              {riskSignals.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Opportunity signals */}
      {opportunitySignals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-emerald-600 dark:text-emerald-400">
              Senales de Oportunidad
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-emerald-600 dark:text-emerald-400">
              {opportunitySignals.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Odoo context: Purchase patterns, Inventory at risk, Cross-sell */}
      <OdooContextCards company={company} />

      {/* Relationships */}
      {relationships.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Relaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {relationships.map((rel) => (
                <div
                  key={rel.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {rel.related_entity?.name ?? "Entidad desconocida"}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline">
                        {rel.relationship_type}
                      </Badge>
                      {rel.related_entity?.entity_type && (
                        <Badge variant="secondary">
                          {rel.related_entity.entity_type}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {rel.strength != null && (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {(rel.strength * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Sub-component for Odoo context cards ──

function OdooContextCards({ company }: { company: Company }) {
  const ctx = company.odoo_context ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pp = ctx.purchase_patterns as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invAtRisk = pp?.inventory_at_risk ?? ctx.inventory_at_risk;

  return (
    <>
      {/* Volume drops */}
      {Array.isArray(pp?.volume_drops) && pp.volume_drops.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <TrendingDown className="h-4 w-4" />
              Caidas de Volumen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {pp.volume_drops.map((d: Record<string, unknown>, i: number) => (
                <Badge key={i} variant="critical" className="gap-1">
                  {String(d.product_name ?? d.name ?? "Producto")}
                  {d.drop_pct != null && ` (${Number(d.drop_pct).toFixed(0)}%)`}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cross-sell */}
      {Array.isArray(pp?.cross_sell) && pp.cross_sell.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-4 w-4" />
              Oportunidades Cross-sell
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {pp.cross_sell.map((cs: Record<string, unknown>, i: number) => (
                <Badge key={i} variant="success" className="gap-1">
                  {String(cs.product_name ?? cs.name ?? "Producto")}
                  {cs.adoption_rate != null && ` (${Math.round(Number(cs.adoption_rate) * 100)}%)`}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Discount anomalies */}
      {Array.isArray(pp?.discount_anomalies) && pp.discount_anomalies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-amber-600 dark:text-amber-400">Descuentos Inusuales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {pp.discount_anomalies.map((da: Record<string, unknown>, i: number) => (
                <Badge key={i} variant="warning">
                  {String(da.product_name ?? da.name ?? "Producto")}: {String(da.discount_applied ?? da.discount ?? "?")}%
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue 12m summary */}
      {pp?.total_revenue_12m != null && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Revenue Total 12m (desde compras)</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
              {formatCurrency(Number(pp.total_revenue_12m))}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Inventory at risk */}
      {Array.isArray(invAtRisk) && invAtRisk.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Inventario en Riesgo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Dias Inv.</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invAtRisk.map((p: Record<string, unknown>, i: number) => {
                    const status = String(p.status ?? "—");
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-medium text-sm">{String(p.name ?? p.product_name ?? "—")}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.qty_available != null ? String(p.qty_available) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.days_of_inventory != null ? `${Math.round(Number(p.days_of_inventory))}d` : "—"}</TableCell>
                        <TableCell>
                          <Badge variant={
                            status === "stockout" ? "critical" :
                            status === "critical" ? "critical" :
                            status === "low" ? "warning" : "secondary"
                          }>
                            {status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
