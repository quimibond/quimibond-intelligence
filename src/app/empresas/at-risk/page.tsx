import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  Moon,
  ShieldAlert,
  Truck,
} from "lucide-react";
import {
  PageLayout,
  PageHeader,
  StatGrid,
  KpiCard,
  QuestionSection,
  DataTable,
  CompanyLink,
  Currency,
  DateDisplay,
  EmptyState,
  LoadingCard,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import {
  getAtRiskOverview,
  type AtRiskBucket,
  type AtRiskCompanyRow,
  type AtRiskOverview,
} from "@/lib/queries/sp13/empresas";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "Empresas en riesgo",
};

const tierVariant: Record<string, "success" | "warning" | "secondary"> = {
  A: "success",
  B: "warning",
  C: "secondary",
};

function commonTierColumn(): DataTableColumn<AtRiskCompanyRow> {
  return {
    key: "tier",
    header: "Tier",
    align: "center",
    hideOnMobile: true,
    cell: (r) =>
      r.tier ? (
        <Badge variant={tierVariant[r.tier] ?? "secondary"} className="h-5">
          {r.tier}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  };
}

function companyColumn(): DataTableColumn<AtRiskCompanyRow> {
  return {
    key: "company",
    header: "Empresa",
    alwaysVisible: true,
    cell: (r) => (
      <CompanyLink
        companyId={r.canonical_company_id}
        name={r.display_name}
        truncate
      />
    ),
  };
}

const blacklistColumns: DataTableColumn<AtRiskCompanyRow>[] = [
  companyColumn(),
  {
    key: "level",
    header: "Lista negra",
    align: "center",
    cell: (r) => (
      <Badge variant="danger" className="h-5 text-[10px]">
        {r.blacklist_level === "69b_definitivo" ? "69B Definitivo" : "69B Presunto"}
      </Badge>
    ),
  },
  {
    key: "ltv",
    header: "LTV",
    align: "right",
    cell: (r) => <Currency amount={r.lifetime_value_mxn} compact />,
  },
  commonTierColumn(),
  {
    key: "rfc",
    header: "RFC",
    hideOnMobile: true,
    cell: (r) =>
      r.rfc ? (
        <span className="font-mono text-xs">{r.rfc}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

const overdueColumns: DataTableColumn<AtRiskCompanyRow>[] = [
  companyColumn(),
  {
    key: "overdue",
    header: "Vencido",
    align: "right",
    cell: (r) => (
      <span className="font-semibold text-danger tabular-nums">
        <Currency amount={r.overdue_amount_mxn} compact />
      </span>
    ),
  },
  {
    key: "days",
    header: "Días máx",
    align: "right",
    hideOnMobile: true,
    cell: (r) =>
      r.max_days_overdue != null ? (
        <span className="tabular-nums">{r.max_days_overdue}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "ltv",
    header: "LTV",
    align: "right",
    hideOnMobile: true,
    cell: (r) => <Currency amount={r.lifetime_value_mxn} compact />,
  },
  commonTierColumn(),
];

const dormantColumns: DataTableColumn<AtRiskCompanyRow>[] = [
  companyColumn(),
  {
    key: "ltv",
    header: "LTV histórico",
    align: "right",
    cell: (r) => <Currency amount={r.lifetime_value_mxn} compact />,
  },
  {
    key: "last",
    header: "Última factura",
    align: "right",
    cell: (r) =>
      r.last_invoice_date ? (
        <DateDisplay date={r.last_invoice_date} relative />
      ) : (
        <span className="text-muted-foreground">Nunca</span>
      ),
  },
  commonTierColumn(),
];

const lateOtdColumns: DataTableColumn<AtRiskCompanyRow>[] = [
  companyColumn(),
  {
    key: "otd",
    header: "OTD rate",
    align: "right",
    cell: (r) => (
      <span
        className={
          (r.otd_rate ?? 0) < 0.5
            ? "font-semibold text-danger tabular-nums"
            : "text-warning tabular-nums"
        }
      >
        {r.otd_rate != null ? `${(r.otd_rate * 100).toFixed(0)}%` : "—"}
      </span>
    ),
  },
  {
    key: "ltv",
    header: "LTV",
    align: "right",
    hideOnMobile: true,
    cell: (r) => <Currency amount={r.lifetime_value_mxn} compact />,
  },
  commonTierColumn(),
];

export default function AtRiskPage() {
  return (
    <PageLayout>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Empresas", href: "/empresas" },
          { label: "En riesgo" },
        ]}
        title="Empresas en riesgo"
        subtitle="¿Quién se está apagando, quién no paga, quién entrega tarde?"
      />
      <Suspense fallback={<LoadingCard />}>
        <AtRiskAsync />
      </Suspense>
    </PageLayout>
  );
}

async function AtRiskAsync() {
  const overview = await getAtRiskOverview(10);
  return <AtRiskView overview={overview} />;
}

function AtRiskView({ overview }: { overview: AtRiskOverview }) {
  const totalAtRisk =
    overview.blacklist.totalCount +
    overview.overdue.totalCount +
    overview.dormant.totalCount +
    overview.lateOtd.totalCount;

  if (totalAtRisk === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Portafolio sano"
        description="Ninguna empresa en lista negra, vencida >$50k, dormida o con OTD <70%."
      />
    );
  }

  return (
    <div className="space-y-6">
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Lista negra"
          value={overview.blacklist.totalCount}
          format="number"
          icon={ShieldAlert}
          subtitle="69B presunto + definitivo"
          tone={overview.blacklist.totalCount > 0 ? "danger" : "default"}
        />
        <KpiCard
          title="Vencidos > $50k"
          value={overview.overdue.totalAmount}
          format="currency"
          compact
          icon={Banknote}
          subtitle={`${overview.overdue.totalCount.toLocaleString("es-MX")} empresas`}
          tone={overview.overdue.totalCount > 0 ? "warning" : "default"}
        />
        <KpiCard
          title="Dormidos"
          value={overview.dormant.totalCount}
          format="number"
          icon={Moon}
          subtitle="Sin facturación 12m+"
        />
        <KpiCard
          title="OTD bajo"
          value={overview.lateOtd.totalCount}
          format="number"
          icon={Truck}
          subtitle="Entrega < 70%"
          tone={overview.lateOtd.totalCount > 0 ? "warning" : "default"}
        />
      </StatGrid>

      <RiskBucketSection
        id="blacklist"
        question="¿Quién está en lista negra?"
        subtext="Empresas con bandera 69B (presunto o definitivo) en SAT. Riesgo fiscal directo si se les sigue facturando."
        bucket={overview.blacklist}
        columns={blacklistColumns}
        emptyTitle="Nadie en lista negra"
        emptyDesc="Tu portafolio está limpio de banderas SAT 69B."
      />

      <RiskBucketSection
        id="overdue"
        question="¿Quién me debe vencido (más de $50k)?"
        subtext="Top empresas por monto vencido. Suma del bucket completo arriba."
        bucket={overview.overdue}
        columns={overdueColumns}
        emptyTitle="Sin cartera vencida significativa"
        emptyDesc="Ninguna empresa supera el umbral de $50,000 MXN vencido."
      />

      <RiskBucketSection
        id="dormant"
        question="¿Quién dejó de comprar?"
        subtext="Clientes/proveedores con LTV histórico pero sin facturación en últimos 12 meses."
        bucket={overview.dormant}
        columns={dormantColumns}
        emptyTitle="Sin dormidos"
        emptyDesc="Toda empresa con LTV ha facturado en los últimos 12 meses."
      />

      <RiskBucketSection
        id="late-otd"
        question="¿A quién le entrego tarde?"
        subtext="Clientes con OTD (on-time delivery) menor a 70%. Riesgo de churn por servicio."
        bucket={overview.lateOtd}
        columns={lateOtdColumns}
        emptyTitle="Sin clientes con OTD bajo"
        emptyDesc="Todos los clientes con OTD computado están sobre 70%."
      />

      <p className="text-xs text-muted-foreground">
        Para ver el portafolio completo, ve a{" "}
        <Link href="/empresas" className="underline hover:text-primary">
          /empresas
        </Link>
        .
      </p>
    </div>
  );
}

interface BucketSectionProps {
  id: string;
  question: string;
  subtext: string;
  bucket: AtRiskBucket;
  columns: DataTableColumn<AtRiskCompanyRow>[];
  emptyTitle: string;
  emptyDesc: string;
}

function RiskBucketSection({
  id,
  question,
  subtext,
  bucket,
  columns,
  emptyTitle,
  emptyDesc,
}: BucketSectionProps) {
  return (
    <QuestionSection
      id={id}
      question={question}
      subtext={`${subtext}${bucket.totalCount > bucket.rows.length ? ` Mostrando top ${bucket.rows.length} de ${bucket.totalCount}.` : ""}`}
      actions={
        bucket.totalCount > bucket.rows.length ? (
          <Link
            href="/empresas"
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver todos en /empresas →
          </Link>
        ) : null
      }
    >
      <DataTable
        data={bucket.rows}
        columns={columns}
        rowKey={(r) => r.canonical_company_id}
        rowHref={(r) => `/empresas/${r.canonical_company_id}`}
        density="compact"
        emptyState={{ icon: AlertTriangle, title: emptyTitle, description: emptyDesc }}
      />
    </QuestionSection>
  );
}
