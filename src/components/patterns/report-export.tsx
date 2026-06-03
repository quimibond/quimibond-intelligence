"use client";

import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { exportCSV } from "@/lib/export-csv";

interface DataCsvButtonProps {
  /** Filas completas a exportar (no solo las visibles en el DOM). */
  rows: Record<string, unknown>[];
  /** Columnas y encabezados, en orden. */
  columns: { key: string; label: string }[];
  /** Nombre del archivo sin extensión. Se le agrega la fecha. */
  filename: string;
  label?: string;
  disabled?: boolean;
}

/**
 * DataCsvButton — exporta un dataset COMPLETO a CSV (no scrapea el DOM, así
 * que incluye filas no renderizadas, p. ej. productos fuera del top 30).
 */
export function DataCsvButton({
  rows,
  columns,
  filename,
  label = "Exportar CSV",
  disabled,
}: DataCsvButtonProps) {
  const handle = () => {
    if (!rows.length) return;
    const dated = `${filename}-${new Date().toISOString().slice(0, 10)}`;
    exportCSV(rows, dated, columns);
  };
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-1.5 print:hidden"
      onClick={handle}
      disabled={disabled || rows.length === 0}
    >
      <Download className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

/**
 * PrintButton — abre el diálogo de impresión del navegador (Guardar como PDF).
 * El layout oculta sidebar/nav en `@media print` (print:hidden).
 */
export function PrintButton({ label = "Imprimir / PDF" }: { label?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-1.5 print:hidden"
      onClick={() => window.print()}
    >
      <Printer className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
