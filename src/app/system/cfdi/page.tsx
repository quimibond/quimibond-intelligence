"use client";

import { useEffect, useState, useMemo } from "react";
import { FileText, DollarSign, Hash } from "lucide-react";
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

interface CfdiDocument {
  id: string;
  emisor_nombre: string | null;
  emisor_rfc: string | null;
  receptor_nombre: string | null;
  receptor_rfc: string | null;
  total: number | null;
  moneda: string | null;
  fecha: string | null;
  tipo_comprobante: string | null;
  uuid: string | null;
}

const tipoLabels: Record<string, { label: string; variant: "success" | "warning" | "critical" | "info" | "secondary" }> = {
  I: { label: "Ingreso", variant: "success" },
  E: { label: "Egreso", variant: "warning" },
  T: { label: "Traslado", variant: "info" },
  P: { label: "Pago", variant: "secondary" },
  N: { label: "Nomina", variant: "secondary" },
};

// ── Main Page ──

export default function CfdiPage() {
  const [documents, setDocuments] = useState<CfdiDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("cfdi_documents")
        .select("id, emisor_nombre, emisor_rfc, receptor_nombre, receptor_rfc, total, moneda, fecha, tipo_comprobante, uuid")
        .order("fecha", { ascending: false })
        .limit(500);

      setDocuments((data ?? []) as CfdiDocument[]);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return documents;
    const q = search.toLowerCase();
    return documents.filter(
      (d) =>
        d.emisor_nombre?.toLowerCase().includes(q) ||
        d.emisor_rfc?.toLowerCase().includes(q) ||
        d.receptor_nombre?.toLowerCase().includes(q) ||
        d.receptor_rfc?.toLowerCase().includes(q) ||
        d.uuid?.toLowerCase().includes(q)
    );
  }, [documents, search]);

  const totalAmount = useMemo(
    () => filtered.reduce((sum, d) => sum + (d.total ?? 0), 0),
    [filtered]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Documentos CFDI" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
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
        description="Facturas electronicas parseadas desde XML"
      />

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
        <StatCard
          title="Documentos"
          value={filtered.length.toLocaleString()}
          icon={Hash}
        />
        <StatCard
          title="Monto Total"
          value={`$${totalAmount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={DollarSign}
        />
        <StatCard
          title="Registros DB"
          value={documents.length.toLocaleString()}
          icon={FileText}
        />
      </div>

      {/* Filter */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por RFC o nombre..."
      />

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
                <TableHead>Emisor</TableHead>
                <TableHead>RFC Emisor</TableHead>
                <TableHead>Receptor</TableHead>
                <TableHead>RFC Receptor</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>UUID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((doc) => {
                const tipo = doc.tipo_comprobante
                  ? tipoLabels[doc.tipo_comprobante] ?? { label: doc.tipo_comprobante, variant: "secondary" as const }
                  : null;
                return (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {doc.emisor_nombre ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {doc.emisor_rfc ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {doc.receptor_nombre ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {doc.receptor_rfc ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {doc.total != null
                        ? `$${doc.total.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : "—"}
                    </TableCell>
                    <TableCell>{doc.moneda ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {doc.fecha ? formatDateTime(doc.fecha) : "—"}
                    </TableCell>
                    <TableCell>
                      {tipo ? (
                        <Badge variant={tipo.variant}>{tipo.label}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {doc.uuid ?? "—"}
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
