"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader2,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ActionItem } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select-native";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ActionMobileCard } from "./components/action-mobile-card";
import { ActionDesktopRow } from "./components/action-desktop-row";

const PAGE_SIZE = 50;

export default function ActionsPage() {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("active");
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
      if (stateFilter === "active" && a.state === "dismissed") return false;
      if (stateFilter !== "all" && stateFilter !== "active" && a.state !== stateFilter) return false;
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
          <div className="flex items-center gap-2 text-warning-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-medium">Pendientes</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{counts.pending}</p>
        </div>
        <div className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2 text-danger-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs font-medium">Vencidas</span>
          </div>
          <p className="mt-1 text-2xl font-bold">{counts.overdue}</p>
        </div>
        <div className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2 text-success-foreground">
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
          aria-label="Filtrar por estado"
        >
          <option value="active">Activas (sin descartadas)</option>
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
          aria-label="Filtrar por prioridad"
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
            aria-label="Filtrar por responsable"
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
                className="h-5 w-5 rounded border-input"
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

            {filtered.map((action) => (
              <ActionMobileCard
                key={action.id}
                action={action}
                selected={selectedIds.has(action.id)}
                onToggleSelect={toggleSelect}
                onComplete={markCompleted}
                onDismiss={dismiss}
                onUpdateState={updateState}
              />
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
                      className="h-4 w-4 rounded border-input"
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
                {filtered.map((action) => (
                  <ActionDesktopRow
                    key={action.id}
                    action={action}
                    selected={selectedIds.has(action.id)}
                    onToggleSelect={toggleSelect}
                    onComplete={markCompleted}
                    onDismiss={dismiss}
                    onUpdateState={updateState}
                    onReassign={reassign}
                  />
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
