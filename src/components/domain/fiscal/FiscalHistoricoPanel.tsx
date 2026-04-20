import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getTopClientsFiscalLifetime,
  getTopSuppliersFiscalLifetime,
} from "@/lib/queries/fiscal/fiscal-historical";
import { FiscalRevenueTrendTable } from "./FiscalRevenueTrendTable";
import { TopClientsFiscalTable } from "./TopClientsFiscalTable";
import { TopSuppliersFiscalTable } from "./TopSuppliersFiscalTable";

/**
 * Full panel for /system → Syntage → Histórico Fiscal sub-tab.
 * Three cards: revenue trend, top clients, top suppliers.
 * Composed of server components with individual Suspense boundaries.
 */
export function FiscalHistoricoPanel() {
  return (
    <div className="space-y-4">
      {/* Card 1: Revenue trend 24m */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue fiscal · tendencia 24 meses</CardTitle>
          <p className="text-xs text-muted-foreground">
            Datos de syntage_revenue_fiscal_monthly · CFDIs emitidos vs gasto recibido.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[400px]" />}>
            <FiscalRevenueTrendTable months={24} />
          </Suspense>
        </CardContent>
      </Card>

      {/* Card 2: Top 20 clients lifetime */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top 20 clientes fiscales lifetime</CardTitle>
          <p className="text-xs text-muted-foreground">
            Por revenue total de CFDIs emitidos · syntage_top_clients_fiscal_lifetime.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[300px]" />}>
            <TopClientsSection />
          </Suspense>
        </CardContent>
      </Card>

      {/* Card 3: Top 20 suppliers lifetime */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top 20 proveedores fiscales lifetime</CardTitle>
          <p className="text-xs text-muted-foreground">
            Por gasto total de CFDIs recibidos · syntage_top_suppliers_fiscal_lifetime.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[300px]" />}>
            <TopSuppliersSection />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function TopClientsSection() {
  const rows = await getTopClientsFiscalLifetime(20);
  return <TopClientsFiscalTable rows={rows} />;
}

async function TopSuppliersSection() {
  const rows = await getTopSuppliersFiscalLifetime(20);
  return <TopSuppliersFiscalTable rows={rows} />;
}
