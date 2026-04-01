"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Brain,
  CheckCircle2,
  Database,
  Mail,
  Play,
  RefreshCw,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PipelineTrigger({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState<string | null>(null);

  async function trigger(steps: string[], label: string) {
    setRunning(label);
    try {
      // Call endpoints directly instead of via trigger (avoids double timeout)
      let data: Record<string, unknown> = {};
      let res: Response;

      if (steps.length === 1 && steps[0] === "cycle-quick") {
        res = await fetch("/api/cycle/run?type=quick");
      } else if (steps.length === 1 && steps[0] === "cycle-full") {
        res = await fetch("/api/cycle/run?type=full");
      } else if (steps.length === 1 && steps[0] === "cycle-daily") {
        res = await fetch("/api/cycle/run?type=daily");
      } else if (steps.length === 1 && steps[0] === "orchestrate") {
        res = await fetch("/api/agents/orchestrate", { method: "POST" });
      } else if (steps.length === 1 && steps[0] === "learn") {
        res = await fetch("/api/agents/learn", { method: "POST" });
      } else if (steps.length === 1 && steps[0] === "evolve") {
        res = await fetch("/api/agents/evolve", { method: "POST" });
      } else if (steps.length === 1 && steps[0] === "cleanup") {
        res = await fetch("/api/agents/cleanup", { method: "POST" });
      } else if (steps.length === 1 && steps[0] !== "all") {
        // Direct call to specific pipeline endpoint
        res = await fetch(`/api/pipeline/${steps[0]}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        data = await res.json();
      } else {
        // For "all" or multi-step, use trigger
        res = await fetch("/api/pipeline/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps }),
        });
        data = await res.json();
      }

      if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);

      const elapsed = data.total_elapsed_ms ? ` (${(Number(data.total_elapsed_ms) / 1000).toFixed(1)}s)` :
                      data.elapsed_s ? ` (${data.elapsed_s}s)` : "";
      toast.success(`${label} completado${elapsed}`);
      onComplete();
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setRunning(null);
    }
  }

  const pipelines = [
    { id: "quick", label: "Ciclo Rapido", desc: "Extract → Heal → Validate", icon: Zap, steps: ["cycle-quick"] },
    { id: "analyze", label: "Analizar Emails", desc: "Procesar 1 cuenta", icon: Mail, steps: ["analyze"] },
    { id: "agents", label: "Agentes IA", desc: "Generar insights", icon: Brain, steps: ["orchestrate"] },
    { id: "learn", label: "Aprender", desc: "Feedback → memorias", icon: TrendingUp, steps: ["learn"] },
    { id: "health", label: "Health Scores", desc: "Recalcular scores", icon: CheckCircle2, steps: ["health-scores"] },
    { id: "evolve", label: "Evolucionar", desc: "Mejoras de schema", icon: Database, steps: ["evolve"] },
    { id: "cleanup", label: "Cleanup Agent", desc: "Enriquecer + dedup + linkear", icon: CheckCircle2, steps: ["cleanup"] },
    { id: "cfdi", label: "Parsear CFDI", desc: "XMLs de facturas sin IA", icon: Database, steps: ["parse-cfdi"] },
    { id: "snapshot", label: "Snapshot Diario", desc: "Foto financiera por empresa", icon: TrendingUp, steps: ["snapshot"] },
    { id: "emp-metrics", label: "Metricas Equipo", desc: "Scores de ejecucion", icon: Users, steps: ["employee-metrics"] },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Play className="h-5 w-5 text-info" />
        <CardTitle className="text-base">Pipeline de Inteligencia (Vercel)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {pipelines.map((p) => {
            const Icon = p.icon;
            const isRunning = running === p.label;
            return (
              <button
                key={p.id}
                onClick={() => trigger(p.steps, p.label)}
                disabled={running !== null}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  running !== null ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"
                )}
              >
                {isRunning ? (
                  <RefreshCw className="h-5 w-5 text-info animate-spin shrink-0 mt-0.5" />
                ) : (
                  <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
