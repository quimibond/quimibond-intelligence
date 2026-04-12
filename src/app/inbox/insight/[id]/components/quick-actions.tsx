"use client";

import {
  Send, Mail, CalendarClock, Check, Loader2,
} from "lucide-react";
import type { AgentInsight, Company } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { LinkCard } from "@/components/shared/link-card";
import { ShareWhatsApp } from "./share-whatsapp";

export function QuickActions({ insight, company, companyContacts, onDone, onCancel, acting }: {
  insight: AgentInsight;
  company: Company | null;
  companyContacts: { name: string | null; email: string; role: string | null }[];
  onDone: (followUpDays?: number) => void;
  onCancel: () => void;
  acting: boolean;
}) {
  const assigneeEmail = insight.assignee_email ?? "";
  const assigneeName = insight.assignee_name ?? "Responsable";
  const companyName = company?.name ?? "la empresa";
  const title = insight.title ?? "";
  const recommendation = insight.recommendation ?? "";
  const impact = insight.business_impact_estimate
    ? `${formatCurrency(Number(insight.business_impact_estimate))} MXN`
    : "";

  const assigneeSubject = `Acción requerida: ${title.slice(0, 80)}`;
  const assigneeBody = [
    `Hola ${assigneeName.split(" ")[0]},`,
    "",
    `Te comparto un tema que requiere acción inmediata:`,
    "",
    `📌 ${title}`,
    "",
    `Recomendación: ${recommendation.slice(0, 300)}`,
    impact ? `\nImpacto estimado: ${impact}` : "",
    "",
    "Por favor confirma que acciones vas a tomar y en qué plazo.",
    "",
    "Saludos",
  ].filter(Boolean).join("\n");

  const mainContact = companyContacts[0];
  const contactSubject = `Seguimiento — ${companyName}`;
  const contactBody = [
    `Estimado${mainContact?.name ? ` ${mainContact.name.split(" ")[0]}` : ""},`,
    "",
    `Le escribo respecto a un tema pendiente con ${companyName}.`,
    "",
    recommendation.includes("pago") || recommendation.includes("cobr")
      ? `Nos gustaría confirmar el estatus de los pagos pendientes y acordar una fecha de regularización.`
      : recommendation.includes("entrega") || recommendation.includes("envío")
        ? `Queremos confirmar las fechas de entrega pendientes y asegurar que todo esté en orden.`
        : `Nos gustaría agendar una llamada para dar seguimiento a temas pendientes.`,
    "",
    "Quedo atento a su respuesta.",
    "",
    "Saludos cordiales",
  ].join("\n");

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="space-y-1.5 px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          ¿Qué acción tomar?
        </p>

        {assigneeEmail && (
          <LinkCard
            as="a"
            href={`mailto:${assigneeEmail}?subject=${encodeURIComponent(assigneeSubject)}&body=${encodeURIComponent(assigneeBody)}`}
            onClick={() => onDone(3)}
            className="flex items-center gap-3 p-3"
            aria-label={`Enviar email a ${assigneeName}`}
          >
            <Send className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Instruir a {assigneeName.split(" ")[0]}</p>
              <p className="truncate text-xs text-muted-foreground">
                Email con instrucciones + recordatorio 3 días
              </p>
            </div>
          </LinkCard>
        )}

        {mainContact && (
          <LinkCard
            as="a"
            href={`mailto:${mainContact.email}?subject=${encodeURIComponent(contactSubject)}&body=${encodeURIComponent(contactBody)}`}
            onClick={() => onDone(5)}
            className="flex items-center gap-3 p-3"
            aria-label={`Contactar a ${companyName}`}
          >
            <Mail className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Contactar a {companyName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {mainContact.name ?? mainContact.email} + recordatorio 5 días
              </p>
            </div>
          </LinkCard>
        )}

        <ShareWhatsApp insight={insight} companyName={company?.name} />

        <LinkCard
          as="button"
          onClick={() => onDone(3)}
          className="flex items-center gap-3 p-3"
          aria-label="Marcar y recordar en 3 dias"
        >
          <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Recordatorio en 3 días</p>
            <p className="text-xs text-muted-foreground">El sistema verifica si se resolvió</p>
          </div>
        </LinkCard>

        <LinkCard
          as="button"
          onClick={() => onDone()}
          disabled={acting}
          className="flex items-center gap-3 p-3"
          aria-label="Marcar insight como resuelto"
        >
          {acting
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            : <Check className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Ya lo resolví</p>
            <p className="text-xs text-muted-foreground">Solo marcar como útil</p>
          </div>
        </LinkCard>

        <button
          onClick={onCancel}
          className="w-full py-1 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancelar
        </button>
      </CardContent>
    </Card>
  );
}
