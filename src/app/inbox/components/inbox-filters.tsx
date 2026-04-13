"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { INSIGHT_CATEGORY_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { SelectNative as Select } from "@/components/ui/select-native";

interface InboxFiltersProps {
  totalCount: number;
  filteredCount: number;
  tierCounts: { urgent: number; important: number; fyi: number };
  filterMode: "all" | "urgent" | "important" | "fyi";
  setFilterMode: (mode: "all" | "urgent" | "important" | "fyi") => void;
  assigneeFilter: string;
  setAssigneeFilter: (name: string) => void;
  allAssignees: string[];
  categoryFilter: string;
  setCategoryFilter: (cat: string) => void;
  /** Categorias unicas presentes en los insights cargados hoy. Si no se provee,
   *  se usa el catalogo completo (retrocompat). */
  availableCategories?: string[];
  dateFilter: string;
  setDateFilter: (d: string) => void;
  freshness: { lastSync: string | null; lastAnalyze: string | null; lastAgents: string | null };
  onRefresh: () => void;
}

export function InboxFilters({
  totalCount, filteredCount, tierCounts,
  filterMode, setFilterMode,
  assigneeFilter, setAssigneeFilter, allAssignees,
  categoryFilter, setCategoryFilter, availableCategories,
  dateFilter, setDateFilter,
  onRefresh,
}: InboxFiltersProps) {
  // Solo muestra categorias con insights reales (evita opciones que dan 0 resultados).
  // Si availableCategories viene vacio o undefined, fallback al catalogo completo.
  const catEntries = (availableCategories && availableCategories.length > 0)
    ? availableCategories
        .filter(k => k in INSIGHT_CATEGORY_LABELS)
        .map(k => [k, INSIGHT_CATEGORY_LABELS[k]] as const)
    : Object.entries(INSIGHT_CATEGORY_LABELS);
  return (
    <div className="px-3 py-2 md:px-0 md:mb-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Inbox</h1>
          <p className="text-xs text-muted-foreground">
            {tierCounts.urgent > 0 && <span className="text-danger font-medium">{tierCounts.urgent} urgente{tierCounts.urgent !== 1 ? "s" : ""}</span>}
            {tierCounts.urgent > 0 && " · "}
            {totalCount} pendiente{totalCount !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onRefresh} className="h-9 w-9">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Mobile: 3 simple buttons */}
      <div className="flex gap-1.5 md:hidden">
        <FilterPill active={filterMode === "urgent"} count={tierCounts.urgent} label="Urgentes" variant="danger"
          onClick={() => setFilterMode(filterMode === "urgent" ? "all" : "urgent")} />
        <FilterPill active={filterMode === "important"} count={tierCounts.important} label="Importantes" variant="warning"
          onClick={() => setFilterMode(filterMode === "important" ? "all" : "important")} />
        <FilterPill active={filterMode === "all"} count={totalCount} label="Todos"
          onClick={() => setFilterMode("all")} />
      </div>

      {/* Desktop: full filter bar */}
      <div className="hidden md:flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setFilterMode("all")}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            filterMode === "all" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          Todos ({totalCount})
        </button>
        {tierCounts.urgent > 0 && (
          <button
            onClick={() => setFilterMode(filterMode === "urgent" ? "all" : "urgent")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              filterMode === "urgent" ? "bg-danger text-destructive-foreground" : "bg-danger/10 text-danger-foreground hover:bg-danger/20"
            )}
          >
            Urgente ({tierCounts.urgent})
          </button>
        )}
        {tierCounts.important > 0 && (
          <button
            onClick={() => setFilterMode(filterMode === "important" ? "all" : "important")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              filterMode === "important" ? "bg-warning text-warning-foreground" : "bg-warning/10 text-warning-foreground hover:bg-warning/20"
            )}
          >
            Importante ({tierCounts.important})
          </button>
        )}

        <div className="h-4 w-px bg-border shrink-0 mx-1" />
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="shrink-0 rounded-full h-auto border bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-pointer outline-none"
        >
          <option value="all">Categorias</option>
          {catEntries.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </Select>
        {allAssignees.length > 1 && (
          <Select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="shrink-0 rounded-full h-auto border bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-pointer outline-none"
          >
            <option value="all">Responsables</option>
            {allAssignees.sort().map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
        )}
        <Select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="shrink-0 rounded-full h-auto border bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-pointer outline-none"
        >
          <option value="all">Cualquier fecha</option>
          <option value="today">Hoy</option>
          <option value="7d">Ultimos 7 dias</option>
          <option value="30d">Ultimos 30 dias</option>
        </Select>
      </div>
    </div>
  );
}

function FilterPill({ active, count, label, variant, onClick }: {
  active: boolean; count: number; label: string; variant?: "danger" | "warning"; onClick: () => void;
}) {
  if (count === 0 && !active) return null;
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded-xl py-2 text-center text-xs font-semibold transition-all",
        active
          ? variant === "danger" ? "bg-danger text-white"
            : variant === "warning" ? "bg-warning text-white"
            : "bg-foreground text-background"
          : "bg-muted text-muted-foreground"
      )}
    >
      {count > 0 && <span className="block text-lg font-black">{count}</span>}
      {label}
    </button>
  );
}
