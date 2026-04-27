import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Banknote, Inbox } from "lucide-react";
import {
  StatGrid,
  KpiCard,
  QuestionSection,
  Currency,
  EmptyState,
} from "@/components/patterns";
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
import { getWorkingCapital } from "@/lib/queries/sp13/finanzas";


/* ── F4 Working Capital ───────────────────────────────────────────────── */
export async function WorkingCapitalBlock() {
  const wc = await getWorkingCapital();

  return (
    <QuestionSection
      id="working-capital"
      question="¿Cuál es mi capital de trabajo?"
      subtext="AR (me deben), AP (yo debo), y los principales contribuidores"
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 1, tablet: 3, desktop: 3 }}>
        <KpiCard
          title="AR — me deben"
          value={wc.arTotalMxn}
          format="currency"
          compact
          icon={ArrowDownCircle}
          source="canonical"
          tone="info"
          href="/cobranza"
          subtitle={`vencido ${formatCurrencyMXN(wc.arOverdueMxn, { compact: true })} · ${wc.arCompaniesCount} clientes`}
        />
        <KpiCard
          title="AP — yo debo"
          value={wc.apTotalMxn}
          format="currency"
          compact
          icon={ArrowUpCircle}
          source="canonical"
          tone="warning"
          href="/compras"
          subtitle={`vencido ${formatCurrencyMXN(wc.apOverdueMxn, { compact: true })} · ${wc.apCompaniesCount} proveedores · ${wc.apOverdueCount} fx vencidas`}
        />
        <KpiCard
          title="Neto (AR − AP)"
          value={wc.netoMxn}
          format="currency"
          compact
          icon={Banknote}
          source="canonical"
          tone={wc.netoMxn >= 0 ? "success" : "danger"}
          subtitle={
            wc.dsoDays != null && wc.dpoDays != null
              ? `DSO ${wc.dsoDays}d · DPO ${wc.dpoDays}d`
              : "rotación en cálculo"
          }
        />
      </StatGrid>

      <div className="grid gap-3 lg:grid-cols-2">
        <ContributorsTable
          title="Top 10 me deben"
          rows={wc.topAr}
          hrefBase="/cobranza"
        />
        <ContributorsTable
          title="Top 10 yo debo"
          rows={wc.topAp}
          hrefBase="/compras"
        />
      </div>
    </QuestionSection>
  );
}

function ContributorsTable({
  title,
  rows,
  hrefBase,
}: {
  title: string;
  rows: Array<{
    companyId: number | null;
    companyName: string | null;
    totalMxn: number;
    overdueMxn: number;
    invoiceCount: number;
    overdueCount: number;
  }>;
  hrefBase: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Link
          href={hrefBase}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          Ver todo →
        </Link>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState
              compact
              icon={Inbox}
              title="Sin contribuidores"
              description="No hay saldos abiertos en este lado."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Vencido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.companyId ?? r.companyName ?? i}>
                  <TableCell>
                    {r.companyId ? (
                      <Link
                        href={`/empresas/${r.companyId}`}
                        className="font-medium hover:underline"
                      >
                        {r.companyName}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.companyName}</span>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      {r.invoiceCount} factura{r.invoiceCount === 1 ? "" : "s"}
                      {r.overdueCount > 0 && (
                        <span className="text-warning">
                          {" "}· {r.overdueCount} vencida{r.overdueCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Currency amount={r.totalMxn} />
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.overdueMxn > 0 ? "text-danger" : "text-muted-foreground"
                    }`}
                  >
                    {r.overdueMxn > 0 ? (
                      <Currency amount={r.overdueMxn} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
