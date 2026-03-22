"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Mail,
  AlertTriangle,
  Target,
  Brain,
  Shield,
  Zap,
  Heart,
  Swords,
  Crown,
  MessageCircle,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
  Clock,
  Phone,
  MapPin,
  Globe,
  BookOpen,
  Activity,
  HeartPulse,
  BarChart3,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";

interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  contact_type: string;
  department: string;
  risk_level: string;
  sentiment_score: number;
  relationship_score: number;
  last_activity: string;
  total_sent: number;
  total_received: number;
  score_breakdown: Record<string, number> | null;
  odoo_partner_id: number | null;
  is_customer: boolean;
  is_supplier: boolean;
  notes: string;
  avg_response_time_hours: number | null;
}

interface PersonProfile {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  department: string;
  decision_power: string;
  communication_style: string;
  negotiation_style: string;
  response_pattern: string;
  key_interests: string[];
  personality_notes: string;
  influence_on_deals: string;
}

interface Alert {
  id: string;
  title: string;
  severity: string;
  state: string;
  alert_type: string;
  created_at: string;
}

interface ActionItem {
  id: string;
  description: string;
  priority: string;
  state: string;
  action_type: string;
  due_date: string;
}

interface Fact {
  id: string;
  fact_text: string;
  fact_type: string;
  confidence: number;
  created_at: string;
}

interface CommunicationPattern {
  id: string;
  pattern_type: string;
  description: string;
  frequency: string;
  confidence: number;
}

interface HealthScore {
  overall_score: number;
  previous_score: number | null;
  trend: string;
  communication_score: number;
  financial_score: number;
  sentiment_score: number;
  responsiveness_score: number;
  engagement_score: number;
  risk_signals: string[];
  opportunity_signals: string[];
}

/** Returns a CSS variable name for stat value coloring */
function getStatCssVar(value: number): string {
  if (value >= 0.5) return "--success";
  if (value >= 0) return "--accent-cyan";
  if (value >= -0.3) return "--warning";
  return "--destructive";
}

/** Returns health level for bar data-level attribute */
function getHealthLevel(value: number): "high" | "mid" | "low" {
  if (value >= 70) return "high";
  if (value >= 40) return "mid";
  return "low";
}

function getRiskConfig(risk: string) {
  switch (risk) {
    case "high": return { cssVar: "--risk-high", label: "ALTO RIESGO", neon: "neon-text-red" };
    case "medium": return { cssVar: "--risk-medium", label: "RIESGO MEDIO", neon: "neon-text-amber" };
    default: return { cssVar: "--risk-low", label: "BAJO RIESGO", neon: "neon-text-green" };
  }
}

function getDecisionPowerConfig(power: string) {
  switch (power?.toLowerCase()) {
    case "high": case "alto": return { label: "Decisor", cssVar: "--role-decisor", icon: Crown };
    case "medium": case "medio": return { label: "Influenciador", cssVar: "--role-influencer", icon: Zap };
    default: return { label: "Contacto", cssVar: "--role-contact", icon: MessageCircle };
  }
}

