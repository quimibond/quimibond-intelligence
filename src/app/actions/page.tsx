"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, timeAgo } from "@/lib/utils";
import type { ActionItem } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StateBadge } from "@/components/shared/state-badge";
import { FeedbackButtons } from "@/components/shared/feedback-buttons";
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

const PAGE_SIZE = 50;

export default function ActionsPage() {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function fetchActions() {
      const { data, error } = await supabase
        .from("action_items")
        .select("*")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (!error && data) {
        setActions(data as ActionItem[]);
        setHasMore(data.length === PAGE_SIZE);
      }
      setLoading(false);
    }
    fetchActions();
  }, []);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { data } = await supabase
      .from("action_items")
      .select("*")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(actions.length, actions.length + PAGE_SIZE - 1);
    if (data) {
      setActions((prev) => [...prev, ...(data as ActionItem[])]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }

  const assignees = useMemo(() => {
    const set = new Set(actions.map((a) => a.assignee_email).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [actions]);

  const filtered = useMemo(() => {
    return actions.filter((a) => {
      if (stateFilter !== "all" && a.state !== stateFilter) return false;
      if (priorityFilter !== "all" && a.priority !== priorityFilter) return false;
      if (assigneeFilter !== "all" && a.assignee_email !== assigneeFilter) return false;
      return true;
    });
  }, [actions, stateFilter, priorityFilter, assigneeFilter]);

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
      updates.completed_at = new Date().toISOString();
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
                  ? { completed_at: new Date().toISOString() }
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
      .update({ state: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    if (!error) {
      setActions((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, state: "completed" as const, completed_at: new Date().toISOString() }
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

        {assignees.length > 0 && (
          <Select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          >
            <option value="all">Todos los responsables</option>
            {assignees.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
        )}
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
        <>
          {/* Mobile card layout */}
          <div className="space-y-3 md:hidden">
            {/* Select all row for mobile */}
            <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2">
              <input
                type="checkbox"
                checked={filtered.length > 0 && selectedIds.size === filtered.length}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm text-muted-foreground">
                Seleccionar todas ({filtered.length})
              </span>
            </div>

            {filtered.map((action) => {
              const overdue = isOverdue(action);
              const reason = (action as unknown as Record<string, unknown>).reason;
              return (
                <div key={action.id} className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(action.id)}
                      onChange={() => toggleSelect(action.id)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{action.description}</p>
                      {typeof reason === "string" && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {reason}
                        </p>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">
                        {action.contact_id ? (
                          <Link href={`/contacts/${action.contact_id}`} className="text-primary hover:underline">
                            {action.contact_name ?? "—"}
                          </Link>
                        ) : (action.contact_name ?? "—")}
                        {" · "}
                        {action.company_id ? (
                          <Link href={`/companies/${action.company_id}`} className="text-primary hover:underline">
                            {action.contact_company ?? "—"}
                          </Link>
                        ) : (action.contact_company ?? "—")}
                        {" · "}
                        {timeAgo(action.created_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={priorityVariantMap[action.priority] ?? "secondary"}>
                      {priorityLabelMap[action.priority] ?? action.priority}
                    </Badge>
                    <StateBadge state={action.state} />
                    {overdue && action.due_date && (
                      <Badge variant="critical">Vencida {formatDate(action.due_date)}</Badge>
                    )}
                    {!overdue && action.due_date && (
                      <span className="text-xs text-muted-foreground">
                        Vence {formatDate(action.due_date)}
                      </span>
                    )}
                    {action.assignee_email && (
                      <span className="text-xs text-muted-foreground">{action.assignee_email}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
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
                    <FeedbackButtons
                      table="action_items"
                      id={action.id}
                      currentFeedback={null}
                    />
                  </div>
                </div>
              );
            })}
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
                      <TableCell className="max-w-[300px]">
                        <p className="font-medium">{action.description}</p>
                        {typeof (action as unknown as Record<string, unknown>).reason === "string" && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {(action as unknown as Record<string, unknown>).reason as string}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {action.contact_id ? (
                          <Link href={`/contacts/${action.contact_id}`} className="text-primary hover:underline">
                            {action.contact_name ?? "—"}
                          </Link>
                        ) : (action.contact_name ?? "—")}
                      </TableCell>
                      <TableCell>
                        {action.company_id ? (
                          <Link href={`/companies/${action.company_id}`} className="text-primary hover:underline">
                            {action.contact_company ?? "—"}
                          </Link>
                        ) : (action.contact_company ?? "—")}
                      </TableCell>
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
                          <FeedbackButtons
                            table="action_items"
                            id={action.id}
                            currentFeedback={null}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
        <div className="fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 md:gap-3 rounded-lg border bg-background px-3 md:px-5 py-3 shadow-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} seleccionada{selectedIds.size !== 1 ? "s" : ""}
          </span>
          <Button size="sm" variant="outline" onClick={() => bulkUpdateState("completed")}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            <span className="hidden md:inline">Completar</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkUpdateState("dismissed")}>
            <XCircle className="mr-1 h-3.5 w-3.5" />
            <span className="hidden md:inline">Descartar</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            <X className="mr-1 h-3.5 w-3.5" />
            <span className="hidden md:inline">Deseleccionar</span>
          </Button>
        </div>
      )}
    </div>
  );
}
