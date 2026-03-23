"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BatchEnrichButtonProps {
  type: "contacts" | "companies";
}

export function BatchEnrichButton({ type }: BatchEnrichButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState<{
    enriched: number;
    errors: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const label = type === "contacts" ? "contactos" : "empresas";

  async function handleBatchEnrich() {
    if (status === "loading") return;

    setStatus("loading");
    setResult(null);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/enrich/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Error ${res.status}`);
      }

      const data = await res.json();
      setResult({ enriched: data.enriched, errors: data.errors });
      setStatus("done");

      // Reset after a while
      setTimeout(() => {
        setStatus("idle");
        setResult(null);
      }, 6000);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error en enriquecimiento";
      setErrorMsg(message);
      setStatus("done");

      setTimeout(() => {
        setStatus("idle");
        setErrorMsg(null);
        setResult(null);
      }, 5000);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={handleBatchEnrich}
        disabled={status === "loading"}
      >
        {status === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {status === "loading"
          ? `Enriqueciendo ${label}...`
          : "Enriquecer Todos"}
      </Button>
      {status === "done" && result && (
        <span className="text-xs text-muted-foreground">
          {result.enriched} enriquecidos
          {result.errors > 0 && (
            <span className="text-red-600 dark:text-red-400">
              , {result.errors} errores
            </span>
          )}
        </span>
      )}
      {status === "done" && errorMsg && (
        <span className="text-xs text-red-600 dark:text-red-400 max-w-64 truncate">
          {errorMsg}
        </span>
      )}
    </div>
  );
}
