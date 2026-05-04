import "server-only";
import { unstable_cache } from "next/cache";
import { callClaudeJSON } from "@/lib/claude";
import type { CrossAccountMovementsSummary } from "./cross-account-movements";

/**
 * Top-line CFO sobre los movimientos del mes — qué subió, qué bajó,
 * dónde hay que mirar primero.
 */

export interface CrossAccountNarrative {
  topInsight: string;            // 1-2 frases del insight más importante
  biggestIncreases: string[];    // 3-4 bullets de cuentas que crecieron
  biggestDecreases: string[];    // 2-3 bullets de cuentas que cayeron
  recommendations: string[];     // 2-3 acciones priorizadas
}

const SYSTEM_PROMPT = `Eres CFO de Quimibond, empresa textil mexicana.
Te dan el resumen de movimientos cross-account de un mes específico:
todas las cuentas P&L con cambios materiales vs run rate 3m + MoM.

Tu trabajo es producir una vista ejecutiva: ¿qué pasó este mes que es
distinto de lo normal?

Reglas:
1. MXN siempre, nunca USD.
2. Sé concreto: nombra la cuenta y el monto. "MANTENIMIENTOS FABRICA
   subió $384k vs run rate" mejor que "los gastos de fábrica subieron".
3. Diferencia entre subidas estructurales (probablemente nuevas) y
   estacionales/aleatorias.
4. Recomendaciones operativas con dueño cuando puedas.
5. NO inventes. Si no hay info para concluir, dilo.
6. Las cuentas 4xx negativas en delta significan ventas BAJARON. Las 6xx
   positivas significan gastos SUBIERON. La columna deltaVsAvgAbs es el
   impacto en utilidad: positivo = peor (más gasto o menos ingreso),
   negativo = mejor.

OUTPUT: JSON estricto, sin markdown wrapper:
{
  "topInsight": "string — 1-2 frases con el hallazgo más importante",
  "biggestIncreases": ["string", "string", "string"],
  "biggestDecreases": ["string", "string"],
  "recommendations": ["string", "string"]
}`;

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(
    Math.round(n)
  );
}

function buildUserPrompt(s: CrossAccountMovementsSummary): string {
  const lines: string[] = [];
  lines.push(`# Movimientos cross-account ${s.period}`);
  lines.push(`Total cambio absoluto vs run rate 3m: $${fmt(s.totalAbsChange)} MXN`);
  lines.push(`Anomalías detectadas: ${s.anomalyCount}`);
  lines.push("");
  lines.push("## Top 20 movimientos (cuenta · curr · run rate · Δ vs avg · % vs avg · MoM · anomaly)");
  for (const m of s.movements.slice(0, 20)) {
    lines.push(
      `  ${m.accountCode} ${m.accountName} [${m.bucket}] | curr $${fmt(m.currMxn)} | avg3m $${fmt(m.avg3mMxn)} | Δavg $${fmt(m.deltaVsAvgAbs)} (${m.deltaVsAvgPct ?? "n/a"}%) | MoM $${fmt(m.deltaMomAbs)} | YoY $${fmt(m.deltaYoyAbs)} | anom: ${m.isAnomaly}`
    );
  }
  lines.push("");
  lines.push("## TU TAREA");
  lines.push(
    "Genera el JSON con topInsight (1-2 frases), 3-4 biggest increases con monto y narrativa, 2-3 biggest decreases, y 2-3 recomendaciones priorizadas."
  );
  return lines.join("\n");
}

async function _getCrossAccountNarrativeRaw(
  summary: CrossAccountMovementsSummary
): Promise<CrossAccountNarrative | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || summary.movements.length === 0) return null;

  try {
    const { result } = await callClaudeJSON<CrossAccountNarrative>(
      apiKey,
      {
        model: "claude-opus-4-7",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(summary) }],
        cacheSystem: true,
      },
      "cross-account-cfo"
    );
    return result;
  } catch (err) {
    console.error("[cross-account-narrative] Claude failed:", err);
    return null;
  }
}

export const getCrossAccountNarrative = (summary: CrossAccountMovementsSummary) =>
  unstable_cache(
    () => _getCrossAccountNarrativeRaw(summary),
    ["sp13-cross-account-narrative-v1", summary.period],
    { revalidate: 3600, tags: ["finanzas"] }
  )();
