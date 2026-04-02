"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Brain,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  HeartPulse,
  Mail,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Pipeline {
  id: string;
  label: string;
  desc: string;
  cron: string;
  icon: React.ElementType;
  steps: string[];
}

const groups: { title: string; pipelines: Pipeline[] }[] = [
  {
    title: "Frecuentes",
    pipelines: [
      { id: "quick", label: "Ciclo Rapido", desc: "Extract + Heal + Validate", cron: "cada 5min", icon: Zap, steps: ["cycle-quick"] },
      { id: "analyze", label: "Analizar Emails", desc: "Procesar 1 cuenta", cron: "cada 5min", icon: Mail, steps: ["analyze"] },
      { id: "agents", label: "Agentes IA", desc: "Generar insights", cron: "cada 15min", icon: Brain, steps: ["orchestrate"] },
      { id: "autofix", label: "Auto-fix", desc: "Reparar datos rotos", cron: "cada 30min", icon: Wrench, steps: ["auto-fix"] },
      { id: "validate", label: "Validar", desc: "Limpiar insights stale", cron: "cada 30min", icon: Shield, steps: ["validate"] },
      { id: "sync-emails", label: "Sync Emails", desc: "Sincronizar Gmail", cron: "manual", icon: Mail, steps: ["sync-emails"] },
    ],
  },
  {
    title: "Periodicos",
    pipelines: [
      { id: "learn", label: "Aprender", desc: "Feedback a memorias", cron: "cada 4h", icon: TrendingUp, steps: ["learn"] },
      { id: "health", label: "Health Scores", desc: "Recalcular scores", cron: "cada 6h", icon: HeartPulse, steps: ["health-scores"] },
      { id: "cfdi", label: "Parsear CFDI", desc: "XMLs de facturas sin IA", cron: "cada 30min", icon: Database, steps: ["parse-cfdi"] },
      { id: "cleanup", label: "Cleanup", desc: "Enriquecer + dedup + linkear", cron: "cada 30min", icon: CheckCircle2, steps: ["cleanup"] },
      { id: "briefing", label: "Briefing", desc: "Briefing diario CEO", cron: "6:30am", icon: FileText, steps: ["briefing"] },
    ],
  },
  {
    title: "Diarios",
    pipelines: [
      { id: "snapshot", label: "Snapshot", desc: "Foto financiera por empresa", cron: "5:30am", icon: TrendingUp, steps: ["snapshot"] },
      { id: "emp-metrics", label: "Metricas Equipo", desc: "Scores de ejecucion", cron: "lunes 5am", icon: Users, steps: ["employee-metrics"] },
      { id: "evolve", label: "Evolucionar", desc: "Mejoras de schema", cron: "6:00am", icon: Sparkles, steps: ["evolve"] },
    ],
  },
];

export function PipelineTrigger({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState<string | null>(null);

  async function trigger(steps: string[], label: string) {
    setRunning(label);
    try {
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
      } else if (steps.length === 1 && steps[0] === "auto-fix") {
        res = await fetch("/api/agents/auto-fix", { method: "POST" });
      } else if (steps.length === 1 && steps[0] === "validate") {
        res = await fetch("/api/agents/validate", { method: "POST" });
      } else if (steps.length === 1 && steps[0] === "briefing") {
        res = await fetch("/api/pipeline/briefing", { method: "POST" });
      } else if (steps.length === 1 && steps[0] === "sync-emails") {
        res = await fetch("/api/pipeline/sync-emails", { method: "POST" });
      } else if (steps.length === 1 && steps[0] !== "all") {
        res = await fetch(`/api/pipeline/${steps[0]}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        data = await res.json();
      } else {
        res = await fetch("/api/pipeline/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps }),
        });
        data = await res.json();
      }

      if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);

      const elapsed = data.total_elapsed_ms
        ? ` (${(Number(data.total_elapsed_ms) / 1000).toFixed(1)}s)`
        : data.elapsed_s
          ? ` (${data.elapsed_s}s)`
          : "";
      toast.success(`${label} completado${elapsed}`);
      onComplete();
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Play className="h-5 w-5 text-info" />
        <CardTitle className="text-base">Pipeline de Inteligencia (Vercel)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {groups.map((group) => (
          <div key={group.title}>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {group.title}
            </h4>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              {group.pipelines.map((p) => {
                const Icon = p.icon;
                const isRunning = running === p.label;
                return (
                  <button
                    key={p.id}
                    onClick={() => trigger(p.steps, p.label)}
                    disabled={running !== null}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      running !== null
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-muted/50 cursor-pointer",
                    )}
                  >
                    {isRunning ? (
                      <RefreshCw className="h-5 w-5 text-info animate-spin shrink-0 mt-0.5" />
                    ) : (
                      <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.desc}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                        <span className="text-[10px] text-muted-foreground/60">{p.cron}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
