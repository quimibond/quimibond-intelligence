"use client";

import { RefreshCw } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { INSIGHT_CATEGORY_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectNative as Select } from "@/components/ui/select-native";

function isRecent(dateStr: string, hoursThreshold: number): boolean {
  return (Date.now() - new Date(dateStr).getTime()) < hoursThreshold * 3600_000;
}

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
  freshness: { lastSync: string | null; lastAnalyze: string | null; lastAgents: string | null };
  onRefresh: () => void;
}

export function InboxFilters({
  totalCount,
  filteredCount,
  tierCounts,
  filterMode,
  setFilterMode,
  assigneeFilter,
  setAssigneeFilter,
  allAssignees,
  categoryFilter,
  setCategoryFilter,
  freshness,
  onRefresh,
}: InboxFiltersProps) {
  return (
    <div className="px-4 py-3 md:px-0 md:py-0 md:mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg md:text-2xl font-bold">Inbox</h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            {totalCount} insight{totalCount !== 1 ? "s" : ""} pendiente{totalCount !== 1 ? "s" : ""}
            {filteredCount !== totalCount && (
              <span className="ml-1">({filteredCount} filtrado{filteredCount !== 1 ? "s" : ""})</span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} title="Actualizar">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Freshness indicators */}
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        {freshness.lastSync && (
          <span className="flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", isRecent(freshness.lastSync, 2) ? "bg-success" : isRecent(freshness.lastSync, 6) ? "bg-warning" : "bg-danger")} />
            Odoo: {timeAgo(freshness.lastSync)}
          </span>
        )}
        {freshness.lastAnalyze && (
          <span className="flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", isRecent(freshness.lastAnalyze, 1) ? "bg-success" : isRecent(freshness.lastAnalyze, 4) ? "bg-warning" : "bg-danger")} />
            Emails: {timeAgo(freshness.lastAnalyze)}
          </span>
        )}
        {freshness.lastAgents && (
          <span className="flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", isRecent(freshness.lastAgents, 6) ? "bg-success" : isRecent(freshness.lastAgents, 12) ? "bg-warning" : "bg-danger")} />
            Agentes: {timeAgo(freshness.lastAgents)}
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
        <button
          onClick={() => setFilterMode("all")}
          aria-pressed={filterMode === "all"}
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
            aria-pressed={filterMode === "urgent"}
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
            aria-pressed={filterMode === "important"}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              filterMode === "important" ? "bg-warning text-warning-foreground" : "bg-warning/10 text-warning-foreground hover:bg-warning/20"
            )}
          >
            Importante ({tierCounts.important})
          </button>
        )}
        {tierCounts.fyi > 0 && (
          <button
            onClick={() => setFilterMode(filterMode === "fyi" ? "all" : "fyi")}
            aria-pressed={filterMode === "fyi"}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              filterMode === "fyi" ? "bg-info text-info-foreground" : "bg-info/10 text-info-foreground hover:bg-info/20"
            )}
          >
            FYI ({tierCounts.fyi})
          </button>
        )}

        {/* Category + Assignee filters */}
        <div className="h-4 w-px bg-border shrink-0 mx-1" />
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="shrink-0 rounded-full h-auto border bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-pointer outline-none"
          aria-label="Filtrar por categoria"
        >
          <option value="all">Todas las categorias</option>
          {Object.entries(INSIGHT_CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </Select>
        {allAssignees.length > 1 && (
          <Select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="shrink-0 rounded-full h-auto border bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-pointer outline-none"
            aria-label="Filtrar por responsable"
          >
            <option value="all">Todos los responsables</option>
            {allAssignees.sort().map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
        )}
      </div>
    </div>
  );
}
