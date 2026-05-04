"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded border bg-card px-3 py-1.5 text-sm hover:bg-muted print:hidden"
    >
      <Printer size={14} />
      Imprimir / PDF
    </button>
  );
}
