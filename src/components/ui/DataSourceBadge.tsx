"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type SourceKind = "odoo" | "syntage" | "unified" | "ia" | "gmail";

interface Props {
  source: SourceKind;
  /** Ej. "2021-abril 2026" o "últimos 24m" */
  coverage?: string;
  /** Ej. "cada 15min", "realtime", "1h" */
  refresh?: string;
}

const META: Record<
  SourceKind,
  {
    label: string;
    icon: string;
    explain: string;
    variant: "default" | "secondary" | "outline";
  }
> = {
  odoo: {
    label: "Odoo",
    icon: "📊",
    explain:
      "Datos operativos de Odoo ERP (desde 2021). Snapshot cada hora via qb19 addon.",
    variant: "secondary",
  },
  syntage: {
    label: "SAT",
    icon: "⚖️",
    explain:
      "Datos fiscales de Syntage (CFDIs SAT desde 2014). Refresh via webhook.",
    variant: "default",
  },
  unified: {
    label: "Unified",
    icon: "🔄",
    explain:
      "Híbrido: reconcilia Odoo operativo con Syntage fiscal. pg_cron 15min.",
    variant: "default",
  },
  ia: {
    label: "IA",
    icon: "🤖",
    explain: "Generado por directores IA.",
    variant: "outline",
  },
  gmail: {
    label: "Gmail",
    icon: "✉️",
    explain: "Datos de comunicación extraídos de Gmail.",
    variant: "outline",
  },
};

export function DataSourceBadge({ source, coverage, refresh }: Props) {
  const m = META[source];
  const suffix = [coverage && `· ${coverage}`, refresh && `· ${refresh}`]
    .filter(Boolean)
    .join(" ");
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={m.variant}
            className="gap-1 text-[10px] font-normal cursor-default"
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
            {suffix && (
              <span className="text-muted-foreground">{suffix}</span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          {m.explain}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
