"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Brain, DollarSign, FileText, Lightbulb, Mail, Package,
  TrendingUp, Truck,
} from "lucide-react";
import type {
  AgentInsight, AIAgent, Email, Fact,
  OdooInvoice, OdooDelivery, OdooOrderLine, OdooCrmLead,
} from "@/lib/types";
import { cn, formatCurrency, formatDate, timeAgo, productDisplay } from "@/lib/utils";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

// Partial picks for the queries we run — we only select specific columns
type EmailRow = Pick<Email, "id" | "sender" | "recipient" | "subject" | "email_date" | "snippet" | "sender_type">;
type InvoiceRow = Pick<OdooInvoice, "name" | "move_type" | "amount_total" | "amount_residual" | "invoice_date" | "due_date" | "state" | "payment_state" | "days_overdue">;
type DeliveryRow = Pick<OdooDelivery, "name" | "origin" | "scheduled_date" | "date_done" | "state" | "is_late" | "lead_time_days">;
type OrderRow = Pick<OdooOrderLine, "order_name" | "product_name" | "qty" | "subtotal" | "order_date" | "order_state"> & { product_ref?: string | null };
type LeadRow = Pick<OdooCrmLead, "name" | "stage" | "expected_revenue" | "probability" | "days_open">;
type FactRow = Pick<Fact, "id" | "fact_type" | "fact_text" | "confidence" | "fact_date">;
type RelatedInsightRow = Pick<AgentInsight, "id" | "title" | "severity" | "state" | "agent_id" | "created_at">;

interface OdooData {
  invoices: InvoiceRow[];
  deliveries: DeliveryRow[];
  orders: OrderRow[];
  leads: LeadRow[];
}

interface InsightContextProps {
  insight: AgentInsight;
  agent: AIAgent | null;
  companyId: number | null;
  companyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  entityId: number | null;
}

/** Helper to wrap Supabase PromiseLike into real Promise */
function wrap<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.resolve(p);
}

