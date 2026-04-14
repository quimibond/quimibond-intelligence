"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
      <div className="rounded-full bg-destructive/10 p-4 mb-6">
        <AlertTriangle className="h-10 w-10 text-destructive" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">
        Algo salio mal
      </h1>
      <p className="text-muted-foreground max-w-md mb-6">
        Ocurrio un error inesperado. Puedes intentar recargar la pagina o volver
        al inicio.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground mb-4 font-mono">
          Ref: {error.digest}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => (window.location.href = "/")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Ir al inicio
        </Button>
        <Button onClick={reset}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
      </div>
    </div>
  );
}
