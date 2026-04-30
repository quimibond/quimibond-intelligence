import { Mail } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export interface CommsEmptyStateProps {
  entityType: "company" | "contact";
}

export function CommsEmptyState({ entityType }: CommsEmptyStateProps) {
  const message =
    entityType === "company"
      ? "No hay comunicaciones registradas con esta empresa. Verifica que el email del contacto principal esté en Odoo y se haya sincronizado a Gmail."
      : "Sin emails sincronizados para este contacto. Verifica el email registrado en Odoo.";

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <Mail className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
