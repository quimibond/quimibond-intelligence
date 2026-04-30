"use client";

import { Paperclip, MessageSquare, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CommsThread } from "@/lib/queries/comms/timeline";

const SEVERITY_DOT: Record<CommsThread["severity"], string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-yellow-400",
  none: "bg-slate-300",
};

export interface CommsThreadCardProps {
  thread: CommsThread;
  onSelect: (threadId: number) => void;
}

export function CommsThreadCard({ thread, onSelect }: CommsThreadCardProps) {
  const isExternal = thread.has_external_reply;
  const subject = thread.subject ?? "(sin asunto)";
  const lastActivityHuman = thread.last_activity
    ? formatDistanceToNow(new Date(thread.last_activity), { addSuffix: true, locale: es })
    : "—";

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={subject}
      onClick={() => onSelect(thread.thread_id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(thread.thread_id);
        }
      }}
      className="cursor-pointer transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary"
    >
      <CardContent className="flex items-start gap-3 py-3">
        <span
          className={cn("mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full", SEVERITY_DOT[thread.severity])}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isExternal ? "secondary" : "outline"} className="shrink-0">
              {isExternal ? "external" : "internal"}
            </Badge>
            <span className="truncate text-sm font-medium">{subject}</span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Último: {thread.last_sender ?? "—"} · {lastActivityHuman}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {thread.severity !== "none" && thread.hours_without_response != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {Math.round(thread.hours_without_response)}h sin respuesta
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {thread.message_count} mensajes
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
