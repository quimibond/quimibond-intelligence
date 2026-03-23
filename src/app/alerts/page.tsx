"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, ChevronDown, Eye, ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import type { Alert } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");

  useEffect(() => {
    async function fetchAlerts() {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (!error && data) {
        setAlerts(data as Alert[]);
      }
      setLoading(false);
    }
    fetchAlerts();
  }, []);

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (stateFilter !== "all" && a.state !== stateFilter) return false;
      return true;
    });
  }, [alerts, severityFilter, stateFilter]);

  const counts = useMemo(() => {
    const newCount = alerts.filter((a) => a.state === "new").length;
    const acknowledgedCount = alerts.filter((a) => a.state === "acknowledged").length;
    const resolvedCount = alerts.filter((a) => a.state === "resolved").length;
    return { newCount, acknowledgedCount, resolvedCount };
  }, [alerts]);

  async function updateState(id: string, state: "acknowledged" | "resolved") {
    const updates: Record<string, unknown> = { state };
    if (state === "resolved") {
      updates.resolved_at = new Date().toISOString();
    }
    const { error } = await supabase.from("alerts").update(updates).eq("id", id);
    if (!error) {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, state, ...(state === "resolved" ? { resolved_at: new Date().toISOString() } : {}) } : a
        )
      );
    }
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Severidad</TableHead>
              <TableHead>Titulo</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Tipo</TableHead>
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
                  <TableCell>
                    <SeverityBadge severity={alert.severity} />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      {alert.title}
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${
                          expandedId === alert.id ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </TableCell>
                  <TableCell>{alert.contact_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{alert.alert_type}</Badge>
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
                    <TableCell colSpan={6}>
                      <div className="space-y-3 rounded-lg bg-muted/50 p-4">
                        {alert.description && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Descripcion
                            </p>
                            <p className="mt-0.5 text-sm">{alert.description}</p>
                          </div>
                        )}
                        {alert.business_impact && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Impacto de negocio
                            </p>
                            <p className="mt-0.5 text-sm">
                              {alert.business_impact}
                            </p>
                          </div>
                        )}
                        {alert.suggested_action && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Accion sugerida
                            </p>
                            <p className="mt-0.5 text-sm">
                              {alert.suggested_action}
                            </p>
                          </div>
                        )}
                        <div className="flex items-center gap-2 pt-1">
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
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
