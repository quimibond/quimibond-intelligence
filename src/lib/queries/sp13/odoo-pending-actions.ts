import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Acciones pendientes de configuración en Odoo.
 *
 * Cada vez que el sistema descubre un patrón que requiere reconfiguración
 * en Odoo (no es bug arreglable en silver/frontend), se registra en
 * `odoo_pending_actions`. Las páginas relevantes muestran un banner inline
 * vinculado al action_key. La página /sistema/odoo-pendientes es el
 * registro central.
 */

export type OdooActionSeverity = "critical" | "high" | "medium" | "low";
export type OdooActionStatus = "open" | "in_progress" | "resolved" | "wont_fix";

export interface OdooPendingAction {
  id: number;
  actionKey: string;
  area: string;
  severity: OdooActionSeverity;
  title: string;
  problemDescription: string;
  fixInOdoo: string;
  workaroundInSilver: string | null;
  estimatedImpactMxn: number | null;
  evidenceUrl: string | null;
  status: OdooActionStatus;
  assignee: string | null;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

type RawRow = {
  id: number;
  action_key: string;
  area: string;
  severity: string;
  title: string;
  problem_description: string;
  fix_in_odoo: string;
  workaround_in_silver: string | null;
  estimated_impact_mxn: number | string | null;
  evidence_url: string | null;
  status: string;
  assignee: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
};

function mapRow(r: RawRow): OdooPendingAction {
  return {
    id: r.id,
    actionKey: r.action_key,
    area: r.area,
    severity: r.severity as OdooActionSeverity,
    title: r.title,
    problemDescription: r.problem_description,
    fixInOdoo: r.fix_in_odoo,
    workaroundInSilver: r.workaround_in_silver,
    estimatedImpactMxn:
      r.estimated_impact_mxn == null ? null : Number(r.estimated_impact_mxn),
    evidenceUrl: r.evidence_url,
    status: r.status as OdooActionStatus,
    assignee: r.assignee,
    notes: r.notes,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

async function _getAllPendingActionsRaw(): Promise<OdooPendingAction[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("odoo_pending_actions")
    .select("*")
    .order("status", { ascending: true })
    .order("severity", { ascending: true });
  if (error) throw error;
  const rows = ((data ?? []) as RawRow[]).map(mapRow);
  // Order: open first by severity, then in_progress, then resolved, then wont_fix
  const statusOrder: Record<string, number> = {
    open: 0,
    in_progress: 1,
    resolved: 2,
    wont_fix: 3,
  };
  rows.sort((a, b) => {
    const s = statusOrder[a.status] - statusOrder[b.status];
    if (s !== 0) return s;
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
  return rows;
}

export const getAllPendingActions = () =>
  unstable_cache(_getAllPendingActionsRaw, ["odoo-pending-actions-v1"], {
    revalidate: 300,
    tags: ["odoo-pending"],
  })();

async function _getPendingActionByKeyRaw(
  actionKey: string
): Promise<OdooPendingAction | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("odoo_pending_actions")
    .select("*")
    .eq("action_key", actionKey)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as RawRow) : null;
}

export const getPendingActionByKey = (actionKey: string) =>
  unstable_cache(
    () => _getPendingActionByKeyRaw(actionKey),
    ["odoo-pending-action-v1", actionKey],
    { revalidate: 300, tags: ["odoo-pending"] }
  )();
