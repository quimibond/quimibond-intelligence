import { Mail, Phone, User } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
 * PersonCard — identifica a la persona responsable de actuar en un insight.
 * Usa Avatar de shadcn (con fallback de iniciales), Card semantica y la
 * accion como callout destacado en bg-primary/5.
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
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const avatarSize = size === "sm" ? "size-9" : "size-11";

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="flex-row items-start gap-3 px-4 pt-4 pb-3">
        <Avatar className={cn(avatarSize, "border border-border")}>
          <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
            {initials || <User className="size-4" />}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold">{name}</div>
            {role && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {role}
              </Badge>
            )}
          </div>
          {(email || phone) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="inline-flex min-h-[24px] items-center gap-1 transition-colors hover:text-primary"
                >
                  <Mail className="size-3" aria-hidden />
                  <span className="truncate">{email}</span>
                </a>
              )}
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="inline-flex min-h-[24px] items-center gap-1 transition-colors hover:text-primary"
                >
                  <Phone className="size-3" aria-hidden />
                  <span>{phone}</span>
                </a>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      {(metrics?.length || action) && (
        <CardContent className="space-y-3 px-4 pb-4">
          {metrics && metrics.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
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
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-primary">
                Acción
              </span>
              <span className="text-foreground">{action}</span>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
