import { getServiceClient } from "@/lib/supabase-server";
import { getUnifiedReconciliationCounts } from "@/lib/queries/unified";
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
          <Card key={sev} className="p-3 text-center">
            <Badge className={SEV_STYLES[sev]}>{sev}</Badge>
            <div className="mt-2 font-mono text-xl tabular-nums">{counts.bySeverity[sev]}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issues abiertos ({counts.open})</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Detectado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(issues ?? []).length === 0 && (
                <TableRow><TableCell className="py-6 text-center text-muted-foreground" colSpan={4}>Sin issues abiertos</TableCell></TableRow>
              )}
              {(issues ?? []).map((i: { issue_id: string; issue_type: string; severity: string; description: string; detected_at: string }) => (
                <TableRow key={i.issue_id}>
                  <TableCell><Badge className={SEV_STYLES[i.severity]}>{i.severity}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{i.issue_type}</TableCell>
                  <TableCell>{i.description}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(i.detected_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
