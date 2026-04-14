"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  FileText,
  Mail,
  Package,
  ShoppingCart,
  Truck,
} from "lucide-react";

import { BottomSheet } from "./bottom-sheet";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export type EvidenceType =
  | "invoice"
  | "order"
  | "delivery"
  | "email"
  | "product";

export type EvidenceStatus =
  | "overdue"
  | "paid"
  | "pending"
  | "active"
  | "delivered"
  | "late";

interface EvidenceChipProps {
  type: EvidenceType;
  /** Display reference (e.g. "INV/2026/02/0144", "PV15127") */
  reference: string;
  amount?: number | null;
  status?: EvidenceStatus;
  /** Extra hint (e.g. "50d vencida") */
  hint?: string;
  /** Optional detail content to show in BottomSheet when tapped */
  detail?: React.ReactNode;
  className?: string;
}

const typeConfig: Record<EvidenceType, { icon: LucideIcon; label: string }> = {
  invoice: { icon: FileText, label: "Factura" },
  order: { icon: ShoppingCart, label: "Pedido" },
  delivery: { icon: Truck, label: "Entrega" },
  email: { icon: Mail, label: "Email" },
  product: { icon: Package, label: "Producto" },
};

const statusToneClass: Record<EvidenceStatus, string> = {
  overdue: "border-danger/30 bg-danger/10 text-danger-foreground",
  late: "border-warning/30 bg-warning/10 text-warning-foreground",
  paid: "border-success/30 bg-success/10 text-success-foreground",
  delivered: "border-success/30 bg-success/10 text-success-foreground",
  pending: "border-info/30 bg-info/10 text-info-foreground",
  active: "border-info/30 bg-info/10 text-info-foreground",
};

/**
 * EvidenceChip — referencia clickeable dentro de un insight.
 * Tap → abre BottomSheet con detalle. Si no se pasa `detail` se comporta
 * como un chip estático (no clickeable).
 *
 * @example
 * <EvidenceChip
 *   type="invoice"
 *   reference="INV/2026/02/0144"
 *   amount={31900}
 *   status="overdue"
 *   hint="50d vencida"
 *   detail={<InvoiceDetail id={144} />}
 * />
 */
export function EvidenceChip({
  type,
  reference,
  amount,
  status,
  hint,
  detail,
  className,
}: EvidenceChipProps) {
  const [open, setOpen] = useState(false);
  const cfg = typeConfig[type];
  const Icon = cfg.icon;
  const toneClass = status ? statusToneClass[status] : "border-border bg-muted/40";
  const clickable = !!detail;

  const content = (
    <span
      className={cn(
        "inline-flex min-h-[28px] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium",
        toneClass,
        clickable && "cursor-pointer hover:opacity-80 active:opacity-60",
        className
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="font-mono">{reference}</span>
      {amount != null && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="tabular-nums">
            {formatCurrencyMXN(amount, { compact: true })}
          </span>
        </>
      )}
      {hint && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="font-bold">{hint}</span>
        </>
      )}
    </span>
  );

  if (!clickable) return content;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-block"
        aria-label={`Ver detalle ${cfg.label} ${reference}`}
      >
        {content}
      </button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={`${cfg.label} ${reference}`}
      >
        {detail}
      </BottomSheet>
    </>
  );
}
