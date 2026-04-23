import Link from "next/link";
import { ExternalLink, ShieldCheck, TriangleAlert } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Currency } from "@/components/patterns/currency";
import { DateDisplay } from "@/components/patterns/date-display";
import { EmptyState } from "@/components/patterns/empty-state";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { cn } from "@/lib/utils";
import type {
  CompanyDriftAggregates,
  CompanyDriftRow,
  DriftKind,
} from "@/lib/queries/canonical/company-drift";
import { driftTone } from "@/lib/queries/canonical/company-drift";

interface Props {
  aggregates: CompanyDriftAggregates;
  rows: CompanyDriftRow[];
}

const DRIFT_KIND_LABEL: Record<DriftKind, string> = {
  odoo_only: "Odoo sin CFDI",
  sat_only: "CFDI sin Odoo",
  amount_mismatch: "Monto distinto",
};

const TONE_TEXT: Record<"success" | "warning" | "danger", string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

const TONE_BG: Record<"success" | "warning" | "danger", string> = {
  success: "bg-success/10 border-success/20",
  warning: "bg-warning/10 border-warning/20",
  danger: "bg-danger/10 border-danger/20",
};

const ODOO_BASE_URL =
  process.env.NEXT_PUBLIC_ODOO_URL ?? "https://quimibond.odoo.com";

function satVerifyUrl(uuid: string): string {
  // SAT CFDI verification. The portal prefills the UUID and the user
  // completes RFC emisor/receptor manually — good enough as a deep link.
  return `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${encodeURIComponent(
    uuid,
  )}`;
}

function odooInvoiceUrl(invoiceId: number): string {
  return `${ODOO_BASE_URL}/web#id=${invoiceId}&model=account.move&view_type=form`;
}

