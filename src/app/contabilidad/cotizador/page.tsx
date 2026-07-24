import { Suspense } from "react";

import { PageLayout, PageHeader } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";

import { getCotizadorData } from "@/lib/queries/sp13/finanzas/cotizador";
import { CotizadorClient } from "./_components/cotizador-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cotizador — Quimibond" };

export default function CotizadorPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Cotizador"
        subtitle="Costo vivo por producto (BOM recursiva) + pool de gastos ÷ volumen → precio, contribución y margen"
      />
      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-lg" />}>
        <Block />
      </Suspense>
    </PageLayout>
  );
}

async function Block() {
  const data = await getCotizadorData();
  return <CotizadorClient data={data} />;
}
