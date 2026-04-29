"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";

type AiFact = Database["public"]["Tables"]["ai_extracted_facts"]["Row"];

interface EvidenceItem {
  key: string;
  title: string;
  body: string;
  at: string;
}

function mapFacts(facts: AiFact[]): EvidenceItem[] {
  return facts
    .map(
      (f): EvidenceItem => ({
        key: `fact-${f.id}`,
        title: f.fact_type ?? "Hecho extraído",
        body: f.fact_text ?? "(sin texto)",
        at: f.extracted_at ?? f.created_at ?? new Date().toISOString(),
      })
    )
    .sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
}

const CAP = 25;

interface EvidenceSectionProps {
  facts: AiFact[];
  className?: string;
}

export function EvidenceSection({ facts, className }: EvidenceSectionProps) {
  const items = React.useMemo(() => mapFacts(facts), [facts]);
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? items : items.slice(0, CAP);
  const hasMore = items.length > CAP;

  if (items.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        Sin hechos extraídos asociados.
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <ol className="space-y-3">
        {visible.map((item) => (
          <li
            key={item.key}
            data-testid="evidence-item"
            className="flex gap-3 rounded-md border bg-card p-3"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted"
            >
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{item.title}</span>
                <time className="text-xs text-muted-foreground" dateTime={item.at}>
                  {formatDate(item.at)}
                </time>
              </div>
              <p className="text-sm text-muted-foreground leading-snug break-words">{item.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-sm font-medium text-foreground underline underline-offset-2 min-h-[44px] inline-flex items-center"
        >
          Ver más ({items.length - CAP})
        </button>
      )}
    </div>
  );
}
