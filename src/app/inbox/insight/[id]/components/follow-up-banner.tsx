"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export function FollowUpBanner({ insightId, state }: { insightId: number; state: string }) {
  const [followUp, setFollowUp] = useState<{
    status: string; follow_up_date: string; resolution_note: string | null;
  } | null>(null);

  useEffect(() => {
    if (state !== "acted_on") return;
    supabase.from("insight_follow_ups")
      .select("status, follow_up_date, resolution_note")
      .eq("insight_id", insightId).limit(1).single()
      .then(({ data }) => { if (data) setFollowUp(data); });
  }, [insightId, state]);

  if (!followUp) return null;

  const colors: Record<string, string> = {
    pending: "border-info/30 bg-info/10 text-info-foreground",
    improved: "border-success/30 bg-success/10 text-success-foreground",
    unchanged: "border-warning/30 bg-warning/10 text-warning-foreground",
    worsened: "border-danger/30 bg-danger/10 text-danger-foreground",
  };
  const labels: Record<string, string> = {
    pending: "Seguimiento programado",
    improved: "Mejoró",
    unchanged: "Sin cambio",
    worsened: "Empeoró",
  };

  return (
    <Card className={cn("overflow-hidden", colors[followUp.status] ?? "bg-muted")}>
      <CardContent className="px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{labels[followUp.status] ?? followUp.status}</span>
          <span className="text-xs opacity-70">{followUp.follow_up_date}</span>
        </div>
        {followUp.resolution_note && (
          <p className="mt-1 text-xs opacity-80">{followUp.resolution_note}</p>
        )}
      </CardContent>
    </Card>
  );
}
