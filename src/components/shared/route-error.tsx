"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  backHref?: string;
  backLabel?: string;
}

export function RouteError({ error, reset, backHref = "/dashboard", backLabel = "Dashboard" }: RouteErrorProps) {
  useEffect(() => {
    console.error("[RouteError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center text-center px-4">
      <div className="rounded-full bg-destructive/10 p-4 mb-6">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="text-xl font-bold tracking-tight mb-2">
        Error al cargar esta seccion
      </h2>
      <p className="text-muted-foreground max-w-md mb-6 text-sm">
        Ocurrio un error inesperado. Puedes intentar recargar o volver atras.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground mb-4 font-mono">
          Ref: {error.digest}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => (window.location.href = backHref)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {backLabel}
        </Button>
        <Button size="sm" onClick={reset}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
      </div>
    </div>
  );
}
