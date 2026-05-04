import "server-only";
import Link from "next/link";
import { FileText, ArrowRight } from "lucide-react";
import { getServiceClient } from "@/lib/supabase-server";

const SPANISH_MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodLabel(p: string): string {
  const [y, m] = p.split("-").map((s) => parseInt(s, 10));
  return `${SPANISH_MONTHS[m - 1]} ${y}`;
}

/**
 * Banner que surface el último reporte mensual cerrado.
 * El "último cerrado" = mes anterior al actual (ej. hoy en mayo → abril).
 */
export async function LatestReportBanner() {
  const sb = getServiceClient();
  const today = new Date();
  // Mes anterior al actual
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevPeriod = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

  // Verifica que haya datos para ese mes
  const { count } = await sb
    .from("canonical_account_balances")
    .select("period", { count: "exact", head: true })
    .eq("period", prevPeriod)
    .eq("deprecated", false);

  if (!count || count === 0) return null;

  return (
    <Link
      href={`/reporte/${prevPeriod}`}
      className="group flex items-center gap-3 rounded-lg border-2 border-foreground/10 bg-gradient-to-r from-card to-muted/30 px-4 py-3 hover:border-foreground/20 hover:from-muted/30 hover:to-muted/50 transition mb-4"
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-foreground/5 shrink-0">
        <FileText size={18} className="text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">
          Reporte mensual de cierre · {periodLabel(prevPeriod)}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          P&amp;L limpio, drivers, one-offs y recomendaciones priorizadas con
          CFO sintetizado · imprimible
        </p>
      </div>
      <ArrowRight
        size={16}
        className="shrink-0 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition"
      />
    </Link>
  );
}
