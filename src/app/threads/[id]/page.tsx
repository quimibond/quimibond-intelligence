"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Mail, MessageSquare, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatDateTime, timeAgo, truncate } from "@/lib/utils";
import type { Thread, Email } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const statusVariant: Record<string, "info" | "warning" | "critical" | "success" | "secondary"> = {
  active: "info",
  waiting_response: "warning",
  stalled: "critical",
  resolved: "success",
  closed: "secondary",
};

export default function ThreadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [thread, setThread] = useState<Thread | null>(null);
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const { data: threadData } = await supabase
        .from("threads")
        .select("*")
        .eq("id", params.id)
        .single();

      if (!threadData) {
        setLoading(false);
        return;
      }

      const t = threadData as Thread;
      setThread(t);

      if (t.gmail_thread_id) {
        const { data: emailData } = await supabase
          .from("emails")
          .select("*")
          .eq("gmail_thread_id", t.gmail_thread_id)
          .order("email_date", { ascending: true });
        setEmails((emailData as Email[] | null) ?? []);
      }

      setLoading(false);
    }
    fetchData();
  }, [params.id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  if (!thread) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/threads")} className="mb-4">
          <ArrowLeft className="mr-1 h-4 w-4" /> Hilos
        </Button>
        <EmptyState icon={MessageSquare} title="Hilo no encontrado" description="El hilo solicitado no existe." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: "Hilos", href: "/threads" },
        { label: thread.subject ?? "(sin asunto)" },
      ]} />

      {/* Thread header */}
      <div className="space-y-2">
        <h1 className="text-xl sm:text-2xl font-bold">{thread.subject ?? "(sin asunto)"}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Badge variant={statusVariant[thread.status ?? ""] ?? "secondary"}>
            {thread.status ?? "desconocido"}
          </Badge>
          <span className="flex items-center gap-1">
            <Mail className="h-3.5 w-3.5" /> {thread.message_count} mensajes
          </span>
          {thread.hours_without_response != null && thread.hours_without_response > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {Math.round(thread.hours_without_response)}h sin respuesta
            </span>
          )}
          <span>Cuenta: {thread.account ?? "—"}</span>
          {thread.started_at && <span>Inicio: {formatDateTime(thread.started_at)}</span>}
        </div>
        {thread.participant_emails && thread.participant_emails.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {thread.participant_emails.map((email) => (
              <Badge key={email} variant="outline" className="text-xs">{email}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Email timeline */}
      <div className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          Conversacion ({emails.length} mensajes)
        </h2>
        {emails.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No se encontraron emails para este hilo.
            </CardContent>
          </Card>
        ) : (
          emails.map((email, i) => (
            <Card key={email.id} className={cn(
              email.sender_type === "internal" && "border-l-2 border-l-blue-500"
            )}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <div className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs",
                      email.sender_type === "internal"
                        ? "bg-info/15 text-info-foreground"
                        : "bg-muted"
                    )}>
                      <User className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <span className="font-medium">{email.sender ?? "?"}</span>
                      <span className="text-muted-foreground"> → {email.recipient ?? "?"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatDateTime(email.email_date)}</span>
                    <Link href={`/emails/${email.id}`} className="text-xs text-primary hover:underline">
                      Ver
                    </Link>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium mb-1">{email.subject}</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
                  {email.snippet ?? email.body?.slice(0, 500) ?? "(sin contenido)"}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
