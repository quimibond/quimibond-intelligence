"use client";

import * as React from "react";
import { Mail, Sparkles } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";

type EmailSignal = Database["public"]["Tables"]["email_signals"]["Row"];
type AiFact = Database["public"]["Tables"]["ai_extracted_facts"]["Row"];

interface EvidenceItem {
  kind: "email" | "fact";
  key: string;
  title: string;
  body: string;
  at: string;
}

function mergeEvidence(signals: EmailSignal[], facts: AiFact[]): EvidenceItem[] {
  const items: EvidenceItem[] = [
    ...signals.map(
      (s): EvidenceItem => ({
        kind: "email",
        key: `signal-${s.id}`,
        title: s.signal_type ?? "Señal de email",
        body: s.signal_value ?? "(sin texto)",
        at: s.extracted_at ?? new Date().toISOString(),
      })
    ),
    ...facts.map(
      (f): EvidenceItem => ({
        kind: "fact",
        key: `fact-${f.id}`,
        title: f.fact_type ?? "Hecho extraído",
        body: f.fact_text ?? "(sin texto)",
        at: f.extracted_at ?? f.created_at ?? new Date().toISOString(),
      })
    ),
  ];
  return items.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
}

const CAP = 25;

interface EvidenceSectionProps {
  signals: EmailSignal[];
  facts: AiFact[];
  className?: string;
}

export function EvidenceSection({ signals, facts, className }: EvidenceSectionProps) {
  const items = React.useMemo(() => mergeEvidence(signals, facts), [signals, facts]);
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? items : items.slice(0, CAP);
  const hasMore = items.length > CAP;

  if (items.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        Sin evidencia asociada (ni señales de email ni hechos extraídos).
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <ol className="space-y-3">
        {visible.map((item) => {
          const Icon = item.kind === "email" ? Mail : Sparkles;
          return (
            <li
              key={item.key}
              data-testid="evidence-item"
              className="flex gap-3 rounded-md border bg-card p-3"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted"
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
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
          );
        })}
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
