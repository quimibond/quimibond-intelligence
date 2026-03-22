"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import {
  ArrowLeft,
  Building2,
  Globe,
  Factory,
  Clock,
  DollarSign,
  BarChart3,
  Shield,
  Truck,
  Users,
  AlertTriangle,
  Target,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

interface Company {
  id: number;
  name: string;
  canonical_name: string;
  domain: string | null;
  is_customer: boolean;
  is_supplier: boolean;
  industry: string | null;
  lifetime_value: number;
  total_credit_notes: number;
  delivery_otd_rate: number | null;
  credit_limit: number;
  total_pending: number;
  monthly_avg: number;
  trend_pct: number | null;
  created_at: string;
  updated_at: string;
}

interface Contact {
  id: string;
  name: string;
  email: string;
  risk_level: string;
  sentiment_score: number;
  relationship_score: number;
  last_activity: string;
  contact_type: string;
}

interface Alert {
  id: string;
  title: string;
  severity: string;
  state: string;
  created_at: string;
}

interface ActionItem {
  id: string;
  description: string;
  priority: string;
  state: string;
  due_date: string;
}

function getOtdLevel(rate: number | null): "high" | "mid" | "low" {
  if (rate == null) return "mid";
  if (rate >= 90) return "high";
  if (rate >= 70) return "mid";
  return "low";
}

function getCreditUtilLevel(pct: number): "high" | "mid" | "low" {
  if (pct <= 50) return "high";
  if (pct <= 80) return "mid";
  return "low";
}

const riskToBadge: Record<string, "critical" | "high" | "medium" | "low" | "success"> = {
  high: "critical",
  medium: "medium",
  low: "success",
};

