"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AutoFixLogsCard() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("pipeline_logs")
        .select("id, level, phase, message, created_at")
        .in("phase", ["auto-fix", "validate", "cleanup"])
        .order("created_at", { ascending: false })
        .limit(20);

      setLogs(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <Skeleton className="h-[200px]" />;
  if (logs.length === 0) return null;

  const levelVariant = (level: string) => {
    if (level === "error") return "critical" as const;
    if (level === "warning") return "warning" as const;
    if (level === "success" || level === "info") return "success" as const;
    return "secondary" as const;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <CheckCircle2 className="h-5 w-5 text-success" />
        <CardTitle className="text-base">Auto-fix / Validate Logs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 text-xs py-1">
              <Badge variant={levelVariant(log.level)} className="text-[10px] shrink-0">
                {log.level}
              </Badge>
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {log.phase}
              </Badge>
              <span className="flex-1 text-muted-foreground">{log.message}</span>
              <span className="text-muted-foreground whitespace-nowrap shrink-0">
                {timeAgo(log.created_at)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
