"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, Paperclip, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import type { Email } from "@/lib/types";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EntityLink } from "@/components/shared/entity-link";
import { EmptyState } from "@/components/shared/empty-state";
import { SanitizedHtml } from "@/components/shared/sanitized-html";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const senderTypeBadgeVariant: Record<string, "info" | "warning" | "secondary"> = {
  inbound: "info",
  outbound: "warning",
};

const senderTypeLabel: Record<string, string> = {
  inbound: "Recibido",
  outbound: "Enviado",
};

interface RecipientContact {
  contact_id: number;
  recipient_email: string;
  recipient_name: string | null;
  contact_name: string;
}

function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

export default function EmailDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const emailId = params.id;

  const [email, setEmail] = useState<Email | null>(null);
  const [recipients, setRecipients] = useState<RecipientContact[]>([]);
  const [senderContact, setSenderContact] = useState<{ id: number; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEmail() {
      const { data } = await supabase
        .from("emails")
        .select("*")
        .eq("id", emailId)
        .single();

      const emailData = (data as Email | null) ?? null;
      setEmail(emailData);

      if (emailData) {
        // email_recipients table removed — recipients not available
        setRecipients([]);

        // Fetch sender contact name
        if (emailData.sender_contact_id) {
          supabase
            .from("contacts")
            .select("id, name")
            .eq("id", emailData.sender_contact_id)
            .single()
            .then(({ data: contact }) => {
              if (contact) setSenderContact(contact);
            });
        }
      }

      setLoading(false);
    }
    fetchEmail();
  }, [emailId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!email) {
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/emails")}
          className="mb-4"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Emails
        </Button>
        <EmptyState
          icon={Mail}
          title="Email no encontrado"
          description="El correo solicitado no existe o fue eliminado."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: "Dashboard", href: "/" },
        { label: "Emails", href: "/emails" },
        { label: email.subject?.slice(0, 40) ?? "Email" },
      ]} />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl leading-tight">
            {email.subject ?? "Sin asunto"}
          </CardTitle>

          <div className="space-y-2 pt-2 text-sm">
            {/* Sender */}
            <div className="flex items-start gap-2">
              <span className="font-medium text-foreground shrink-0 w-12">De:</span>
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                {senderContact ? (
                  <Link
                    href={`/contacts/${senderContact.id}`}
                    className="text-primary hover:underline font-medium"
                  >
                    {senderContact.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{email.sender ?? "—"}</span>
                )}
                {email.sender_type && (
                  <Badge
                    variant={senderTypeBadgeVariant[email.sender_type] ?? "secondary"}
                  >
                    {senderTypeLabel[email.sender_type] ?? email.sender_type}
                  </Badge>
                )}
              </div>
            </div>

            {/* Recipients */}
            <div className="flex items-start gap-2">
              <span className="font-medium text-foreground shrink-0 w-12">Para:</span>
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                {recipients.length > 0 ? (
                  recipients.map((r) => (
                    <Link
                      key={r.contact_id}
                      href={`/contacts/${r.contact_id}`}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-primary hover:bg-muted/80 hover:underline transition-colors"
                    >
                      <User className="h-3 w-3" />
                      {r.contact_name}
                    </Link>
                  ))
                ) : (
                  <span className="text-muted-foreground">{email.recipient ?? "—"}</span>
                )}
              </div>
            </div>

            {/* Date + metadata */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
              <span>{formatDateTime(email.email_date)}</span>
              {email.has_attachments && (
                <span className="flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" />
                  Adjuntos
                </span>
              )}
            </div>
          </div>

          {/* Entity links */}
          <div className="flex flex-wrap gap-2 pt-2">
            {email.sender_contact_id && (
              <EntityLink type="contact" id={email.sender_contact_id} label="Perfil del remitente" />
            )}
            {email.company_id && (
              <EntityLink type="company" id={email.company_id} label="Ver empresa" />
            )}
            {email.thread_id && (
              <Link href={`/threads/${email.thread_id}`} className="text-xs text-primary hover:underline">
                Ver hilo completo
              </Link>
            )}
          </div>

          {email.snippet && (
            <p className="text-sm text-muted-foreground italic pt-2">
              {email.snippet}
            </p>
          )}
        </CardHeader>

        <Separator />

        <CardContent className="pt-6">
          {email.body ? (
            looksLikeHtml(email.body) ? (
              <SanitizedHtml
                html={email.body}
                className="prose prose-sm dark:prose-invert max-w-none"
              />
            ) : (
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {email.body}
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin contenido disponible.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
