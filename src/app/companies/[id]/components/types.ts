import type {
  Company,
  Contact,
  Fact,
  EntityRelationship,
  Entity,
  Alert,
  ActionItem,
  HealthScore,
  CompanyFinancials,
  CompanyLogistics,
  CompanyPipeline,
} from "@/lib/types";

export interface ResolvedRelationship extends EntityRelationship {
  related_entity: Entity | null;
}

export interface RevenueRow {
  id: number;
  company_id: number;
  total_invoiced: number | null;
  pending_amount: number | null;
  overdue_amount: number | null;
  num_orders: number | null;
  avg_order_value: number | null;
  period_start: string;
  period_type: string | null;
}

export type {
  Company,
  Contact,
  Fact,
  Alert,
  ActionItem,
  HealthScore,
  CompanyFinancials,
  CompanyLogistics,
  CompanyPipeline,
};
