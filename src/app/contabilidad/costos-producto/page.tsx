import { Suspense } from "react";

import { PageLayout, PageHeader } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";

import { getProductCostCatalog } from "@/lib/queries/sp13/finanzas/product-cost-catalog";
import { ProductCostExplorer } from "./_components/product-cost-explorer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Costos por producto — Quimibond" };

export default function CostosProductoPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Costos por producto"
        subtitle="Busca cualquier producto y consulta su costo desglosado (vendido o no)"
      />
      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-lg" />}>
        <Block />
      </Suspense>
    </PageLayout>
  );
}

async function Block() {
  const data = await getProductCostCatalog();
  return <ProductCostExplorer data={data} />;
}
