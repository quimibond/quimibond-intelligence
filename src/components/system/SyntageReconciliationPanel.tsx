import { getSyntageReconciliationSummary } from "@/lib/queries/syntage-reconciliation";
import type { IssueType, Severity } from "@/lib/queries/syntage-reconciliation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/formatters";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<Severity, { label: string; className: string }> = {
  critical: {
    label: "Crítico",
    className: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
  },
  high: {
    label: "Alto",
    className: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100",
  },
  medium: {
    label: "Medio",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  },
  low: {
    label: "Bajo",
    className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  },
};

const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  cancelled_but_posted: "Cancelada pero activa",
  posted_but_sat_uncertified: "Sin certificación SAT",
  sat_only_cfdi_received: "Solo en SAT (recibida)",
  sat_only_cfdi_issued: "Solo en SAT (emitida)",
  amount_mismatch: "Diferencia de monto",
  partner_blacklist_69b: "Proveedor lista 69-B",
  payment_missing_complemento: "Pago sin complemento",
  complemento_missing_payment: "Complemento sin pago",
};

// ─── Component ────────────────────────────────────────────────────────────────

export async function SyntageReconciliationPanel() {
  const summary = await getSyntageReconciliationSummary();

  const totalOpen = summary.by_type.reduce((acc, t) => acc + t.open, 0);

  return (
    <div className="space-y-4">
      {/* Row 1 — 8 stat cards, one per issue_type */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.by_type.map((issue) => {
          const sev = SEVERITY_STYLES[issue.severity];
          return (
            <div key={issue.type} className="rounded-md border bg-card p-3">
              <div className="text-xs text-muted-foreground">
                {ISSUE_TYPE_LABELS[issue.type] ?? issue.type}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-lg font-semibold tabular-nums">
                  {formatNumber(issue.open)}
                </span>
                <Badge className={sev.className}>{sev.label}</Badge>
              </div>
              {issue.resolved_7d > 0 && (
                <div className="mt-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  +{formatNumber(issue.resolved_7d)} resueltos 7d
                </div>
              )}
            </div>
          );
        })}
        {/* Fill remaining slots if fewer than 8 issue types returned */}
        {summary.by_type.length === 0 && (
          <div className="col-span-4 rounded-md border bg-card p-3 text-center text-sm text-muted-foreground">
            Sin issues activos.
          </div>
        )}
      </div>

      {/* Row 2 — Severity breakdown + resolution rate */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["critical", "high", "medium", "low"] as Severity[]).map((sev) => {
          const count = summary.by_severity[sev];
          const style = SEVERITY_STYLES[sev];
          return (
            <div key={sev} className="rounded-md border bg-card p-3">
              <div className="text-xs text-muted-foreground">Severidad</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-lg font-semibold tabular-nums">{formatNumber(count)}</span>
                <Badge className={style.className}>{style.label}</Badge>
              </div>
            </div>
          );
        })}

        {/* Resolution rate card */}
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Tasa resolución 7d</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {summary.resolution_rate_7d.toFixed(1)}%
            </div>
            <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
              <div>
                Facturas:{" "}
                {summary.invoices_unified_refreshed_at
                  ? new Date(summary.invoices_unified_refreshed_at).toLocaleString("es-MX")
                  : "—"}
              </div>
              <div>
                Pagos:{" "}
                {summary.payments_unified_refreshed_at
                  ? new Date(summary.payments_unified_refreshed_at).toLocaleString("es-MX")
                  : "—"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3 — Recent critical/high issues table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issues críticos y altos recientes</CardTitle>
          <p className="text-xs text-muted-foreground">
            Máximo 20 issues de severidad crítica o alta. Total abiertos:{" "}
            <strong>{formatNumber(totalOpen)}</strong>
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Severidad</th>
                  <th className="px-4 py-2 text-left">Tipo</th>
                  <th className="px-4 py-2 text-left">Descripción</th>
                  <th className="px-4 py-2 text-left">Contraparte</th>
                  <th className="px-4 py-2 text-right">Dif. monto</th>
                  <th className="px-4 py-2 text-left">Detectado</th>
                </tr>
              </thead>
              <tbody>
                {summary.recent_critical.length === 0 ? (
                  <tr>
                    <td
                      className="px-4 py-6 text-center text-muted-foreground"
                      colSpan={6}
                    >
                      Sin issues críticos o altos activos.
                    </td>
                  </tr>
                ) : (
                  summary.recent_critical.slice(0, 20).map((issue) => {
                    const sev = SEVERITY_STYLES[issue.severity];
                    return (
                      <tr key={issue.issue_id} className="border-t">
                        <td className="px-4 py-2">
                          <Badge className={sev.className}>{sev.label}</Badge>
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {ISSUE_TYPE_LABELS[issue.type] ?? issue.type}
                        </td>
                        <td className="max-w-[260px] truncate px-4 py-2 text-xs">
                          {issue.description}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {issue.company ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                          {issue.amount_diff != null
                            ? formatNumber(parseFloat(issue.amount_diff))
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {new Date(issue.detected_at).toLocaleDateString("es-MX")}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Row 4 — Top 10 empresas con más issues abiertos */}
      {summary.top_companies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top empresas con más issues abiertos</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {summary.top_companies.slice(0, 10).map((co, idx) => (
                <li key={co.company_id} className="flex items-center gap-3">
                  <span className="w-5 text-right font-mono text-xs text-muted-foreground">
                    {idx + 1}.
                  </span>
                  <span className="flex-1 truncate">{co.name ?? `ID ${co.company_id}`}</span>
                  <span className="font-mono text-xs tabular-nums">
                    {formatNumber(co.open)} issues
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Generado {new Date(summary.generated_at).toLocaleString("es-MX")}.
      </p>
    </div>
  );
}
