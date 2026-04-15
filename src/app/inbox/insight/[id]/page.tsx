import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Bot, Calendar, Database } from "lucide-react";

import {
  PageHeader,
  SeverityBadge,
  DateDisplay,
  MetricRow,
  EvidencePackView,
  EvidenceChip,
  EvidenceTimeline,
  PersonCard,
  InvoiceDetailView,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { getInsightById } from "@/lib/queries/insights";
import { getCompanyEvidencePack } from "@/lib/queries/evidence";
import {
  buildTimelineFromEvidencePack,
  extractEvidenceRefs,
} from "@/lib/queries/evidence-helpers";
import { markInsightSeen } from "../../actions";
import { InsightActions } from "./_components/insight-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const insight = await getInsightById(Number(id));
  return { title: insight?.title ?? "Insight" };
}

export default async function InsightDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();

  const insight = await getInsightById(id);
  if (!insight) notFound();

  if (insight.state === "new") {
    await markInsightSeen(id);
  }

  // Extract evidence refs from title + description + recommendation
  const searchText = [
    insight.title,
    insight.description,
    insight.recommendation,
  ]
    .filter(Boolean)
    .join(" ");
  const refs = extractEvidenceRefs(searchText);

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Inbox", href: "/inbox" },
          { label: "Insight" },
        ]}
        title={insight.title ?? "Insight"}
        subtitle={insight.description ?? undefined}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <SeverityBadge level={insight.severity ?? "medium"} />
            {insight.category && (
              <Badge variant="secondary" className="uppercase text-[10px]">
                {insight.category}
              </Badge>
            )}
            {insight.state && insight.state !== "new" && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {insight.state}
              </Badge>
            )}
          </div>
        }
      />

      {/* Evidence refs clickeables parseadas del texto del insight */}
      {refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {refs.map((ref, i) => (
            <EvidenceChip
              key={`${ref.reference}-${i}`}
              type={ref.type}
              reference={ref.reference}
              detail={
                ref.type === "invoice" ? (
                  <InvoiceDetailView reference={ref.reference} />
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Action buttons */}
      <InsightActions insightId={insight.id} currentState={insight.state} />

      {/* Person card — persona responsable */}
      {insight.assignee_name && (
        <PersonCard
          name={insight.assignee_name}
          email={insight.assignee_email}
          role={insight.assignee_department ?? "Asignado"}
          action={
            insight.recommendation
              ? truncate(insight.recommendation, 140)
              : undefined
          }
        />
      )}

      {/* Meta grid: context + metrics */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contexto</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {insight.agent_name && (
              <MetricRow
                label="Generado por"
                value={
                  <span className="inline-flex items-center gap-1">
                    <Bot className="h-3 w-3 text-muted-foreground" aria-hidden />
                    {insight.agent_name}
                  </span>
                }
              />
            )}
            {insight.created_at && (
              <MetricRow
                label="Detectado"
                value={<DateDisplay date={insight.created_at} relative />}
              />
            )}
            {insight.expires_at && (
              <MetricRow
                label="Expira"
                value={
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-muted-foreground" aria-hidden />
                    {new Date(insight.expires_at).toLocaleDateString("es-MX")}
                  </span>
                }
              />
            )}
            {insight.state && (
              <MetricRow
                label="Estado"
                value={
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {insight.state}
                  </Badge>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Métricas</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {insight.business_impact_estimate != null && (
              <MetricRow
                label="Impacto estimado"
                value={insight.business_impact_estimate}
                format="currency"
                compact
              />
            )}
            {insight.confidence != null && (
              <MetricRow
                label="Confianza"
                value={`${Math.round(insight.confidence * 100)}%`}
                hint="del agente"
              />
            )}
            <MetricRow
              label="Severidad"
              value={
                <SeverityBadge level={insight.severity ?? "medium"} />
              }
            />
            <MetricRow label="Categoría" value={insight.category ?? "—"} />
          </CardContent>
        </Card>
      </div>

      {/* Recommendation */}
      {insight.recommendation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Recomendación del agente
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="whitespace-pre-wrap text-sm">
              {insight.recommendation}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Timeline + Evidence pack — solo si hay empresa */}
      {insight.company_id && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Timeline de eventos
            </h2>
            <Card>
              <CardContent className="py-4">
                <Suspense fallback={<Skeleton className="h-48" />}>
                  <TimelineSection companyId={insight.company_id} />
                </Suspense>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Evidencia cruzada
            </h2>
            <Suspense fallback={<EvidencePackSkeleton />}>
              <EvidenceSection companyId={insight.company_id} />
            </Suspense>
          </section>
        </>
      )}

      {/* Raw evidence JSON (collapsible, for debugging) */}
      {insight.evidence != null && (
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground">
            <Database className="h-3 w-3" aria-hidden />
            <span>Evidencia raw del agente (JSON)</span>
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-[10px] font-mono">
            {JSON.stringify(insight.evidence, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function EvidencePackSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

async function TimelineSection({ companyId }: { companyId: number }) {
  const pack = await getCompanyEvidencePack(companyId);
  if (!pack) return null;
  const events = buildTimelineFromEvidencePack(pack);
  if (events.length === 0) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        Sin eventos históricos recientes.
      </p>
    );
  }
  return <EvidenceTimeline events={events} />;
}

async function EvidenceSection({ companyId }: { companyId: number }) {
  const pack = await getCompanyEvidencePack(companyId);
  if (!pack) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-xs text-muted-foreground">
          No se pudo cargar el evidence pack para esta empresa.
        </CardContent>
      </Card>
    );
  }
  return <EvidencePackView pack={pack} />;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len).trim() + "…" : s;
}
