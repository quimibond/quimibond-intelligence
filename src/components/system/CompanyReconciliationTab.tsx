import { getServiceClient } from "@/lib/supabase-server";
import { getUnifiedReconciliationCounts } from "@/lib/queries/unified";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SEV_STYLES: Record<string, string> = {
  critical: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
  high:     "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  medium:   "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  low:      "bg-muted text-muted-foreground",
};

export async function CompanyReconciliationTab({ companyId }: { companyId: number }) {
  const supabase = getServiceClient();
  const counts = await getUnifiedReconciliationCounts(companyId);

  const { data: issues, error } = await supabase
    .from("reconciliation_issues")
    .select("issue_id,issue_type,severity,description,detected_at,metadata,uuid_sat,odoo_invoice_id")
    .eq("company_id", companyId)
    .is("resolved_at", null)
    .order("detected_at", { ascending: false })
    .limit(50);

  if (error) {
    return <div className="p-4 text-rose-600 text-sm">Error: {error.message}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {(["critical","high","medium","low"] as const).map((sev) => (
          <div key={sev} className="rounded-md border bg-card p-3 text-center">
            <Badge className={SEV_STYLES[sev]}>{sev}</Badge>
            <div className="mt-2 font-mono text-xl tabular-nums">{counts.bySeverity[sev]}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issues abiertos ({counts.open})</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Severity</th>
                <th className="px-4 py-2 text-left">Tipo</th>
                <th className="px-4 py-2 text-left">Descripción</th>
                <th className="px-4 py-2 text-left">Detectado</th>
              </tr>
            </thead>
            <tbody>
              {(issues ?? []).length === 0 && (
                <tr><td className="px-4 py-6 text-center text-muted-foreground" colSpan={4}>Sin issues abiertos</td></tr>
              )}
              {(issues ?? []).map((i: { issue_id: string; issue_type: string; severity: string; description: string; detected_at: string }) => (
                <tr key={i.issue_id} className="border-t">
                  <td className="px-4 py-2"><Badge className={SEV_STYLES[i.severity]}>{i.severity}</Badge></td>
                  <td className="px-4 py-2 text-xs font-mono">{i.issue_type}</td>
                  <td className="px-4 py-2">{i.description}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(i.detected_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
