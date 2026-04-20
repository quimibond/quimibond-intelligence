import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgingSummary } from "@/lib/queries/unified/payments";
import { formatCurrencyMXN } from "@/lib/formatters";
import { ShoppingBag } from "lucide-react";

export async function AgingCxPCard() {
  const buckets = await getAgingSummary("cxp");
  const total = buckets.reduce((s, b) => s + b.amount, 0);

  const toneClass: Record<string, string> = {
    "0-30": "text-info",
    "31-60": "text-warning",
    "61-90": "text-danger",
    "90+": "text-destructive font-bold",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Cuentas por Pagar</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          Total:{" "}
          <span className="font-semibold text-foreground">
            {formatCurrencyMXN(total, { compact: true })}
          </span>
        </p>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-muted/40">
            <span className="text-sm text-muted-foreground">{b.label} días</span>
            <span className={`text-sm tabular-nums ${toneClass[b.label] ?? ""}`}>
              {formatCurrencyMXN(b.amount, { compact: true })}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
