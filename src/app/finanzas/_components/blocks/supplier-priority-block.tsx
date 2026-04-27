import Link from "next/link";
import { formatCurrencyMXN } from "@/lib/formatters";
import {
  StatGrid,
  KpiCard,
  QuestionSection,
} from "@/components/patterns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getSupplierPriorityScores,
  type SupplierPriorityScore,
} from "@/lib/queries/sp13/finanzas";

/**
 * F-PRIORITY — Score de prioridad de pago a proveedores.
 * Espejo del customer credit score: a quién pagar primero cuando no alcanza.
 */
export async function SupplierPriorityBlock() {
  const data = await getSupplierPriorityScores();
  if (data.totalSuppliers === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const top = data.rows.slice(0, 25);

  const tierLabel: Record<string, string> = {
    critico: "CRÍTICO",
    alta: "Alta",
    media: "Media",
    baja: "Baja",
    estirable: "Estirable",
  };

  return (
    <QuestionSection
      id="supplier-priority"
      question="¿A qué proveedor le pago primero cuando no alcanza?"
      subtext={`Score de prioridad (0-100) por proveedor combinando AP
        vencido, dependencia operativa, volumen, antigüedad y categoría
        crítica (SAT/IMSS/Leasing). Más alto = pagar antes. ${data.totalSuppliers}
        proveedores evaluados. Total a pagar HOY (crítico): ${fmt(data.totalCriticoMxn)}.`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
        <KpiCard title="Crítico (80+)" value={data.byTier.critico} format="number" tone="danger" subtitle={`Pagar HOY · ${fmt(data.totalCriticoMxn)}`} />
        <KpiCard title="Alta (60-79)" value={data.byTier.alta} format="number" tone="warning" subtitle={`Esta semana · ${fmt(data.totalAltaMxn)}`} />
        <KpiCard title="Media (40-59)" value={data.byTier.media} format="number" tone="info" subtitle="Próx. 2 semanas" />
        <KpiCard title="Baja (20-39)" value={data.byTier.baja} format="number" tone="default" subtitle="Fin de mes / estirar" />
        <KpiCard title="Estirable (<20)" value={data.byTier.estirable} format="number" tone="success" subtitle="Esperar 30+ días" />
      </StatGrid>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Top 25 proveedores ordenados por urgencia de pago
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Proveedor</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">AP abierto</TableHead>
                <TableHead className="text-right">% vencido</TableHead>
                <TableHead className="text-right">Monthly avg</TableHead>
                <TableHead className="text-right">Delay hist</TableHead>
                <TableHead className="min-w-[220px]">Recomendación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((r: SupplierPriorityScore) => {
                const tone = r.tone;
                const scoreClass =
                  tone === "destructive" ? "text-destructive"
                  : tone === "danger" ? "text-destructive"
                  : tone === "warning" ? "text-warning"
                  : tone === "info" ? "text-info"
                  : "text-success";
                return (
                  <TableRow key={r.bronzeId}>
                    <TableCell className="font-medium">
                      <Link href={`/empresas/${r.bronzeId}`} className="hover:underline">
                        {r.supplierName}
                      </Link>
                      {r.isCriticalCategory && (
                        <span className="ml-1 text-[10px] text-warning">⚠ no negociable</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${scoreClass}`}
                      title={`Componentes: past-due ${r.pastDueSeverityPts}/35, volumen ${r.volumePts}/25, recurrencia ${r.recurrencePts}/20, strict ${r.strictTermsPts}/15, crítico ${r.criticalCategoryPts}/5`}
                    >
                      {r.score}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">{tierLabel[r.tier]}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums" title={fmtFull(r.apOpenMxn)}>
                      {r.apOpenMxn > 0 ? fmt(r.apOpenMxn) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${r.apOverduePct >= 50 ? "text-destructive" : r.apOverduePct >= 20 ? "text-warning" : ""}`}>
                      {r.apOverduePct > 0 ? `${r.apOverduePct.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.monthlyAvgMxn)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.apDelayHistDays != null ? `${r.apDelayHistDays}d` : "—"}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{r.recommendedAction}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-info">Cómo se calcula</span>{" "}
        Score 0-100 combinando: past-due severity (35 pts, % AP vencido →
        riesgo de cortar suministro), volumen mensual (25 pts log10),
        recurrencia + antigüedad (20 pts, canonical 12m + SAT 60m), strict
        terms (15 pts — proveedores que cobran a tiempo deben recibir a
        tiempo), categoría crítica (5 pts SAT/IMSS/Leasing/CFE).
        Categorías &quot;no negociables&quot; (multas/intereses si no pagas)
        aparecen marcadas. Espejo del customer credit score: ahí decides a
        quién extender, aquí decides a quién pagar.
      </div>
    </QuestionSection>
  );
}
