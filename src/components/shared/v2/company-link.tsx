import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

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
  return (
    <Link
      href={`/companies/${companyId}`}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-2 py-1 font-medium text-foreground hover:text-primary active:text-primary",
        className
      )}
    >
      <span className={cn(truncate && "truncate max-w-[180px]")}>
        {name ?? "—"}
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
