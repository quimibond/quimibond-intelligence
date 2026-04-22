import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./status-badge";

export interface SatBadgeProps {
  estadoSat: string | null;
  uuidSat: string | null;
}

/**
 * @deprecated SP6 — use `<StatusBadge kind="estado_sat" value={estadoSat} />` instead.
 * This wrapper is preserved for back-compat with out-of-scope pages during SP6 foundation.
 * Note: the null-uuidSat "sin UUID" path has no equivalent in StatusBadge and is kept as-is.
 */
export function SatBadge({ estadoSat, uuidSat }: SatBadgeProps) {
  if (!uuidSat) {
    return <Badge variant="outline" className="text-muted-foreground">sin UUID</Badge>;
  }
  if (estadoSat === "cancelado" || estadoSat === "vigente") {
    return <StatusBadge kind="estado_sat" value={estadoSat} density="regular" />;
  }
  return <StatusBadge kind="generic" value={String(estadoSat)} density="regular" />;
}
