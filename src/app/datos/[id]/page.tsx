import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle, ExternalLink } from "lucide-react";

import {
  PageLayout,
  PageHeader,
  DataTable,
  TableExportButton,
  EmptyState,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import {
  getOdooFixes,
  type OdooFixSeverity,
} from "@/lib/queries/datos/odoo-fixes";
import {
  getOdooFixById,
  getSatInvoiceDriftDetail,
  getDuplicatePartnerRfcDetail,
  getPartnerNoCanonicalDetail,
  getForeignTaxIdDetail,
  getContactsDuplicatesDetail,
  getProductsDuplicatesDetail,
  getContactNameIsEmailDetail,
  getCanonicalPartnerOrphanDetail,
  getPreHistoryInvoiceDetail,
  type SatInvoiceDriftDetailRow,
  type DuplicatePartnerRfcDetailRow,
  type PartnerNoCanonicalDetailRow,
  type ForeignTaxIdDetailRow,
  type ContactDuplicateGroup,
  type ProductDuplicateGroup,
  type ContactNameIsEmailDetailRow,
  type CanonicalPartnerOrphanDetailRow,
  type PreHistoryInvoiceDetailRow,
} from "@/lib/queries/datos/odoo-fixes-detail";

export const revalidate = 60;
export const metadata = { title: "Detalle de fix Odoo" };

const severityVariant: Record<
  OdooFixSeverity,
  "danger" | "warning" | "info" | "secondary"
> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "info",
};

const severityLabel: Record<OdooFixSeverity, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Medio",
  low: "Bajo",
};

function fmtMxn(v: number | null | undefined): string {
  if (v == null || v === 0) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}

export default async function FixDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (Number.isNaN(id)) notFound();

  const allFixes = await getOdooFixes();
  let insight = allFixes.find((f) => f.id === id) ?? null;
  if (!insight) {
    insight = await getOdooFixById(id);
  }
  if (!insight) notFound();

  const ev = insight.evidence ?? {};

  return (
    <PageLayout>
      <div className="flex items-center gap-2 mb-2">
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5">
          <Link href="/datos">
            <ArrowLeft className="size-3.5" />
            <span>Volver a Datos</span>
          </Link>
        </Button>
      </div>

      <PageHeader
        title={insight.title}
        subtitle={insight.description}
        actions={
          <Badge variant={severityVariant[insight.severity] ?? "secondary"}>
            {severityLabel[insight.severity] ?? insight.severity}
          </Badge>
        }
      />

      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertCircle className="size-4 text-warning" />
            Acción recomendada
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">{insight.recommendation}</p>
        </CardContent>
      </Card>

      {insight.insight_type === "odoo_sat_invoice_drift" && (
        <SatInvoiceDriftDetail
          invariantKey={ev.invariant_key as string}
          openCount={ev.open_count as number}
        />
      )}
      {insight.insight_type === "odoo_duplicate_partner_rfc" && (
        <DuplicatePartnerRfcDetail rfc={ev.rfc as string} />
      )}
      {insight.insight_type === "odoo_partner_no_canonical" && (
        <PartnerNoCanonicalDetail odooPartnerId={ev.odoo_partner_id as number} />
      )}
      {insight.insight_type === "odoo_foreign_tax_id_in_rfc" && (
        <ForeignTaxIdDetail odooPartnerId={ev.odoo_partner_id as number} />
      )}
      {insight.insight_type === "mdm_contacts_duplicates" && (
        <ContactsDuplicatesDetail />
      )}
      {insight.insight_type === "mdm_products_duplicates" && (
        <ProductsDuplicatesDetail />
      )}
      {insight.insight_type === "mdm_contact_name_is_email" && (
        <ContactNameIsEmailDetail />
      )}
      {insight.insight_type === "canonical_partner_orphan" && (
        <CanonicalPartnerOrphanDetail />
      )}
      {insight.insight_type === "canonical_invoice_pre_history" && (
        <PreHistoryInvoiceDetail />
      )}
    </PageLayout>
  );
}

