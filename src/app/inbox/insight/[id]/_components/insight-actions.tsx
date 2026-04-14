"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, Archive } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setInsightState } from "../../../actions";
import type { InsightState } from "@/lib/queries/insights";

interface Props {
  insightId: number;
  currentState: string | null;
}

export function InsightActions({ insightId, currentState }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const terminal = ["acted_on", "dismissed", "archived", "expired"];
  const isTerminal = currentState ? terminal.includes(currentState) : false;

  if (isTerminal) {
    return (
      <div className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        Insight ya cerrado ({currentState})
      </div>
    );
  }

  const handle = (state: InsightState, label: string) => {
    startTransition(async () => {
      const res = await setInsightState(insightId, state);
      if (res.ok) {
        toast.success(label);
        router.push("/inbox");
      } else {
        toast.error(`Error: ${res.error ?? "desconocido"}`);
      }
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() => handle("acted_on", "Marcado como accionado")}
        disabled={pending}
        className="flex-1 min-w-[140px]"
      >
        <Check className="mr-1.5 h-4 w-4" />
        Accionado
      </Button>
      <Button
        variant="outline"
        onClick={() => handle("dismissed", "Descartado")}
        disabled={pending}
        className="flex-1 min-w-[140px]"
      >
        <X className="mr-1.5 h-4 w-4" />
        Descartar
      </Button>
      <Button
        variant="ghost"
        onClick={() => handle("archived", "Archivado")}
        disabled={pending}
        size="icon"
      >
        <Archive className="h-4 w-4" />
      </Button>
    </div>
  );
}
