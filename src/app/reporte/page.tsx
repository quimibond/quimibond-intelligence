import Link from "next/link";
import { getServiceClient } from "@/lib/supabase-server";

export default async function ReporteIndexPage() {
  const sb = getServiceClient();

  // Pull last 12 months with P&L data
  const { data } = await sb
    .from("canonical_account_balances")
    .select("period")
    .eq("deprecated", false)
    .gte("period", "2024-01")
    .order("period", { ascending: false });

  const periods = Array.from(
    new Set((data ?? []).map((r) => r.period as string))
  )
    .filter((p) => /^\d{4}-\d{2}$/.test(p))
    .slice(0, 24);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Reportes mensuales de cierre</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Selecciona un mes para generar el reporte ejecutivo con P&amp;L
          limpio, drivers, one-offs y recomendaciones priorizadas. Cada
          reporte es imprimible / exportable a PDF.
        </p>
      </header>

      <ul className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {periods.map((p) => (
          <li key={p}>
            <Link
              href={`/reporte/${p}`}
              className="block rounded border bg-card hover:bg-muted px-3 py-2 text-sm transition"
            >
              {periodLabel(p)}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

const SPANISH_MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function periodLabel(p: string): string {
  const [y, m] = p.split("-").map((s) => parseInt(s, 10));
  return `${SPANISH_MONTHS[m - 1]} ${y}`;
}

export const metadata = {
  title: "Reportes mensuales — Quimibond",
};
