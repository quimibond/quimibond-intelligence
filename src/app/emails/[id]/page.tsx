"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";
import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";

interface Email {
  id: number;
  account: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  snippet: string;
  email_date: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  sender_type: string;
  has_attachments: boolean;
}

interface ThreadEmail {
  id: number;
  sender: string;
  recipient: string;
  subject: string;
  snippet: string;
  email_date: string;
  sender_type: string;
}

export default function EmailDetailPage() {
  const params = useParams();
  const [email, setEmail] = useState<Email | null>(null);
  const [threadEmails, setThreadEmails] = useState<ThreadEmail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const { data: emailData } = await supabase
        .from("emails")
        .select("id, account, sender, recipient, subject, body, snippet, email_date, gmail_message_id, gmail_thread_id, sender_type, has_attachments")
        .eq("id", params.id)
        .single();

      if (!emailData) {
        setLoading(false);
        return;
      }

      setEmail(emailData);

      if (emailData.gmail_thread_id) {
        const { data: threadData } = await supabase
          .from("emails")
          .select("id, sender, recipient, subject, snippet, email_date, sender_type")
          .eq("gmail_thread_id", emailData.gmail_thread_id)
          .neq("id", emailData.id)
          .order("email_date", { ascending: true });

        if (threadData) setThreadEmails(threadData);
      }

      setLoading(false);
    }
    fetchData();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-pulse text-[var(--muted-foreground)]">Cargando email...</div>
      </div>
    );
  }

  if (!email) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--muted-foreground)]">Email no encontrado.</p>
        <Link href="/emails">
          <Button variant="ghost" className="mt-4">Volver a emails</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/emails">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{email.subject || "(Sin asunto)"}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={email.sender_type === "internal" ? "info" : "success"}>
              {email.sender_type === "internal" ? "Interno" : "Externo"}
            </Badge>
            <span className="text-sm text-[var(--muted-foreground)]">
              {email.email_date ? timeAgo(email.email_date) : ""}
            </span>
            {email.has_attachments && (
              <span className="text-sm text-[var(--muted-foreground)]">📎 Con adjuntos</span>
            )}
          </div>
        </div>
      </div>

      {/* Meta */}
      <Card>
        <CardContent className="p-4 space-y-1 text-sm">
          <div className="flex gap-2">
            <span className="text-[var(--muted-foreground)] w-16">De:</span>
            <span>{email.sender}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[var(--muted-foreground)] w-16">Para:</span>
            <span>{email.recipient || "—"}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[var(--muted-foreground)] w-16">Cuenta:</span>
            <span>{email.account || "—"}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[var(--muted-foreground)] w-16">Fecha:</span>
            <span>
              {email.email_date
                ? new Date(email.email_date).toLocaleDateString("es-MX", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Body */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Contenido
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">{email.body || "Sin contenido."}</pre>
        </CardContent>
      </Card>

      {/* Thread context */}
      {threadEmails.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Otros mensajes del hilo ({threadEmails.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {threadEmails.map((te) => (
                <Link key={te.id} href={`/emails/${te.id}`}>
                  <div className="rounded border border-[var(--border)] p-3 hover:bg-[var(--accent)]/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={te.sender_type === "internal" ? "info" : "success"} className="text-[10px]">
                        {te.sender_type === "internal" ? "Interno" : "Externo"}
                      </Badge>
                      <span className="text-xs text-[var(--muted-foreground)]">{te.sender}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {te.email_date ? timeAgo(te.email_date) : ""}
                      </span>
                    </div>
                    <p className="text-sm truncate">{te.snippet}</p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
