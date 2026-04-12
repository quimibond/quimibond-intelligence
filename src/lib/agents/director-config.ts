import type { SupabaseClient } from "@supabase/supabase-js";

export interface DirectorConfig {
  /** Mínimo de impacto económico (MXN) para que un insight pase. 0 = sin filtro. */
  min_business_impact_mxn: number;
  /** Máx insights insertados por corrida (0 = usar default global de la ruta). */
  max_insights_per_run: number;
  /** Modos rotativos del director. Si tiene 2+, cada corrida usa el siguiente. */
  mode_rotation: string[];
  /** Piso de confianza adicional (si > 0, se aplica sobre el adaptive threshold). */
  min_confidence_floor: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  min_business_impact_mxn: 0,
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
    max_insights_per_run: clamp(Number(raw.max_insights_per_run ?? 0), 0, 10),
    mode_rotation: Array.isArray(raw.mode_rotation)
      ? (raw.mode_rotation as unknown[]).map(String).filter(Boolean)
      : [],
    min_confidence_floor: clamp(Number(raw.min_confidence_floor ?? 0), 0, 1),
  };
}
