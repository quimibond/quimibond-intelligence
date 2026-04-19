import { Badge } from "@/components/ui/badge";

export interface SatBadgeProps {
  estadoSat: string | null;
  uuidSat: string | null;
}

export function SatBadge({ estadoSat, uuidSat }: SatBadgeProps) {
  if (!uuidSat) {
    return <Badge variant="outline" className="text-muted-foreground">sin UUID</Badge>;
  }
  if (estadoSat === "cancelado") {
    return <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100">cancelado</Badge>;
  }
  return <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">vigente</Badge>;
}
