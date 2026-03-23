"use client";

import { useState } from "react";
import { Sparkles, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EnrichButtonProps {
  type: "contact" | "company";
  id: string;
  name: string;
  onComplete?: () => void;
}

export function EnrichButton({ type, id, name, onComplete }: EnrichButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleEnrich() {
    if (status === "loading") return;

    setStatus("loading");
    setErrorMsg(null);

    try {
      const endpoint =
        type === "contact" ? "/api/enrich/contact" : "/api/enrich/company";
      const payload =
        type === "contact" ? { contact_id: id } : { company_id: id };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Error ${res.status}`);
      }

      setStatus("success");
      onComplete?.();

      // Reset to idle after showing success briefly
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al enriquecer";
      setErrorMsg(message);
      setStatus("error");

      // Reset to idle after showing error
      setTimeout(() => {
        setStatus("idle");
        setErrorMsg(null);
      }, 4000);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          handleEnrich();
        }}
        disabled={status === "loading"}
        className={cn(
          status === "success" &&
            "border-green-500 text-green-600 dark:text-green-400",
          status === "error" &&
            "border-red-500 text-red-600 dark:text-red-400"
        )}
        title={`Enriquecer ${name}`}
      >
        {status === "loading" && (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        {status === "success" && <Check className="h-3.5 w-3.5" />}
        {(status === "idle" || status === "error") && (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {status === "loading" ? "Enriqueciendo..." : "Enriquecer"}
      </Button>
      {status === "error" && errorMsg && (
        <span className="text-xs text-red-600 dark:text-red-400 max-w-48 truncate">
          {errorMsg}
        </span>
      )}
    </div>
  );
}
