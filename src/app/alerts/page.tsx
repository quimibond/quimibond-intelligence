"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  Search,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Eye,
  Loader2,
  Package,
  PackageX,
  Percent,
  ShieldAlert,
  ShoppingCart,
  DollarSign,
  TrendingDown,
  X,
  Download,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo, formatCurrency } from "@/lib/utils";
import { exportCSV } from "@/lib/export-csv";
import type { Alert } from "@/lib/types";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { FeedbackButtons } from "@/components/shared/feedback-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

// Icon per alert_type for the new product/inventory/payment types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const alertTypeIcon: Record<string, any> = {
  volume_drop: TrendingDown,
  unusual_discount: Percent,
  cross_sell: ShoppingCart,
  stockout_risk: PackageX,
  reorder_needed: Package,
  payment_compliance: CreditCard,
};

// Category colors for badge variants
const categoryVariant: Record<string, "info" | "warning" | "secondary"> = {
  comercial: "info",
  operativo: "warning",
  financiero: "secondary",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sortBy, setSortBy] = useState<string>("recent");
  const [searchText, setSearchText] = useState("");
  const [alertTypeNames, setAlertTypeNames] = useState<Record<string, string>>({});
  const [alertTypeCategories, setAlertTypeCategories] = useState<Record<string, string>>({});
  const [totalCounts, setTotalCounts] = useState({ newCount: 0, acknowledgedCount: 0, resolvedCount: 0 });

  useEffect(() => {
    async function fetchAlerts() {
      // Fetch page + total counts in parallel
      const [alertsRes, newRes, ackRes, resRes] = await Promise.all([
        supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "acknowledged"),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "resolved"),
      ]);

      if (!alertsRes.error && alertsRes.data) {
        setAlerts(alertsRes.data as Alert[]);
        setHasMore(alertsRes.data.length === PAGE_SIZE);
      }
      // Alert type display names (hardcoded — alert_type_catalog was removed)
      const nameMap: Record<string, string> = {
        no_response: "Sin respuesta", stalled_thread: "Hilo estancado",
        high_volume: "Alto volumen", overdue_invoice: "Factura vencida",
        at_risk_client: "Cliente en riesgo", accountability: "Responsabilidad",
        anomaly: "Anomalia", competitor: "Competidor",
        negative_sentiment: "Sentimiento negativo", churn_risk: "Riesgo de churn",
        invoice_silence: "Silencio de factura", delivery_risk: "Riesgo de entrega",
        payment_delay: "Retraso de pago", opportunity: "Oportunidad",
        quality_issue: "Problema de calidad", volume_drop: "Caida de volumen",
        unusual_discount: "Descuento inusual", cross_sell: "Cross-sell",
        stockout_risk: "Riesgo de desabasto", reorder_needed: "Reorden necesario",
        payment_compliance: "Compliance de pago",
      };
      setAlertTypeNames(nameMap);
      setAlertTypeCategories({});
      setTotalCounts({
        newCount: newRes.count ?? 0,
        acknowledgedCount: ackRes.count ?? 0,
        resolvedCount: resRes.count ?? 0,
      });
      setLoading(false);
    }
    fetchAlerts();
  }, []);

  const alertTypes = useMemo(() => {
    const types = new Set(alerts.map((a) => a.alert_type));
    return Array.from(types).sort();
  }, [alerts]);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const result = alerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (stateFilter !== "all" && a.state !== stateFilter) return false;
      if (typeFilter !== "all" && a.alert_type !== typeFilter) return false;
      if (q && !a.title.toLowerCase().includes(q) && !(a.contact_name ?? "").toLowerCase().includes(q) && !(a.description ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortBy === "urgency") {
      result.sort((a, b) => (b.urgency_score ?? 0) - (a.urgency_score ?? 0));
    } else if (sortBy === "value") {
      result.sort((a, b) => (b.business_value_at_risk ?? 0) - (a.business_value_at_risk ?? 0));
    }
    // "recent" keeps default order (created_at DESC from API)
    return result;
  }, [alerts, severityFilter, stateFilter, typeFilter, sortBy, searchText]);

  const counts = totalCounts;

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === filtered.length
        ? new Set()
        : new Set(filtered.map((a) => a.id))
    );
  }, [filtered]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { data } = await supabase
      .from("alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .range(alerts.length, alerts.length + PAGE_SIZE - 1);
    if (data) {
      setAlerts((prev) => [...prev, ...(data as Alert[])]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }

  async function bulkUpdateState(state: "acknowledged" | "resolved") {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const updates: Record<string, unknown> = { state };
    if (state === "resolved") {
      updates.resolved_at = new Date().toISOString();
    }
    const { error } = await supabase.from("alerts").update(updates).in("id", ids);
    if (error) {
      toast.error("Error al actualizar alertas");
      return;
    }
    setAlerts((prev) =>
      prev.map((a) =>
        selectedIds.has(a.id)
          ? { ...a, state, ...(state === "resolved" ? { resolved_at: new Date().toISOString() } : {}) }
          : a
      )
    );
    setSelectedIds(new Set());
    toast.success(`${ids.length} alerta${ids.length > 1 ? "s" : ""} actualizada${ids.length > 1 ? "s" : ""}`);
  }

  async function updateState(id: number, state: "acknowledged" | "resolved") {
    const updates: Record<string, unknown> = { state };
    if (state === "resolved") {
      updates.resolved_at = new Date().toISOString();
    }
    const { error } = await supabase.from("alerts").update(updates).eq("id", id);
    if (error) {
      toast.error("Error al actualizar alerta");
      return;
    }
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, state, ...(state === "resolved" ? { resolved_at: new Date().toISOString() } : {}) } : a
      )
    );
    toast.success("Alerta actualizada");
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-5 w-80" />
        <div className="flex gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertas"
        description="Centro de alertas e inteligencia de riesgos"
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar alertas..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="all">Todas las severidades</option>
          <option value="low">Baja</option>
          <option value="medium">Media</option>
          <option value="high">Alta</option>
          <option value="critical">Critica</option>
        </Select>

        <Select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="all">Todos los estados</option>
          <option value="new">Nuevas</option>
          <option value="acknowledged">Reconocidas</option>
          <option value="resolved">Resueltas</option>
        </Select>

        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">Todos los tipos</option>
          {alertTypes.map((t) => (
            <option key={t} value={t}>{alertTypeNames[t] ?? t}</option>
          ))}
        </Select>

        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="recent">Mas recientes</option>
          <option value="urgency">Mayor urgencia</option>
          <option value="value">Mayor valor en riesgo</option>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => exportCSV(
            filtered.map((a) => ({
              titulo: a.title,
              severidad: a.severity,
              estado: a.state,
              tipo: a.alert_type,
              contacto: a.contact_name ?? "",
              empresa: "",
              valor_en_riesgo: a.business_value_at_risk ?? "",
              fecha: a.created_at,
            })),
            `alertas-${new Date().toISOString().split("T")[0]}`,
            [
              { key: "titulo", label: "Titulo" },
              { key: "severidad", label: "Severidad" },
              { key: "estado", label: "Estado" },
              { key: "tipo", label: "Tipo" },
              { key: "contacto", label: "Contacto" },
              { key: "empresa", label: "Empresa" },
              { key: "valor_en_riesgo", label: "Valor en Riesgo" },
              { key: "fecha", label: "Fecha" },
            ]
          )}
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Exportar</span>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="info" className="gap-1.5 px-3 py-1">
          <Bell className="h-3.5 w-3.5" />
          {counts.newCount} nuevas
        </Badge>
        <Badge variant="warning" className="gap-1.5 px-3 py-1">
          <Eye className="h-3.5 w-3.5" />
          {counts.acknowledgedCount} reconocidas
        </Badge>
        <Badge variant="success" className="gap-1.5 px-3 py-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {counts.resolvedCount} resueltas
        </Badge>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="Sin alertas"
          description="No hay alertas que coincidan con los filtros seleccionados."
        />
      ) : (
        <>
          {/* Mobile card layout */}
          <div className="space-y-3 md:hidden">
            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                checked={filtered.length > 0 && selectedIds.size === filtered.length}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-xs text-muted-foreground">Seleccionar todas</span>
            </div>
            {filtered.map((alert) => (
              <div
                key={alert.id}
                className="rounded-lg border bg-card p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(alert.id)}
                      onChange={() => toggleSelect(alert.id)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300"
                    />
                    <div className="min-w-0">
                      <Link href={`/alerts/${alert.id}`} className="text-sm font-medium hover:underline line-clamp-2">
                        {alert.title}
                      </Link>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {alert.contact_id ? (
                          <Link href={`/contacts/${alert.contact_id}`} className="text-primary hover:underline">
                            {alert.contact_name ?? "—"}
                          </Link>
                        ) : (
                          alert.contact_name ?? "—"
                        )}
                        {" · "}{timeAgo(alert.created_at)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
                    className="shrink-0 p-1"
                  >
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        expandedId === alert.id ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={alert.severity} />
                  <StateBadge state={alert.state} />
                  {(() => {
                    const TypeIcon = alertTypeIcon[alert.alert_type];
                    const cat = alertTypeCategories[alert.alert_type];
                    const variant = (cat ? categoryVariant[cat] : undefined) ?? "secondary";
                    return (
                      <Badge variant={variant} className="gap-1">
                        {TypeIcon && <TypeIcon className="h-3 w-3" />}
                        {alertTypeNames[alert.alert_type] ?? alert.alert_type}
                      </Badge>
                    );
                  })()}
                  {alert.business_value_at_risk != null && alert.business_value_at_risk > 0 && (
                    <Badge variant="warning" className="gap-1">
                      <DollarSign className="h-3 w-3" />
                      {formatCurrency(alert.business_value_at_risk)} en riesgo
                    </Badge>
                  )}
                </div>
                {expandedId === alert.id && (
                  <div className="space-y-3 rounded-lg bg-muted/50 p-3">
                    {alert.description && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Descripcion</p>
                        <p className="mt-0.5 text-sm">{alert.description}</p>
                      </div>
                    )}
                    {(() => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const a = alert as any;
                      return (
                        <>
                          {a.business_impact && (
                            <div>
                              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Impacto de Negocio</p>
                              <p className="mt-0.5 text-sm">{String(a.business_impact)}</p>
                            </div>
                          )}
                          {a.suggested_action && (
                            <div>
                              <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Accion Sugerida</p>
                              <p className="mt-0.5 text-sm">{String(a.suggested_action)}</p>
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        {alert.state === "new" && (
                          <Button size="sm" variant="outline" onClick={() => updateState(alert.id, "acknowledged")}>
                            <Eye className="h-3.5 w-3.5" />
                            Reconocer
                          </Button>
                        )}
                        {alert.state !== "resolved" && (
                          <Button size="sm" variant="outline" onClick={() => updateState(alert.id, "resolved")}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Resolver
                          </Button>
                        )}
                      </div>
                      <FeedbackButtons table="alerts" id={alert.id} currentFeedback={null} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table layout */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </TableHead>
                  <TableHead className="w-[100px]">Severidad</TableHead>
                  <TableHead>Titulo</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Valor en riesgo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-[100px]">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((alert) => (
                  <>
                    <TableRow
                      key={alert.id}
                      className="cursor-pointer"
                      onClick={() =>
                        setExpandedId(expandedId === alert.id ? null : alert.id)
                      }
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(alert.id)}
                          onChange={() => toggleSelect(alert.id)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </TableCell>
                      <TableCell>
                        <SeverityBadge severity={alert.severity} />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/alerts/${alert.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                            {alert.title}
                          </Link>
                          <ChevronDown
                            className={`h-4 w-4 text-muted-foreground transition-transform ${
                              expandedId === alert.id ? "rotate-180" : ""
                            }`}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        {alert.contact_id ? (
                          <Link href={`/contacts/${alert.contact_id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            {alert.contact_name ?? "—"}
                          </Link>
                        ) : (
                          alert.contact_name ?? "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const TypeIcon = alertTypeIcon[alert.alert_type];
                          const cat = alertTypeCategories[alert.alert_type];
                          const variant = (cat ? categoryVariant[cat] : undefined) ?? "secondary";
                          return (
                            <Badge variant={variant} className="gap-1">
                              {TypeIcon && <TypeIcon className="h-3 w-3" />}
                              {alertTypeNames[alert.alert_type] ?? alert.alert_type}
                            </Badge>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        {alert.business_value_at_risk != null && alert.business_value_at_risk > 0 ? (
                          <span className="font-medium text-amber-600 dark:text-amber-400">
                            {formatCurrency(alert.business_value_at_risk)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StateBadge state={alert.state} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {timeAgo(alert.created_at)}
                      </TableCell>
                    </TableRow>
                    {expandedId === alert.id && (
                      <TableRow key={`${alert.id}-detail`}>
                        <TableCell colSpan={8}>
                          <div className="space-y-3 rounded-lg bg-muted/50 p-4">
                            {alert.description && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground">
                                  Descripcion
                                </p>
                                <p className="mt-0.5 text-sm">{alert.description}</p>
                              </div>
                            )}
                            {(() => {
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              const a = alert as any;
                              return (
                                <>
                                  {a.business_impact && (
                                    <div>
                                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Impacto de Negocio</p>
                                      <p className="mt-0.5 text-sm">{String(a.business_impact)}</p>
                                    </div>
                                  )}
                                  {a.suggested_action && (
                                    <div>
                                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Accion Sugerida</p>
                                      <p className="mt-0.5 text-sm">{String(a.suggested_action)}</p>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                            <div className="flex items-center justify-between pt-1">
                              <div className="flex items-center gap-2">
                                {alert.state === "new" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateState(alert.id, "acknowledged");
                                    }}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    Reconocer
                                  </Button>
                                )}
                                {alert.state !== "resolved" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateState(alert.id, "resolved");
                                    }}
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Resolver
                                  </Button>
                                )}
                              </div>
                              <div onClick={(e) => e.stopPropagation()}>
                                <FeedbackButtons
                                  table="alerts"
                                  id={alert.id}
                                  currentFeedback={null}
                                />
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Load more */}
      {hasMore && filtered.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loadingMore ? "Cargando..." : "Cargar mas"}
          </Button>
        </div>
      )}

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 md:gap-3 rounded-lg border bg-background px-3 md:px-5 py-3 shadow-lg max-w-[calc(100vw-2rem)]">
          <span className="text-xs md:text-sm font-medium whitespace-nowrap">
            {selectedIds.size} sel.
          </span>
          <Button size="sm" variant="outline" onClick={() => bulkUpdateState("acknowledged")}>
            <Eye className="h-3.5 w-3.5 md:mr-1" />
            <span className="hidden md:inline">Reconocer</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkUpdateState("resolved")}>
            <CheckCircle2 className="h-3.5 w-3.5 md:mr-1" />
            <span className="hidden md:inline">Resolver</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            <X className="h-3.5 w-3.5 md:mr-1" />
            <span className="hidden md:inline">Deseleccionar</span>
          </Button>
        </div>
      )}
    </div>
  );
}
