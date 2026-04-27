import { FileX } from "lucide-react";
import {
  QuestionSection,
  EmptyState,
  StatusBadge,
} from "@/components/patterns";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  getBalanceSheet,
  type BalanceSheetCategoryRow,
} from "@/lib/queries/sp13/finanzas";
import { formatPeriod, isFresh } from "../utils";

/* ── F3.5 Balance sheet ──────────────────────────────────────────────── */
export async function BalanceSheetBlock() {
  const bs = await getBalanceSheet();
  const fresh = isFresh(bs?.asOfDate, 48);

  return (
    <QuestionSection
      id="balance-sheet"
      question="¿Cómo está mi balance?"
      subtext={
        bs
          ? `Activo · pasivo · capital al cierre de ${formatPeriod(bs.period)}`
          : undefined
      }
      actions={
        bs?.asOfDate ? (
          <span title={bs.asOfDate}>
            <StatusBadge
              kind="staleness"
              value={fresh ? "fresh" : "stale"}
              density="regular"
            />
          </span>
        ) : null
      }
    >
      {!bs ? (
        <EmptyState
          icon={FileX}
          title="Sin balance disponible"
          description="El refresco de gold_balance_sheet no ha corrido todavía."
        />
      ) : (
        <>
          <BalanceSheetTable
            assets={bs.detailRows.filter((r) => r.side === "asset")}
            liabilities={bs.detailRows.filter((r) => r.side === "liability")}
            equity={bs.detailRows.filter((r) => r.side === "equity")}
            totalAssets={bs.totalAssetsMxn}
            totalLiabilities={bs.totalLiabilitiesMxn}
            totalEquity={bs.totalEquityMxn}
            liquidityRatio={bs.liquidityRatio}
            debtToEquityRatio={bs.debtToEquityRatio}
            netIncomeLifetimeMxn={bs.netIncomeLifetimeMxn}
          />
          {Math.abs(bs.unbalancedAmountMxn) > 1 && (
            <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
              ⚠ Balance descuadrado por {formatCurrencyMXN(bs.unbalancedAmountMxn, { compact: true })} — revisa asientos sin contrapartida.
            </div>
          )}
        </>
      )}
    </QuestionSection>
  );
}

/* Tabla balance general estilo estado financiero clásico ──────────── */
function BalanceSheetTable({
  assets,
  liabilities,
  equity,
  totalAssets,
  totalLiabilities,
  totalEquity,
  liquidityRatio,
  debtToEquityRatio,
  netIncomeLifetimeMxn,
}: {
  assets: BalanceSheetCategoryRow[];
  liabilities: BalanceSheetCategoryRow[];
  equity: BalanceSheetCategoryRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  liquidityRatio: number | null;
  debtToEquityRatio: number | null;
  netIncomeLifetimeMxn: number;
}) {
  const fmt = (n: number) => formatCurrencyMXN(n);
  const totalLiabPlusEquity = totalLiabilities + totalEquity;
  const passSign = Math.sign(totalLiabPlusEquity);
  const equityCalc = totalEquity; // ya viene positivo

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Columna izquierda: ACTIVO */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Activo
        </div>
        <div className="divide-y">
          {assets.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
              Sin desglose disponible
            </div>
          ) : (
            assets.map((r) => {
              const pct =
                totalAssets > 0 ? (r.closingMxn / totalAssets) * 100 : 0;
              return (
                <div
                  key={r.category}
                  className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div>{r.categoryLabel}</div>
                    <div
                      className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-primary/40"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums">
                      {fmt(r.closingMxn)}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {pct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div className="flex items-center justify-between gap-3 border-t-2 border-foreground/20 bg-muted/40 px-3 py-3 text-sm font-semibold sm:px-4">
            <span>TOTAL ACTIVO</span>
            <span className="tabular-nums">{fmt(totalAssets)}</span>
          </div>
        </div>
      </div>

      {/* Columna derecha: PASIVO + CAPITAL */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Pasivo
        </div>
        <div className="divide-y">
          {liabilities.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
              Sin desglose
            </div>
          ) : (
            liabilities.map((r) => {
              const pct =
                totalLiabPlusEquity > 0
                  ? (r.closingMxn / totalLiabPlusEquity) * 100
                  : 0;
              return (
                <div
                  key={r.category}
                  className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div>{r.categoryLabel}</div>
                    <div
                      className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-warning/50"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums">
                      {fmt(r.closingMxn)}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {pct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-3 py-2 text-sm font-medium sm:px-4">
            <span>Total pasivo</span>
            <span className="tabular-nums">{fmt(totalLiabilities)}</span>
          </div>
        </div>

        <div className="border-b border-t-2 border-foreground/20 bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Capital contable
        </div>
        <div className="divide-y">
          {equity.length === 0 ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm sm:px-4">
              <span>Capital total</span>
              <span className="tabular-nums">{fmt(equityCalc)}</span>
            </div>
          ) : (
            equity.map((r) => (
              <div
                key={r.category}
                className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
              >
                <span className="flex-1">{r.categoryLabel}</span>
                <span className="tabular-nums">{fmt(r.closingMxn)}</span>
              </div>
            ))
          )}
          <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-3 py-2 text-sm font-medium sm:px-4">
            <span>Total capital</span>
            <span className="tabular-nums">{fmt(equityCalc)}</span>
          </div>
        </div>

        <div
          className={cn(
            "flex items-center justify-between gap-3 border-t-2 px-3 py-3 text-sm font-semibold sm:px-4",
            passSign >= 0
              ? "border-foreground/20 bg-muted/40"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          )}
        >
          <span>TOTAL PASIVO + CAPITAL</span>
          <span className="tabular-nums">{fmt(totalLiabPlusEquity)}</span>
        </div>
      </div>

      {/* Footer indicators */}
      <div className="lg:col-span-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-md border bg-card px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Liquidez (A/P)</div>
          <div className="mt-0.5 text-base font-semibold tabular-nums">
            {liquidityRatio == null ? "—" : `${liquidityRatio.toFixed(2)}×`}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {liquidityRatio == null
              ? ""
              : liquidityRatio >= 1.5
                ? "saludable"
                : liquidityRatio >= 1
                  ? "ajustado"
                  : "comprometido"}
          </div>
        </div>
        <div className="rounded-md border bg-card px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Apalancamiento (P/C)</div>
          <div className="mt-0.5 text-base font-semibold tabular-nums">
            {debtToEquityRatio == null
              ? "—"
              : `${debtToEquityRatio.toFixed(2)}×`}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {debtToEquityRatio == null
              ? ""
              : debtToEquityRatio < 0.5
                ? "conservador"
                : debtToEquityRatio < 1
                  ? "moderado"
                  : "alto"}
          </div>
        </div>
        <div className="rounded-md border bg-card px-3 py-2 col-span-2 sm:col-span-1">
          <div className="text-[11px] text-muted-foreground">Utilidad acumulada (vida)</div>
          <div className="mt-0.5 text-base font-semibold tabular-nums">
            {fmt(netIncomeLifetimeMxn)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            ya está dentro del capital
          </div>
        </div>
      </div>
    </div>
  );
}
