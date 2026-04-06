"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, productDisplay } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, DollarSign, ShoppingCart, TrendingDown, TrendingUp } from "lucide-react";

interface CompanyIntelProps {
  companyId: number;
  companyName: string;
}

interface PaymentPred {
  avg_days_to_pay: number;
  median_days_to_pay: number;
  payment_trend: string;
  total_pending: number;
  max_days_overdue: number;
  predicted_payment_date: string;
  payment_risk: string;
  paid_invoices: number;
}

interface ReorderPred {
  avg_cycle_days: number;
  days_since_last: number;
  days_overdue_reorder: number;
  reorder_status: string;
  avg_order_value: number;
  salesperson_name: string;
  top_product_ref: string;
  total_revenue: number;
}

interface Narrative {
  risk_signal: string | null;
  complaints: number;
  recent_complaints: string | null;
  emails_30d: number;
  late_deliveries: number;
  otd_rate: number | null;
}

const RISK_COLORS: Record<string, string> = {
  "CRITICO: excede maximo historico": "text-red-600 bg-red-50 border-red-200",
  "ALTO: fuera de patron normal": "text-orange-600 bg-orange-50 border-orange-200",
  "MEDIO: pasado de promedio": "text-yellow-600 bg-yellow-50 border-yellow-200",
  "NORMAL: dentro de patron": "text-green-600 bg-green-50 border-green-200",
};

const REORDER_COLORS: Record<string, string> = {
  lost: "text-red-600 bg-red-50",
  critical: "text-red-600 bg-red-50",
  at_risk: "text-orange-600 bg-orange-50",
  overdue: "text-yellow-600 bg-yellow-50",
  on_track: "text-green-600 bg-green-50",
};

const REORDER_LABELS: Record<string, string> = {
  lost: "Perdido",
  critical: "Critico",
  at_risk: "En riesgo",
  overdue: "Vencido",
  on_track: "Al dia",
};

export function CompanyIntelCards({ companyId, companyName }: CompanyIntelProps) {
  const [payment, setPayment] = useState<PaymentPred | null>(null);
  const [reorder, setReorder] = useState<ReorderPred | null>(null);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("payment_predictions").select("*").eq("company_id", companyId).limit(1).single(),
      supabase.from("client_reorder_predictions").select("*").eq("company_id", companyId).limit(1).single(),
      supabase.from("company_narrative").select("risk_signal, complaints, recent_complaints, emails_30d, late_deliveries, otd_rate").eq("company_id", companyId).limit(1).single(),
    ]).then(([payRes, reorderRes, narrRes]) => {
      if (payRes.data) setPayment(payRes.data as PaymentPred);
      if (reorderRes.data) setReorder(reorderRes.data as ReorderPred);
      if (narrRes.data) setNarrative(narrRes.data as Narrative);
      setLoading(false);
    });
  }, [companyId]);

  if (loading) return null;
  if (!payment && !reorder && !narrative) return null;

  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {/* Payment Prediction */}
      {payment && (
        <Card className="border-l-4 border-l-domain-finance">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-domain-finance" />
              <CardTitle className="text-sm">Prediccion de Pago</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Promedio</span>
              <span className="text-sm font-bold">{payment.avg_days_to_pay}d</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Pendiente</span>
              <span className="text-sm font-bold">{formatCurrency(payment.total_pending)}</span>
            </div>
            {payment.max_days_overdue > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Max vencido</span>
                <span className="text-sm font-bold text-danger">{payment.max_days_overdue}d</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              {payment.payment_trend === "deteriorando" && <TrendingDown className="h-3.5 w-3.5 text-danger" />}
              {payment.payment_trend === "mejorando" && <TrendingUp className="h-3.5 w-3.5 text-success" />}
              {payment.payment_trend === "estable" && <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="text-xs">{payment.payment_trend}</span>
            </div>
            <Badge className={cn("text-[10px] w-full justify-center", RISK_COLORS[payment.payment_risk] ?? "bg-muted")}>
              {payment.payment_risk.split(":")[0]}
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* Reorder Prediction */}
      {reorder && (
        <Card className="border-l-4 border-l-domain-sales">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-domain-sales" />
              <CardTitle className="text-sm">Prediccion de Reorden</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Ciclo</span>
              <span className="text-sm font-bold">cada {reorder.avg_cycle_days}d</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Sin comprar</span>
              <span className={cn("text-sm font-bold", reorder.days_overdue_reorder > 0 && "text-danger")}>{reorder.days_since_last}d</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Orden promedio</span>
              <span className="text-sm font-bold">{formatCurrency(reorder.avg_order_value)}</span>
            </div>
            {reorder.top_product_ref && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Producto</span>
                <span className="text-xs font-mono">{reorder.top_product_ref}</span>
              </div>
            )}
            {reorder.salesperson_name && (
              <div className="text-xs text-muted-foreground">→ {reorder.salesperson_name}</div>
            )}
            <Badge className={cn("text-[10px] w-full justify-center", REORDER_COLORS[reorder.reorder_status] ?? "bg-muted")}>
              {REORDER_LABELS[reorder.reorder_status] ?? reorder.reorder_status}
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* Risk Signal from Narrative */}
      {narrative?.risk_signal && (
        <Card className="border-l-4 border-l-domain-risk">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-domain-risk" />
              <CardTitle className="text-sm">Señal de Riesgo</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-danger">{narrative.risk_signal}</p>
            {narrative.complaints > 0 && (
              <p className="text-xs text-muted-foreground">
                {narrative.complaints} queja{narrative.complaints !== 1 ? "s" : ""}: "{(narrative.recent_complaints ?? "").slice(0, 100)}"
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {narrative.emails_30d === 0 && <span className="text-danger">0 emails en 30d</span>}
              {narrative.late_deliveries > 0 && <span>{narrative.late_deliveries} entregas tarde</span>}
              {narrative.otd_rate != null && <span>OTD: {narrative.otd_rate}%</span>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
