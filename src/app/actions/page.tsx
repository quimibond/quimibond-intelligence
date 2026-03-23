"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  X,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, timeAgo } from "@/lib/utils";
import type { ActionItem } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
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

const priorityVariantMap: Record<string, "critical" | "warning" | "info" | "secondary"> = {
  low: "secondary",
  medium: "warning",
  high: "critical",
};

const priorityLabelMap: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

function isOverdue(item: ActionItem): boolean {
  if (item.state !== "pending" || !item.due_date) return false;
  return new Date(item.due_date) < new Date();
}

export default function ActionsPage() {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function fetchActions() {
      const { data, error } = await supabase
        .from("action_items")
        .select("*")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(200);

      if (!error && data) {
        setActions(data as ActionItem[]);
      }
      setLoading(false);
    }
    fetchActions();
  }, []);

  const filtered = useMemo(() => {
    return actions.filter((a) => {
      if (stateFilter !== "all" && a.state !== stateFilter) return false;
      if (priorityFilter !== "all" && a.priority !== priorityFilter) return false;
      return true;
    });
  }, [actions, stateFilter, priorityFilter]);

  const counts = useMemo(() => {
    const pending = actions.filter((a) => a.state === "pending").length;
    const overdue = actions.filter((a) => isOverdue(a)).length;
    const completed = actions.filter((a) => a.state === "completed").length;
    return { pending, overdue, completed };
  }, [actions]);

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

  async function bulkUpdateState(state: "completed" | "dismissed") {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const updates: Record<string, unknown> = { state };
    if (state === "completed") {
      updates.completed_date = new Date().toISOString();
    }
    const { error } = await supabase.from("action_items").update(updates).in("id", ids);
    if (!error) {
      setActions((prev) =>
        prev.map((a) =>
          selectedIds.has(a.id)
            ? {
                ...a,
                state: state as ActionItem["state"],
                ...(state === "completed"
                  ? { completed_date: new Date().toISOString() }
                  : {}),
              }
            : a
        )
      );
      setSelectedIds(new Set());
    }
  }

  async function markCompleted(id: number) {
    const { error } = await supabase
      .from("action_items")
      .update({ state: "completed", completed_date: new Date().toISOString() })
      .eq("id", id);
    if (!error) {
      setActions((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, state: "completed" as const, completed_date: new Date().toISOString() }
            : a
        )
      );
    }
  }

  async function dismiss(id: number) {
    const { error } = await supabase
      .from("action_items")
      .update({ state: "dismissed" })
      .eq("id", id);
    if (!error) {
      setActions((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, state: "dismissed" as const } : a
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
        title="Acciones"
        description="Seguimiento de acciones y tareas pendientes"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="all">Todas los estados</option>
          <option value="pending">Pendientes</option>
          <option value="completed">Completadas</option>
          <option value="dismissed">Descartadas</option>
        </Select>

        <Select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="all">Todas las prioridades</option>
          <option value="low">Baja</option>
          <option value="medium">Media</option>
          <option value="high">Alta</option>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="warning" className="gap-1.5 px-3 py-1">
          <Clock className="h-3.5 w-3.5" />
          {counts.pending} pendientes
        </Badge>
        <Badge variant="critical" className="gap-1.5 px-3 py-1">
          <AlertTriangle className="h-3.5 w-3.5" />
          {counts.overdue} vencidas
        </Badge>
        <Badge variant="success" className="gap-1.5 px-3 py-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {counts.completed} completadas
        </Badge>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Sin acciones"
          description="No hay acciones que coincidan con los filtros seleccionados."
        />
      ) : (
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
              <TableHead>Descripcion</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Prioridad</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Responsable</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead className="w-[100px]">Creada</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((action) => {
              const overdue = isOverdue(action);
              return (
                <TableRow key={action.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(action.id)}
                      onChange={() => toggleSelect(action.id)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </TableCell>
                  <TableCell className="max-w-[300px] font-medium">
                    {action.description}
                  </TableCell>
                  <TableCell>{action.contact_name ?? "—"}</TableCell>
                  <TableCell>{action.contact_company ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={priorityVariantMap[action.priority] ?? "secondary"}
                    >
                      {priorityLabelMap[action.priority] ?? action.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StateBadge state={action.state} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {action.assignee_email ?? "—"}
                  </TableCell>
                  <TableCell>
                    {action.due_date ? (
                      <span
                        className={
                          overdue
                            ? "font-medium text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }
                      >
                        {formatDate(action.due_date)}
                        {overdue && " (vencida)"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {timeAgo(action.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {action.state === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Completar"
                            onClick={() => markCompleted(action.id)}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Descartar"
                            onClick={() => dismiss(action.id)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-background px-5 py-3 shadow-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} seleccionada{selectedIds.size !== 1 ? "s" : ""}
          </span>
          <Button size="sm" variant="outline" onClick={() => bulkUpdateState("completed")}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Completar
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkUpdateState("dismissed")}>
            <XCircle className="mr-1 h-3.5 w-3.5" />
            Descartar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            <X className="mr-1 h-3.5 w-3.5" />
            Deseleccionar
          </Button>
        </div>
      )}
    </div>
  );
}
