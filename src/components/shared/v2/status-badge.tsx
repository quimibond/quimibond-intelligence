import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Status =
  | "paid"
  | "overdue"
  | "partial"
  | "active"
  | "draft"
  | "cancelled"
  | "pending"
  | "delivered"
  | "in_progress";

interface StatusBadgeProps {
  status: Status | string;
  className?: string;
}

const config: Record<
  Status,
  { label: string; variant: "success" | "critical" | "warning" | "info" | "secondary" | "default" }
> = {
  paid: { label: "Pagada", variant: "success" },
  overdue: { label: "Vencida", variant: "critical" },
  partial: { label: "Parcial", variant: "warning" },
  active: { label: "Activa", variant: "info" },
  draft: { label: "Borrador", variant: "secondary" },
  cancelled: { label: "Cancelada", variant: "secondary" },
  pending: { label: "Pendiente", variant: "warning" },
  delivered: { label: "Entregada", variant: "success" },
  in_progress: { label: "En curso", variant: "info" },
};

/**
 * StatusBadge — estados canónicos de facturas / pedidos / deliveries.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const entry = (config as Record<string, (typeof config)["paid"]>)[status] ?? {
    label: status,
    variant: "secondary" as const,
  };
  return (
    <Badge variant={entry.variant} className={cn("capitalize", className)}>
      {entry.label}
    </Badge>
  );
}
