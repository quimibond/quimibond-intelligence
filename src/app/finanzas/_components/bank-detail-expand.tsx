"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Currency } from "@/components/patterns";
import { formatCurrencyMXN, formatRelative } from "@/lib/formatters";
import type { BankAccountDetail } from "@/lib/queries/sp13/finanzas";

interface Props {
  accounts: BankAccountDetail[];
}

function classificationLabel(c: string | null): string {
  switch (c) {
    case "cash":
      return "Efectivo";
    case "debt":
      return "Tarjeta";
    case "other":
      return "Otros";
    default:
      return c ?? "—";
  }
}

export function BankDetailExpand({ accounts }: Props) {
  const [open, setOpen] = useState(false);
  const visible = open ? accounts : [];

  const cashCount = accounts.filter((a) => a.classification === "cash").length;
  const debtCount = accounts.filter((a) => a.classification === "debt").length;
  const staleCount = accounts.filter((a) => a.isStale).length;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left hover:bg-accent/30"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          )}
          <div>
            <div className="text-sm font-medium">Detalle por cuenta bancaria</div>
            <div className="text-xs text-muted-foreground">
              {cashCount} efectivo · {debtCount} tarjeta
              {staleCount > 0 && (
                <> · <span className="text-warning">{staleCount} stale</span></>
              )}
            </div>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? "Ocultar" : "Ver detalle por cuenta"}
        </span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Cuenta</th>
                <th className="px-4 py-2 text-left font-medium">Tipo</th>
                <th className="px-4 py-2 text-right font-medium">Saldo MXN</th>
                <th className="px-4 py-2 text-right font-medium">Δ 24h</th>
                <th className="px-4 py-2 text-left font-medium">Últ. actividad</th>
                <th className="px-4 py-2 text-left font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((a) => (
                <tr key={`${a.journalId ?? a.name}`} className="hover:bg-accent/20">
                  <td className="px-4 py-2">
                    <div className="font-medium">{a.name ?? "—"}</div>
                    {a.bankAccount && (
                      <div className="text-[11px] text-muted-foreground">
                        {a.bankAccount}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge
                      variant={a.classification === "debt" ? "destructive" : "secondary"}
                      className="text-[10px]"
                    >
                      {classificationLabel(a.classification)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <Currency amount={a.currentBalanceMxn} />
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right tabular-nums",
                      (a.changeVs24h ?? 0) > 0 && "text-success",
                      (a.changeVs24h ?? 0) < 0 && "text-danger",
                      (a.changeVs24h ?? 0) === 0 && "text-muted-foreground"
                    )}
                  >
                    {a.changeVs24h == null
                      ? "—"
                      : a.changeVs24h === 0
                        ? "0"
                        : `${a.changeVs24h > 0 ? "+" : ""}${formatCurrencyMXN(a.changeVs24h, { compact: true })}`}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {a.lastActivityAt ? formatRelative(a.lastActivityAt) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {a.isStale ? (
                      <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">
                        Stale
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Al día</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
