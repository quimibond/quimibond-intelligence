import "server-only";
import { unstable_cache } from "next/cache";
import { callClaudeJSON } from "@/lib/claude";
import type { MonthlyReport } from "./monthly-report";

/**
 * Síntesis CFO del reporte mensual vía Claude.
 *
 * Toma el snapshot numérico de `getMonthlyReport()` y produce:
 *   - Resumen ejecutivo (3 párrafos: situación, drivers, perspectiva)
 *   - 5–7 recomendaciones priorizadas con dueño y deadline sugerido
 *   - Plan de acción mes siguiente (3–5 acciones concretas)
 *
 * Design notes:
 *   - Usa Opus 4.7 (claude-opus-4-7) — mejor para análisis financiero matizado
 *   - Adaptive thinking — el modelo decide cuánto pensar
 *   - Output en JSON estructurado para renderizado UI
 *   - Caching: 1h porque la narrativa no cambia entre runs si los datos no cambian
 */

export interface ReportRecommendation {
  priority: number;            // 1 = más urgente
  title: string;
  description: string;
  category: "ventas" | "costos" | "cobranza" | "compras" | "financiero" | "operacion" | "fiscal";
  owner: string;               // sugerencia de responsable
  impactMxn: number | null;    // impacto estimado en MXN si la conoce
  horizon: "30d" | "60d" | "90d" | "estructural";
}

export interface ReportNarrative {
  executiveSummary: string;       // 3 párrafos markdown
  whyWonOrLost: string;           // Explicación 1 párrafo del resultado del mes
  topThreeWins: string[];         // 3 bullets
  topThreeLosses: string[];       // 3 bullets
  recommendations: ReportRecommendation[];  // 5-7 items
  nextMonthFocus: string;         // 1 párrafo
}

