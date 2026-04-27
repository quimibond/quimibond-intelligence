import { Globe2, Scale } from "lucide-react";
import {
  StatGrid,
  KpiCard,
  QuestionSection,
  Currency,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrencyMXN } from "@/lib/formatters";
import { getFxExposure } from "@/lib/queries/sp13/finanzas";

export async function FxExposureBlock() {
  const fx = await getFxExposure();
  const hasExposure = fx.exposure.length > 0;

  return (
    <QuestionSection
      id="fx"
      question="¿Cuánta exposición tengo en moneda extranjera?"
      subtext="Tipo de cambio actual + AR/AP abierto en USD/EUR"
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 1, tablet: 3, desktop: 3 }}>
        {fx.rates.map((r) => (
          <KpiCard
            key={r.currency}
            title={`${r.currency}/MXN`}
            value={r.rate}
            format="number"
            icon={Globe2}
            source="canonical"
            tone={r.isStale ? "warning" : "default"}
            subtitle={
              r.isStale
                ? `STALE · al ${r.rateDate}`
                : `al ${r.rateDate}`
            }
            definition={{
              title: `Tipo de cambio ${r.currency}/MXN`,
              description:
                "Última tasa registrada en canonical_fx_rates con recency_rank=1.",
              formula: "MAX(rate) WHERE recency_rank = 1",
              table: "canonical_fx_rates",
            }}
          />
        ))}
        <KpiCard
          title="Exposición neta extranjera"
          value={fx.netForeignMxn}
          format="currency"
          compact
          icon={Scale}
          source="canonical"
          tone={fx.netForeignMxn >= 0 ? "info" : "warning"}
          subtitle={`AR ${formatCurrencyMXN(fx.arForeignMxn, { compact: true })} − AP ${formatCurrencyMXN(fx.apForeignMxn, { compact: true })}`}
          definition={{
            title: "Exposición neta foreign",
            description:
              "Diferencia entre AR y AP abierto en monedas distintas a MXN. Una variación del tipo de cambio mueve este número proporcionalmente.",
            formula: "SUM(AR_mxn WHERE currency!=MXN) − SUM(AP_mxn WHERE currency!=MXN)",
            table: "canonical_invoices + canonical_fx_rates",
          }}
        />
      </StatGrid>

      {hasExposure && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Detalle por moneda y dirección</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Moneda</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead className="text-right">Facturas</TableHead>
                  <TableHead className="text-right">Monto nativo</TableHead>
                  <TableHead className="text-right">Equivalente MXN</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fx.exposure.map((e) => (
                  <TableRow key={`${e.currency}-${e.direction}`}>
                    <TableCell className="font-mono text-xs">{e.currency}</TableCell>
                    <TableCell>
                      <Badge
                        variant={e.direction === "issued" ? "info" : "warning"}
                        className="text-[10px]"
                      >
                        {e.direction === "issued" ? "AR — me deben" : "AP — yo debo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.invoiceCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.amountNative.toLocaleString("es-MX", { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Currency amount={e.amountMxn} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </QuestionSection>
  );
}
