/**
 * Centralized Spanish labels and string constants.
 * Single source of truth for UI text across the application.
 */

// ── Severity ──
export const SEVERITY_LABELS: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Critica",
};

// ── Priority ──
export const PRIORITY_LABELS: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

export const PRIORITY_VARIANTS: Record<string, "success" | "warning" | "critical" | "secondary"> = {
  low: "success",
  medium: "warning",
  high: "critical",
};

// ── State ──
export const STATE_LABELS: Record<string, string> = {
  new: "Nueva",
  pending: "Pendiente",
  acknowledged: "Reconocida",
  in_progress: "En progreso",
  completed: "Completada",
  resolved: "Resuelta",
  dismissed: "Descartada",
};

// ── Risk ──
export const RISK_LABELS: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Critico",
};

// ── Alert types ──
export const ALERT_TYPE_LABELS: Record<string, string> = {
  sentiment_drop: "Caida de sentimiento",
  payment_risk: "Riesgo de pago",
  communication_gap: "Brecha comunicacion",
  churn_risk: "Riesgo de fuga",
  stockout_risk: "Riesgo desabasto",
  opportunity: "Oportunidad",
  volume_drop: "Caida de volumen",
  discount_anomaly: "Descuento inusual",
};

// ── Sender types ──
export const SENDER_TYPE_LABELS: Record<string, string> = {
  inbound: "Recibido",
  outbound: "Enviado",
};

// ── Payment states ──
export const PAYMENT_STATE_LABELS: Record<string, string> = {
  paid: "Pagada",
  not_paid: "Pendiente",
  partial: "Parcial",
  overdue: "Vencida",
  in_payment: "En proceso",
};

// ── Insight Categories (fixed catalog — must match orchestrate/route.ts) ──
export const INSIGHT_CATEGORY_LABELS: Record<string, string> = {
  cobranza: "Cobranza",
  ventas: "Ventas",
  entregas: "Entregas",
  operaciones: "Operaciones",
  proveedores: "Proveedores",
  riesgo: "Riesgo",
  equipo: "Equipo",
  datos: "Datos",
};

export const INSIGHT_CATEGORY_COLORS: Record<string, string> = {
  cobranza: "text-danger-foreground bg-danger/10",
  ventas: "text-domain-sales bg-domain-sales/10",
  entregas: "text-warning-foreground bg-warning/10",
  operaciones: "text-domain-operations bg-domain-operations/10",
  proveedores: "text-domain-finance bg-domain-finance/10",
  riesgo: "text-domain-risk bg-domain-risk/10",
  equipo: "text-domain-relationships bg-domain-relationships/10",
  datos: "text-muted-foreground bg-muted",
};

// ── General UI ──
export const EMPTY_VALUE = "—";
export const NO_DATA = "Sin datos";
export const NO_NAME = "Sin nombre";
export const NO_ASSIGN = "Sin asignar";