const SYSTEM_PROMPT = `Eres CFO ad-honorem de Quimibond, empresa textil mexicana de entretelas
(80% manufactura propia, 20% importación). Tu trabajo es leer el cierre
mensual y producir un reporte ejecutivo accionable para el CEO.

Quimibond opera con margen contributivo material 60-65%. EBIT objetivo
mensual: $1.5-2M MXN. Costos fijos estructurales ~$10M/mes.

Contexto Lepezo (2026-03): venta-leaseback financiero de la rama
ICOMATEX. Generó $11.35M de cash (clasificado como préstamo en libros)
+ $574k de utilidad contable one-off + $1.5M en otros ingresos
extraordinarios. NUEVO costo recurrente: $1.08M/mes de arrendamiento
financiero (cuenta 701.11.0001).

Reglas de tu output:
1. Habla siempre en MXN, nunca en USD/dólares.
2. Sé directo y operacional. No uses lenguaje corporativo vacío
   ("sinergia", "alineación estratégica", "best-in-class"). Si la
   recomendación es "renegociar precio con shawmut", dilo así.
3. Cada recomendación debe tener un dueño concreto del equipo Quimibond.
4. Si el impacto en MXN es estimable, ponlo. Si no, deja null.
5. NO copies texto literal del prompt — interpreta los números.
6. NO inventes datos que no están en el input. Si te piden algo
   imposible de saber con la info dada, dilo.
7. Recomendaciones deben ser priorizadas: la #1 es la que más mueve
   utilidad o más urgente.

Equipo Quimibond:
- Sandra Dávila — Cobranza
- Guadalupe Guerrero — Ventas (líder)
- Dario Manriquez — Logística
- Guadalupe Ramos — Producción
- Gustavo Delgado — Almacén
- Oscar Gonzalez — Calidad
- Elena Delgado — Compras
- Jessica Francisco — Innovación
- Paris César Villordo — Planeación
- Miguel Medina — RH
- Mariano Dominguez — Sistemas
- Jose J. Mizrahi — CEO/Dirección

OUTPUT: estricto JSON con esta forma exacta (sin markdown wrapper):
{
  "executiveSummary": "string — 3 párrafos separados por \\n\\n. Sin headers.",
  "whyWonOrLost": "string — 1 párrafo explicando si el mes ganó o perdió y por qué",
  "topThreeWins": ["string", "string", "string"],
  "topThreeLosses": ["string", "string", "string"],
  "recommendations": [
    {
      "priority": 1,
      "title": "string — frase imperativa, máx 12 palabras",
      "description": "string — 2-3 oraciones con cómo, qué medir, riesgo",
      "category": "ventas|costos|cobranza|compras|financiero|operacion|fiscal",
      "owner": "string — uno de los nombres del equipo arriba",
      "impactMxn": number_o_null,
      "horizon": "30d|60d|90d|estructural"
    }
  ],
  "nextMonthFocus": "string — 1 párrafo con qué priorizar el mes siguiente"
}`;

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function buildUserPrompt(r: MonthlyReport): string {
  const c = r.pnl.curr;
  const p = r.pnl.prev;
  const dUtil = c.utilidadLimpia - p.utilidadLimpia;
  const dRev = c.ventas4xx - p.ventas4xx;
  const dEbit = c.ebitLimpio - p.ebitLimpio;

  const lines: string[] = [];
  lines.push(`# Cierre ${r.periodLabel} (vs ${r.periodPrevLabel})`);
  lines.push("");
  lines.push("## P&L LIMPIO MXN (con costo MP recursivo, no contable inflado)");
  lines.push("```");
  lines.push(`                       ${r.periodLabel.padEnd(15)} ${r.periodPrevLabel.padEnd(15)} Δ`);
  lines.push(`Ventas (4xx)           ${fmt(c.ventas4xx).padEnd(15)} ${fmt(p.ventas4xx).padEnd(15)} ${fmt(dRev)}`);
  lines.push(`Costo MP (BOM)         ${fmt(c.cogsRecursivoMp).padEnd(15)} ${fmt(p.cogsRecursivoMp).padEnd(15)} ${fmt(c.cogsRecursivoMp - p.cogsRecursivoMp)}`);
  lines.push(`MOD (501.06)           ${fmt(c.mod501_06).padEnd(15)} ${fmt(p.mod501_06).padEnd(15)} ${fmt(c.mod501_06 - p.mod501_06)}`);
  lines.push(`Compras imp. (502)     ${fmt(c.compras502).padEnd(15)} ${fmt(p.compras502).padEnd(15)} ${fmt(c.compras502 - p.compras502)}`);
  lines.push(`Overhead (504.01)      ${fmt(c.overhead504_01).padEnd(15)} ${fmt(p.overhead504_01).padEnd(15)} ${fmt(c.overhead504_01 - p.overhead504_01)}`);
  lines.push(`Gastos op (6xx)        ${fmt(c.gastosOp6xx).padEnd(15)} ${fmt(p.gastosOp6xx).padEnd(15)} ${fmt(c.gastosOp6xx - p.gastosOp6xx)}`);
  lines.push(`EBIT limpio            ${fmt(c.ebitLimpio).padEnd(15)} ${fmt(p.ebitLimpio).padEnd(15)} ${fmt(dEbit)}`);
  lines.push(`Otros (7xx) NETO       ${fmt(c.otros7xx).padEnd(15)} ${fmt(p.otros7xx).padEnd(15)} ${fmt(c.otros7xx - p.otros7xx)}`);
  lines.push(`Depreciación           ${fmt(c.depreciacion).padEnd(15)} ${fmt(p.depreciacion).padEnd(15)} ${fmt(c.depreciacion - p.depreciacion)}`);
  lines.push(`UTILIDAD NETA limpia   ${fmt(c.utilidadLimpia).padEnd(15)} ${fmt(p.utilidadLimpia).padEnd(15)} ${fmt(dUtil)}`);
  lines.push(`Utilidad NORMALIZADA   ${fmt(r.utilidadNormalizada).padEnd(15)} (quita one-offs detectados)`);
  lines.push("```");
  lines.push("");
  lines.push(`Residual CAPA inflada en 501.01: ${fmt(c.capaResidual)} MXN`);
  lines.push("");

  if (r.oneOffs.length > 0) {
    lines.push("## ONE-OFFS DETECTADOS este mes");
    for (const oo of r.oneOffs) {
      lines.push(`- ${oo.categoryLabel}: ${fmt(oo.amountMxn)} MXN (impacto utilidad: ${fmt(oo.impactOnUtilityMxn)})`);
    }
    lines.push("");
  }

  lines.push("## CLIENTES — top movers MoM (revenue MXN)");
  if (r.customerGainers.length > 0) {
    lines.push("Ganaron:");
    for (const g of r.customerGainers.slice(0, 5)) {
      lines.push(`  + ${g.companyName}: ${fmt(g.revenuePrev)} → ${fmt(g.revenueCurr)} (Δ ${fmt(g.delta)})`);
    }
  }
  if (r.customerLosers.length > 0) {
    lines.push("Perdieron:");
    for (const l of r.customerLosers.slice(0, 5)) {
      lines.push(`  − ${l.companyName}: ${fmt(l.revenuePrev)} → ${fmt(l.revenueCurr)} (Δ ${fmt(l.delta)})`);
    }
  }
  lines.push("");

  lines.push("## CUENTAS GL — top movers MoM (impacto en utilidad)");
  if (r.accountHelpers.length > 0) {
    lines.push("Ayudaron (Δ utilidad +):");
    for (const h of r.accountHelpers) {
      lines.push(`  + ${h.accountCode} ${h.accountName}: Δ ${fmt(h.delta)}`);
    }
  }
  if (r.accountHurters.length > 0) {
    lines.push("Castigaron (Δ utilidad −):");
    for (const h of r.accountHurters) {
      lines.push(`  − ${h.accountCode} ${h.accountName}: Δ ${fmt(h.delta)}`);
    }
  }
  lines.push("");

  lines.push("## CASH POSITION (cierre del mes)");
  lines.push(`Cash en bancos: ${fmt(r.cashOpening)} MXN`);
  lines.push(`AR abierto: ${fmt(r.arOpen)} MXN`);
  lines.push(`AP abierto: ${fmt(r.apOpen)} MXN`);
  lines.push(`FX neto del mes (impacto utilidad): ${fmt(r.fxNetMxn)} MXN`);
  lines.push(`Arrendamiento financiero Lepezo (recurrente, impacto utilidad): ${fmt(r.arrendamientoFinancieroMxn)} MXN`);
  lines.push("");

  lines.push("## TU TAREA");
  lines.push(`Genera el JSON con executiveSummary, whyWonOrLost, top 3 wins/losses, ${
    dUtil < 0 ? "5-7 recomendaciones priorizadas con sesgo a recuperar margen y reducir costos no operativos" : "5-7 recomendaciones priorizadas para sostener y amplificar la utilidad"
  }, y nextMonthFocus.`);
  lines.push("Recuerda: JSON estricto, sin markdown wrapper, sin texto antes ni después.");

  return lines.join("\n");
}

async function _getReportNarrativeRaw(
  report: MonthlyReport
): Promise<ReportNarrative | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[monthly-report-narrative] ANTHROPIC_API_KEY missing — skipping narrative");
    return null;
  }

  const userPrompt = buildUserPrompt(report);

  try {
    const { result } = await callClaudeJSON<ReportNarrative>(
      apiKey,
      {
        model: "claude-opus-4-7",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        cacheSystem: true,
      },
      "monthly-report-cfo"
    );
    return result;
  } catch (err) {
    console.error("[monthly-report-narrative] Claude call failed:", err);
    return null;
  }
}

export const getReportNarrative = (report: MonthlyReport) =>
  unstable_cache(
    () => _getReportNarrativeRaw(report),
    ["sp13-finanzas-monthly-report-narrative-v1", report.period],
    { revalidate: 3600, tags: ["finanzas"] }
  )();
