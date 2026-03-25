"use client";

import { Badge } from "@/components/ui/badge";
import { AlertCircle, Calendar, User } from "lucide-react";

interface Activity {
  activity_type: string;
  summary: string | null;
  date_deadline: string | null;
  assigned_to: string | null;
  is_overdue: boolean;
  res_model: string;
}

const modelLabels: Record<string, string> = {
  "res.partner": "Contacto",
  "sale.order": "Venta",
  "account.move": "Factura",
  "purchase.order": "Compra",
  "crm.lead": "CRM",
  "stock.picking": "Entrega",
};

export function ActivityList({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-6">
        Sin actividades pendientes
      </div>
    );
  }

  const overdue = activities.filter((a) => a.is_overdue);
  const upcoming = activities.filter((a) => !a.is_overdue);

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5" />
            Vencidas ({overdue.length})
          </h4>
          {overdue.map((a, i) => (
            <ActivityItem key={`o-${i}`} activity={a} />
          ))}
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Proximas ({upcoming.length})
          </h4>
          {upcoming.map((a, i) => (
            <ActivityItem key={`u-${i}`} activity={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        activity.is_overdue ? "border-red-500/30 bg-red-500/5" : ""
      }`}
    >
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <Badge
            variant={activity.is_overdue ? "critical" : "secondary"}
            className="text-xs"
          >
            {activity.activity_type}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {modelLabels[activity.res_model] ?? activity.res_model}
          </Badge>
        </div>
        {activity.summary && (
          <p className="text-sm">{activity.summary}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {activity.date_deadline && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {activity.date_deadline}
            </span>
          )}
          {activity.assigned_to && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {activity.assigned_to}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
