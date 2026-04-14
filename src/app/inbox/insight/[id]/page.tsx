import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, Building2, Calendar, Database, User } from "lucide-react";

import {
  PageHeader,
  SeverityBadge,
  DateDisplay,
  CompanyLink,
  MetricRow,
  EvidencePackView,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { getInsightById } from "@/lib/queries/insights";
import { getCompanyEvidencePack } from "@/lib/queries/evidence";
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

  // Auto-mark seen when CEO opens detail
  if (insight.state === "new") {
    await markInsightSeen(id);
  }

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <Link
        href="/inbox"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Todos los insights
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
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
        <h1 className="text-xl font-bold sm:text-2xl lg:text-3xl">
          {insight.title}
        </h1>
        {insight.description && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground sm:text-base">
            {insight.description}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <InsightActions insightId={insight.id} currentState={insight.state} />

      {/* Meta grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contexto</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {insight.company_id && insight.company_name && (
              <div className="flex items-center gap-2 border-b border-border/60 py-2">
                <Building2
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                <CompanyLink
                  companyId={insight.company_id}
                  name={insight.company_name}
                  truncate
                />
              </div>
            )}
            {insight.agent_name && (
              <div className="flex items-center gap-2 border-b border-border/60 py-2 text-sm">
                <Bot className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span>
                  Generado por{" "}
                  <span className="font-semibold">{insight.agent_name}</span>
                </span>
              </div>
            )}
            {insight.assignee_name && (
              <div className="flex items-center gap-2 border-b border-border/60 py-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span>
                  Asignado a{" "}
                  <span className="font-semibold">
                    {insight.assignee_name}
                  </span>
                  {insight.assignee_department && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {insight.assignee_department}
                    </span>
                  )}
                </span>
              </div>
            )}
            {insight.created_at && (
              <div className="flex items-center gap-2 border-b border-border/60 py-2 text-sm">
                <Calendar
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                <span>
                  Detectado <DateDisplay date={insight.created_at} relative />
                </span>
              </div>
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
                value={Math.round(insight.confidence * 100)}
                format="number"
                hint="del agente que generó este insight"
              />
            )}
            {insight.expires_at && (
              <MetricRow
                label="Expira"
                value={new Date(insight.expires_at).toLocaleDateString(
                  "es-MX"
                )}
              />
            )}
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

      {/* Evidence pack — cross-referenced data about the company */}
      {insight.company_id && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Evidencia cruzada
          </h2>
          <Suspense fallback={<EvidencePackSkeleton />}>
            <EvidenceSection companyId={insight.company_id} />
          </Suspense>
        </section>
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
