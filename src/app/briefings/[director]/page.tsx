import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Check, FileText, Sparkles } from "lucide-react";

import {
  PageHeader,
  EvidencePackView,
  EmptyState,
  DateDisplay,
} from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  getDirectorBriefing,
  DIRECTOR_LABELS,
  type DirectorSlug,
} from "@/lib/queries/evidence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DIRECTORS: DirectorSlug[] = [
  "comercial",
  "financiero",
  "operaciones",
  "compras",
  "riesgo",
  "equipo",
  "costos",
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ director: string }>;
}) {
  const { director } = await params;
  if (!DIRECTORS.includes(director as DirectorSlug)) {
    return { title: "Briefing" };
  }
  return { title: `Briefing — Director ${DIRECTOR_LABELS[director as DirectorSlug]}` };
}

export default async function DirectorBriefingPage({
  params,
  searchParams,
}: {
  params: Promise<{ director: string }>;
  searchParams: Promise<{ n?: string }>;
}) {
  const { director: directorParam } = await params;
  const { n } = await searchParams;

  if (!DIRECTORS.includes(directorParam as DirectorSlug)) notFound();
  const director = directorParam as DirectorSlug;

  const maxCompanies = Math.min(Math.max(Number(n) || 5, 1), 15);

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Briefings", href: "/briefings" },
          { label: DIRECTOR_LABELS[director] },
        ]}
        title={`Briefing — ${DIRECTOR_LABELS[director]}`}
        subtitle={`¿Qué empresas necesitan atención hoy desde ${DIRECTOR_LABELS[director].toLowerCase()}? Top ${maxCompanies} con evidencia cruzada.`}
      />

      <DirectorTabs active={director} />

      <Suspense
        key={`${director}-${maxCompanies}`}
        fallback={<BriefingSkeleton />}
      >
        <BriefingContent director={director} maxCompanies={maxCompanies} />
      </Suspense>
    </div>
  );
}

function DirectorTabs({ active }: { active: DirectorSlug }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
      {DIRECTORS.map((d) => (
        <Link
          key={d}
          href={`/briefings/${d}`}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            active === d
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-accent"
          )}
        >
          {DIRECTOR_LABELS[d]}
        </Link>
      ))}
    </div>
  );
}

function BriefingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

async function BriefingContent({
  director,
  maxCompanies,
}: {
  director: DirectorSlug;
  maxCompanies: number;
}) {
  const briefing = await getDirectorBriefing(director, maxCompanies);

  if (!briefing) {
    return (
      <EmptyState
        icon={FileText}
        title="Sin briefing"
        description="El RPC get_director_briefing no devolvió datos."
      />
    );
  }

  if (
    !briefing.evidence_packs ||
    briefing.evidence_packs.length === 0
  ) {
    return (
      <EmptyState
        icon={Bot}
        title="Sin empresas críticas"
        description={`No hay empresas marcadas como prioritarias para el director ${DIRECTOR_LABELS[director]}.`}
      />
    );
  }

  return (
    <div className="space-y-5">
      <BriefingMeta briefing={briefing} />

      {briefing.evidence_packs.map((pack, idx) => (
        <div key={pack.company_id} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              {idx + 1}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Empresa {idx + 1} de {briefing.evidence_packs.length}
            </span>
          </div>
          <EvidencePackView pack={pack} />
        </div>
      ))}
    </div>
  );
}

function BriefingMeta({
  briefing,
}: {
  briefing: NonNullable<Awaited<ReturnType<typeof getDirectorBriefing>>>;
}) {
  const recentActed =
    briefing.agent_feedback?.recent_acted_titles ?? undefined;

  return (
    <div className="space-y-3">
      {briefing.instructions && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
              Instrucciones al agente
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {briefing.instructions}
            </p>
            {briefing.generated_at && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Generado <DateDisplay date={briefing.generated_at} relative />
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {recentActed && recentActed.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-success" aria-hidden />
              Insights accionados recientemente
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {recentActed.slice(0, 6).map((title, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-success">✓</span>
                  <span className="line-clamp-2">{title}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
