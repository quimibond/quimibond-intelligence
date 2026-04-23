// src/app/showcase/sp13/page.tsx
import { TrendingUp } from "lucide-react";
import {
  PageLayout,
  PageHeader,
  StatGrid,
  KpiCard,
  SourceBadge,
  DriftPill,
  DriftAlert,
  MetricTooltip,
  ComparisonCell,
  HistorySelector,
  QuestionSection,
} from "@/components/patterns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KpiResult } from "@/lib/kpi";

export const metadata = { title: "SP13 primitives" };

const definicionIngresos = {
  title: "Ingresos del mes",
  description:
    "Suma de facturación SAT timbrada con estado vigente del mes actual.",
  formula:
    "SUM(amount_total_mxn_resolved) WHERE direction='issued' AND estado_sat='vigente' AND invoice_date IN CURRENT_MONTH",
  table: "canonical_invoices",
};

const sourcesDual: NonNullable<KpiResult["sources"]> = [
  { source: "sat", value: 8_314_094, diffFromPrimary: 0, diffPct: 0 },
  {
    source: "pl",
    value: 7_379_304,
    diffFromPrimary: -934_790,
    diffPct: -11.2,
  },
];

const comparisonMoM = {
  label: "vs marzo",
  priorValue: 29_492_624,
  delta: -21_178_530,
  deltaPct: -71.8,
  direction: "down" as const,
};

export default function Sp13ShowcasePage() {
  return (
    <PageLayout>
      <PageHeader
        title="SP13 primitives"
        subtitle="Catálogo visual de los building blocks SP13 (data-first)."
        actions={<HistorySelector paramName="sp13_range" defaultRange="ltm" />}
      />

      <QuestionSection
        id="drift-alert"
        question="¿Cómo se ve un DriftAlert crítico?"
        subtext="Úsalo cuando una divergencia sistémica entre SAT y P&L requiere acción."
      >
        <DriftAlert
          severity="critical"
          title="$13.4M timbrados sin booking contable en marzo 2026"
          description="SAT y P&L divergen 45.5%. Revisar con contabilidad antes de cerrar el mes."
          action={{ label: "Ver detalle", href: "/sistema/drift" }}
        />
        <DriftAlert
          severity="warning"
          title="DSO subió 6 días respecto al promedio LTM"
          description="Cartera vencida 30+ creció 18% este trimestre."
        />
        <DriftAlert
          severity="info"
          title="Ticket promedio en línea con LTM"
          description="Sin desviaciones relevantes."
        />
      </QuestionSection>

      <QuestionSection
        id="kpis"
        question="¿Cómo se ve un KpiCard con todas las piezas SP13?"
        subtext="Source badge + MetricTooltip + DriftPill + Comparison."
      >
        <StatGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }}>
          <KpiCard
            title="Ingresos del mes"
            value={8_314_094}
            format="currency"
            compact
            icon={TrendingUp}
            source="sat"
            definition={definicionIngresos}
            comparison={comparisonMoM}
            sources={sourcesDual}
            asOfDate="2026-04-23"
          />
          <KpiCard
            title="Solo con source (sin definition)"
            value={285_147_145}
            format="currency"
            compact
            source="canonical"
            comparison={{
              label: "vs mes",
              priorValue: 275_000_000,
              delta: 10_147_145,
              deltaPct: 3.7,
              direction: "up",
            }}
          />
          <KpiCard
            title="Legacy (old API, no SP13 props)"
            value={67_167_696}
            format="currency"
            compact
            icon={TrendingUp}
            tone="warning"
            subtitle="Cartera vencida"
            trend={{ value: 18, good: "down" }}
          />
        </StatGrid>
      </QuestionSection>

      <QuestionSection
        id="badges"
        question="¿Cómo se ven los SourceBadges por tipo?"
      >
        <div className="flex flex-wrap gap-2">
          <SourceBadge source="sat" />
          <SourceBadge source="pl" />
          <SourceBadge source="odoo" />
          <SourceBadge source="canonical" />
        </div>
      </QuestionSection>

      <QuestionSection
        id="drift-pill"
        question="¿Cómo se ve DriftPill suelto?"
        subtext="Click abre popover con el breakdown."
      >
        <DriftPill sources={sourcesDual} primary="sat" />
      </QuestionSection>

      <QuestionSection
        id="metric-tooltip"
        question="¿Cómo se ve MetricTooltip suelto?"
      >
        <MetricTooltip definition={definicionIngresos}>
          <span className="text-sm font-medium">Ingresos del mes</span>
        </MetricTooltip>
      </QuestionSection>

      <QuestionSection
        id="comparison-cell"
        question="¿Cómo se ve ComparisonCell en una tabla?"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tabla de ejemplo</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Ingresos</TableHead>
                  <TableHead className="text-right">Utilidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Abril 2026 MTD</TableCell>
                  <TableCell className="text-right">
                    <ComparisonCell
                      value={8_314_094}
                      comparison={comparisonMoM}
                      format="currency"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <ComparisonCell value={2_615_206} comparison={null} format="currency" />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </QuestionSection>
    </PageLayout>
  );
}
