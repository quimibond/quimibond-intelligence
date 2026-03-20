"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";
import { CheckSquare, Check, Clock } from "lucide-react";

interface ActionItem {
  id: string;
  action_type: string;
  description: string;
  contact_name: string;
  priority: string;
  due_date: string;
  state: string;
  created_at: string;
  completed_at: string | null;
}

const priorityVariant: Record<string, "destructive" | "warning" | "info"> = {
  high: "destructive",
  medium: "warning",
  low: "info",
};

export default function ActionsPage() {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("pending");

  useEffect(() => {
    async function fetch() {
      let query = supabase
        .from("action_items")
        .select("*")
        .order("due_date", { ascending: true })
        .limit(50);

      if (stateFilter !== "all") {
        query = query.eq("state", stateFilter);
      }

      const { data } = await query;
      setActions(data || []);
      setLoading(false);
    }
    fetch();
  }, [stateFilter]);

  async function completeAction(id: string) {
    await supabase
      .from("action_items")
      .update({ state: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    setActions((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, state: "completed", completed_at: new Date().toISOString() } : a
      )
    );
  }

  function isOverdue(dueDate: string) {
    return dueDate && new Date(dueDate) < new Date();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Acciones</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Acciones sugeridas por el sistema de inteligencia</p>
        </div>
        <div className="flex gap-1">
          {["pending", "completed", "dismissed", "all"].map((f) => (
            <button
              key={f}
              onClick={() => { setStateFilter(f); setLoading(true); }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                stateFilter === f
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              }`}
            >
              {f === "all" ? "Todas" : f === "pending" ? "Pendientes" : f === "completed" ? "Completadas" : "Descartadas"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-pulse text-[var(--muted-foreground)]">Cargando acciones...</div>
        </div>
      ) : actions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckSquare className="mb-3 h-10 w-10 text-[var(--muted-foreground)] opacity-50" />
            <p className="text-sm text-[var(--muted-foreground)]">No hay acciones en esta categoria.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {actions.map((action) => (
            <Card
              key={action.id}
              className={
                action.state === "pending" && action.due_date && isOverdue(action.due_date)
                  ? "border-l-2 border-l-red-500"
                  : ""
              }
            >
              <CardContent className="flex items-start justify-between gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge variant={priorityVariant[action.priority] || "info"}>
                      {action.priority}
                    </Badge>
                    <Badge variant="outline">{action.action_type}</Badge>
                    {action.contact_name && (
                      <span className="text-xs text-[var(--muted-foreground)]">{action.contact_name}</span>
                    )}
                  </div>
                  <p className="text-sm">{action.description}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                    <span>{timeAgo(action.created_at)}</span>
                    {action.due_date && (
                      <span className={`flex items-center gap-1 ${isOverdue(action.due_date) ? "text-red-400" : ""}`}>
                        <Clock className="h-3 w-3" />
                        Vence: {new Date(action.due_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                      </span>
                    )}
                    {action.completed_at && (
                      <span className="text-emerald-400">
                        Completada {timeAgo(action.completed_at)}
                      </span>
                    )}
                  </div>
                </div>
                {action.state === "pending" && (
                  <Button variant="ghost" size="icon" onClick={() => completeAction(action.id)} title="Completar">
                    <Check className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
