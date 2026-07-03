import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Cierre de Inventario Limpio — war room.
 *
 * El número norte: |GL 115.x − físico×costo| por bucket, meta $0.00.
 * Fuente: RPCs get_inventory_close_status / get_inventory_close_alarms
 * (migration 20260703_cierre_inventario_war_room.sql) + odoo_pending_actions
 * para el semáforo de workstreams.
 *
 * Contexto completo: docs/audit-2026-07-02-inventario-contabilidad.md.
 */

export interface CloseBucket {
  bucket: string;
  cuentas: string;
  glMxn: number;
  fisicoMxn: number;
  driftMxn: number;
  skus: number;
}

export interface CloseAlarm {
  alarma: string;
  severidad: "critical" | "high";
  valorMxn: number;
  eventos: number;
  detalle: string;
}

export interface CloseSnapshot {
  buckets: CloseBucket[];
  totalGl: number;
  totalFisico: number;
  totalDriftAbs: number;
  alarms: CloseAlarm[];
}

type StatusRow = {
  bucket: string;
  cuentas: string;
  gl_mxn: number | string;
  fisico_mxn: number | string;
  drift_mxn: number | string;
  skus: number;
};

type AlarmRow = {
  alarma: string;
  severidad: string;
  valor_mxn: number | string;
  eventos: number;
  detalle: string | null;
};

async function _getCloseSnapshotRaw(): Promise<CloseSnapshot> {
  const sb = getServiceClient();

  const [statusRes, alarmsRes] = await Promise.all([
    sb.rpc("get_inventory_close_status"),
    sb.rpc("get_inventory_close_alarms", { p_days: 30 }),
  ]);
  if (statusRes.error) throw statusRes.error;
  if (alarmsRes.error) throw alarmsRes.error;

  const buckets = ((statusRes.data ?? []) as StatusRow[]).map((r) => ({
    bucket: r.bucket,
    cuentas: r.cuentas,
    glMxn: Number(r.gl_mxn ?? 0),
    fisicoMxn: Number(r.fisico_mxn ?? 0),
    driftMxn: Number(r.drift_mxn ?? 0),
    skus: Number(r.skus ?? 0),
  }));

  const alarms = ((alarmsRes.data ?? []) as AlarmRow[]).map((r) => ({
    alarma: r.alarma,
    severidad: (r.severidad === "critical" ? "critical" : "high") as
      | "critical"
      | "high",
    valorMxn: Number(r.valor_mxn ?? 0),
    eventos: Number(r.eventos ?? 0),
    detalle: r.detalle ?? "",
  }));

  return {
    buckets,
    totalGl: buckets.reduce((s, b) => s + b.glMxn, 0),
    totalFisico: buckets.reduce((s, b) => s + b.fisicoMxn, 0),
    totalDriftAbs: buckets.reduce((s, b) => s + Math.abs(b.driftMxn), 0),
    alarms,
  };
}

export const getCloseSnapshot = () =>
  unstable_cache(_getCloseSnapshotRaw, ["sp13-finanzas-cierre-inventario-v1"], {
    revalidate: 300,
    tags: ["finanzas"],
  })();

/** Los 6 workstreams del plan de cierre, en orden de ejecución. */
export const CLOSE_WORKSTREAMS: Array<{
  actionKey: string;
  paso: string;
  fase: string;
}> = [
  {
    actionKey: "capa-valoracion-manual-detener",
    paso: "1. Congelar CAPA y depurar WIP",
    fase: "Fase 1-2",
  },
  {
    actionKey: "cuentas-valuacion-categoria-realinear",
    paso: "2. Realinear categorías → cuentas (cerrar 115.01.01, crear 115.03.02)",
    fase: "Fase 1",
  },
  {
    actionKey: "refacciones-fuera-ciclo-textil",
    paso: "3. Refacciones fuera del ciclo textil + fantasmas a 0",
    fase: "Fase 1-2",
  },
  {
    actionKey: "conteo-junio-reclasificado-999998",
    paso: "4. Revertir 999998 y reclasificar el conteo de junio",
    fase: "Fase 2",
  },
  {
    actionKey: "activo-fijo-clasificado-como-inventario",
    paso: "5. Alta de activo fijo (máquinas de tejer del conteo)",
    fase: "Fase 2",
  },
  {
    actionKey: "revaluacion-inventario-costo-reconstruido",
    paso: "6. Revaluación Política A y cuadre al centavo",
    fase: "Fase 3",
  },
];
