"use client";

import { useEffect, useState, useMemo } from "react";
import { FileText, DollarSign, Hash, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ── Types ──

interface CfdiMatch {
  cfdi_id: string;
  cfdi_uuid: string | null;
  emisor_nombre: string | null;
  emisor_rfc: string | null;
  receptor_nombre: string | null;
  receptor_rfc: string | null;
  cfdi_total: number | null;
  cfdi_fecha: string | null;
  tipo_comprobante: string | null;
  invoice_id: number | null;
  invoice_name: string | null;
  invoice_total: number | null;
  payment_state: string | null;
  match_status: "matched" | "unmatched" | "no_uuid";
  amount_check: "OK" | "MONTO_DIFERENTE" | null;
}

const tipoLabels: Record<string, { label: string; variant: "success" | "warning" | "critical" | "info" | "secondary" }> = {
  I: { label: "Ingreso", variant: "success" },
  E: { label: "Egreso", variant: "warning" },
  T: { label: "Traslado", variant: "info" },
  P: { label: "Pago", variant: "secondary" },
  N: { label: "Nomina", variant: "secondary" },
};

const matchLabels: Record<string, { label: string; variant: "success" | "warning" | "critical" }> = {
  matched: { label: "Matched", variant: "success" },
  unmatched: { label: "Sin factura", variant: "warning" },
  no_uuid: { label: "Sin UUID", variant: "critical" },
};

// ── Main Page ──

export default function CfdiPage() {
  const [documents, setDocuments] = useState<CfdiMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("cfdi_invoice_match")
        .select("cfdi_id, cfdi_uuid, emisor_nombre, emisor_rfc, receptor_nombre, receptor_rfc, tipo_comprobante, cfdi_total, cfdi_fecha, invoice_id, invoice_name, invoice_total, payment_state, match_status, amount_check")
        .order("cfdi_fecha", { ascending: false })
        .limit(500);

      setDocuments((data ?? []) as CfdiMatch[]);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    let result = documents;

    if (statusFilter !== "all") {
      result = result.filter((d) => d.match_status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.emisor_nombre?.toLowerCase().includes(q) ||
          d.emisor_rfc?.toLowerCase().includes(q) ||
          d.receptor_nombre?.toLowerCase().includes(q) ||
          d.receptor_rfc?.toLowerCase().includes(q) ||
          d.cfdi_uuid?.toLowerCase().includes(q) ||
          d.invoice_name?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [documents, search, statusFilter]);

  const stats = useMemo(() => {
    const matched = documents.filter((d) => d.match_status === "matched").length;
    const unmatched = documents.filter((d) => d.match_status === "unmatched").length;
    const noUuid = documents.filter((d) => d.match_status === "no_uuid").length;
    const amountMismatch = documents.filter((d) => d.amount_check === "MONTO_DIFERENTE").length;
    const totalAmount = filtered.reduce((sum, d) => sum + (d.cfdi_total ?? 0), 0);
    return { matched, unmatched, noUuid, amountMismatch, totalAmount };
  }, [documents, filtered]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Documentos CFDI" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px]" />
          ))}
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentos CFDI"
        description="Facturas electronicas parseadas desde XML — cruzadas con facturas Odoo via UUID"
      />

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          title="Total Docs"
          value={documents.length.toLocaleString()}
          icon={Hash}
        />
        <StatCard
          title="Matched"
          value={stats.matched.toLocaleString()}
          icon={CheckCircle}
          description={`${documents.length > 0 ? Math.round((stats.matched / documents.length) * 100) : 0}% del total`}
        />
        <StatCard
          title="Sin Factura"
          value={stats.unmatched.toLocaleString()}
          icon={AlertTriangle}
          description="UUID sin match en Odoo"
        />
        <StatCard
          title="Sin UUID"
          value={stats.noUuid.toLocaleString()}
          icon={XCircle}
          description="CFDI sin UUID extraido"
        />
        <StatCard
          title="Monto Filtrado"
          value={`$${stats.totalAmount.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          icon={DollarSign}
          description={stats.amountMismatch > 0 ? `${stats.amountMismatch} con monto diferente` : undefined}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Buscar por RFC, nombre o UUID..."
          />
        </div>
        <div className="flex gap-2">
          {(["all", "matched", "unmatched", "no_uuid"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-accent"
              }`}
            >
              {s === "all" ? "Todos" : s === "matched" ? "Matched" : s === "unmatched" ? "Sin factura" : "Sin UUID"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {documents.length === 0
                ? "No hay documentos CFDI en la base de datos."
                : "No se encontraron documentos con ese filtro."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Emisor</TableHead>
                <TableHead>RFC Emisor</TableHead>
                <TableHead>Receptor</TableHead>
                <TableHead className="text-right">CFDI Total</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Factura Odoo</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>UUID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((doc) => {
                const tipo = doc.tipo_comprobante
                  ? tipoLabels[doc.tipo_comprobante] ?? { label: doc.tipo_comprobante, variant: "secondary" as const }
                  : null;
                const match = matchLabels[doc.match_status];
                return (
                  <TableRow key={doc.cfdi_id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={match.variant}>{match.label}</Badge>
                        {doc.amount_check === "MONTO_DIFERENTE" && (
                          <Badge variant="warning" className="text-[10px]">$ diferente</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {doc.emisor_nombre ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {doc.emisor_rfc ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {doc.receptor_nombre ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {doc.cfdi_total != null
                        ? `$${doc.cfdi_total.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {doc.cfdi_fecha ? formatDateTime(doc.cfdi_fecha) : "—"}
                    </TableCell>
                    <TableCell>
                      {tipo ? (
                        <Badge variant={tipo.variant}>{tipo.label}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {doc.invoice_name ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {doc.payment_state ? (
                        <Badge
                          variant={
                            doc.payment_state === "paid" ? "success"
                              : doc.payment_state === "partial" ? "warning"
                                : doc.payment_state === "not_paid" ? "critical"
                                  : "secondary"
                          }
                        >
                          {doc.payment_state}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[160px] truncate">
                      {doc.cfdi_uuid ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
