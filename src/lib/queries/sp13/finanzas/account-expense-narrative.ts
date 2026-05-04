import "server-only";
import { unstable_cache } from "next/cache";
import { callClaudeJSON } from "@/lib/claude";
import type { AccountExpenseDetail } from "./account-expense-detail";

/**
 * Síntesis CFO de una cuenta GL específica.
 *
 * Toma el detalle (vendor breakdown + facturas + trend) y produce:
 *   - 2 frases explicando QUÉ es esta cuenta y a quién va el dinero
 *   - 3-5 bullets de qué movió este mes vs el promedio
 *   - 1-2 recomendaciones operativas
 *
 * Cache 1h: la narrativa no cambia si los datos no cambian.
 */

export interface AccountNarrative {
  whatIsThis: string;          // 2 frases sobre la cuenta y su contenido
  driversThisPeriod: string[]; // 3-5 bullets
  recommendations: string[];   // 1-2 acciones concretas
}

const SYSTEM_PROMPT = `Eres CFO de Quimibond, empresa textil mexicana de
entretelas. El CEO te pregunta sobre una cuenta contable específica:
qué es, en qué se está gastando, y por qué.

Tu trabajo es leer el detalle (proveedores top + facturas recientes +
trend mensual) y producir una explicación operativa breve.

Reglas:
1. Hablas en MXN, nunca USD.
2. Sé concreto: nombra proveedores y montos. "Pagaste $210k a productos
   eléctricos y ferreteros" es mejor que "el principal gasto fue
   electricidad".
3. Si el mes está fuera de patrón vs el run rate, dilo: "este mes está
   $174k arriba del promedio por dos OC grandes a Servicios Industriales".
4. Recomendaciones deben ser concretas y operacionales, no genéricas.
   Mal: "revisar gastos". Bien: "renegociar tarifa con productos
   eléctricos — concentra 36% del gasto en una sola factura".
5. NO inventes datos. Si no hay info suficiente, di que no hay
   patrón claro.

OUTPUT: estricto JSON con esta forma exacta (sin markdown wrapper):
{
  "whatIsThis": "string — 2 frases explicando la cuenta y su contenido típico",
  "driversThisPeriod": ["string", "string", "string"],
  "recommendations": ["string", "string"]
}`;

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(
    Math.round(n)
  );
}

function buildUserPrompt(d: AccountExpenseDetail): string {
  const lines: string[] = [];
  lines.push(`# Cuenta GL: ${d.accountCode} — ${d.accountName ?? ""}`);
  lines.push(`Período: ${d.fromPeriod} a ${d.toPeriod}`);
  lines.push(`Total del período: $${fmt(d.totalMxn)} MXN`);
  lines.push(`Promedio últimos 3 meses cerrados: $${fmt(d.avgRecent3mMxn)} MXN`);
  if (d.changeVsAvgPct != null) {
    lines.push(
      `Cambio vs run rate: ${d.changeVsAvgPct >= 0 ? "+" : ""}${d.changeVsAvgPct.toFixed(1)}%`
    );
  }
  lines.push("");

  lines.push("## Trend mensual (últimos 12 meses)");
  for (const t of d.trend12m) {
    lines.push(`  ${t.period}: $${fmt(t.balanceMxn)}`);
  }
  lines.push("");

  lines.push("## Top proveedores en el período");
  for (const v of d.vendors.slice(0, 10)) {
    lines.push(
      `  - ${v.vendorName}: $${fmt(v.totalMxn)} (${v.invoiceCount} facturas, ${v.lineCount} líneas)`
    );
  }
  lines.push("");

  lines.push("## Facturas más representativas (top 15 por monto)");
  const sortedLines = [...d.recentLines]
    .sort((a, b) => Math.abs(b.netMxn) - Math.abs(a.netMxn))
    .slice(0, 15);
  for (const l of sortedLines) {
    lines.push(
      `  - ${l.date} | ${l.entryName} | ${l.vendorName} | $${fmt(l.netMxn)} | ${(l.description ?? "").slice(0, 80)}`
    );
  }
  lines.push("");

  lines.push("## TU TAREA");
  lines.push(
    "Genera el JSON con whatIsThis (2 frases), driversThisPeriod (3-5 bullets concretos con nombres y montos), y recommendations (1-2 acciones operativas)."
  );
  return lines.join("\n");
}

async function _getAccountNarrativeRaw(
  detail: AccountExpenseDetail
): Promise<AccountNarrative | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  if (detail.recentLines.length === 0 && detail.vendors.length === 0) {
    return null;
  }

  try {
    const { result } = await callClaudeJSON<AccountNarrative>(
      apiKey,
      {
        model: "claude-opus-4-7",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(detail) }],
        cacheSystem: true,
      },
      "account-expense-cfo"
    );
    return result;
  } catch (err) {
    console.error("[account-expense-narrative] Claude failed:", err);
    return null;
  }
}

export const getAccountNarrative = (detail: AccountExpenseDetail) =>
  unstable_cache(
    () => _getAccountNarrativeRaw(detail),
    [
      "sp13-account-expense-narrative-v1",
      detail.accountCode,
      detail.fromPeriod,
      detail.toPeriod,
    ],
    { revalidate: 3600, tags: ["finanzas"] }
  )();
