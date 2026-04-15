"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  /** Control externo (abierto/cerrado). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Texto del botón de confirmar. Default: "Confirmar" */
  confirmLabel?: string;
  /** Texto del botón de cancelar. Default: "Cancelar" */
  cancelLabel?: string;
  /** Variante del botón de confirmar (destructivo vs. default). */
  variant?: "default" | "destructive";
  /** Loading state externo. */
  loading?: boolean;
  /** Callback al confirmar. Si retorna Promise, se muestra spinner. */
  onConfirm: () => void | Promise<void>;
}

/**
 * ConfirmDialog — diálogo reutilizable para confirmar acciones destructivas o
 * irreversibles. Cumple con shadcn / Radix Dialog best practices:
 * labelledby + describedby, focus-trap, escape to cancel, enter to confirm.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "default",
  loading: loadingProp,
  onConfirm,
}: ConfirmDialogProps) {
  const [internalLoading, setInternalLoading] = React.useState(false);
  const loading = loadingProp ?? internalLoading;

  const handleConfirm = async () => {
    try {
      const result = onConfirm();
      if (result instanceof Promise) {
        setInternalLoading(true);
        await result;
      }
      onOpenChange(false);
    } finally {
      setInternalLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
