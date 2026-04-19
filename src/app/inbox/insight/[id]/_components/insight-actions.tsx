"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { setInsightState } from "../../../actions";
import type { InsightState } from "@/lib/queries/insights";

interface Props {
  insightId: number;
  currentState: string | null;
}

export function InsightActions({ insightId, currentState }: Props) {
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<InsightState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  const runAction = (
    state: InsightState,
    successLabel: string,
    options: { showUndo?: boolean } = {}
  ) => {
    setPendingAction(state);
    startTransition(async () => {
      const res = await setInsightState(insightId, state);
      if (res.ok) {
        if (options.showUndo && currentState) {
          toast.success(successLabel, {
            action: {
              label: "Deshacer",
              onClick: async () => {
                const undo = await setInsightState(
                  insightId,
                  currentState as InsightState
                );
                if (undo.ok) {
                  toast.success("Deshecho — insight reabierto");
                  router.refresh();
                } else {
                  toast.error("No se pudo deshacer");
                }
              },
            },
            duration: 6000,
          });
        } else {
          toast.success(successLabel);
        }
        router.push("/inbox");
      } else {
        toast.error(`Error: ${res.error ?? "desconocido"}`);
      }
      setPendingAction(null);
    });
  };

  const isPending = (state: InsightState) => pending && pendingAction === state;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => runAction("acted_on", "Marcado como accionado")}
          disabled={pending}
          className="flex-1 min-w-[140px]"
        >
          {isPending("acted_on") ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Check className="mr-1.5 size-4" />
          )}
          Accionado
        </Button>
        <Button
          variant="outline"
          onClick={() => setConfirmOpen(true)}
          disabled={pending}
          className="flex-1 min-w-[140px]"
        >
          {isPending("dismissed") ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <X className="mr-1.5 size-4" />
          )}
          Descartar
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            runAction("archived", "Archivado", { showUndo: true })
          }
          disabled={pending}
          size="icon"
          aria-label="Archivar"
        >
          {isPending("archived") ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Archive className="size-4" />
          )}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Descartar este insight?"
        description="El insight se marcará como descartado y no aparecerá en el inbox. Puedes deshacer la acción con el botón que aparece en la notificación."
        confirmLabel="Descartar"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() =>
          runAction("dismissed", "Descartado", { showUndo: true })
        }
      />
    </>
  );
}