async function SatInvoiceDriftDetail({
  invariantKey,
  openCount,
}: {
  invariantKey: string;
  openCount: number;
}) {
  const rows = await getSatInvoiceDriftDetail(invariantKey);
  const cols: DataTableColumn<SatInvoiceDriftDetailRow>[] = [
    { key: "uuid_sat", header: "UUID SAT", cell: (r) => (
      <span className="font-mono text-[11px]">{r.uuid_sat ? r.uuid_sat.slice(0, 8) + "…" : "—"}</span>
    )},
    { key: "odoo_invoice_id", header: "Odoo invoice", cell: (r) => (
      <span className="font-mono text-xs tabular-nums">{r.odoo_invoice_id ?? "—"}</span>
    )},
    { key: "severity", header: "Severidad", hideOnMobile: true, cell: (r) => (
      <Badge variant={severityVariant[r.severity as OdooFixSeverity] ?? "secondary"} className="text-[10px]">
        {severityLabel[r.severity as OdooFixSeverity] ?? r.severity}
      </Badge>
    )},
    { key: "impact_mxn", header: "Impacto MXN", align: "right", cell: (r) => (
      <span className="font-semibold tabular-nums">{fmtMxn(r.impact_mxn)}</span>
    )},
    { key: "age_days", header: "Antigüedad", align: "right", hideOnMobile: true, cell: (r) => (
      <span className="tabular-nums">{r.age_days != null ? `${r.age_days}d` : "—"}</span>
    )},
    { key: "description", header: "Detalle", className: "min-w-[260px]", cell: (r) => (
      <span className="text-xs text-muted-foreground line-clamp-2">{r.description ?? "—"}</span>
    )},
    { key: "detected_at", header: "Detectado", hideOnMobile: true, cell: (r) => (
      <span className="text-xs tabular-nums">{fmtDate(r.detected_at)}</span>
    )},
  ];

  if (rows.length === 0) return <EmptyState icon={AlertCircle} title="Sin issues subyacentes" description="Refresca la página." />;

  return (
    <Card data-table-export-root>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">
          {rows.length === 500 ? `500+ issues` : `${rows.length} issues`}
          <span className="text-xs font-normal text-muted-foreground ml-2">({invariantKey} · {openCount} total)</span>
        </CardTitle>
        <TableExportButton filename={`drift-${invariantKey.replace(".", "-")}`} />
      </CardHeader>
      <CardContent>
        <DataTable data={rows} columns={cols} rowKey={(r) => r.issue_id} stickyHeader />
      </CardContent>
    </Card>
  );
}

async function DuplicatePartnerRfcDetail({ rfc }: { rfc: string }) {
  const rows = await getDuplicatePartnerRfcDetail(rfc);
  const cols: DataTableColumn<DuplicatePartnerRfcDetailRow>[] = [
    { key: "odoo_partner_id", header: "Partner ID", cell: (r) => (
      <span className="font-mono text-xs tabular-nums">#{r.odoo_partner_id}</span>
    )},
    { key: "name", header: "Nombre", alwaysVisible: true, cell: (r) => (
      <span className="font-medium">{r.name ?? "—"}</span>
    )},
    { key: "country", header: "País", hideOnMobile: true, cell: (r) => (
      <span className="text-xs">{r.country ?? "—"}</span>
    )},
    { key: "type", header: "Tipo", hideOnMobile: true, cell: (r) => (
      <div className="flex gap-1">
        {r.is_customer && <Badge variant="info" className="text-[10px]">Cliente</Badge>}
        {r.is_supplier && <Badge variant="secondary" className="text-[10px]">Proveedor</Badge>}
      </div>
    )},
    { key: "created_at", header: "Creado", cell: (r) => (
      <span className="text-xs tabular-nums">{fmtDate(r.created_at)}</span>
    )},
    { key: "updated_at", header: "Actualizado", hideOnMobile: true, cell: (r) => (
      <span className="text-xs tabular-nums">{fmtDate(r.updated_at)}</span>
    )},
  ];
  if (rows.length === 0) return <EmptyState icon={AlertCircle} title="Sin partners con este RFC" description="Probablemente ya fueron mergeados." />;
  return (
    <Card data-table-export-root>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">{rows.length} partners con RFC <span className="font-mono">{rfc}</span></CardTitle>
        <TableExportButton filename={`dup-partner-${rfc}`} />
      </CardHeader>
      <CardContent>
        <DataTable data={rows} columns={cols} rowKey={(r) => r.odoo_partner_id} stickyHeader />
      </CardContent>
    </Card>
  );
}

