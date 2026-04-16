import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { sanitizeCompanyName } from "@/lib/queries/_helpers";

interface CompanyLinkProps {
  companyId: string | number;
  name: string | null | undefined;
  tier?: "A" | "B" | "C" | string | null;
  className?: string;
  /** Muestra el nombre en una sola línea con truncate */
  truncate?: boolean;
}

const tierVariant: Record<string, "success" | "warning" | "secondary"> = {
  A: "success",
  B: "warning",
  C: "secondary",
};

/**
 * CompanyLink — link canónico a la ficha de empresa.
 * Touch target 44px mínimo.
 */
export function CompanyLink({
  companyId,
  name,
  tier,
  className,
  truncate,
}: CompanyLinkProps) {
  // Nombres raw de MVs (company_profile, rfm_segments, cash_flow_aging, etc.)
  // no pasan por `joinedCompanyName`, así que pueden traer basura (193 rows
  // en producción: "8141", "5806", "1139" — Odoo partners sin nombre real).
  // Este es el último backstop antes del render.
  const displayName = sanitizeCompanyName(name) ?? "—";
  return (
    <Link
      href={`/companies/${companyId}`}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-2 py-1 font-medium text-foreground hover:text-primary active:text-primary",
        className
      )}
    >
      <span className={cn(truncate && "truncate max-w-[180px]")}>
        {displayName}
      </span>
      {tier && (
        <Badge
          variant={tierVariant[tier] ?? "secondary"}
          className="h-4 text-[10px]"
        >
          {tier}
        </Badge>
      )}
    </Link>
  );
}
