"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDate } from "@/lib/formatters";
import type { Database } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { addManualNote } from "@/app/inbox/actions";

type ManualNote = Database["public"]["Tables"]["manual_notes"]["Row"];

interface NotesSectionProps {
  notes: ManualNote[];
  canonicalEntityType: string;
  canonicalEntityId: string;
  className?: string;
}

export function NotesSection({
  notes,
  canonicalEntityType,
  canonicalEntityId,
  className,
}: NotesSectionProps) {
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (!body.trim()) {
      setError("Escribe algo antes de agregar la nota.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addManualNote({
        canonical_entity_type: canonicalEntityType,
        canonical_entity_id: canonicalEntityId,
        body,
      });
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo guardar la nota");
        return;
      }
      toast.success("Nota agregada");
      setBody("");
    });
  };

  const sorted = React.useMemo(
    () =>
      [...notes].sort((a, b) =>
        a.created_at > b.created_at ? -1 : a.created_at < b.created_at ? 1 : 0
      ),
    [notes]
  );

  return (
    <div className={cn("space-y-3", className)}>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin notas.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((n) => (
            <li key={n.id} className="rounded-md border bg-card p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {n.created_by}
                </span>
                <time className="text-xs text-muted-foreground" dateTime={n.created_at}>
                  {formatDate(n.created_at)}
                </time>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Agregar nota..."
          rows={3}
          aria-label="Nueva nota"
        />
        {error && (
          <div role="alert" className="text-sm text-status-critical">
            {error}
          </div>
        )}
        <Button onClick={submit} disabled={isPending} className="min-h-[44px]">
          {isPending ? "Guardando..." : "Agregar"}
        </Button>
      </div>
    </div>
  );
}
