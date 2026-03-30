"use client";

import { CheckSquare, Truck, TrendingUp } from "lucide-react";
import type { CompanyLogistics, CompanyPipeline } from "@/lib/types";
import { ActivityList } from "@/components/shared/activity-list";
import { DeliveryStatus } from "@/components/shared/delivery-status";
import { PipelineFunnel } from "@/components/shared/pipeline-funnel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface TabOperacionesProps {
  logistics: CompanyLogistics | null;
  pipeline: CompanyPipeline | null;
}

export function TabOperaciones({ logistics, pipeline }: TabOperacionesProps) {
  return (
    <div className="space-y-6">
      {/* Logistics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Logistica &amp; Entregas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DeliveryStatus
            pending={logistics?.pending_deliveries ?? []}
            performance={logistics?.delivery_performance ?? null}
            lateCount={logistics?.late_count ?? 0}
          />
        </CardContent>
      </Card>

      {/* Pipeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Pipeline de Ventas (CRM)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineFunnel
            summary={pipeline?.pipeline_summary ?? null}
            leads={pipeline?.leads ?? []}
          />
        </CardContent>
      </Card>

      {/* Odoo Activities */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4" />
            Actividades Pendientes
            {pipeline?.overdue_activities != null && pipeline.overdue_activities > 0 && (
              <Badge variant="critical">{pipeline.overdue_activities} vencidas</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityList activities={pipeline?.activities ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
