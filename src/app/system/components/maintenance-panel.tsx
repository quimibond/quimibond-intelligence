"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Brain,
  GitBranch,
  RefreshCw,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MaintenancePanel({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState<string | null>(null);

  async function runRPC(id: string, label: string, rpcName: string) {
    setRunning(id);
    try {
      const { data, error } = await supabase.rpc(rpcName);
      if (error) throw error;
      const result = typeof data === "object" && data !== null
        ? Object.entries(data as Record<string, number>).map(([k, v]) => `${k}=${v}`).join(", ")
        : String(data ?? "OK");
      toast.success(`${label}: ${result}`);
      onComplete();
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setRunning(null);
    }
  }

  async function runEnrich(id: string, label: string, type: string) {
    setRunning(id);
    try {
      const res = await fetch("/api/enrich/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, limit: 5 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      toast.success(`${label}: ${data.enriched ?? 0} enriquecidos`);
      onComplete();
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setRunning(null);
    }
  }

  const actions = [
    { id: "resolve", label: "Resolver Conexiones", desc: "emails↔contactos, threads↔empresas", icon: GitBranch, fn: () => runRPC("resolve", "Resolver Conexiones", "resolve_all_connections") },
    { id: "refresh_360", label: "Stats Contactos", desc: "total_sent, total_received", icon: Users, fn: () => runRPC("refresh_360", "Stats Contactos", "refresh_contact_360") },
    { id: "enrich_c", label: "Enriquecer Contactos", desc: "Perfiles IA (5 contactos)", icon: Brain, fn: () => runEnrich("enrich_c", "Enriquecer Contactos", "contacts") },
    { id: "enrich_co", label: "Enriquecer Empresas", desc: "Perfiles IA (5 empresas)", icon: Brain, fn: () => runEnrich("enrich_co", "Enriquecer Empresas", "companies") },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <RefreshCw className="h-5 w-5 text-success" />
        <CardTitle className="text-base">Mantenimiento</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map((a) => {
            const Icon = a.icon;
            const isRunning = running === a.id;
            return (
              <button
                key={a.id}
                onClick={a.fn}
                disabled={running !== null}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  running !== null ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"
                )}
              >
                {isRunning ? <RefreshCw className="h-5 w-5 text-info animate-spin shrink-0 mt-0.5" /> : <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />}
                <div>
                  <p className="text-sm font-medium">{a.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
