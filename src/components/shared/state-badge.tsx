import { Badge } from "@/components/ui/badge";

interface StateBadgeProps {
  state: string;
}

const stateVariantMap: Record<string, "info" | "warning" | "success" | "secondary"> = {
  new: "info",
  pending: "warning",
  acknowledged: "warning",
  in_progress: "warning",
  completed: "success",
  resolved: "success",
  dismissed: "secondary",
};

const stateLabelMap: Record<string, string> = {
  new: "Nuevo",
  pending: "Pendiente",
  acknowledged: "Reconocido",
  in_progress: "En progreso",
  completed: "Completado",
  resolved: "Resuelto",
  dismissed: "Descartado",
};

export function StateBadge({ state }: StateBadgeProps) {
  const variant = stateVariantMap[state] ?? "secondary";
  const label = stateLabelMap[state] ?? state;

  return <Badge variant={variant}>{label}</Badge>;
}