export default function ContactDetailPage() {
  const params = useParams();
  const [contact, setContact] = useState<Contact | null>(null);
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [patterns, setPatterns] = useState<CommunicationPattern[]>([]);
  const [healthScore, setHealthScore] = useState<HealthScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      // First get the contact to know their name and email
      const contactRes = await supabase.from("contacts").select("*").eq("id", params.id).single();
      if (!contactRes.data) {
        setLoading(false);
        return;
      }
      setContact(contactRes.data);
      const contactName = contactRes.data.name;
      const contactEmail = contactRes.data.email;

      // Use name/email to query related tables (no FK joins available)
      const [profileRes, alertsRes, actionsRes, factsRes] = await Promise.all([
        supabase.from("person_profiles").select("*").eq("email", contactEmail).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("alerts").select("*").eq("contact_name", contactName).order("created_at", { ascending: false }).limit(10),
        supabase.from("action_items").select("*").eq("contact_name", contactName).order("created_at", { ascending: false }).limit(10),
        // Facts are linked via entities, not contacts — search by entity name
        supabase.rpc("get_contact_intelligence", { p_contact_email: contactEmail }),
      ]);

      setProfile(profileRes.data);
      setAlerts(alertsRes.data || []);
      setActions(actionsRes.data || []);

      // Extract facts from RPC if available
      const intel = factsRes.data as Record<string, unknown> | null;
      if (intel) {
        // RPC doesn't return facts directly, but we can query entities
        const entityRes = await supabase.from("entities").select("id").ilike("email", `%${contactEmail}%`).limit(1);
        if (entityRes.data?.length) {
          const entityFactsRes = await supabase.from("facts").select("*").eq("entity_id", entityRes.data[0].id).order("created_at", { ascending: false }).limit(15);
          setFacts(entityFactsRes.data || []);
        }
      }

      // Fetch real health score from customer_health_scores
      const healthRes = await supabase
        .from("customer_health_scores")
        .select("*")
        .eq("contact_email", contactEmail)
        .order("score_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (healthRes.data) {
        setHealthScore(healthRes.data);
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
          <div className="text-sm text-[var(--muted-foreground)]">Cargando perfil de agente...</div>
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--muted-foreground)]">Contacto no encontrado.</p>
        <Link href="/contacts">
          <Button variant="ghost" className="mt-4">Volver a contactos</Button>
        </Link>
      </div>
    );
  }

  const riskConfig = getRiskConfig(contact.risk_level);
  const decisionConfig = profile ? getDecisionPowerConfig(profile.decision_power) : null;
  const DecisionIcon = decisionConfig?.icon || MessageCircle;

  // Use real health score if available, else fallback to calculated
  const sentiment = contact.sentiment_score ?? 0;
  const relationship = contact.relationship_score ?? 50;
  const fallbackHealth = Math.max(0, Math.min(100, Math.round(((sentiment + 1) / 2) * 50 + (relationship / 100) * 50)));
  const healthClamped = healthScore ? Math.round(Number(healthScore.overall_score)) : fallbackHealth;

  // RPG-style stats using real health components if available
  const stats = healthScore ? [
    { label: "Comunicacion", value: Math.round(Number(healthScore.communication_score)), icon: MessageCircle, raw: `${(contact.total_sent || 0) + (contact.total_received || 0)} emails` },
    { label: "Financiero", value: Math.round(Number(healthScore.financial_score)), icon: BarChart3, raw: "facturacion" },
    { label: "Sentimiento", value: Math.round(Number(healthScore.sentiment_score)), icon: Heart, raw: sentiment.toFixed(2) },
    { label: "Responsividad", value: Math.round(Number(healthScore.responsiveness_score)), icon: Zap, raw: contact.avg_response_time_hours ? `${Number(contact.avg_response_time_hours).toFixed(0)}h avg` : "—" },
    { label: "Engagement", value: Math.round(Number(healthScore.engagement_score)), icon: Shield, raw: "KG data" },
  ] : [
    { label: "Sentimiento", value: Math.round(((sentiment + 1) / 2) * 100), icon: Heart, raw: sentiment.toFixed(2) },
    { label: "Relacion", value: Math.round(relationship), icon: Swords, raw: relationship.toFixed(0) },
    { label: "Actividad", value: Math.min(100, Math.round(((contact.total_sent || 0) + (contact.total_received || 0) / 50) * 100)), icon: Zap, raw: `${(contact.total_sent || 0) + (contact.total_received || 0)} emails` },
    { label: "Lealtad", value: fallbackHealth, icon: Shield, raw: `${fallbackHealth}%` },
  ];

  // Trend from real health score
  const trendConfig = healthScore?.trend === "improving"
    ? { icon: TrendingUp, label: "Mejorando", neon: "neon-text-green" }
    : healthScore?.trend === "declining"
      ? { icon: TrendingDown, label: "Declinando", neon: "neon-text-red" }
      : healthScore?.trend === "critical"
        ? { icon: AlertCircle, label: "Critico", neon: "neon-text-red" }
        : { icon: Minus, label: "Estable", neon: "neon-text-amber" };

  const openAlerts = alerts.filter(a => a.state === "new").length;
  const pendingActions = actions.filter(a => a.state === "pending").length;

  return (
    <div className="space-y-6">
      {/* Header - Character Banner */}
      <div className="flex items-center gap-4">
        <Link href="/contacts">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div
        className="game-card rounded-lg p-6"
        style={{
          backgroundColor: `color-mix(in srgb, var(${riskConfig.cssVar}) 15%, transparent)`,
          borderColor: `color-mix(in srgb, var(${riskConfig.cssVar}) 30%, transparent)`,
        }}
      >
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div
            className="w-20 h-20 rounded-xl flex items-center justify-center text-2xl font-black shrink-0 border-2"
            style={{
              backgroundColor: `color-mix(in srgb, var(${riskConfig.cssVar}) 15%, transparent)`,
              borderColor: `color-mix(in srgb, var(${riskConfig.cssVar}) 30%, transparent)`,
            }}
          >
            <span style={{ color: `var(${riskConfig.cssVar})` }}>
              {(contact.name || contact.email).charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-black tracking-tight">{contact.name || contact.email}</h1>
              {decisionConfig && (
                <div className="flex items-center gap-1 text-xs font-bold" style={{ color: `var(${decisionConfig.cssVar})` }}>
                  <DecisionIcon className="h-3.5 w-3.5" />
                  {decisionConfig.label}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-[var(--muted-foreground)]">
              {contact.company && <span>{contact.company}</span>}
              {profile?.role && <span>· {profile.role}</span>}
              {profile?.department && <span>· {profile.department}</span>}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <Badge variant={contact.risk_level === "high" ? "destructive" : contact.risk_level === "medium" ? "warning" : "success"}>
                {riskConfig.label}
              </Badge>
              {contact.contact_type && <Badge variant="outline">{contact.contact_type}</Badge>}
              {openAlerts > 0 && (
                <span className="flex items-center gap-1 text-xs text-[var(--destructive)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--destructive)] animate-pulse" />
                  {openAlerts} alertas activas
                </span>
              )}
            </div>

            {/* Health Bar */}
            <div className="mt-4 max-w-md">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Salud del Contacto
                </span>
                <span className={cn("text-sm font-black tabular-nums", healthClamped >= 70 ? "neon-text-green" : healthClamped >= 40 ? "neon-text-amber" : "neon-text-red")}>
                  {healthClamped}%
                </span>
              </div>
              <div className="health-bar-track" style={{ height: "10px" }}>
                <div className="health-bar-fill" data-level={getHealthLevel(healthClamped)} style={{ width: `${healthClamped}%` }} />
              </div>
              {/* Trend + Signals */}
              {healthScore && (
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className={cn("flex items-center gap-1 text-xs font-bold", trendConfig.neon)}>
                    <trendConfig.icon className="h-3.5 w-3.5" />
                    {trendConfig.label}
                    {healthScore.previous_score != null && (
                      <span className="font-normal text-[var(--muted-foreground)] ml-1">
                        (antes: {Math.round(Number(healthScore.previous_score))})
                      </span>
                    )}
                  </span>
                  {healthScore.risk_signals?.map((s: string, i: number) => (
                    <Badge key={`r-${i}`} variant="destructive" className="text-[10px] px-1.5 py-0">{s.replace(/_/g, " ")}</Badge>
                  ))}
                  {healthScore.opportunity_signals?.map((s: string, i: number) => (
                    <Badge key={`o-${i}`} variant="success" className="text-[10px] px-1.5 py-0">{s.replace(/_/g, " ")}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid - RPG Character Sheet */}
      <div className={cn("grid gap-3", healthScore ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4")}>
        {stats.map((stat, i) => (
          <div key={stat.label} className={cn("game-card rounded-lg p-4 bg-[var(--card)] float-in", `float-in-delay-${i + 1}`)}>
            <div className="flex items-center gap-2 mb-3">
              <stat.icon className="h-4 w-4 text-[var(--accent-cyan)]" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {stat.label}
              </span>
            </div>
            <div className="mb-2">
              <span className="text-2xl font-black tabular-nums" style={{ color: `var(${getStatCssVar(stat.value / 100 - 0.5)})` }}>
                {stat.value}
              </span>
              <span className="text-xs text-[var(--muted-foreground)] ml-1">/ 100</span>
            </div>
            <div className="health-bar-track">
              <div className="health-bar-fill" data-level={getHealthLevel(stat.value)} style={{ width: `${stat.value}%` }} />
            </div>
            <div className="text-[10px] text-[var(--muted-foreground)] mt-1">{stat.raw}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: Profile + Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Personality Profile - Character Abilities */}
          {profile && (
            <div className="game-card rounded-lg bg-[var(--card)] p-5">
              <div className="flex items-center gap-2 mb-4">
                <Brain className="h-4 w-4 text-[var(--quest-epic)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Perfil de Personalidad
                </span>
              </div>

              {profile.personality_notes && (
                <p className="text-sm leading-relaxed mb-4 text-[var(--foreground)]/90">{profile.personality_notes}</p>
              )}

              <div className="grid grid-cols-2 gap-4 mb-4">
                {profile.communication_style && (
                  <div className="rounded-lg bg-[var(--secondary)]/50 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <MessageCircle className="h-3 w-3 text-[var(--accent-cyan)]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Comunicacion</span>
                    </div>
                    <p className="text-sm font-medium">{profile.communication_style}</p>
                  </div>
                )}
                {profile.decision_power && (
                  <div className="rounded-lg bg-[var(--secondary)]/50 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Crown className="h-3 w-3 text-[var(--warning)]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Poder de Decision</span>
                    </div>
                    <p className="text-sm font-medium">{profile.decision_power}</p>
                  </div>
                )}
              </div>

              {profile.key_interests?.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="h-3 w-3 text-[var(--quest-epic)]" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Rasgos</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.key_interests.map((t, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded-md bg-[var(--quest-epic-muted)] text-[var(--quest-epic)] border border-[color-mix(in_srgb,var(--quest-epic)_20%,transparent)]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profile.influence_on_deals && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Target className="h-3 w-3 text-[var(--warning)]" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Influencia en Negocios</span>
                  </div>
                  <p className="text-sm">{profile.influence_on_deals}</p>
                </div>
              )}

              {profile.key_interests?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Heart className="h-3 w-3 text-[var(--accent-pink)]" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Intereses</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.key_interests.map((interest, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded-md bg-[color-mix(in_srgb,var(--accent-pink)_15%,transparent)] text-[var(--accent-pink)] border border-[color-mix(in_srgb,var(--accent-pink)_20%,transparent)]">
                        {interest}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Intel / Facts */}
          {facts.length > 0 && (
            <div className="game-card rounded-lg bg-[var(--card)] p-5">
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="h-4 w-4 text-[var(--accent-cyan)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Inteligencia Recopilada
                </span>
                <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">{facts.length} hechos</span>
              </div>
              <div className="space-y-2">
                {facts.map((fact) => (
                  <div key={fact.id} className="flex items-start gap-3 rounded-md bg-[var(--secondary)]/30 p-3">
                    <div className={cn(
                      "mt-0.5 w-2 h-2 rounded-full shrink-0",
                      fact.confidence >= 0.8 ? "bg-[var(--success)]" :
                      fact.confidence >= 0.5 ? "bg-[var(--accent-cyan)]" : "bg-[var(--warning)]",
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{fact.fact_text}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-[var(--muted-foreground)]">
                          Confianza: {Math.round(fact.confidence * 100)}%
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{fact.fact_type}</Badge>
                        <span className="text-[10px] text-[var(--muted-foreground)]">{timeAgo(fact.created_at)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Communication Patterns */}
          {patterns.length > 0 && (
            <div className="game-card rounded-lg bg-[var(--card)] p-5">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="h-4 w-4 text-[var(--accent-teal)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Patrones de Comunicacion
                </span>
              </div>
              <div className="space-y-2">
                {patterns.map((pattern) => (
                  <div key={pattern.id} className="rounded-md bg-[var(--secondary)]/30 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="info" className="text-[10px] px-1.5 py-0">{pattern.pattern_type}</Badge>
                      {pattern.frequency && (
                        <span className="text-[10px] text-[var(--muted-foreground)]">{pattern.frequency}</span>
                      )}
                      <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">
                        {Math.round(pattern.confidence * 100)}% confianza
                      </span>
                    </div>
                    <p className="text-sm">{pattern.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Contact info + Alerts + Actions */}
        <div className="space-y-6">
          {/* Contact Card */}
          <div className="game-card rounded-lg bg-[var(--card)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Mail className="h-4 w-4 text-[var(--info)]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Datos de Contacto
              </span>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                <span className="truncate">{contact.email || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                <span>{contact.department || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                <span>{contact.is_customer ? "Cliente" : contact.is_supplier ? "Proveedor" : "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                <span>{contact.notes || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                <span className="text-xs text-[var(--muted-foreground)]">
                  Ultima interaccion: {contact.last_activity ? timeAgo(contact.last_activity) : "—"}
                </span>
              </div>
            </div>
            {contact.is_customer && <Badge variant="success" className="mt-3 text-[10px]">Cliente</Badge>}
            {contact.is_supplier && <Badge variant="info" className="mt-3 text-[10px]">Proveedor</Badge>}
          </div>

          {/* Active Alerts */}
          <div className="game-card rounded-lg bg-[var(--card)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Alertas
                </span>
              </div>
              {openAlerts > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--destructive)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--destructive)] animate-pulse" />
                  {openAlerts} activas
                </span>
              )}
            </div>
            {alerts.length > 0 ? (
              <div className="space-y-2">
                {alerts.map((a) => (
                  <div key={a.id} className={cn(
                    "alert-pulse pl-4 py-2 rounded-md",
                    a.state === "new" ? (
                      a.severity === "critical" ? "alert-pulse-critical bg-[color-mix(in_srgb,var(--destructive)_5%,transparent)]" :
                      a.severity === "high" ? "alert-pulse-high bg-[color-mix(in_srgb,var(--warning)_5%,transparent)]" :
                      "alert-pulse-medium"
                    ) : "",
                  )}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge
                        variant={a.severity === "critical" || a.severity === "high" ? "destructive" : "warning"}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {a.severity}
                      </Badge>
                      <Badge variant={a.state === "new" ? "default" : a.state === "resolved" ? "success" : "secondary"} className="text-[10px] px-1.5 py-0">
                        {a.state}
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
                Sin alertas
              </div>
            )}
          </div>

          {/* Missions */}
          <div className="game-card rounded-lg bg-[var(--card)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[var(--quest-epic)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Misiones
                </span>
              </div>
              {pendingActions > 0 && (
                <span className="text-[10px] font-bold text-[var(--quest-epic)]">{pendingActions} pendientes</span>
              )}
            </div>
            {actions.length > 0 ? (
              <div className="space-y-2">
                {actions.map((a) => {
                  const isOverdue = a.due_date && a.state === "pending" && new Date(a.due_date) < new Date();
                  return (
                    <div key={a.id} className={cn(
                      "rounded-md p-2.5 border",
                      a.state === "completed" ? "border-[color-mix(in_srgb,var(--success)_20%,transparent)] bg-[color-mix(in_srgb,var(--success)_5%,transparent)]" :
                      isOverdue ? "border-[color-mix(in_srgb,var(--destructive)_20%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_5%,transparent)]" :
                      a.priority === "high" ? "mission-epic border-[var(--border)]" :
                      a.priority === "medium" ? "mission-rare border-[var(--border)]" :
                      "mission-common border-[var(--border)]",
                    )}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge
                          variant={a.state === "completed" ? "success" : a.state === "pending" ? (a.priority === "high" ? "destructive" : "warning") : "secondary"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {a.state === "completed" ? "COMPLETADA" : a.priority?.toUpperCase()}
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
                Sin misiones
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
