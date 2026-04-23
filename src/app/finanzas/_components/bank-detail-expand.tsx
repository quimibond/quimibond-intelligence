"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Currency } from "@/components/patterns/currency";
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

  const cashCount = accounts.filter((a) => a.classification === "cash").length;
  const debtCount = accounts.filter((a) => a.classification === "debt").length;
  const staleCount = accounts.filter((a) => a.isStale).length;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-auto w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left hover:bg-accent/30"
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
                <>
                  {" "}· <span className="text-warning">{staleCount} stale</span>
                </>
              )}
            </div>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? "Ocultar" : "Ver detalle por cuenta"}
        </span>
      </Button>

      {open && (
        <div className="border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Saldo MXN</TableHead>
                <TableHead className="text-right">Δ 24h</TableHead>
                <TableHead>Últ. actividad</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={`${a.journalId ?? a.name}`}>
                  <TableCell>
                    <div className="font-medium">{a.name ?? "—"}</div>
                    {a.bankAccount && (
                      <div className="text-[11px] text-muted-foreground">
                        {a.bankAccount}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={a.classification === "debt" ? "destructive" : "secondary"}
                      className="text-[10px]"
                    >
                      {classificationLabel(a.classification)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Currency amount={a.currentBalanceMxn} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
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
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.lastActivityAt ? formatRelative(a.lastActivityAt) : "—"}
                  </TableCell>
                  <TableCell>
                    {a.isStale ? (
                      <Badge
                        variant="outline"
                        className="border-warning/40 text-[10px] text-warning"
                      >
                        Stale
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Al día</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
