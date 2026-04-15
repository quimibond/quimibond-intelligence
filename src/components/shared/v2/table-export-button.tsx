"use client";

import * as React from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

interface TableExportButtonProps {
  /** Nombre del archivo sin extensión. Default: "export". */
  filename?: string;
  /**
   * Selector CSS para encontrar la tabla en el DOM. Si es undefined, usa
   * `data-table-export-target` sobre el ancestro más cercano.
   */
  targetSelector?: string;
  label?: string;
}

/**
 * TableExportButton — exporta la tabla HTML más cercana a CSV.
 *
 * Best-effort: lee las filas directamente del DOM. Para exportes server-side
 * completos (todos los rows sin pagination) usar un API route dedicado.
 */
export function TableExportButton({
  filename = "export",
  targetSelector,
  label = "Exportar CSV",
}: TableExportButtonProps) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const handleExport = () => {
    const root = wrapperRef.current?.closest(
      "[data-table-export-root]"
    ) as HTMLElement | null;
    const table = targetSelector
      ? (document.querySelector(targetSelector) as HTMLTableElement | null)
      : ((root?.querySelector("table") ??
          wrapperRef.current?.parentElement?.querySelector("table")) as
          | HTMLTableElement
          | null);
    if (!table) {
      console.warn("[TableExportButton] No table found to export");
      return;
    }
    const rows: string[][] = [];
    const headerCells = table.querySelectorAll("thead th");
    rows.push(
      Array.from(headerCells).map((c) => cleanText(c.textContent ?? ""))
    );
    const bodyRows = table.querySelectorAll("tbody tr");
    for (const tr of Array.from(bodyRows)) {
      const cells = tr.querySelectorAll("td");
      rows.push(Array.from(cells).map((c) => cleanText(c.textContent ?? "")));
    }
    const csv = rows
      .map((r) => r.map(csvEscape).join(","))
      .join("\n");
    // BOM para Excel UTF-8
    const blob = new Blob(["\ufeff" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div ref={wrapperRef} className="inline-flex">
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5"
        onClick={handleExport}
      >
        <Download className="size-3.5" />
        <span className="hidden sm:inline">{label}</span>
      </Button>
    </div>
  );
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
