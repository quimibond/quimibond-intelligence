import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";

import {
  PageLayout,
  PageHeader,
} from "@/components/patterns";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { getCompanyDetail } from "@/lib/queries/_shared/companies";

import { PanoramaTab } from "./_components/PanoramaTab";
import { ComercialTab } from "./_components/ComercialTab";
import { FinancieroTab } from "./_components/FinancieroTab";
import { OperativoTab } from "./_components/OperativoTab";
import { FiscalTab } from "./_components/FiscalTab";
import { PagosTab } from "./_components/PagosTab";

export const revalidate = 30; // 30s ISR cache · detail pages change faster with user activity

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const company = await getCompanyDetail(Number(id));
  return { title: company?.name ?? "Empresa" };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Valid tab slugs for URL routing */
const VALID_TABS = [
  "panorama",
  "comercial",
  "financiero",
  "operativo",
  "fiscal",
  "pagos",
] as const;
type TabSlug = (typeof VALID_TABS)[number];

function resolveTab(sp: SearchParams): TabSlug {
  const raw = sp.tab;
  const slug = typeof raw === "string" ? raw : (raw?.[0] ?? "panorama");
  return (VALID_TABS as readonly string[]).includes(slug)
    ? (slug as TabSlug)
    : "panorama";
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id: idParam } = await params;
  const sp = await searchParams;
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();

  const company = await getCompanyDetail(id);
  if (!company) notFound();

  // M8: /companies/[id] para empresas self (Quimibond + variantes
  // Google Drive/Chat) renderizaba métricas vacías. Ahora muestra un
  // banner claro — análisis comercial no aplica a empresas internas.
  if (company.isSelf) {
    return (
      <PageLayout>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Empresas", href: "/empresas" },
            { label: company.name },
          ]}
          title={company.name}
          subtitle="Empresa interna"
          actions={<Badge variant="secondary">Interna</Badge>}
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="size-10 text-muted-foreground" />
            <h3 className="text-base font-semibold">Esta es una empresa interna</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {company.name} está marcada como{" "}
              <code className="rounded bg-muted px-1">relationship_type=self</code>{" "}
              — no aplica análisis comercial (revenue, cartera, reorder, etc.). Las
              empresas externas se ven en{" "}
              <Link href="/empresas" className="underline hover:text-primary">
                /empresas
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  const activeTab = resolveTab(sp);

  return (
    <PageLayout>
      {/* Header con breadcrumbs */}
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Empresas", href: "/empresas" },
          { label: company.name },
        ]}
        title={company.name}
        subtitle={
          [company.industry, company.city, company.rfc]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        actions={
          <div className="flex gap-2">
            {company.tier && (
              <Badge
                variant={
                  company.tier === "A"
                    ? "success"
                    : company.tier === "B"
                      ? "info"
                      : "secondary"
                }
              >
                Pareto {company.tier}
              </Badge>
            )}
            {company.isCustomer && <Badge variant="info">Cliente</Badge>}
            {company.isSupplier && (
              <Badge variant="secondary">Proveedor</Badge>
            )}
          </div>
        }
      />

      {/* 5 tabs agrupados por dimensión · URL routing via ?tab=<slug> */}
      <Tabs defaultValue={activeTab} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="panorama">
            Panorama
          </TabsTrigger>
          <TabsTrigger value="comercial">
            Comercial
          </TabsTrigger>
          <TabsTrigger value="financiero">
            Financiero
          </TabsTrigger>
          <TabsTrigger value="operativo">
            Operativo
          </TabsTrigger>
          <TabsTrigger value="fiscal">
            Fiscal
          </TabsTrigger>
          <TabsTrigger value="pagos">
            Pagos
          </TabsTrigger>
        </TabsList>

        {/* 1. Panorama — KPIs cross-domain + insights IA + evidence */}
        <TabsContent value="panorama" className="mt-4">
          <Suspense fallback={<TabSkeleton />}>
            <PanoramaTab company={company} />
          </Suspense>
        </TabsContent>

        {/* 2. Comercial — CRM + ventas + productos */}
        <TabsContent value="comercial" className="mt-4">
          <Suspense fallback={<TabSkeleton />}>
            <ComercialTab company={company} searchParams={sp} />
          </Suspense>
        </TabsContent>

        {/* 3. Financiero — CxC + pagos + LTV */}
        <TabsContent value="financiero" className="mt-4">
          <Suspense fallback={<TabSkeleton />}>
            <FinancieroTab company={company} searchParams={sp} />
          </Suspense>
        </TabsContent>

        {/* 4. Operativo — entregas + actividades */}
        <TabsContent value="operativo" className="mt-4">
          <Suspense fallback={<TabSkeleton />}>
            <OperativoTab company={company} searchParams={sp} />
          </Suspense>
        </TabsContent>

        {/* 5. Fiscal — reconciliación + histórico SAT */}
        <TabsContent value="fiscal" className="mt-4">
          <Suspense fallback={<TabSkeleton />}>
            <FiscalTab companyId={id} />
          </Suspense>
        </TabsContent>

        {/* 6. Pagos — historial de cobros y pagos desde odoo_account_payments */}
        <TabsContent value="pagos" className="mt-4">
          <Suspense fallback={<TabSkeleton />}>
            <PagosTab company={company} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Shared skeleton for tab content loading
// ──────────────────────────────────────────────────────────────────────────
function TabSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}
