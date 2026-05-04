import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getMonthlyReport } from "@/lib/queries/sp13/finanzas/monthly-report";
import { getReportNarrative } from "@/lib/queries/sp13/finanzas/monthly-report-narrative";
import { ReportHeader } from "./_components/report-header";
import { ExecutiveSummary } from "./_components/executive-summary";
import { PnlComparisonTable } from "./_components/pnl-comparison-table";
import { DriversSection } from "./_components/drivers-section";
import { OneOffsSection } from "./_components/one-offs-section";
import { CashHealthSection } from "./_components/cash-health-section";
import { RecommendationsSection } from "./_components/recommendations-section";
import { NextMonthFocus } from "./_components/next-month-focus";
import { PrintButton } from "./_components/print-button";

const PRINT_CSS = `
@media print {
  @page { size: letter; margin: 18mm 15mm; }
  html, body { background: white !important; }
  .reporte-print { font-size: 11pt; color: black; }
  .reporte-print h1 { font-size: 22pt; }
  .reporte-print h2 { font-size: 14pt; page-break-after: avoid; }
  .reporte-print h3 { font-size: 12pt; page-break-after: avoid; }
  .reporte-print table { page-break-inside: avoid; }
  .reporte-print a { text-decoration: none; color: inherit; }
}
`;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function ReportePage({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  const { period } = await params;
  if (!PERIOD_RE.test(period)) notFound();

  const report = await getMonthlyReport(period);

  return (
    <main className="reporte-print mx-auto max-w-5xl px-6 py-8 print:px-0 print:py-0">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="flex items-start justify-between mb-6 print:hidden">
        <div className="text-sm text-muted-foreground">
          Reporte mensual · cierre del mes · listo para imprimir
        </div>
        <PrintButton />
      </div>

      <ReportHeader report={report} />

      <Suspense fallback={<NarrativePlaceholder />}>
        <NarrativeBlock period={period} report={report} />
      </Suspense>

      <section className="mt-10">
        <h2 className="text-xl font-semibold mb-3">Resultado del mes</h2>
        <PnlComparisonTable report={report} />
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold mb-3">Qué movió el resultado</h2>
        <DriversSection report={report} />
      </section>

      {report.oneOffs.length > 0 ? (
        <section className="mt-10 print:break-inside-avoid">
          <h2 className="text-xl font-semibold mb-3">One-offs detectados</h2>
          <OneOffsSection report={report} />
        </section>
      ) : null}

      <section className="mt-10 print:break-inside-avoid">
        <h2 className="text-xl font-semibold mb-3">Salud financiera</h2>
        <CashHealthSection report={report} />
      </section>

      <Suspense fallback={null}>
        <RecommendationsBlock period={period} report={report} />
      </Suspense>
    </main>
  );
}

async function NarrativeBlock({
  period,
  report,
}: {
  period: string;
  report: Awaited<ReturnType<typeof getMonthlyReport>>;
}) {
  void period;
  const narrative = await getReportNarrative(report);
  if (!narrative) {
    return (
      <div className="mt-8 p-4 rounded border border-amber-300 bg-amber-50 text-sm text-amber-900 print:hidden">
        El resumen ejecutivo no se pudo generar (revisa ANTHROPIC_API_KEY).
        Todos los datos numéricos abajo son completos.
      </div>
    );
  }
  return (
    <ExecutiveSummary
      summary={narrative.executiveSummary}
      whyWonOrLost={narrative.whyWonOrLost}
      topThreeWins={narrative.topThreeWins}
      topThreeLosses={narrative.topThreeLosses}
    />
  );
}

async function RecommendationsBlock({
  period,
  report,
}: {
  period: string;
  report: Awaited<ReturnType<typeof getMonthlyReport>>;
}) {
  void period;
  const narrative = await getReportNarrative(report);
  if (!narrative) return null;
  return (
    <>
      <section className="mt-10 print:break-before-page">
        <h2 className="text-xl font-semibold mb-3">Recomendaciones priorizadas</h2>
        <RecommendationsSection recommendations={narrative.recommendations} />
      </section>
      <section className="mt-10 print:break-inside-avoid">
        <h2 className="text-xl font-semibold mb-3">Foco para el mes siguiente</h2>
        <NextMonthFocus text={narrative.nextMonthFocus} />
      </section>
    </>
  );
}

function NarrativePlaceholder() {
  return (
    <div className="mt-8 space-y-3 animate-pulse">
      <div className="h-4 w-3/4 bg-muted rounded" />
      <div className="h-4 w-full bg-muted rounded" />
      <div className="h-4 w-5/6 bg-muted rounded" />
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  const { period } = await params;
  return {
    title: `Reporte ${period} — Quimibond`,
  };
}
