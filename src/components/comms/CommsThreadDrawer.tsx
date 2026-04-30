"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Mail } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { CommsMessage } from "@/lib/queries/comms/messages";

export interface CommsThreadDrawerProps {
  threadId: number | null;
  gmailThreadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

async function fetchMessages(threadId: number): Promise<CommsMessage[]> {
  const res = await fetch(`/api/comms/thread/${threadId}`, { cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as CommsMessage[];
}

export function CommsThreadDrawer({
  threadId,
  gmailThreadId,
  open,
  onOpenChange,
}: CommsThreadDrawerProps) {
  const [messages, setMessages] = useState<CommsMessage[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || threadId == null) {
      setMessages(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchMessages(threadId)
      .then((m) => {
        if (!cancelled) setMessages(m);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, threadId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Hilo de comunicación
          </SheetTitle>
        </SheetHeader>

        {gmailThreadId && (
          <Button asChild variant="outline" size="sm" className="mt-3 gap-2">
            <a
              href={`https://mail.google.com/mail/u/0/#inbox/${gmailThreadId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3 w-3" />
              Abrir en Gmail
            </a>
          </Button>
        )}

        <ScrollArea className="mt-4 h-[calc(100vh-180px)] pr-3">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {!loading && messages != null && messages.length === 0 && (
            <p className="text-sm text-muted-foreground">No se cargaron mensajes. Intenta de nuevo o abre en Gmail.</p>
          )}
          {!loading &&
            messages != null &&
            messages.map((m) => (
              <article
                key={m.email_id}
                className="mb-4 rounded-md border bg-card p-3 text-sm"
              >
                <header className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={m.sender_type === "external" ? "secondary" : "outline"}>
                    {m.sender_type ?? "unknown"}
                  </Badge>
                  <span className="font-medium">{m.sender}</span>
                  {m.email_date && (
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(m.email_date), "d MMM yyyy HH:mm", { locale: es })}
                    </span>
                  )}
                </header>
                {m.subject && <h4 className="mb-1 font-medium">{m.subject}</h4>}
                <p className="whitespace-pre-wrap text-sm text-foreground/90">
                  {m.body ?? m.snippet ?? "(sin contenido)"}
                </p>
              </article>
            ))}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