export default function CompanyDetailPage() {
  const params = useParams();
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      const companyRes = await supabase
        .from("companies")
        .select("*")
        .eq("id", params.id)
        .single();
      if (!companyRes.data) {
        setLoading(false);
        return;
      }
      setCompany(companyRes.data);

      const contactsRes = await supabase
        .from("contacts")
        .select("*")
        .eq("company_id", params.id)
        .order("last_activity", { ascending: false })
        .limit(20);
      const companyContacts = contactsRes.data || [];
      setContacts(companyContacts);

      if (companyContacts.length > 0) {
        const contactNames = companyContacts
          .map((c) => c.name)
          .filter(Boolean);
        if (contactNames.length > 0) {
          const [alertsRes, actionsRes] = await Promise.all([
            supabase
              .from("alerts")
              .select("*")
              .in("contact_name", contactNames)
              .eq("state", "new")
              .order("created_at", { ascending: false })
              .limit(10),
            supabase
              .from("action_items")
              .select("*")
              .in("contact_name", contactNames)
              .eq("state", "pending")
              .order("created_at", { ascending: false })
              .limit(10),
          ]);
          setAlerts(alertsRes.data || []);
          setActions(actionsRes.data || []);
        }
      }

      setLoading(false);
    }
    fetchAll();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Activity className="h-8 w-8 text-[var(--accent-cyan)] animate-pulse mx-auto mb-3" />
          <div className="text-sm text-[var(--muted-foreground)]">Cargando perfil de empresa...</div>
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--muted-foreground)]">Empresa no encontrada.</p>
        <Link href="/companies">
          <Button variant="ghost" className="mt-4">Volver a empresas</Button>
        </Link>
      </div>
    );
  }

  const trend = company.trend_pct;
  const TrendIcon = trend != null && trend > 0 ? TrendingUp : trend != null && trend < 0 ? TrendingDown : Minus;
  const trendNeon = trend != null && trend > 0 ? "neon-text-green" : trend != null && trend < 0 ? "neon-text-red" : "neon-text-amber";

  const creditUtil = company.credit_limit > 0
    ? Math.round((Number(company.total_pending) / Number(company.credit_limit)) * 100)
    : 0;

  const stats = [
    {
      label: "Valor de Vida",
      value: formatCurrency(Number(company.lifetime_value) || 0),
      icon: DollarSign,
      bar: null,
    },
    {
      label: "Promedio Mensual",
      value: formatCurrency(Number(company.monthly_avg) || 0),
      icon: BarChart3,
      bar: null,
    },
    {
      label: "Pendiente",
      value: formatCurrency(Number(company.total_pending) || 0),
      icon: Clock,
      bar: company.credit_limit > 0 ? { pct: creditUtil, level: getCreditUtilLevel(creditUtil) } : null,
      sub: company.credit_limit > 0 ? `${creditUtil}% del limite` : null,
    },
    {
      label: "Limite de Credito",
      value: formatCurrency(Number(company.credit_limit) || 0),
      icon: Shield,
      bar: null,
    },
    {
      label: "Entrega OTD",
      value: company.delivery_otd_rate != null ? `${Number(company.delivery_otd_rate).toFixed(0)}%` : "—",
      icon: Truck,
      bar: company.delivery_otd_rate != null ? { pct: Number(company.delivery_otd_rate), level: getOtdLevel(company.delivery_otd_rate) } : null,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div className="flex items-center gap-4">
        <Link href="/companies">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Header Banner */}
      <div
        className="game-card rounded-lg p-6"
        style={{
          backgroundColor: "color-mix(in srgb, var(--accent-cyan) 15%, transparent)",
          borderColor: "color-mix(in srgb, var(--accent-cyan) 30%, transparent)",
        }}
      >
        <div className="flex items-start gap-5">
          <div
            className="w-20 h-20 rounded-xl flex items-center justify-center text-2xl font-black shrink-0 border-2"
            style={{
              backgroundColor: "color-mix(in srgb, var(--accent-cyan) 15%, transparent)",
              borderColor: "color-mix(in srgb, var(--accent-cyan) 30%, transparent)",
            }}
          >
            <span style={{ color: "var(--accent-cyan)" }}>
              {company.name.charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-black tracking-tight">{company.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-[var(--muted-foreground)]">
              {company.domain && <span>{company.domain}</span>}
              {company.industry && <span>· {company.industry}</span>}
            </div>
            <div className="flex items-center gap-3 mt-2">
              {company.is_customer && <Badge variant="success">Cliente</Badge>}
              {company.is_supplier && <Badge variant="info">Proveedor</Badge>}
              {trend != null && (
                <span className={cn("flex items-center gap-1 text-xs font-bold", trendNeon)}>
                  <TrendIcon className="h-3.5 w-3.5" />
                  {trend > 0 ? "+" : ""}{Number(trend).toFixed(0)}% tendencia
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {stats.map((stat, i) => (
          <div key={stat.label} className={cn("game-card rounded-lg p-4 bg-[var(--card)] float-in", `float-in-delay-${i + 1}`)}>
            <div className="flex items-center gap-2 mb-3">
              <stat.icon className="h-4 w-4 text-[var(--accent-cyan)]" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {stat.label}
              </span>
            </div>
            <div className="mb-2">
              <span className="text-xl font-black tabular-nums">{stat.value}</span>
            </div>
            {stat.bar && (
              <div className="health-bar-track">
                <div
                  className="health-bar-fill"
                  data-level={stat.bar.level}
                  style={{ width: `${Math.min(100, stat.bar.pct)}%` }}
                />
              </div>
            )}
            {stat.sub && (
              <div className="text-[10px] text-[var(--muted-foreground)] mt-1">{stat.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Financial Summary */}
          <div className="game-card rounded-lg bg-[var(--card)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-[var(--accent-cyan)]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Resumen Financiero
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="rounded-lg bg-[var(--secondary)]/50 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
                  Notas de Credito
                </div>
                <p className="text-sm font-bold tabular-nums">
                  {formatCurrency(Number(company.total_credit_notes) || 0)}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--secondary)]/50 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
                  Tasa de Entrega
                </div>
                <p className="text-sm font-bold tabular-nums">
                  {company.delivery_otd_rate != null ? `${Number(company.delivery_otd_rate).toFixed(1)}%` : "—"}
                </p>
              </div>
              {trend != null && (
                <div className="rounded-lg bg-[var(--secondary)]/50 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
                    Tendencia
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendIcon className="h-4 w-4" style={{ color: trend > 0 ? "var(--success)" : trend < 0 ? "var(--destructive)" : "var(--warning)" }} />
                    <span className="text-sm font-bold tabular-nums">
                      {trend > 0 ? "+" : ""}{Number(trend).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Contacts at this company */}
          <div className="game-card rounded-lg bg-[var(--card)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-[var(--success)]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Contactos en esta Empresa
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">{contacts.length} contactos</span>
            </div>
            {contacts.length > 0 ? (
              <div className="space-y-2">
                {contacts.map((contact) => {
                  const riskVar = contact.risk_level === "high" ? "var(--risk-high)"
                    : contact.risk_level === "medium" ? "var(--risk-medium)" : "var(--risk-low)";
                  const riskMutedVar = contact.risk_level === "high" ? "var(--risk-high-muted)"
                    : contact.risk_level === "medium" ? "var(--risk-medium-muted)" : "var(--risk-low-muted)";

                  return (
                    <Link key={contact.id} href={`/contacts/${contact.id}`}>
                      <div className="flex items-center gap-3 rounded-md bg-[var(--secondary)]/30 p-3 hover:bg-[var(--secondary)]/50 transition-colors cursor-pointer">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ backgroundColor: riskMutedVar, color: riskVar }}
                        >
                          {(contact.name || contact.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold truncate block">{contact.name || contact.email}</span>
                          <span className="text-xs text-[var(--muted-foreground)] truncate block">{contact.email}</span>
                        </div>
                        <Badge variant={riskToBadge[contact.risk_level] || "success"} className="text-[10px] px-1.5 py-0">
                          {contact.risk_level || "low"}
                        </Badge>
                        <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-[var(--muted-foreground)]">
                <Users className="h-6 w-6 mx-auto mb-1 opacity-30" />
                Sin contactos registrados
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Company Info */}
          <div className="game-card rounded-lg bg-[var(--card)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-4 w-4 text-[var(--info)]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Datos de Empresa
              </span>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                <span className="truncate">{company.domain || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Factory className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                <span>{company.industry || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                <span className="text-xs text-[var(--muted-foreground)]">
                  Creado: {company.created_at ? timeAgo(company.created_at) : "—"}
                </span>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              {company.is_customer && <Badge variant="success" className="text-[10px]">Cliente</Badge>}
              {company.is_supplier && <Badge variant="info" className="text-[10px]">Proveedor</Badge>}
            </div>
          </div>

          {/* Alerts */}
          <div className="game-card rounded-lg bg-[var(--card)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Alertas
                </span>
              </div>
              {alerts.length > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--destructive)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--destructive)] animate-pulse" />
                  {alerts.length} activas
                </span>
              )}
            </div>
            {alerts.length > 0 ? (
              <div className="space-y-2">
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    className={cn(
                      "alert-pulse pl-4 py-2 rounded-md",
                      a.severity === "critical" ? "alert-pulse-critical bg-[color-mix(in_srgb,var(--destructive)_5%,transparent)]" :
                      a.severity === "high" ? "alert-pulse-high bg-[color-mix(in_srgb,var(--warning)_5%,transparent)]" :
                      "alert-pulse-medium",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge
                        variant={a.severity === "critical" || a.severity === "high" ? "destructive" : "warning"}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {a.severity}
                      </Badge>
                    </div>
                    <p className="text-sm truncate">{a.title}</p>
                    <span className="text-[10px] text-[var(--muted-foreground)]">{timeAgo(a.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-[var(--muted-foreground)]">
                <Shield className="h-6 w-6 mx-auto mb-1 opacity-30" />
                Sin alertas activas
              </div>
            )}
          </div>

          {/* Actions / Missions */}
          <div className="game-card rounded-lg bg-[var(--card)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[var(--quest-epic)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Misiones
                </span>
              </div>
              {actions.length > 0 && (
                <span className="text-[10px] font-bold text-[var(--quest-epic)]">{actions.length} pendientes</span>
              )}
            </div>
            {actions.length > 0 ? (
              <div className="space-y-2">
                {actions.map((a) => {
                  const isOverdue = a.due_date && new Date(a.due_date) < new Date();
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "rounded-md p-2.5 border",
                        isOverdue ? "border-[color-mix(in_srgb,var(--destructive)_20%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_5%,transparent)]" :
                        a.priority === "high" ? "mission-epic border-[var(--border)]" :
                        a.priority === "medium" ? "mission-rare border-[var(--border)]" :
                        "mission-common border-[var(--border)]",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge
                          variant={a.priority === "high" ? "destructive" : "warning"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {a.priority?.toUpperCase()}
                        </Badge>
                        {isOverdue && <span className="text-[10px] font-bold text-[var(--destructive)]">VENCIDA</span>}
                      </div>
                      <p className="text-sm truncate">{a.description}</p>
                      {a.due_date && (
                        <span className={cn("text-[10px]", isOverdue ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]")}>
                          <Clock className="h-2.5 w-2.5 inline mr-0.5" />
                          {new Date(a.due_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-[var(--muted-foreground)]">
                <Target className="h-6 w-6 mx-auto mb-1 opacity-30" />
                Sin misiones pendientes
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