export function InsightContext({
  insight, agent, companyId, companyName, contactName, contactEmail, entityId,
}: InsightContextProps) {
  const [relatedEmails, setRelatedEmails] = useState<EmailRow[]>([]);
  const [relatedFacts, setRelatedFacts] = useState<FactRow[]>([]);
  const [relatedInsights, setRelatedInsights] = useState<RelatedInsightRow[]>([]);
  const [odooData, setOdooData] = useState<OdooData>({ invoices: [], deliveries: [], orders: [], leads: [] });

  useEffect(() => {
    const domain = agent?.domain ?? "";
    const promises: Promise<void>[] = [];

    // ── Emails related to this insight ──
    const searchTerm = companyName ?? contactName ?? contactEmail;
    if (searchTerm) {
      promises.push(wrap(
        supabase
          .from("emails")
          .select("id, sender, recipient, subject, email_date, snippet, sender_type")
          .or(`subject.ilike.%${searchTerm}%,sender.ilike.%${searchTerm}%`)
          .order("email_date", { ascending: false })
          .limit(5)
      ).then(({ data }) => { if (data?.length) setRelatedEmails(data as EmailRow[]); }));
    } else if (companyId) {
      promises.push(wrap(
        supabase
          .from("emails")
          .select("id, sender, recipient, subject, email_date, snippet, sender_type")
          .eq("company_id", companyId)
          .order("email_date", { ascending: false })
          .limit(5)
      ).then(({ data }) => { if (data?.length) setRelatedEmails(data as EmailRow[]); }));
    }

    // ── Odoo data based on agent domain ──
    // Directores activos (slug en DB): comercial, financiero, compras, costos,
    // operaciones (domain=operaciones_dir), riesgo (domain=riesgo_dir),
    // equipo (domain=equipo_dir). Mantengo los slugs legacy (finance, sales, etc)
    // para que los insights historicos sigan mostrando contexto.
    if (companyId) {
      const isFinance = domain === "financiero" || domain === "finance" ||
        domain === "riesgo_dir" || domain === "risk" || domain === "costos";
      const isOps = domain === "operaciones_dir" || domain === "operations";
      const isSales = domain === "comercial" || domain === "sales" || domain === "growth";
      const isPurchases = domain === "compras";

      if (isFinance) {
        promises.push(wrap(
          supabase
            .from("odoo_invoices")
            .select("name, move_type, amount_total, amount_residual, invoice_date, due_date, state, payment_state, days_overdue")
            .eq("company_id", companyId)
            .eq("move_type", "out_invoice")
            .order("invoice_date", { ascending: false })
            .limit(5)
        ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, invoices: data as InvoiceRow[] })); }));
      }
      if (isOps) {
        promises.push(wrap(
          supabase
            .from("odoo_deliveries")
            .select("name, origin, scheduled_date, date_done, state, is_late, lead_time_days")
            .eq("company_id", companyId)
            .order("scheduled_date", { ascending: false })
            .limit(5)
        ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, deliveries: data as DeliveryRow[] })); }));
      }
      if (isSales) {
        promises.push(wrap(
          supabase
            .from("odoo_order_lines")
            .select("order_name, product_name, product_ref, qty, subtotal, order_date, order_state")
            .eq("company_id", companyId)
            .eq("order_type", "sale")
            .order("order_date", { ascending: false })
            .limit(5)
        ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, orders: data as OrderRow[] })); }));
        promises.push(wrap(
          supabase
            .from("odoo_crm_leads")
            .select("name, stage, expected_revenue, probability, days_open")
            .eq("company_id", companyId)
            .eq("active", true)
            .limit(5)
        ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, leads: data as LeadRow[] })); }));
      }
      if (isPurchases) {
        // Para compras: mostrar ordenes de compra recientes (order_type=purchase)
        // + facturas de proveedor (in_invoice).
        promises.push(wrap(
          supabase
            .from("odoo_order_lines")
            .select("order_name, product_name, product_ref, qty, subtotal, order_date, order_state")
            .eq("company_id", companyId)
            .eq("order_type", "purchase")
            .order("order_date", { ascending: false })
            .limit(5)
        ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, orders: data as OrderRow[] })); }));
        promises.push(wrap(
          supabase
            .from("odoo_invoices")
            .select("name, move_type, amount_total, amount_residual, invoice_date, due_date, state, payment_state, days_overdue")
            .eq("company_id", companyId)
            .eq("move_type", "in_invoice")
            .order("invoice_date", { ascending: false })
            .limit(5)
        ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, invoices: data as InvoiceRow[] })); }));
      }

      // Related insights from same company
      promises.push(wrap(
        supabase
          .from("agent_insights")
          .select("id, title, severity, state, agent_id, created_at")
          .eq("company_id", companyId)
          .neq("id", insight.id)
          .in("state", ["new", "seen", "acted_on"])
          .order("created_at", { ascending: false })
          .limit(4)
      ).then(({ data }) => { if (data) setRelatedInsights(data as RelatedInsightRow[]); }));
    }

    // ── Knowledge graph facts ──
    if (entityId) {
      promises.push(wrap(
        supabase
          .from("facts")
          .select("id, fact_type, fact_text, confidence, fact_date")
          .eq("entity_id", entityId)
          .order("created_at", { ascending: false })
          .limit(5)
      ).then(({ data }) => { if (data) setRelatedFacts(data as FactRow[]); }));
    }

    Promise.all(promises).catch(err => console.error("[insight-context] fetch error:", err));
  }, [insight.id, agent?.domain, companyId, companyName, contactName, contactEmail, entityId]);

  const hasOdooData = odooData.invoices.length > 0 || odooData.deliveries.length > 0 || odooData.orders.length > 0 || odooData.leads.length > 0;
  const hasAnyContext = hasOdooData || relatedEmails.length > 0 || relatedFacts.length > 0 || relatedInsights.length > 0;

  if (!hasAnyContext) return null;

  return (
    <>
      {/* ── Odoo data context ── */}
      {hasOdooData && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-warning" />
              <CardTitle className="text-sm">Datos de Odoo</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Invoices */}
            {odooData.invoices.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Facturas recientes
                </p>
                <div className="space-y-1">
                  {odooData.invoices.map((inv, i) => (
                    <div key={i} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{inv.name}</span>
                        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{formatDate(inv.invoice_date)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="font-medium tabular-nums">{formatCurrency(inv.amount_total)}</span>
                        {inv.days_overdue > 0 ? (
                          <Badge variant="critical" className="text-[10px]">{inv.days_overdue}d vencida</Badge>
                        ) : inv.payment_state === "paid" ? (
                          <Badge variant="success" className="text-[10px]">Pagada</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">{formatCurrency(inv.amount_residual)} pend.</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Deliveries */}
            {odooData.deliveries.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Truck className="h-3 w-3" /> Entregas recientes
                </p>
                <div className="space-y-1">
                  {odooData.deliveries.map((del, i) => (
                    <div key={i} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
                      <div className="min-w-0">
                        <span className="font-medium">{del.name}</span>
                        {del.origin && <span className="text-xs text-muted-foreground ml-1 hidden sm:inline">({del.origin})</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-muted-foreground">{formatDate(del.scheduled_date)}</span>
                        {del.is_late ? (
                          <Badge variant="critical" className="text-[10px]">Atrasada</Badge>
                        ) : del.state === "done" ? (
                          <Badge variant="success" className="text-[10px]">Entregada</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">{del.state}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Orders */}
            {odooData.orders.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Ordenes recientes
                </p>
                <div className="space-y-1">
                  {odooData.orders.map((ord, i) => (
                    <div key={i} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{ord.order_name}</span>
                        <span className="text-xs text-muted-foreground ml-1 block sm:inline sm:ml-2 truncate">{productDisplay(ord)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="font-medium tabular-nums">{formatCurrency(ord.subtotal)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CRM Leads */}
            {odooData.leads.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Pipeline
                </p>
                <div className="space-y-1">
                  {odooData.leads.map((lead, i) => (
                    <div key={i} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium truncate">{lead.name}</span>
                        {lead.stage && <Badge variant="outline" className="text-[10px] ml-2">{lead.stage}</Badge>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {lead.expected_revenue > 0 && <span className="font-medium tabular-nums">{formatCurrency(lead.expected_revenue)}</span>}
                        <span className="text-xs text-muted-foreground">{lead.probability}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Related emails ── */}
      {relatedEmails.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-info" />
              <CardTitle className="text-sm">Emails Relacionados</CardTitle>
              <Badge variant="outline" className="text-[10px] ml-auto">{relatedEmails.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {relatedEmails.map((email) => (
              <Link
                key={email.id}
                href={`/emails/${email.id}`}
                className="flex items-start gap-3 rounded-lg p-2 md:p-2.5 hover:bg-muted/50 transition-colors"
              >
                <Mail className={cn("h-4 w-4 mt-0.5 shrink-0", email.sender_type === "external" ? "text-info" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{email.subject ?? "(sin asunto)"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {email.sender?.replace(/<[^>]+>/, "").trim()}
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(email.email_date)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Knowledge graph facts ── */}
      {relatedFacts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-domain-relationships" />
              <CardTitle className="text-sm">Knowledge Graph</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {relatedFacts.map((fact) => (
              <div key={fact.id} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground/50 mt-0.5 shrink-0">&bull;</span>
                <div className="min-w-0">
                  <p className="break-words">{fact.fact_text}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {fact.fact_type} &middot; {(fact.confidence * 100).toFixed(0)}%
                    {fact.fact_date && ` \u00b7 ${fact.fact_date}`}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Related insights ── */}
      {relatedInsights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-warning" />
              <CardTitle className="text-sm">Otros Insights de {companyName ?? "esta empresa"}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {relatedInsights.map((ri) => (
              <Link
                key={ri.id}
                href={`/inbox/insight/${ri.id}`}
                className="flex items-center gap-3 rounded-lg p-2 md:p-2.5 hover:bg-muted/50 transition-colors"
              >
                {ri.severity && <SeverityBadge severity={ri.severity} />}
                <span className="text-sm truncate flex-1 min-w-0">{ri.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(ri.created_at)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
