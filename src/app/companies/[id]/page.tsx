"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertCircle,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  ExternalLink,
  Zap,
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
  contact_name: string;
  created_at: string;
}

interface ActionItem {
  id: string;
  description: string;
  priority: string;
  state: string;
  contact_name: string;
  due_date: string;
}

function getOtdLevel(rate: number | null): "high" | "mid" | "low" {
  if (rate == null) return "mid";
  if (rate >= 90) return "high";
  if (rate >= 70) return "mid";
  return "low";
}

function getHealthLevel(score: number): "high" | "mid" | "low" {
  if (score >= 70) return "high";
  if (score >= 40) return "mid";
  return "low";
}

function HealthBar({ score, className = "" }: { score: number; className?: string }) {
  const level = getHealthLevel(score);
  return (
    <div className={cn("health-bar-track h-2 bg-muted rounded-full overflow-hidden", className)}>
      <div
        className="health-bar-fill h-full transition-all duration-300"
        data-level={level}
        style={{ width: `${score}%`, backgroundColor: `var(--health-${level})` }}
      />
    </div>
  );
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const variant = score >= 70 ? "success" : score >= 40 ? "warning" : "critical";
  return (
    <Badge variant={variant} className="font-bold text-sm">
      {label}
    </Badge>
  );
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
        const contactNames = companyContacts.map((c) => c.name).filter(Boolean);
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
      <div className="max-w-7xl mx-auto space-y-8">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-5">
              <Skeleton className="w-16 h-16 rounded-full" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-6 w-20" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="max-w-7xl mx-auto text-center py-12">
        <Building2 className="w-12 h-12 text-[var(--muted-foreground)] mx-auto mb-4 opacity-50" />
        <p className="text-[var(--muted-foreground)] font-medium">Empresa no encontrada.</p>
        <Link href="/companies">
          <Button variant="ghost" className="mt-4">Volver a empresas</Button>
        </Link>
      </div>
    );
  }

  const trend = company.trend_pct;
  const TrendIcon = trend != null && trend > 0 ? TrendingUp : trend != null && trend < 0 ? TrendingDown : Minus;
  const trendVariant = trend != null && trend > 0 ? "success" : trend != null && trend < 0 ? "critical" : "warning";

  const creditUtil = Number(company.credit_limit) > 0
    ? Math.round((Number(company.total_pending) / Number(company.credit_limit)) * 100)
    : 0;
  const creditLevel = creditUtil <= 50 ? "high" : creditUtil <= 80 ? "mid" : "low";

  const otdRate = company.delivery_otd_rate != null ? Number(company.delivery_otd_rate) : null;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Back button */}
      <div className="opacity-0 animate-in fade-in slide-in-from-bottom-4">
        <Link href="/companies">
          <Button variant="ghost" size="sm" className="text-xs gap-1">
            <ArrowLeft className="h-4 w-4" />
            Empresas
          </Button>
        </Link>
      </div>

      {/* Header Card */}
      <Card className="game-card opacity-0 animate-in fade-in slide-in-from-bottom-4">
        <CardContent className="p-6">
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-black shrink-0 text-white bg-[var(--primary)]">
              {company.name.charAt(0).toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold text-[var(--foreground)] truncate">
                    {company.name}
                  </h1>
                  <div className="flex items-center gap-3 mt-1 text-sm text-[var(--muted-foreground)]">
                    {company.domain && (
                      <span className="flex items-center gap-1">
                        <Globe className="h-3.5 w-3.5" />
                        {company.domain}
                      </span>
                    )}
                    {company.industry && (
                      <span className="flex items-center gap-1">
                        <Factory className="h-3.5 w-3.5" />
                        {company.industry}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {company.is_customer && <Badge variant="success" className="text-xs font-medium">Cliente</Badge>}
                  {company.is_supplier && <Badge variant="info" className="text-xs font-medium">Proveedor</Badge>}
                </div>
              </div>

              {/* Trend + Key Metric */}
              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted-foreground)]">Valor de Vida</span>
                  <span className="text-lg font-bold tabular-nums text-[var(--success)]">
                    {formatCurrency(Number(company.lifetime_value) || 0)}
                  </span>
                </div>
                {trend != null && (
                  <div className="flex items-center gap-1.5">
                    <TrendIcon className={cn(
                      "h-4 w-4",
                      trend > 0 ? "text-[var(--success)]" :
                      trend < 0 ? "text-[var(--severity-critical)]" :
                      "text-[var(--muted-foreground)]",
                    )} />
                    <Badge variant={trendVariant} className="font-bold">
                      {trend > 0 ? "+" : ""}{Number(trend).toFixed(0)}%
                    </Badge>
                  </div>
                )}
                {alerts.length > 0 && (
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--severity-critical)] animate-pulse" />
                    <span className="text-xs font-bold text-[var(--severity-critical)]">
                      {alerts.length} alertas activas
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="game-card opacity-0 animate-in fade-in slide-in-from-bottom-4" style={{ animationDelay: "50ms", animationFillMode: "forwards" }}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--muted-foreground)]">Promedio Mensual</p>
                <p className="text-2xl font-bold tabular-nums">{formatCurrency(Number(company.monthly_avg) || 0)}</p>
              </div>
              <BarChart3 className="h-6 w-6 text-[var(--muted-foreground)]" />
            </div>
          </CardContent>
        </Card>

        <Card className="game-card opacity-0 animate-in fade-in slide-in-from-bottom-4" style={{ animationDelay: "100ms", animationFillMode: "forwards" }}>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-[var(--muted-foreground)]">Pendiente</p>
                <Clock className="h-6 w-6 text-[var(--muted-foreground)]" />
              </div>
              <p className={cn(
                "text-2xl font-bold tabular-nums",
                creditUtil > 80 && "text-[var(--severity-critical)]",
              )}>
                {formatCurrency(Number(company.total_pending) || 0)}
              </p>
              {Number(company.credit_limit) > 0 && (
                <div className="space-y-1">
                  <HealthBar score={Math.min(100, creditUtil)} className="h-1.5" />
                  <p className="text-xs text-[var(--muted-foreground)]">{creditUtil}% del límite</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="game-card opacity-0 animate-in fade-in slide-in-from-bottom-4" style={{ animationDelay: "150ms", animationFillMode: "forwards" }}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--muted-foreground)]">Límite de Crédito</p>
                <p className="text-2xl font-bold tabular-nums">{formatCurrency(Number(company.credit_limit) || 0)}</p>
              </div>
              <Shield className="h-6 w-6 text-[var(--muted-foreground)]" />
            </div>
          </CardContent>
        </Card>

        <Card className="game-card opacity-0 animate-in fade-in slide-in-from-bottom-4" style={{ animationDelay: "200ms", animationFillMode: "forwards" }}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--muted-foreground)]">Notas de Crédito</p>
                <p className="text-2xl font-bold tabular-nums">{formatCurrency(Number(company.total_credit_notes) || 0)}</p>
              </div>
              <DollarSign className="h-6 w-6 text-[var(--muted-foreground)]" />
            </div>
          </CardContent>
        </Card>

        <Card className="game-card opacity-0 animate-in fade-in slide-in-from-bottom-4" style={{ animationDelay: "250ms", animationFillMode: "forwards" }}>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-[var(--muted-foreground)]">Entrega OTD</p>
                <Truck className="h-6 w-6 text-[var(--muted-foreground)]" />
              </div>
              <p className={cn(
                "text-2xl font-bold tabular-nums",
                otdRate != null && otdRate >= 90 ? "text-[var(--success)]" :
                otdRate != null && otdRate >= 70 ? "text-[var(--warning)]" :
                otdRate != null ? "text-[var(--severity-critical)]" : "",
              )}>
                {otdRate != null ? `${otdRate.toFixed(0)}%` : "—"}
              </p>
              {otdRate != null && (
                <HealthBar score={otdRate} className="h-1.5" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contacts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--success)]" />
                <span className="uppercase tracking-wider">Contactos</span>
                <Badge variant="outline" className="ml-2 text-xs">{contacts.length}</Badge>
                <Link href="/contacts" className="ml-auto">
                  <Button variant="ghost" size="sm" className="text-xs gap-1">
                    Ver todos <ExternalLink className="h-3 w-3" />
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {contacts.length > 0 ? (
                contacts.map((contact, index) => {
                  const riskVar = contact.risk_level === "high" ? "var(--severity-critical)"
                    : contact.risk_level === "medium" ? "var(--warning)" : "var(--success)";
                  const avatarBg = contact.risk_level === "high" ? "bg-[var(--severity-critical)]"
                    : contact.risk_level === "medium" ? "bg-[var(--warning)]" : "bg-[var(--success)]";

                  const health = Math.max(0, Math.min(100, Math.round(
                    (((contact.sentiment_score ?? 0) + 1) / 2) * 50 +
                    ((contact.relationship_score ?? 50) / 100) * 50
                  )));

                  return (
                    <Link key={contact.id} href={`/contacts/${contact.id}`}>
                      <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-3 hover:border-[var(--primary)] transition-all cursor-pointer">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white",
                          avatarBg,
                        )}>
                          {(contact.name || contact.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold truncate">{contact.name || contact.email}</h4>
                          <p className="text-xs text-[var(--muted-foreground)] truncate">{contact.email}</p>
                        </div>
                        <div className="hidden sm:block w-24">
                          <HealthBar score={health} className="h-1" />
                        </div>
                        <Badge variant={riskToBadge[contact.risk_level] || "success"} className="text-[10px] shrink-0">
                          {contact.risk_level || "low"}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="text-center py-8">
                  <Users className="w-10 h-10 text-[var(--muted-foreground)] mx-auto mb-3 opacity-40" />
                  <p className="text-sm text-[var(--muted-foreground)]">Sin contactos registrados</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Company Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-[var(--primary)]" />
                <span className="uppercase tracking-wider">Datos de Empresa</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[var(--muted-foreground)]">
                    <Globe className="h-3.5 w-3.5" />
                    Dominio
                  </span>
                  <span className="font-medium truncate ml-4">{company.domain || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[var(--muted-foreground)]">
                    <Factory className="h-3.5 w-3.5" />
                    Industria
                  </span>
                  <span className="font-medium">{company.industry || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[var(--muted-foreground)]">
                    <Clock className="h-3.5 w-3.5" />
                    Registrada
                  </span>
                  <span className="font-medium">{company.created_at ? timeAgo(company.created_at) : "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[var(--muted-foreground)]">
                    <Users className="h-3.5 w-3.5" />
                    Contactos
                  </span>
                  <span className="font-medium">{contacts.length}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--border)]">
                {company.is_customer && <Badge variant="success" className="text-xs">Cliente</Badge>}
                {company.is_supplier && <Badge variant="info" className="text-xs">Proveedor</Badge>}
                {!company.is_customer && !company.is_supplier && (
                  <span className="text-xs text-[var(--muted-foreground)]">Sin clasificar</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Alerts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
                <span className="uppercase tracking-wider">Alertas</span>
                {alerts.length > 0 && (
                  <span className="flex items-center gap-1 ml-auto text-[10px] font-bold text-[var(--severity-critical)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--severity-critical)] animate-pulse" />
                    {alerts.length} activas
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alerts.length > 0 ? (
                <div className="space-y-2">
                  {alerts.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-3 space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={a.severity === "critical" || a.severity === "high" ? "critical" : "warning"}
                            className="text-[10px] shrink-0"
                          >
                            {a.severity}
                          </Badge>
                          <span className="text-sm font-medium truncate">{a.title}</span>
                        </div>
                        <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">
                          {timeAgo(a.created_at)}
                        </span>
                      </div>
                      {a.contact_name && (
                        <p className="text-xs text-[var(--muted-foreground)]">
                          <span className="font-medium text-[var(--foreground)]">Contacto:</span> {a.contact_name}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <Shield className="w-8 h-8 text-[var(--muted-foreground)] mx-auto mb-2 opacity-40" />
                  <p className="text-sm text-[var(--muted-foreground)]">Sin alertas activas</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Missions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[var(--quest-epic)]" />
                <span className="uppercase tracking-wider">Misiones</span>
                {actions.length > 0 && (
                  <span className="text-[10px] font-bold text-[var(--quest-epic)] ml-auto">
                    {actions.length} pendientes
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {actions.length > 0 ? (
                <div className="space-y-2">
                  {actions.map((a) => {
                    const isOverdue = a.due_date && new Date(a.due_date) < new Date();
                    return (
                      <div
                        key={a.id}
                        className={cn(
                          "rounded-lg border p-3 space-y-1",
                          isOverdue
                            ? "border-[color-mix(in_srgb,var(--severity-critical)_30%,var(--border))] bg-[color-mix(in_srgb,var(--severity-critical)_5%,transparent)]"
                            : "border-[var(--border)] bg-[var(--secondary)]",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={a.priority === "high" ? "critical" : a.priority === "medium" ? "warning" : "info"}
                            className="text-[10px] shrink-0"
                          >
                            {a.priority?.toUpperCase()}
                          </Badge>
                          {isOverdue && (
                            <Badge variant="critical" className="text-[10px]">
                              <AlertCircle className="w-3 h-3 mr-0.5 inline" />
                              VENCIDA
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm truncate">{a.description}</p>
                        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                          {a.contact_name && <span>{a.contact_name}</span>}
                          {a.due_date && (
                            <span className={cn(isOverdue && "text-[var(--severity-critical)]")}>
                              <Clock className="h-2.5 w-2.5 inline mr-0.5" />
                              {new Date(a.due_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6">
                  <Target className="w-8 h-8 text-[var(--muted-foreground)] mx-auto mb-2 opacity-40" />
                  <p className="text-sm text-[var(--muted-foreground)]">Sin misiones pendientes</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
