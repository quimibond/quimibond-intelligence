import { Suspense } from "react";
import { DollarSign } from "lucide-react";

import { getLatestCurrencyRates } from "@/lib/queries/analytics/currency-rates";
import { SectionHeader, LoadingCard, EmptyState } from "@/components/patterns";
import { Card, CardContent } from "@/components/ui/card";

async function FxRatesContent() {
  const rates = await getLatestCurrencyRates();

  if (rates.length === 0) {
    return (
      <EmptyState
        icon={DollarSign}
        title="Sin tipos de cambio"
        description="odoo_currency_rates está vacío o no tiene rates recientes."
        compact
      />
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {rates.map((r) => {
        // `rate` is already MXN per 1 foreign unit (e.g. 17.27 = 1 USD costs $17.27 MXN)
        const label = `${r.currency} / MXN`;
        const formattedRate = r.rate.toLocaleString("es-MX", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        });
        const formattedDate = new Date(r.rate_date + "T12:00:00").toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });

        return (
          <Card key={r.currency}>
            <CardContent className="p-4 space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="text-xl font-semibold tabular-nums">
                ${formattedRate}
              </div>
              <div className="text-xs text-muted-foreground">
                {formattedDate}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function FxRatesWidget() {
  return (
    <section id="fx-rates" className="space-y-3 scroll-mt-24">
      <SectionHeader
        title="Tipos de cambio"
        description="Últimos rates capturados por Odoo · MXN por unidad de divisa extranjera"
      />
      <Suspense fallback={<LoadingCard />}>
        <FxRatesContent />
      </Suspense>
    </section>
  );
}
