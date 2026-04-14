import { Mail, Phone, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PersonMetric {
  label: string;
  value: string | number;
  danger?: boolean;
}

interface PersonCardProps {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  /** Small metrics shown below the name */
  metrics?: PersonMetric[];
  /** Call-to-action suggestion for what this person should do */
  action?: string;
  className?: string;
  /** Size variant */
  size?: "sm" | "default";
}

/**
 * PersonCard — identifica a la persona responsable de actuar en un insight
 * con email clickeable (mailto) y acción sugerida.
 *
 * @example
 * <PersonCard
 *   name="Gilberto López"
 *   email="gilberto@quimibond.com"
 *   role="Vendedor"
 *   metrics={[
 *     { label: "Cuentas", value: 45 },
 *     { label: "Actividades vencidas", value: 12, danger: true },
 *   ]}
 *   action="Llamar a Carina Yazmin hoy antes del viernes"
 * />
 */
export function PersonCard({
  name,
  email,
  phone,
  role,
  metrics,
  action,
  className,
  size = "default",
}: PersonCardProps) {
  const avatarSize = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Card className={cn("gap-2 py-3", className)}>
      <div className="flex items-start gap-3 px-4">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary",
            avatarSize,
            size === "sm" ? "text-[10px]" : "text-xs"
          )}
          aria-hidden
        >
          {initials || <User className={iconSize} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold">{name}</div>
            {role && (
              <Badge variant="secondary" className="text-[10px]">
                {role}
              </Badge>
            )}
          </div>
          {(email || phone) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="flex min-h-[24px] items-center gap-1 hover:text-primary"
                >
                  <Mail className="h-3 w-3" aria-hidden />
                  <span className="truncate">{email}</span>
                </a>
              )}
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="flex min-h-[24px] items-center gap-1 hover:text-primary"
                >
                  <Phone className="h-3 w-3" aria-hidden />
                  <span>{phone}</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {metrics && metrics.length > 0 && (
        <div className="flex flex-wrap gap-3 px-4 pt-1 text-[11px]">
          {metrics.map((m, i) => (
            <div key={i} className="flex items-baseline gap-1">
              <span className="text-muted-foreground">{m.label}:</span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  m.danger && "text-danger"
                )}
              >
                {m.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {action && (
        <div className="mx-4 mt-1 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] font-medium">
          <span className="uppercase tracking-wide text-primary">Acción:</span>{" "}
          <span className="text-foreground">{action}</span>
        </div>
      )}
    </Card>
  );
}