async function PartnerNoCanonicalDetail({ odooPartnerId }: { odooPartnerId: number }) {
  const rows = await getPartnerNoCanonicalDetail(odooPartnerId);
  const cols: DataTableColumn<PartnerNoCanonicalDetailRow>[] = [
    { key: "fecha_pago_sat", header: "Fecha", cell: (r) => (
      <span className="text-xs tabular-nums">{fmtDate(r.fecha_pago_sat)}</span>
    )},
    { key: "direction", header: "Dir", cell: (r) => (
      <Badge variant="secondary" className="text-[10px]">{r.direction ?? "—"}</Badge>
    )},
    { key: "amount_mxn_sat", header: "Monto MXN", align: "right", cell: (r) => (
      <span className="font-semibold tabular-nums">{fmtMxn(r.amount_mxn_sat)}</span>
    )},
    { key: "partner_name", header: "Partner name (raw)", alwaysVisible: true, cell: (r) => (
      <span className="text-sm">{r.partner_name ?? "—"}</span>
    )},
    { key: "sat_uuid_complemento", header: "UUID Complemento", hideOnMobile: true, cell: (r) => (
      <span className="font-mono text-[11px]">{r.sat_uuid_complemento ? r.sat_uuid_complemento.slice(0, 8) + "…" : "—"}</span>
    )},
  ];
  if (rows.length === 0) return <EmptyState icon={AlertCircle} title="Sin pagos para este partner" description="Probablemente ya se canonicalizó." />;
  return (
    <Card data-table-export-root>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">{rows.length} pagos · partner Odoo #{odooPartnerId}</CardTitle>
        <TableExportButton filename={`partner-${odooPartnerId}-payments`} />
      </CardHeader>
      <CardContent>
        <DataTable data={rows} columns={cols} rowKey={(r) => r.canonical_id} stickyHeader />
      </CardContent>
    </Card>
  );
}