function CategoryFlagBadges({ aggregates }: { aggregates: CompanyDriftAggregates }) {
  const flags = [
    aggregates.is_foreign && {
      key: "foreign",
      icon: "🌍",
      label: "Extranjero",
      tip: "Sin RFC mexicano · no emite CFDI · drift suprimido",
    },
    aggregates.is_bank && {
      key: "bank",
      icon: "🏦",
      label: "Banco",
      tip: "CFDIs bancarios se registran por póliza · drift suprimido",
    },
    aggregates.is_government && {
      key: "gov",
      icon: "🏛",
      label: "Gobierno",
      tip: "SAT / IMSS / INFONAVIT · drift suprimido",
    },
    aggregates.is_payroll_entity && {
      key: "payroll",
      icon: "💰",
      label: "Nómina",
      tip: "Pseudo-counterparty NOMINA · drift suprimido",
    },
  ].filter(Boolean) as Array<{ key: string; icon: string; label: string; tip: string }>;

  if (flags.length === 0) return null;

  return (
    <div
      role="note"
      className="rounded-md border border-muted-foreground/20 bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
    >
      <p className="mb-1 font-medium">
        Drift suprimido por categoría de contraparte:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {flags.map((f) => (
          <Badge
            key={f.key}
            variant="outline"
            className="gap-1 text-[10px] font-normal"
            title={f.tip}
          >
            <span aria-hidden>{f.icon}</span>
            <span>{f.label}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

function KpiStrip({ aggregates }: { aggregates: CompanyDriftAggregates }) {
  const arTone = driftTone(
    aggregates.drift_total_abs_mxn,
    aggregates.drift_needs_review,
  );
  const apTone = driftTone(
    aggregates.drift_ap_total_abs_mxn,
    aggregates.drift_ap_needs_review,
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card className={cn("border", TONE_BG[arTone])}>
        <CardContent className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Drift AR (clientes)
            </p>
            {arTone === "success" ? (
              <ShieldCheck className="size-4 text-success" aria-hidden />
            ) : (
              <TriangleAlert
                className={cn("size-4", TONE_TEXT[arTone])}
                aria-hidden
              />
            )}
          </div>
          <Currency
            amount={aggregates.drift_total_abs_mxn}
            compact
            className={cn("mt-1 block text-2xl font-bold", TONE_TEXT[arTone])}
          />
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {aggregates.drift_sat_only_count +
              aggregates.drift_odoo_only_count +
              aggregates.drift_matched_diff_count}{" "}
            facturas · 2022+ sin IVA
          </p>
        </CardContent>
      </Card>

      <Card className={cn("border", TONE_BG[apTone])}>
        <CardContent className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Drift AP (proveedores)
            </p>
            {apTone === "success" ? (
              <ShieldCheck className="size-4 text-success" aria-hidden />
            ) : (
              <TriangleAlert
                className={cn("size-4", TONE_TEXT[apTone])}
                aria-hidden
              />
            )}
          </div>
          <Currency
            amount={aggregates.drift_ap_total_abs_mxn}
            compact
            className={cn("mt-1 block text-2xl font-bold", TONE_TEXT[apTone])}
          />
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {aggregates.drift_ap_sat_only_count +
              aggregates.drift_ap_odoo_only_count +
              aggregates.drift_ap_matched_diff_count}{" "}
            facturas · 2025+ sin IVA
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Última actualización
          </p>
          <p className="mt-1 text-sm font-medium">
            {aggregates.drift_last_computed_at ? (
              <DateDisplay
                date={aggregates.drift_last_computed_at}
                relative
                className="text-sm font-medium"
              />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Refresco horario · Syntage convention (sin IVA)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function DriftRowsTable({ rows }: { rows: CompanyDriftRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
        Sin facturas con drift — Odoo y SAT coinciden en esta vista.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">SAT</TableHead>
            <TableHead className="text-right">Odoo</TableHead>
            <TableHead className="text-right">Diferencia</TableHead>
            <TableHead>Enlaces</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const diffAbs = r.diff_mxn != null ? Math.abs(r.diff_mxn) : 0;
            return (
              <TableRow
                key={`${r.side}-${r.canonical_id}-${r.drift_kind}`}
                data-kind={r.drift_kind}
              >
                <TableCell className="whitespace-nowrap">
                  {r.invoice_date ? (
                    <DateDisplay date={r.invoice_date} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {DRIFT_KIND_LABEL[r.drift_kind]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {r.sat_mxn != null ? (
                    <Currency amount={r.sat_mxn} compact />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {r.odoo_mxn != null ? (
                    <Currency amount={r.odoo_mxn} compact />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {diffAbs > 0 ? (
                    <Currency
                      amount={diffAbs}
                      compact
                      className="text-danger"
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  <div className="flex items-center gap-2">
                    {r.sat_uuid && (
                      <Link
                        href={satVerifyUrl(r.sat_uuid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-primary hover:underline"
                        aria-label={`Verificar CFDI ${r.sat_uuid} en portal SAT`}
                      >
                        SAT <ExternalLink className="size-3" aria-hidden />
                      </Link>
                    )}
                    {r.odoo_invoice_id && (
                      <Link
                        href={odooInvoiceUrl(r.odoo_invoice_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-primary hover:underline"
                        aria-label={`Abrir ${r.odoo_name ?? "factura"} en Odoo`}
                      >
                        {r.odoo_name ?? "Odoo"}{" "}
                        <ExternalLink className="size-3" aria-hidden />
                      </Link>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Subsection({
  title,
  side,
  aggregates,
  rows,
}: {
  title: string;
  side: "customer" | "supplier";
  aggregates: CompanyDriftAggregates;
  rows: CompanyDriftRow[];
}) {
  const satOnlyCount =
    side === "customer"
      ? aggregates.drift_sat_only_count
      : aggregates.drift_ap_sat_only_count;
  const satOnlyMxn =
    side === "customer"
      ? aggregates.drift_sat_only_mxn
      : aggregates.drift_ap_sat_only_mxn;
  const odooOnlyCount =
    side === "customer"
      ? aggregates.drift_odoo_only_count
      : aggregates.drift_ap_odoo_only_count;
  const odooOnlyMxn =
    side === "customer"
      ? aggregates.drift_odoo_only_mxn
      : aggregates.drift_ap_odoo_only_mxn;
  const matchedCount =
    side === "customer"
      ? aggregates.drift_matched_diff_count
      : aggregates.drift_ap_matched_diff_count;
  const matchedMxn =
    side === "customer"
      ? aggregates.drift_matched_abs_mxn
      : aggregates.drift_ap_matched_abs_mxn;
  const sideRows = rows.filter((r) => r.side === side);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <DataSourceBadge source="unified" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <div className="rounded border px-2 py-1.5">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
              CFDI sin Odoo
            </dt>
            <dd className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="font-semibold tabular-nums">
                {satOnlyCount}
              </span>
              <Currency amount={satOnlyMxn} compact className="text-muted-foreground" />
            </dd>
          </div>
          <div className="rounded border px-2 py-1.5">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Odoo sin CFDI
            </dt>
            <dd className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="font-semibold tabular-nums">
                {odooOnlyCount}
              </span>
              <Currency amount={odooOnlyMxn} compact className="text-muted-foreground" />
            </dd>
          </div>
          <div className="rounded border px-2 py-1.5">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Match con diferencia
            </dt>
            <dd className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="font-semibold tabular-nums">
                {matchedCount}
              </span>
              <Currency amount={matchedMxn} compact className="text-muted-foreground" />
            </dd>
          </div>
        </dl>

        <DriftRowsTable rows={sideRows} />
      </CardContent>
    </Card>
  );
}

export function AuditoriaSatTab({ aggregates, rows }: Props) {
  const arTotal = aggregates.drift_total_abs_mxn ?? 0;
  const apTotal = aggregates.drift_ap_total_abs_mxn ?? 0;

  if (arTotal <= 0 && apTotal <= 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Sin drift Odoo↔SAT"
        description="Esta empresa no tiene discrepancias entre lo que Odoo registra y lo que el SAT reconoce. Revisado en la última hora."
      />
    );
  }

  return (
    <div className="space-y-4">
      <KpiStrip aggregates={aggregates} />
      <CategoryFlagBadges aggregates={aggregates} />
      {arTotal > 0 && (
        <Subsection
          title="Clientes (AR · facturas emitidas, scope 2022+)"
          side="customer"
          aggregates={aggregates}
          rows={rows}
        />
      )}
      {apTotal > 0 && (
        <Subsection
          title="Proveedores (AP · facturas recibidas, scope 2025+)"
          side="supplier"
          aggregates={aggregates}
          rows={rows}
        />
      )}
    </div>
  );
}
