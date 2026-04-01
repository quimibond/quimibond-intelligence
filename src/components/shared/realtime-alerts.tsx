"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

const severityEmoji: Record<string, string> = {
  critical: "!!",
  high: "!",
  medium: "",
  low: "",
};

/**
 * Subscribes to new agent_insights and pipeline completions via Supabase Realtime.
 * Shows toast notifications when new data arrives.
 * Renders nothing — this is a side-effect-only component.
 */
export function RealtimeAlerts() {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    // Subscribe to new agent insights (the primary intelligence output)
    const insightChannel = supabase
      .channel("realtime-insights")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_insights",
        },
        (payload) => {
          const insight = payload.new as {
            title?: string;
            severity?: string;
            confidence?: number;
            assignee_name?: string;
          };
          // Only show toast for high-confidence insights
          if ((insight.confidence ?? 0) < 0.65) return;

          const prefix = severityEmoji[insight.severity ?? ""] ?? "";
          toast.warning(
            `${prefix} ${insight.title ?? "Nuevo insight"}`,
            {
              description: insight.assignee_name
                ? `Responsable: ${insight.assignee_name}`
                : undefined,
              duration: 8000,
              action: {
                label: "Ver inbox",
                onClick: () => (window.location.href = "/inbox"),
              },
            }
          );
        }
      )
      .subscribe();

    // Subscribe to pipeline completions
    const pipelineChannel = supabase
      .channel("realtime-pipeline")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pipeline_runs",
          filter: "status=eq.completed",
        },
        (payload) => {
          const run = payload.new as {
            run_type?: string;
            emails_processed?: number;
            alerts_generated?: number;
          };
          toast.success(
            `Pipeline completado: ${run.run_type ?? "sync"}`,
            {
              description: [
                run.emails_processed ? `${run.emails_processed} emails` : null,
                run.alerts_generated ? `${run.alerts_generated} alertas` : null,
              ]
                .filter(Boolean)
                .join(", ") || undefined,
              duration: 5000,
            }
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(insightChannel);
      supabase.removeChannel(pipelineChannel);
      subscribedRef.current = false;
    };
  }, []);

  return null;
}
