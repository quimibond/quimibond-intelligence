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
 * Subscribes to new alerts and pipeline completions via Supabase Realtime.
 * Shows toast notifications when new data arrives.
 * Renders nothing — this is a side-effect-only component.
 */
export function RealtimeAlerts() {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    // Subscribe to new alerts
    const alertChannel = supabase
      .channel("realtime-alerts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "alerts",
        },
        (payload) => {
          const alert = payload.new as {
            title?: string;
            severity?: string;
            contact_name?: string;
          };
          const prefix = severityEmoji[alert.severity ?? ""] ?? "";
          toast.warning(
            `${prefix} ${alert.title ?? "Nueva alerta"}`,
            {
              description: alert.contact_name
                ? `Contacto: ${alert.contact_name}`
                : undefined,
              duration: 8000,
              action: {
                label: "Ver alertas",
                onClick: () => (window.location.href = "/alerts"),
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
      supabase.removeChannel(alertChannel);
      supabase.removeChannel(pipelineChannel);
      subscribedRef.current = false;
    };
  }, []);

  return null;
}
