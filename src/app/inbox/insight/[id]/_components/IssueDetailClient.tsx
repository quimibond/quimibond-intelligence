"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { MetricRow } from "@/components/patterns/metric-row";
import { SectionHeader } from "@/components/patterns/section-header";
import type { Database } from "@/lib/database.types";
import type { InboxRow } from "@/lib/queries/intelligence/inbox";
import { EvidenceSection } from "./EvidenceSection";
import { AttachmentsSection } from "./AttachmentsSection";
import { NotesSection } from "./NotesSection";

type EmailSignal = Database["public"]["Tables"]["email_signals"]["Row"];
type AiFact = Database["public"]["Tables"]["ai_extracted_facts"]["Row"];
type ManualNote = Database["public"]["Tables"]["manual_notes"]["Row"];
type Attachment = Database["public"]["Tables"]["attachments"]["Row"];

export type IssueDetailItem = InboxRow & {
  email_signals: EmailSignal[];
  ai_extracted_facts: AiFact[];
  manual_notes: ManualNote[];
  attachments: Attachment[];
};

type CtaKey = "operationalize" | "confirm_cancel" | "link_manual" | "resolve";

const CTA_MAP: Record<CtaKey, { label: string; api: string }> = {
  operationalize: { label: "Operacionalizar", api: "/api/inbox/action/operationalize" },
  confirm_cancel: { label: "Confirmar cancelación", api: "/api/inbox/resolve" },
  link_manual: { label: "Ligar manual", api: "/api/inbox/action/link_manual" },
  resolve: { label: "Resolver", api: "/api/inbox/resolve" },
};

function formatMxn(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

interface Props {
  item: IssueDetailItem;
}

export function IssueDetailClient({ item }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const ctaKey: CtaKey = (item.action_cta as CtaKey) || "resolve";
  const primary = CTA_MAP[ctaKey];

  const callApi = (api: string, body: Record<string, unknown>) => {
    startTransition(async () => {
      try {
        const res = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          toast.error(text || "La acción falló");
          return;
        }
        toast.success("Acción completada");
        router.push("/inbox");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error de red");
      }
    });
  };

  const handlePrimary = () => {
    if (ctaKey === "operationalize") {
      callApi("/api/inbox/action/operationalize", { issue_id: item.issue_id });
    } else if (ctaKey === "link_manual") {
      callApi("/api/inbox/action/link_manual", { issue_id: item.issue_id });
    } else {
      callApi("/api/inbox/resolve", { issue_id: item.issue_id, resolution: "manual" });
    }
  };

  const handleAssign = () => {
    const id = window.prompt("ID de canonical_contact a asignar:");
    if (!id) return;
    const parsed = Number(id);
    if (!Number.isInteger(parsed)) {
      toast.error("ID inválido");
      return;
    }
    callApi("/api/inbox/assign", {
      issue_id: item.issue_id,
      assignee_canonical_contact_id: parsed,
    });
  };

  const severityValue = (item.severity ?? "low") as "critical" | "high" | "medium" | "low";

  return (
    <div className="relative pb-24 lg:pb-0 lg:grid lg:grid-cols-[1fr_280px] lg:gap-6">
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="severity" value={severityValue} density="regular" />
            <span className="text-xs text-muted-foreground">
              Prioridad {Math.round(item.priority_score ?? 0)}
            </span>
            <span className="text-xs text-muted-foreground">· Hace {item.age_days}d</span>
            {item.impact_mxn != null && (
              <span className="text-xs text-muted-foreground">
                · Impacto {formatMxn(item.impact_mxn)}
              </span>
            )}
          </div>
          <h1 className="text-lg font-semibold leading-snug">{item.description}</h1>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>
              Entidad: {item.canonical_entity_type} · {item.canonical_entity_id}
            </span>
            {item.assignee_name && <span>Asignado: {item.assignee_name}</span>}
          </div>
        </header>

        <section aria-labelledby="evidencia-heading" className="space-y-3">
          <SectionHeader title="Evidencia" />
          <EvidenceSection signals={item.email_signals} facts={item.ai_extracted_facts} />
        </section>

        <section aria-labelledby="archivos-heading" className="space-y-3">
          <SectionHeader title="Archivos" />
          <AttachmentsSection items={item.attachments} />
        </section>

        <section aria-labelledby="notas-heading" className="space-y-3">
          <SectionHeader title="Notas" />
          <NotesSection
            notes={item.manual_notes}
            canonicalEntityType={item.canonical_entity_type ?? ""}
            canonicalEntityId={item.canonical_entity_id ?? ""}
          />
        </section>
      </div>

      {/* Mobile sticky bottom bar */}
      <div
        data-testid="mobile-action-bar"
        role="toolbar"
        aria-label="Acciones"
        className="fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 backdrop-blur p-3 lg:hidden"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex max-w-screen-md gap-2">
          <Button
            className="flex-1 min-h-[44px]"
            onClick={handlePrimary}
            disabled={isPending}
          >
            {primary.label}
          </Button>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={handleAssign}
            disabled={isPending}
          >
            Asignar
          </Button>
        </div>
      </div>

      {/* Desktop sticky sidebar */}
      <aside
        data-testid="desktop-action-bar"
        role="toolbar"
        aria-label="Acciones (escritorio)"
        className="hidden lg:sticky lg:top-4 lg:block lg:self-start lg:space-y-4"
      >
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <MetricRow
            label="Severidad"
            value={<StatusBadge kind="severity" value={severityValue} />}
          />
          <MetricRow label="Prioridad" value={String(Math.round(item.priority_score ?? 0))} />
          <MetricRow label="Impacto" value={formatMxn(item.impact_mxn)} />
          <MetricRow label="Edad" value={`${item.age_days}d`} />
          <MetricRow label="Asignado" value={item.assignee_name ?? "—"} />
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={handlePrimary} disabled={isPending} tabIndex={-1}>
            {primary.label}
          </Button>
          <Button variant="outline" onClick={handleAssign} disabled={isPending} tabIndex={-1}>
            Asignar
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              callApi("/api/inbox/action/operationalize", { issue_id: item.issue_id })
            }
            disabled={isPending || ctaKey === "operationalize"}
            tabIndex={-1}
          >
            Operacionalizar
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              callApi("/api/inbox/action/link_manual", { issue_id: item.issue_id })
            }
            disabled={isPending || ctaKey === "link_manual"}
            tabIndex={-1}
          >
            Ligar manual
          </Button>
        </div>
      </aside>
    </div>
  );
}
