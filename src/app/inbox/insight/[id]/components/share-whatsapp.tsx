"use client";

import { useCallback } from "react";
import { Share2 } from "lucide-react";
import type { AgentInsight } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function ShareWhatsApp({ insight, companyName }: { insight: AgentInsight; companyName?: string | null }) {
  const handleShare = useCallback(() => {
    const sevIcon = insight.severity === "critical" ? "🔴" : insight.severity === "high" ? "🟠" : "🟡";
    const lines: string[] = [];
    lines.push(`${sevIcon} *${insight.title}*`);
    if (insight.recommendation) {
      lines.push("");
      lines.push(`→ ${insight.recommendation.slice(0, 200)}`);
    }
    if (insight.assignee_name) {
      lines.push("");
      lines.push(`📋 Responsable: ${insight.assignee_name}`);
    }
    if (insight.business_impact_estimate) {
      lines.push(`💰 Impacto: $${Number(insight.business_impact_estimate).toLocaleString()} MXN`);
    }
    const appUrl = typeof window !== "undefined" ? window.location.href : "";
    if (appUrl) lines.push("", `👉 ${appUrl}`);

    const text = encodeURIComponent(lines.join("\n"));
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }, [insight, companyName]);

  return (
    <Button
      variant="outline"
      className="w-full gap-2"
      onClick={handleShare}
    >
      <Share2 className="h-4 w-4" />
      Compartir por WhatsApp
    </Button>
  );
}
