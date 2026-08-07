/**
 * /hilos/[id] — lectura completa de una conversación de correo.
 *
 * La pieza que faltaba de "todo conectado": /equipo, /operacion y /hoy
 * muestran QUÉ hilos están pendientes; esta página muestra la
 * conversación completa para decidir sin salir del sistema.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PageHeader, PageLayout } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatRelative } from "@/lib/formatters";
import { getServiceClient } from "@/lib/supabase-server";
import { getCommsThreadMessages, type CommsMessage } from "@/lib/queries/comms/messages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Hilo de correo" };

async function getThread(id: number) {
  const supabase = getServiceClient();
  const { data: thread } = await supabase
    .from("threads")
    .select(
      "id, subject, account, company_id, last_sender, last_sender_type, last_activity, status, message_count, has_internal_reply",
    )
    .eq("id", id)
    .maybeSingle();
  if (!thread) return null;

  let companyName: string | null = null;
  if (thread.company_id) {
    const { data: c } = await supabase
      .from("companies")
      .select("name")
      .eq("id", thread.company_id)
      .maybeSingle();
    companyName = (c?.name as string | null) ?? null;
  }
  return { ...thread, companyName };
}

function MessageCard({ m }: { m: CommsMessage }) {
  const isInternal = m.sender_type === "internal";
  const body = (m.body ?? m.snippet ?? "").trim();
  const isLong = body.length > 2000;

  return (
    <Card className={isInternal ? "border-l-4 border-l-primary/60" : "border-l-4 border-l-amber-500/60"}>
      <CardContent className="space-y-2 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={isInternal ? "default" : "secondary"}>
              {isInternal ? "Quimibond" : "Cliente"}
            </Badge>
            <span className="text-sm font-medium">{m.sender}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {m.email_date ? `${m.email_date.slice(0, 16).replace("T", " ")} · ${formatRelative(m.email_date)}` : "—"}
          </span>
        </div>
        {m.recipient && (
          <p className="text-xs text-muted-foreground">Para: {m.recipient}</p>
        )}
        {isLong ? (
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Mensaje largo — clic para expandir ({Math.round(body.length / 1000)}k caracteres)
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{body}</p>
          </details>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{body || "(sin contenido)"}</p>
        )}
        {m.has_attachments && (
          <p className="text-xs text-muted-foreground">📎 Tiene adjuntos (ver en Gmail)</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function HiloPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();

  const thread = await getThread(id);
  if (!thread) notFound();

  const messages = await getCommsThreadMessages(id);
  const sorted = [...messages].sort((a, b) =>
    String(a.email_date ?? "").localeCompare(String(b.email_date ?? "")),
  );

  const esperando = thread.last_sender_type === "external" && Boolean(thread.has_internal_reply);

  return (
    <PageLayout>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          ...(thread.company_id
            ? [{ label: thread.companyName ?? "Empresa", href: `/empresas/${thread.company_id}` }]
            : []),
          { label: "Hilo" },
        ]}
        title={thread.subject ?? "(sin asunto)"}
        subtitle={`${thread.message_count} mensajes · buzón ${thread.account ?? "—"}`}
        actions={
          <div className="flex items-center gap-2">
            {esperando && <Badge variant="destructive">Esperando respuesta nuestra</Badge>}
            {thread.company_id && (
              <Link
                href={`/empresas/${thread.company_id}`}
                className="text-sm underline hover:text-primary"
              >
                Ficha de {thread.companyName ?? "la empresa"}
              </Link>
            )}
          </div>
        }
      />

      <div className="space-y-3">
        {sorted.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No hay mensajes legibles en este hilo.
            </CardContent>
          </Card>
        )}
        {sorted.map((m) => (
          <MessageCard key={m.email_id} m={m} />
        ))}
      </div>
    </PageLayout>
  );
}
