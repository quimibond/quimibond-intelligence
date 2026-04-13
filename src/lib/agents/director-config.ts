import type { SupabaseClient } from "@supabase/supabase-js";

export interface DirectorConfig {
  /** Mínimo de impacto económico (MXN) para que un insight pase. 0 = sin filtro. */
  min_business_impact_mxn: number;
  /** Máximo de impacto económico (MXN). Insights arriba de este cap se rechazan
   *  como probables alucinaciones (ej: equipo reportando issues de HR de $5.8M).
   *  0 = sin cap. Se aplica DESPUÉS de min_business_impact y antes del top-N cap. */
  max_business_impact_mxn: number;
  /** Máx insights insertados por corrida (0 = usar default global de la ruta). */
  max_insights_per_run: number;
  /** Modos rotativos del director. Si tiene 2+, cada corrida usa el siguiente. */
  mode_rotation: string[];
  /** Piso de confianza adicional (si > 0, se aplica sobre el adaptive threshold). */
  min_confidence_floor: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  min_business_impact_mxn: 0,
  max_business_impact_mxn: 0,
  max_insights_per_run: 0,
  mode_rotation: [],
  min_confidence_floor: 0,
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function loadDirectorConfig(
  supabase: SupabaseClient,
  agentId: number
): Promise<DirectorConfig> {
  const { data } = await supabase
    .from("ai_agents")
    .select("config")
    .eq("id", agentId)
    .maybeSingle();

  const raw = (data?.config ?? {}) as Record<string, unknown>;
  return {
    min_business_impact_mxn: clamp(Number(raw.min_business_impact_mxn ?? 0), 0, 10_000_000),
    max_business_impact_mxn: clamp(Number(raw.max_business_impact_mxn ?? 0), 0, 1_000_000_000),
    max_insights_per_run: clamp(Number(raw.max_insights_per_run ?? 0), 0, 10),
    mode_rotation: Array.isArray(raw.mode_rotation)
      ? (raw.mode_rotation as unknown[]).map(String).filter(Boolean)
      : [],
    min_confidence_floor: clamp(Number(raw.min_confidence_floor ?? 0), 0, 1),
  };
}

export interface RawInsight {
  title?: unknown;
  description?: unknown;
  severity?: unknown;
  confidence?: unknown;
  business_impact_estimate?: unknown;
  category?: unknown;
  [k: string]: unknown;
}

export function filterInsightsByConfig<T extends RawInsight>(
  insights: T[],
  cfg: DirectorConfig
): T[] {
  let out = insights.slice();

  // Order matters: confidence runs BEFORE impact so the `severity='critical'`
  // bypass in the impact stage cannot rescue a low-confidence critical insight.
  // The cap (max_insights_per_run) runs last so it slices the already-filtered set.
  if (cfg.min_confidence_floor > 0) {
    out = out.filter(i => Number(i.confidence ?? 0) >= cfg.min_confidence_floor);
  }

  if (cfg.min_business_impact_mxn > 0) {
    out = out.filter(i => {
      if (String(i.severity ?? "") === "critical") return true;
      const impact = Number(i.business_impact_estimate ?? 0);
      return impact >= cfg.min_business_impact_mxn;
    });
  }

  // Cap de impact superior: rechaza insights con impact > cap.
  // Esto ataca las alucinaciones de equipo ($5.8M avg para issues de HR) y
  // de operaciones/costos ($9-12M). severity='critical' NO rescata aqui —
  // la intencion es que el cap sea un truth-check, no un filtro de prioridad.
  if (cfg.max_business_impact_mxn > 0) {
    out = out.filter(i => {
      const impact = Number(i.business_impact_estimate ?? 0);
      // Si no hay estimate, no podemos juzgarlo — pasa.
      if (!Number.isFinite(impact) || impact <= 0) return true;
      return impact <= cfg.max_business_impact_mxn;
    });
  }

  if (cfg.max_insights_per_run > 0 && out.length > cfg.max_insights_per_run) {
    out.sort((a, b) => {
      const ai = Number(a.business_impact_estimate ?? 0);
      const bi = Number(b.business_impact_estimate ?? 0);
      return bi - ai;
    });
    out = out.slice(0, cfg.max_insights_per_run);
  }

  return out;
}
