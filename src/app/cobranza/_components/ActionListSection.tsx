import { Phone, Check } from "lucide-react";

import { CompanyLink, Currency, EmptyState } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getActionList, type ActionRiskLabel } from "@/lib/queries/sp13/cobranza";

const RISK_LABEL: Record<string, string> = {
  critical: "Crítico",
  abnormal: "Alto",
  watch: "Vigilar",
  normal: "Normal",
};

const RISK_VARIANT: Record<string, "destructive" | "secondary" | "outline"> = {
  critical: "destructive",
  abnormal: "destructive",
  watch: "secondary",
  normal: "outline",
};

interface Props {
  top?: number;
}

export async function ActionListSection({ top = 20 }: Props) {
  const items = await getActionList(top);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Check}
        title="Nada urgente por cobrar"
        description="No hay facturas vencidas priorizables."
        compact
      />
    );
  }

  return (
    <ol className="space-y-2">
      {items.map((item, idx) => {
        const risk = (item.risk ?? "") as ActionRiskLabel | "";
        const riskLabel = risk ? RISK_LABEL[risk] ?? risk : null;
        const riskVariant = risk ? RISK_VARIANT[risk] ?? "outline" : "outline";
        return (
          <li
            key={item.invoiceId}
            className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                {item.companyId ? (
                  <CompanyLink
                    companyId={item.companyId}
                    name={item.companyName ?? "Sin nombre"}
                    className="font-medium"
                  />
                ) : (
                  <span className="font-medium">{item.companyName ?? "—"}</span>
                )}
                {riskLabel && (
                  <Badge variant={riskVariant} className="uppercase text-[10px]">
                    {riskLabel}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                <span className="font-semibold text-foreground">
                  <Currency amount={item.amountOverdueMxn} />
                </span>
                <span>vencido {item.daysOverdue}d</span>
                {item.invoiceName && <span>· {item.invoiceName}</span>}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="outline" asChild className="h-8 gap-1 text-xs">
                <a href="tel:">
                  <Phone className="size-3.5" /> Llamar
                </a>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 text-xs text-muted-foreground"
                disabled
                title="Próximamente: marca contactado en agent_insights_actions"
              >
                <Check className="size-3.5" /> Contactado
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
