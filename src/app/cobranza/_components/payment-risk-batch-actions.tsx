"use client";

import * as React from "react";
import { Copy, Hash, Mail } from "lucide-react";

import { BatchActionBar } from "@/components/patterns/batch-action-bar";

interface PaymentRiskBatchActionsProps {
  /** Mapa `company_id → nombre` para reconstruir info desde los IDs seleccionados. */
  idToName: Record<string, string>;
}

/**
 * Barra de acciones batch para Payment Risk.
 *
 * Es un client component para que los handlers (`navigator.clipboard`, etc.)
 * no crucen el boundary RSC. Recibe `idToName` como prop serializable.
 */
export function PaymentRiskBatchActions({
  idToName,
}: PaymentRiskBatchActionsProps) {
  const [flash, setFlash] = React.useState<string | null>(null);

  const copyText = React.useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setFlash(label);
      setTimeout(() => setFlash(null), 1800);
    } catch (err) {
      console.error("Clipboard error", err);
    }
  }, []);

  return (
    <div className="flex flex-col items-end gap-1">
      {flash ? (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success-foreground">
          {flash}
        </span>
      ) : null}
      <BatchActionBar
        actions={[
          {
            id: "copy-names",
            label: "Copiar nombres",
            icon: Copy,
            clearAfter: false,
            onRun: async (ids) => {
              const names = ids
                .map((id) => idToName[id])
                .filter((n): n is string => Boolean(n));
              await copyText(names.join("\n"), `${names.length} nombres copiados`);
            },
          },
          {
            id: "copy-ids",
            label: "Copiar IDs",
            icon: Hash,
            clearAfter: false,
            onRun: async (ids) => {
              await copyText(ids.join(","), `${ids.length} IDs copiados`);
            },
          },
          {
            id: "draft-mail",
            label: "Borrador mail",
            icon: Mail,
            clearAfter: false,
            onRun: async (ids) => {
              const names = ids
                .map((id) => idToName[id])
                .filter((n): n is string => Boolean(n));
              const subject = encodeURIComponent(
                `Seguimiento cobranza · ${names.length} cliente${names.length === 1 ? "" : "s"}`
              );
              const body = encodeURIComponent(
                `Clientes en riesgo de pago:\n\n${names.map((n) => `· ${n}`).join("\n")}\n\n—`
              );
              window.location.href = `mailto:?subject=${subject}&body=${body}`;
            },
          },
        ]}
      />
    </div>
  );
}
