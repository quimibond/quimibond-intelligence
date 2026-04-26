"use client";

import * as React from "react";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  HelpCircleIcon,
  InfoIcon,
  RefreshCwIcon,
  ScaleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { MetricRow } from "@/components/patterns/metric-row";
import { SectionHeader } from "@/components/patterns/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/database.types";
import type { InboxRow } from "@/lib/queries/intelligence/inbox";
import type { InvariantExplainer } from "@/lib/queries/intelligence/invariant-explainers";
import type { IssueEntityContext } from "@/lib/queries/intelligence/issue-entity-context";
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
  /** Plain-language explanation of the invariant. Optional for backward
   *  compat with existing callers/tests; defaults to a generic banner. */
  explainer?: InvariantExplainer;
  /** Resolved invoice/payment context for the entity this issue points to. */
  entityContext?: IssueEntityContext | null;
}

const FALLBACK_EXPLAINER: InvariantExplainer = {
  title: "Inconsistencia detectada",
  what: "El motor de reconciliación detectó una inconsistencia entre fuentes.",
  why: "Sin resolverlo los reportes pueden mostrar números incorrectos.",
  howToFix: ["Revisar los datos en Odoo y SAT manualmente."],
  autoCloses: "Cuando la condición deja de ocurrir.",
  entityLabel: "Entidad",
};

export function IssueDetailClient({
  item,
  explainer = FALLBACK_EXPLAINER,
  entityContext = null,
}: Props) {
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
      <div className="space-y-5">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="severity" value={severityValue} density="regular" />
            <span className="text-xs text-muted-foreground">
              Prioridad {Math.round(item.priority_score ?? 0)}
            </span>
            <span className="text-xs text-muted-foreground">· Hace {item.age_days}d</span>
            {item.impact_mxn != null && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
                <ScaleIcon className="size-3" aria-hidden />
                {formatMxn(item.impact_mxn)}
              </span>
            )}
          </div>
          {item.assignee_name && (
            <p className="text-xs text-muted-foreground">
              Routeado a {item.assignee_name}
            </p>
          )}
        </header>

        {/* Stale-issue alert: the underlying entity already meets the
            condition the issue claimed was missing. */}
        {entityContext?.appearsResolved && entityContext.resolutionHint && (
          <Card className="gap-0 border-l-4 border-l-success bg-success/5 py-0">
            <CardContent className="flex items-start gap-3 px-4 py-3">
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <div className="text-xs leading-relaxed">
                <p className="font-semibold text-success">
                  Probable falso positivo — la condición ya no se cumple
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {entityContext.resolutionHint}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* "What happened" — plain-language explanation of the invariant */}
        <section aria-labelledby="que-paso" className="space-y-3">
          <h2 id="que-paso" className="flex items-center gap-1.5 text-sm font-semibold">
            <InfoIcon className="size-4 text-muted-foreground" aria-hidden />
            ¿Qué pasó?
          </h2>
          <p className="text-sm leading-relaxed text-foreground/90">
            {explainer.what}
          </p>
        </section>

        {/* Entity context: surfaces the actual invoice/payment with company,
            amount, dates, status compare. */}
        {entityContext && (
          <section aria-labelledby="contexto-entidad" className="space-y-3">
            <h2
              id="contexto-entidad"
              className="flex items-center gap-1.5 text-sm font-semibold"
            >
              <ClipboardListIcon className="size-4 text-muted-foreground" aria-hidden />
              {explainer.entityLabel} involucrada
            </h2>
            <Card className="gap-0 py-0">
              <CardContent className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {entityContext.displayName ?? entityContext.sourceRef}
                  </span>
                  {entityContext.amountMxn != null && (
                    <Badge variant="secondary" className="tabular-nums">
                      {formatMxn(entityContext.amountMxn)}
                    </Badge>
                  )}
                  {entityContext.companyId && entityContext.companyName && (
                    <Link
                      href={`/empresas/${entityContext.companyId}`}
                      className="ml-auto text-xs font-medium text-primary hover:underline"
                    >
                      {entityContext.companyName} →
                    </Link>
                  )}
                </div>
                {entityContext.facts.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-3">
                    {entityContext.facts.map((f, i) => (
                      <div key={i} className="min-w-0">
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {f.label}
                        </dt>
                        <dd
                          className={cn(
                            "mt-0.5 truncate font-medium tabular-nums",
                            f.tone === "danger" && "text-destructive",
                            f.tone === "warning" && "text-warning",
                            f.tone === "success" && "text-success"
                          )}
                          title={f.value}
                        >
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {entityContext.links.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-border/40 pt-2">
                    {entityContext.links.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium hover:bg-muted/70"
                      >
                        {l.label}
                        <ArrowRightIcon className="size-3" aria-hidden />
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* "Why it matters" */}
        <section aria-labelledby="por-que-importa" className="space-y-2">
          <h2
            id="por-que-importa"
            className="flex items-center gap-1.5 text-sm font-semibold"
          >
            <AlertTriangleIcon className="size-4 text-muted-foreground" aria-hidden />
            ¿Por qué importa?
          </h2>
          <p className="text-sm leading-relaxed text-foreground/90">
            {explainer.why}
          </p>
        </section>

        {/* "What to do" — ordered checklist */}
        <section aria-labelledby="que-hacer" className="space-y-2">
          <h2
            id="que-hacer"
            className="flex items-center gap-1.5 text-sm font-semibold"
          >
            <ClipboardListIcon className="size-4 text-muted-foreground" aria-hidden />
            ¿Qué hacer?
          </h2>
          <ol className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
            {explainer.howToFix.map((step, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="text-foreground/90">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Auto-close hint */}
        <section aria-labelledby="auto-cierre" className="space-y-2">
          <h2
            id="auto-cierre"
            className="flex items-center gap-1.5 text-sm font-semibold"
          >
            <RefreshCwIcon className="size-4 text-muted-foreground" aria-hidden />
            Cierre automático
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {explainer.autoCloses}
          </p>
        </section>

        {/* Existing evidence/files/notes — secondary content below the fold */}
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold hover:text-foreground">
            <HelpCircleIcon className="size-4 text-muted-foreground" aria-hidden />
            Evidencia, archivos y notas
            <span className="text-[10px] font-normal text-muted-foreground">
              ({item.email_signals.length + item.ai_extracted_facts.length} señales ·{" "}
              {item.attachments.length} archivos · {item.manual_notes.length} notas)
            </span>
          </summary>
          <div className="mt-3 space-y-4">
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
        </details>

        <p className="text-[10px] text-muted-foreground">
          ID interno: {item.canonical_entity_type} · {item.canonical_entity_id}
        </p>
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
