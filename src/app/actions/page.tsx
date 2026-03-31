"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ArrowUpCircle,
  Search,
  ClipboardList,
  Clock,
  Loader2,
  PauseCircle,
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
import { AssigneeSelect } from "@/components/shared/assignee-select";
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
  const [searchText, setSearchText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [totalCounts, setTotalCounts] = useState({ pending: 0, overdue: 0, completed: 0 });

  useEffect(() => {
    async function fetchActions() {
      const today = new Date().toISOString().split("T")[0];
      const [dataRes, pendingRes, overdueRes, completedRes] = await Promise.all([
        supabase.from("action_items").select("*").order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(PAGE_SIZE),
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending").lt("due_date", today),
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "completed"),
      ]);

      if (!dataRes.error && dataRes.data) {
        setActions(dataRes.data as ActionItem[]);
        setHasMore(dataRes.data.length === PAGE_SIZE);
      }
      setTotalCounts({
        pending: pendingRes.count ?? 0,
        overdue: overdueRes.count ?? 0,
        completed: completedRes.count ?? 0,
      });
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
    const map = new Map<string, string>();
    for (const a of actions) {
      const email = a.assignee_email;
      if (email) {
        map.set(email, a.assignee_name ?? email);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]));
  }, [actions]);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return actions.filter((a) => {
      if (stateFilter !== "all" && a.state !== stateFilter) return false;
      if (priorityFilter !== "all" && a.priority !== priorityFilter) return false;
      if (assigneeFilter !== "all" && a.assignee_email !== assigneeFilter) return false;
      if (q && !a.description.toLowerCase().includes(q) && !(a.contact_name ?? "").toLowerCase().includes(q) && !(a.contact_company ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [actions, stateFilter, priorityFilter, assigneeFilter, searchText]);

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

  async function bulkUpdateState(state: "completed" | "dismissed") {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const updates: Record<string, unknown> = { state };
    if (state === "completed") {
      updates.completed_at = new Date().toISOString();
    }
    const { error } = await supabase.from("action_items").update(updates).in("id", ids);
    if (error) {
      toast.error("Error al actualizar acciones");
      return;
    }
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
    toast.success(`${ids.length} accion${ids.length > 1 ? "es" : ""} actualizada${ids.length > 1 ? "s" : ""}`);
  }

  async function markCompleted(id: number) {
    const { error } = await supabase
      .from("action_items")
      .update({ state: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("Error al completar accion");
      return;
    }
    setActions((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, state: "completed" as const, completed_at: new Date().toISOString() }
          : a
      )
    );
    toast.success("Accion completada");
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

  async function reassign(id: number, email: string | null, name: string | null) {
    const { error } = await supabase
      .from("action_items")
      .update({ assignee_email: email, assignee_name: name })
      .eq("id", id);
    if (error) {
      toast.error("Error al reasignar");
      return;
    }
    setActions((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, assignee_email: email, assignee_name: name } : a
      )
    );
    toast.success(`Asignado a ${name ?? "nadie"}`);
  }

  async function updateState(id: number, state: string) {
    const updates: Record<string, unknown> = { state };
    if (state === "completed") updates.completed_at = new Date().toISOString();
    const { error } = await supabase
      .from("action_items")
      .update(updates)
      .eq("id", id);
    if (error) {
      toast.error("Error al actualizar estado");
      return;
    }
    setActions((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, state, ...(state === "completed" ? { completed_at: new Date().toISOString() } : {}) } : a
      )
    );
    toast.success(`Estado: ${state}`);
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

      {/* Quick stats bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ClipboardList className="h-4 w-4" />
            <span className="text-xs font-medium">Total</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{counts.pending + counts.overdue + counts.completed}</p>
        </div>
        <div className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-medium">Pendientes</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{counts.pending}</p>
        </div>
        <div className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs font-medium">Vencidas</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{counts.overdue}</p>
        </div>
        <div className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-medium">Completadas</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{counts.completed}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar acciones..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Filters - horizontally scrollable on mobile */}
      <div className="flex items-center gap-3 overflow-x-auto pb-1 -mb-1 scrollbar-none">
        <Select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="min-w-[160px] shrink-0"
        >
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="in_progress">En progreso</option>
          <option value="blocked">Bloqueadas</option>
          <option value="escalated">Escaladas</option>
          <option value="completed">Completadas</option>
          <option value="dismissed">Descartadas</option>
        </Select>

        <Select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="min-w-[160px] shrink-0"
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
            className="min-w-[170px] shrink-0"
          >
            <option value="all">Todos los responsables</option>
            {assignees.map(([email, name]) => (
              <option key={email} value={email}>{name}</option>
            ))}
          </Select>
        )}
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
            <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5">
              <input
                type="checkbox"
                checked={filtered.length > 0 && selectedIds.size === filtered.length}
                onChange={toggleSelectAll}
                className="h-5 w-5 rounded border-gray-300"
              />
              <span className="text-sm text-muted-foreground">
                Seleccionar todas ({filtered.length})
              </span>
              {selectedIds.size > 0 && (
                <Button size="sm" variant="outline" className="ml-auto h-8 text-xs" onClick={() => bulkUpdateState("completed")}>
                  Completar sel.
                </Button>
              )}
            </div>

            {filtered.map((action) => {
              const overdue = isOverdue(action);
              const reason = (action as unknown as Record<string, unknown>).reason;
              const priorityColor: Record<string, string> = {
                high: "bg-red-500",
                medium: "bg-amber-500",
                low: "bg-gray-400",
              };
              return (
                <div key={action.id} className="relative overflow-hidden rounded-lg border bg-card">
                  {/* Priority color bar on left */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${priorityColor[action.priority] ?? "bg-gray-400"}`} />
                  <div className="p-4 pl-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(action.id)}
                        onChange={() => toggleSelect(action.id)}
                        className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300"
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
                      {(action.assignee_name || action.assignee_email) && (
                        <span className="text-xs text-muted-foreground">{action.assignee_name ?? action.assignee_email}</span>
                      )}
                    </div>
                    {/* Inline quick actions - always visible with proper touch targets */}
                    <div className="flex items-center gap-1 pt-1">
                      {(action.state === "pending" || action.state === "in_progress") && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Completar"
                            className="h-10 min-w-[44px] gap-1.5 text-xs"
                            onClick={() => markCompleted(action.id)}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Completar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Descartar"
                            className="h-10 min-w-[44px] gap-1.5 text-xs"
                            onClick={() => dismiss(action.id)}
                          >
                            <XCircle className="h-4 w-4" />
                            Descartar
                          </Button>
                        </>
                      )}
                      {(action.state === "blocked" || action.state === "escalated") && (
                        <Button size="sm" variant="outline" className="h-10 text-xs" onClick={() => updateState(action.id, "pending")}>
                          Reactivar
                        </Button>
                      )}
                      <div className="ml-auto">
                        <FeedbackButtons
                          table="action_items"
                          id={action.id}
                          currentFeedback={null}
                        />
                      </div>
                    </div>
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
                  <TableHead className="w-[140px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((action) => {
                  const overdue = isOverdue(action);
                  const priorityDot: Record<string, string> = {
                    high: "bg-red-500",
                    medium: "bg-amber-500",
                    low: "bg-gray-400",
                  };
                  return (
                    <TableRow key={action.id} className="group transition-colors hover:bg-muted/50">
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
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${priorityDot[action.priority] ?? "bg-gray-400"}`} />
                          <Badge
                            variant={priorityVariantMap[action.priority] ?? "secondary"}
                          >
                            {priorityLabelMap[action.priority] ?? action.priority}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StateBadge state={action.state} />
                      </TableCell>
                      <TableCell>
                        <AssigneeSelect
                          value={action.assignee_email}
                          onChange={(email, name) => reassign(action.id, email, name)}
                          className="h-8 text-xs w-[140px]"
                        />
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
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {(action.state === "pending" || action.state === "in_progress") && (
                            <>
                              <Button size="sm" variant="ghost" title="Completar" className="h-8 w-8 p-0" onClick={() => markCompleted(action.id)}>
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" title="Bloqueada" className="h-8 w-8 p-0" onClick={() => updateState(action.id, "blocked")}>
                                <PauseCircle className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" title="Escalar" className="h-8 w-8 p-0" onClick={() => updateState(action.id, "escalated")}>
                                <ArrowUpCircle className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" title="Descartar" className="h-8 w-8 p-0" onClick={() => dismiss(action.id)}>
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {(action.state === "blocked" || action.state === "escalated") && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateState(action.id, "pending")}>
                              Reactivar
                            </Button>
                          )}
                        </div>
                        {action.state !== "pending" && action.state !== "in_progress" && action.state !== "blocked" && action.state !== "escalated" && (
                          <FeedbackButtons table="action_items" id={action.id} currentFeedback={null} />
                        )}
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
