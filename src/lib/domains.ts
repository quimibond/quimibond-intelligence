/**
 * Centralized agent domain configuration.
 * Single source of truth for icons, colors, and descriptions across the app.
 */
import {
  Bot, Brain, Calculator, Database, DollarSign, Package, Rocket, Server, Shield,
  TrendingUp, Truck, Users, Zap,
} from "lucide-react";

export interface DomainConfig {
  icon: React.ElementType;
  color: string;
  bg: string;
  description: string;
}

export const DOMAIN_CONFIG: Record<string, DomainConfig> = {
  // ── 7 DIRECTORS ──
  comercial: {
    icon: TrendingUp,
    color: "text-domain-sales",
    bg: "bg-domain-sales/10",
    description: "Reorden, oportunidades, margenes, cross-sell",
  },
  financiero: {
    icon: DollarSign,
    color: "text-domain-finance",
    bg: "bg-domain-finance/10",
    description: "Cash flow, prediccion de cobros, cartera vencida",
  },
  operaciones_dir: {
    icon: Truck,
    color: "text-domain-operations",
    bg: "bg-domain-operations/10",
    description: "Entregas, inventario, desabasto, dead stock",
  },
  compras: {
    icon: Package,
    color: "text-warning",
    bg: "bg-warning/10",
    description: "Proveedores, costos MP, proveedor unico",
  },
  riesgo_dir: {
    icon: Shield,
    color: "text-domain-risk",
    bg: "bg-domain-risk/10",
    description: "Churn, concentracion, incumplimientos, quejas",
  },
  costos: {
    icon: Calculator,
    color: "text-warning",
    bg: "bg-warning/10",
    description: "Margen real, price erosion, dead stock value",
  },
  equipo_dir: {
    icon: Users,
    color: "text-domain-relationships",
    bg: "bg-domain-relationships/10",
    description: "Performance vendedores, actividades, accountability",
  },
  // ── LEGACY (kept for old insights display) ──
  sales: { icon: TrendingUp, color: "text-domain-sales", bg: "bg-domain-sales/10", description: "" },
  finance: { icon: DollarSign, color: "text-domain-finance", bg: "bg-domain-finance/10", description: "" },
  operations: { icon: Truck, color: "text-domain-operations", bg: "bg-domain-operations/10", description: "" },
  relationships: { icon: Users, color: "text-domain-relationships", bg: "bg-domain-relationships/10", description: "" },
  risk: { icon: Shield, color: "text-domain-risk", bg: "bg-domain-risk/10", description: "" },
  growth: { icon: Rocket, color: "text-domain-growth", bg: "bg-domain-growth/10", description: "" },
  meta: { icon: Brain, color: "text-domain-meta", bg: "bg-domain-meta/10", description: "" },
  cleanup: { icon: Database, color: "text-info", bg: "bg-info/10", description: "" },
  suppliers: { icon: Package, color: "text-warning", bg: "bg-warning/10", description: "" },
  predictive: { icon: Brain, color: "text-domain-meta", bg: "bg-domain-meta/10", description: "" },
  data_quality: { icon: Database, color: "text-info", bg: "bg-info/10", description: "" },
  odoo: { icon: Server, color: "text-warning", bg: "bg-warning/10", description: "" },
};

const DEFAULT_CONFIG: DomainConfig = {
  icon: Bot,
  color: "text-muted-foreground",
  bg: "bg-muted",
  description: "",
};

export function getDomainConfig(domain: string): DomainConfig {
  return DOMAIN_CONFIG[domain] ?? DEFAULT_CONFIG;
}
