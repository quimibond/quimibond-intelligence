/**
 * Centralized agent domain configuration.
 * Single source of truth for icons, colors, and descriptions across the app.
 */
import {
  Bot, Brain, Database, DollarSign, Rocket, Server, Shield,
  TrendingUp, Truck, Users, Zap,
} from "lucide-react";

export interface DomainConfig {
  icon: React.ElementType;
  color: string;
  bg: string;
  description: string;
}

export const DOMAIN_CONFIG: Record<string, DomainConfig> = {
  sales: {
    icon: TrendingUp,
    color: "text-domain-sales",
    bg: "bg-domain-sales/10",
    description: "Ordenes, CRM, top clientes, oportunidades",
  },
  finance: {
    icon: DollarSign,
    color: "text-domain-finance",
    bg: "bg-domain-finance/10",
    description: "Facturas, cartera vencida, cash flow",
  },
  operations: {
    icon: Truck,
    color: "text-domain-operations",
    bg: "bg-domain-operations/10",
    description: "Entregas, inventario, manufactura",
  },
  relationships: {
    icon: Users,
    color: "text-domain-relationships",
    bg: "bg-domain-relationships/10",
    description: "Health scores, threads, sentimiento",
  },
  risk: {
    icon: Shield,
    color: "text-domain-risk",
    bg: "bg-domain-risk/10",
    description: "Facturas vencidas, entregas atrasadas, contactos criticos",
  },
  growth: {
    icon: Rocket,
    color: "text-domain-growth",
    bg: "bg-domain-growth/10",
    description: "Top clientes, tendencias, cross-sell",
  },
  meta: {
    icon: Brain,
    color: "text-domain-meta",
    bg: "bg-domain-meta/10",
    description: "Evalua rendimiento de otros agentes",
  },
  data_quality: {
    icon: Database,
    color: "text-info",
    bg: "bg-info/10",
    description: "Datos faltantes, links rotos, metricas",
  },
  odoo: {
    icon: Server,
    color: "text-warning",
    bg: "bg-warning/10",
    description: "Gaps en sync, modelos faltantes",
  },
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