async function ForeignTaxIdDetail({ odooPartnerId }: { odooPartnerId: number }) {
  const data = await getForeignTaxIdDetail(odooPartnerId);
  if (!data) return <EmptyState icon={AlertCircle} title="Partner no encontrado" description={`No existe companies.odoo_partner_id = ${odooPartnerId}.`} />;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Partner #{data.odoo_partner_id} · {data.name ?? "(sin nombre)"}</CardTitle>
        <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
          <a href={`https://quimibond.odoo.com/web#id=${data.odoo_partner_id}&model=res.partner&view_type=form`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5" />
            <span>Abrir en Odoo</span>
          </a>
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div><dt className="text-xs text-muted-foreground uppercase tracking-wide">RFC actual (inválido)</dt><dd className="font-mono text-base font-semibold text-warning">{data.rfc ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground uppercase tracking-wide">País</dt><dd>{data.country ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground uppercase tracking-wide">Tipo</dt><dd className="flex gap-1">{data.is_customer && <Badge variant="info">Cliente</Badge>}{data.is_supplier && <Badge variant="secondary">Proveedor</Badge>}{!data.is_customer && !data.is_supplier && "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground uppercase tracking-wide">Facturas asociadas</dt><dd className="font-semibold tabular-nums">{data.invoice_count}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground uppercase tracking-wide">Cambiar a</dt><dd className="font-mono text-base font-semibold text-success">XEXX010101000</dd><p className="text-xs text-muted-foreground mt-1">RFC genérico para partners extranjeros. Guardar el tax-id real ({data.rfc}) en el campo Notes o un custom field.</p></div>
        </dl>
      </CardContent>
    </Card>
  );
}

async function ContactsDuplicatesDetail() {
  const groups = await getContactsDuplicatesDetail();
  const cols: DataTableColumn<ContactDuplicateGroup>[] = [
    { key: "name", header: "Nombre canónico", alwaysVisible: true, className: "min-w-[200px]", cell: (g) => <span className="font-medium">{g.canonical_name}</span> },
    { key: "dup_count", header: "Dups", align: "right", cell: (g) => <span className="font-semibold tabular-nums">{g.dup_count}</span> },
    { key: "ids", header: "IDs", className: "min-w-[160px]", cell: (g) => <span className="font-mono text-[11px]">{g.members.map((m) => m.id).join(", ")}</span> },
    { key: "emails", header: "Emails", className: "min-w-[260px]", cell: (g) => <span className="text-xs text-muted-foreground line-clamp-2">{g.members.map((m) => m.email ?? "(null)").join(" · ")}</span> },
    { key: "company_ids", header: "Companies", hideOnMobile: true, cell: (g) => {
      const cids = g.members.map((m) => m.company_id).filter((c) => c != null);
      const unique = Array.from(new Set(cids));
      return <span className="text-xs tabular-nums">{unique.length === 0 ? "—" : unique.length === 1 ? `#${unique[0]}` : `${unique.length} distintas`}</span>;
    }},
  ];
  if (groups.length === 0) return <EmptyState icon={AlertCircle} title="Sin grupos duplicados" description="Todos los contactos tienen canonical_name único." />;
  return (
    <Card data-table-export-root>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">{groups.length} grupos</CardTitle>
        <TableExportButton filename="contacts-duplicates" />
      </CardHeader>
      <CardContent>
        <DataTable data={groups} columns={cols} rowKey={(g) => g.canonical_name} stickyHeader />
      </CardContent>
    </Card>
  );
}

async function ProductsDuplicatesDetail() {
  const groups = await getProductsDuplicatesDetail();
  const cols: DataTableColumn<ProductDuplicateGroup>[] = [
    { key: "name", header: "Nombre canónico", alwaysVisible: true, className: "min-w-[200px]", cell: (g) => <span className="font-medium">{g.canonical_name}</span> },
    { key: "dup_count", header: "Variantes", align: "right", cell: (g) => <span className="font-semibold tabular-nums">{g.dup_count}</span> },
    { key: "internal_refs", header: "Internal refs (sample)", className: "min-w-[280px]", cell: (g) => (
      <span className="font-mono text-[11px] text-muted-foreground line-clamp-2">
        {g.members.slice(0, 5).map((m) => m.internal_ref ?? "(null)").join(" · ")}
        {g.members.length > 5 && ` · +${g.members.length - 5}`}
      </span>
    )},
    { key: "stock_total", header: "Stock total", align: "right", hideOnMobile: true, cell: (g) => {
      const total = g.members.reduce((acc, m) => acc + (m.stock_qty ?? 0), 0);
      return <span className="font-semibold tabular-nums">{total > 0 ? Math.round(total).toLocaleString() : "0"}</span>;
    }},
  ];
  if (groups.length === 0) return <EmptyState icon={AlertCircle} title="Sin grupos duplicados" description="Todos los productos tienen canonical_name único." />;
  return (
    <Card data-table-export-root>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">{groups.length} grupos · ⚠ son variantes legítimas, NO duplicates reales</CardTitle>
        <TableExportButton filename="products-duplicates" />
      </CardHeader>
      <CardContent>
        <DataTable data={groups} columns={cols} rowKey={(g) => g.canonical_name} stickyHeader />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// G) mdm_contact_name_is_email
// ─────────────────────────────────────────────────────────────────

async function ContactNameIsEmailDetail() {
  const rows = await getContactNameIsEmailDetail();
  const cols: DataTableColumn<ContactNameIsEmailDetailRow>[] = [
    { key: "id", header: "ID", cell: (r) => (
      <span className="font-mono text-xs tabular-nums">#{r.id}</span>
    )},
    { key: "canonical_name", header: "Nombre canónico (debería ser persona)", alwaysVisible: true, className: "min-w-[280px]", cell: (r) => (
      <span className="font-mono text-xs text-warning">{r.canonical_name}</span>
    )},
    { key: "primary_email", header: "Email asociado", hideOnMobile: true, cell: (r) => (
      <span className="text-xs text-muted-foreground">{r.primary_email ?? "—"}</span>
    )},
    { key: "canonical_company_id", header: "Company", align: "right", cell: (r) => (
      <span className="text-xs tabular-nums">{r.canonical_company_id != null ? `#${r.canonical_company_id}` : "—"}</span>
    )},
  ];
  if (rows.length === 0) return <EmptyState icon={AlertCircle} title="Sin contactos con este patrón" description="Todos los contactos tienen nombre real." />;
  return (
    <Card data-table-export-root>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">{rows.length} contactos</CardTitle>
        <TableExportButton filename="contacts-name-is-email" />
      </CardHeader>
      <CardContent>
        <DataTable data={rows} columns={cols} rowKey={(r) => r.id} stickyHeader />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// H) canonical_partner_orphan
// ─────────────────────────────────────────────────────────────────

async function CanonicalPartnerOrphanDetail() {
  const rows = await getCanonicalPartnerOrphanDetail();
  const cols: DataTableColumn<CanonicalPartnerOrphanDetailRow>[] = [
    { key: "canonical_id", header: "Canonical ID", cell: (r) => (
      <span className="font-mono text-xs tabular-nums">#{r.id}</span>
    )},
    { key: "canonical_name", header: "Nombre", alwaysVisible: true, cell: (r) => (
      <span className="font-medium">{r.canonical_name}</span>
    )},
    { key: "rfc", header: "RFC", cell: (r) => (
      <span className="font-mono text-xs">{r.rfc ?? "—"}</span>
    )},
    { key: "odoo_partner_id", header: "Odoo partner", align: "right", cell: (r) => (
      <span className="font-mono text-xs tabular-nums text-warning">#{r.odoo_partner_id}</span>
    )},
    { key: "type", header: "Tipo", hideOnMobile: true, cell: (r) => (
      <div className="flex gap-1">
        {r.is_customer && <Badge variant="info" className="text-[10px]">Cliente</Badge>}
        {r.is_supplier && <Badge variant="secondary" className="text-[10px]">Proveedor</Badge>}
      </div>
    )},
    { key: "odoo_link", header: "Acción", cell: (r) => (
      <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-xs">
        <a href={`https://quimibond.odoo.com/web#id=${r.odoo_partner_id}&model=res.partner&view_type=form`} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-3" />Verificar
        </a>
      </Button>
    )},
  ];
  if (rows.length === 0) return <EmptyState icon={AlertCircle} title="Sin partners orphan" description="Todos los canonical companies tienen bronze company match." />;
  return (
    <Card data-table-export-root>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">{rows.length} partners orphan</CardTitle>
        <TableExportButton filename="canonical-partner-orphan" />
      </CardHeader>
      <CardContent>
        <DataTable data={rows} columns={cols} rowKey={(r) => r.id} stickyHeader />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// I) canonical_invoice_pre_history
// ─────────────────────────────────────────────────────────────────

async function PreHistoryInvoiceDetail() {
  const rows = await getPreHistoryInvoiceDetail();
  const cols: DataTableColumn<PreHistoryInvoiceDetailRow>[] = [
    { key: "sat_uuid", header: "UUID SAT", cell: (r) => (
      <span className="font-mono text-[11px]">{r.sat_uuid.slice(0, 8) + "…"}</span>
    )},
    { key: "invoice_date_resolved", header: "Fecha (sospechosa)", alwaysVisible: true, cell: (r) => (
      <span className="font-mono text-xs tabular-nums text-warning">{fmtDate(r.invoice_date_resolved)}</span>
    )},
    { key: "amount_total_mxn_resolved", header: "Monto MXN", align: "right", cell: (r) => (
      <span className="font-semibold tabular-nums">{fmtMxn(r.amount_total_mxn_resolved)}</span>
    )},
    { key: "direction", header: "Dir", cell: (r) => (
      <Badge variant="secondary" className="text-[10px]">{r.direction ?? "—"}</Badge>
    )},
    { key: "verify", header: "Verificar en SAT", cell: (r) => (
      <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-xs">
        <a href={`https://verificacfdi.facturaelectronica.sat.gob.mx/`} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-3" />SAT
        </a>
      </Button>
    )},
  ];
  if (rows.length === 0) return <EmptyState icon={AlertCircle} title="Sin facturas pre-2013" description="Todas las facturas tienen fechas válidas." />;
  return (
    <Card data-table-export-root>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">{rows.length} facturas con fecha sospechosa</CardTitle>
        <TableExportButton filename="invoices-pre-2013" />
      </CardHeader>
      <CardContent>
        <DataTable data={rows} columns={cols} rowKey={(r) => r.sat_uuid} stickyHeader />
      </CardContent>
    </Card>
  );
}
