import { getCompanyFiscalProfile } from "@/lib/queries/fiscal-historical";
import { formatCurrencyMXN } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function MetricLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

function YoYBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  const isPos = pct >= 0;
  return (
    <Badge
      variant="secondary"
      className={`tabular-nums ${
        isPos
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
      }`}
    >
      {isPos ? "+" : ""}
      {pct.toFixed(1)}%
    </Badge>
  );
}

/**
 * Fiscal profile card for /companies/[id] — server component.
 * Shows client profile if available, supplier profile if available,
 * or a "no history" message.
 */
export async function FiscalCompanyProfileCard({
  companyId,
}: {
  companyId: number;
}) {
  const profile = await getCompanyFiscalProfile(companyId);

  if (!profile.client && !profile.supplier) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Sin histórico SAT registrado para este RFC.
          </p>
          <p className="text-xs text-muted-foreground">
            La empresa no aparece en los top 100 clientes ni top 100 proveedores
            de syntage_top_*_fiscal_lifetime.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {profile.client && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Histórico como cliente (SAT)</CardTitle>
              <Badge variant="info">Cliente</Badge>
            </div>
            {profile.client.rfc && (
              <p className="text-xs font-mono text-muted-foreground">
                RFC: {profile.client.rfc}
              </p>
            )}
          </CardHeader>
          <CardContent className="pb-4">
            <div className="divide-y">
              <MetricLine
                label="Revenue lifetime"
                value={formatCurrencyMXN(profile.client.lifetime_revenue_mxn, { compact: false })}
              />
              <MetricLine
                label="Revenue últimos 12m"
                value={formatCurrencyMXN(profile.client.revenue_12m_mxn, { compact: false })}
              />
              <MetricLine
                label="YoY vs 12m anteriores"
                value={<YoYBadge pct={profile.client.yoy_pct ?? null} />}
              />
              <MetricLine
                label="Tasa de cancelación"
                value={
                  profile.client.cancellation_rate_pct != null
                    ? `${profile.client.cancellation_rate_pct.toFixed(1)}%`
                    : "—"
                }
              />
              <MetricLine
                label="Primer CFDI"
                value={
                  profile.client.first_cfdi
                    ? new Date(profile.client.first_cfdi).toLocaleDateString("es-MX", {
                        year: "numeric",
                        month: "long",
                      })
                    : "—"
                }
              />
              <MetricLine
                label="Días desde último CFDI"
                value={
                  profile.client.days_since_last_cfdi != null
                    ? `${profile.client.days_since_last_cfdi} días`
                    : "—"
                }
              />
            </div>
          </CardContent>
        </Card>
      )}

      {profile.supplier && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Histórico como proveedor (SAT)</CardTitle>
              <Badge variant="secondary">Proveedor</Badge>
            </div>
            {profile.supplier.rfc && (
              <p className="text-xs font-mono text-muted-foreground">
                RFC: {profile.supplier.rfc}
              </p>
            )}
          </CardHeader>
          <CardContent className="pb-4">
            <div className="divide-y">
              <MetricLine
                label="Gasto lifetime"
                value={formatCurrencyMXN(profile.supplier.lifetime_spend_mxn, { compact: false })}
              />
              <MetricLine
                label="Gasto últimos 12m"
                value={formatCurrencyMXN(profile.supplier.spend_12m_mxn, { compact: false })}
              />
              <MetricLine
                label="YoY vs 12m anteriores"
                value={<YoYBadge pct={profile.supplier.yoy_pct ?? null} />}
              />
              <MetricLine
                label="Retenciones lifetime"
                value={
                  profile.supplier.retenciones_lifetime_mxn != null
                    ? formatCurrencyMXN(profile.supplier.retenciones_lifetime_mxn, {
                        compact: false,
                      })
                    : "—"
                }
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
