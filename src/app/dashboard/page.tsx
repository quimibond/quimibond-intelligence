"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import { XPBar } from "@/components/gamified/xp-bar";
import { PowerStat } from "@/components/gamified/power-stat";
import { MissionCard } from "@/components/gamified/mission-card";
import { HealthBar } from "@/components/gamified/health-bar";
import { AchievementBadge } from "@/components/gamified/achievement-badge";
import { AlertFeedItem } from "@/components/gamified/alert-feed";
import { RadarWidget } from "@/components/gamified/radar-widget";
import { UrgencyPanel } from "@/components/gamified/urgency-panel";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  Mail,
  AlertTriangle,
  CheckSquare,
  Users,
  Shield,
  Zap,
  Trophy,
  Target,
  Eye,
  Flame,
  Star,
  Crosshair,
  Scroll,
  FileText,
  Activity,
  TrendingDown,
} from "lucide-react";

interface Stats {
  totalEmails: number;
  openAlerts: number;
  pendingActions: number;
  atRiskContacts: number;
  resolvedAlerts: number;
  completedActions: number;
  totalContacts: number;
  totalBriefings: number;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  contact_name: string;
  created_at: string;
  is_read: boolean;
}

interface ActionItem {
  id: string;
  action_type: string;
  description: string;
  contact_name: string;
  priority: string;
  due_date: string;
  state: string;
}

interface Contact {
  id: string;
  name: string;
  company: string;
  risk_level: string;
  sentiment_score: number;
  relationship_score: number;
}

interface Briefing {
  id: string;
  briefing_type: string;
  period_start: string;
  period_end: string;
  html_content: string;
  created_at: string;
}

function calculateLevel(xp: number): { level: number; currentXP: number; maxXP: number } {
  // Each level requires progressively more XP
  let level = 1;
  let remaining = xp;
  let threshold = 100;

  while (remaining >= threshold) {
    remaining -= threshold;
    level++;
    threshold = Math.floor(threshold * 1.5);
  }

  return { level, currentXP: remaining, maxXP: threshold };
}

function generateRadarDots(alerts: Alert[]) {
  // Map alerts to radar positions - severity determines distance from center
  const severityRadius: Record<string, number> = {
    critical: 15,
    high: 25,
    medium: 38,
    low: 45,
  };

  return alerts.map((alert, i) => {
    const radius = severityRadius[alert.severity] || 40;
    const angle = (i / Math.max(alerts.length, 1)) * Math.PI * 2 + Math.random() * 0.5;
    return {
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
      severity: (alert.severity as "critical" | "high" | "medium" | "low") || "low",
      label: alert.title,
    };
  });
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalEmails: 0,
    openAlerts: 0,
    pendingActions: 0,
    atRiskContacts: 0,
    resolvedAlerts: 0,
    completedActions: 0,
    totalContacts: 0,
    totalBriefings: 0,
  });
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [pendingActions, setPendingActions] = useState<ActionItem[]>([]);
  const [topContacts, setTopContacts] = useState<Contact[]>([]);
  const [latestBriefing, setLatestBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const [
        emailsRes,
        alertsOpenRes,
        actionsOpenRes,
        contactsRiskRes,
        alertsResolvedRes,
        actionsCompletedRes,
        contactsTotalRes,
        briefingsTotalRes,
        recentAlertsRes,
        actionsListRes,
        topContactsRes,
        briefingRes,
      ] = await Promise.all([
        supabase.from("emails").select("id", { count: "exact", head: true }),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("risk_level", "high"),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "resolved"),
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "completed"),
        supabase.from("contacts").select("id", { count: "exact", head: true }),
        supabase.from("briefings").select("id", { count: "exact", head: true }),
        supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(8),
        supabase.from("action_items").select("*").eq("state", "pending").order("due_date", { ascending: true }).limit(5),
        supabase
          .from("contacts")
          .select("id, name, company, risk_level, sentiment_score, relationship_score")
          .order("risk_level", { ascending: false })
          .limit(6),
        supabase.from("briefings").select("*").order("created_at", { ascending: false }).limit(1),
      ]);

      setStats({
        totalEmails: emailsRes.count ?? 0,
        openAlerts: alertsOpenRes.count ?? 0,
        pendingActions: actionsOpenRes.count ?? 0,
        atRiskContacts: contactsRiskRes.count ?? 0,
        resolvedAlerts: alertsResolvedRes.count ?? 0,
        completedActions: actionsCompletedRes.count ?? 0,
        totalContacts: contactsTotalRes.count ?? 0,
        totalBriefings: briefingsTotalRes.count ?? 0,
      });

      if (recentAlertsRes.data) setRecentAlerts(recentAlertsRes.data);
      if (actionsListRes.data) setPendingActions(actionsListRes.data);
      if (topContactsRes.data) setTopContacts(topContactsRes.data);
      if (briefingRes.data?.[0]) setLatestBriefing(briefingRes.data[0]);
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Activity className="h-8 w-8 text-cyan-400 animate-pulse mx-auto mb-3" />
          <div className="text-sm text-[var(--muted-foreground)]">Inicializando centro de comando...</div>
        </div>
      </div>
    );
  }

  // Calculate XP: emails + resolved alerts*10 + completed actions*5 + briefings*20
  const totalXP =
    stats.totalEmails +
    stats.resolvedAlerts * 10 +
    stats.completedActions * 5 +
    stats.totalBriefings * 20;
  const levelInfo = calculateLevel(totalXP);

  // Achievements
  const achievements = [
    {
      icon: Mail,
      title: "Interceptor",
      description: `${stats.totalEmails} emails procesados`,
      unlocked: stats.totalEmails >= 50,
      tier: (stats.totalEmails >= 500 ? "gold" : stats.totalEmails >= 100 ? "silver" : "bronze") as "gold" | "silver" | "bronze",
    },
    {
      icon: Shield,
      title: "Guardian",
      description: `${stats.resolvedAlerts} alertas resueltas`,
      unlocked: stats.resolvedAlerts >= 5,
      tier: (stats.resolvedAlerts >= 50 ? "gold" : stats.resolvedAlerts >= 20 ? "silver" : "bronze") as "gold" | "silver" | "bronze",
    },
    {
      icon: Zap,
      title: "Ejecutor",
      description: `${stats.completedActions} acciones completadas`,
      unlocked: stats.completedActions >= 5,
      tier: (stats.completedActions >= 50 ? "gold" : stats.completedActions >= 20 ? "silver" : "bronze") as "gold" | "silver" | "bronze",
    },
    {
      icon: Users,
      title: "Diplomatico",
      description: `${stats.totalContacts} contactos registrados`,
      unlocked: stats.totalContacts >= 10,
      tier: (stats.totalContacts >= 100 ? "gold" : stats.totalContacts >= 30 ? "silver" : "bronze") as "gold" | "silver" | "bronze",
    },
    {
      icon: Eye,
      title: "Visionario",
      description: `${stats.totalBriefings} briefings generados`,
      unlocked: stats.totalBriefings >= 3,
      tier: (stats.totalBriefings >= 30 ? "gold" : stats.totalBriefings >= 10 ? "silver" : "bronze") as "gold" | "silver" | "bronze",
    },
    {
      icon: Flame,
      title: "En Racha",
      description: "Sin contactos en riesgo",
      unlocked: stats.atRiskContacts === 0,
      tier: "gold" as const,
    },
  ];

  const radarDots = generateRadarDots(recentAlerts);

  // Build urgency items
  const urgencyItems: { type: "alert" | "action" | "contact"; title: string; reason: string; urgency: number }[] = [];

  // Critical/high alerts = high urgency
  recentAlerts.forEach((alert) => {
    if (alert.severity === "critical" && !alert.is_read) {
      urgencyItems.push({ type: "alert", title: alert.title, reason: `Alerta critica de ${alert.contact_name || "desconocido"}`, urgency: 95 });
    } else if (alert.severity === "high" && !alert.is_read) {
      urgencyItems.push({ type: "alert", title: alert.title, reason: `Alerta alta de ${alert.contact_name || "desconocido"}`, urgency: 75 });
    }
  });

  // Overdue actions = high urgency
  const now = new Date();
  pendingActions.forEach((action) => {
    if (action.due_date && new Date(action.due_date) < now) {
      const daysOverdue = Math.floor((now.getTime() - new Date(action.due_date).getTime()) / 86400000);
      urgencyItems.push({
        type: "action",
        title: action.description,
        reason: `Vencida hace ${daysOverdue} dia${daysOverdue > 1 ? "s" : ""} — ${action.contact_name}`,
        urgency: Math.min(95, 60 + daysOverdue * 5),
      });
    } else if (action.priority === "high") {
      urgencyItems.push({
        type: "action",
        title: action.description,
        reason: `Mision de alta prioridad — ${action.contact_name}`,
        urgency: 55,
      });
    }
  });

  // At-risk contacts
  topContacts.forEach((c) => {
    if (c.risk_level === "high") {
      const health = Math.round(((( c.sentiment_score ?? 0) + 1) / 2) * 50 + ((c.relationship_score ?? 50) / 100) * 50);
      if (health < 30) {
        urgencyItems.push({ type: "contact", title: c.name, reason: `Salud critica: ${health}% — requiere atencion inmediata`, urgency: 85 });
      } else {
        urgencyItems.push({ type: "contact", title: c.name, reason: `Contacto en alto riesgo — salud: ${health}%`, urgency: 50 });
      }
    }
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Crosshair className="h-6 w-6 neon-text-cyan" />
            <h1 className="text-2xl font-black tracking-tight">Centro de Comando</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Sistema de inteligencia comercial — Monitoreo en tiempo real
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          SISTEMA ACTIVO
        </div>
      </div>

      {/* XP Bar */}
      <div className="game-card rounded-lg bg-[var(--card)] p-4">
        <XPBar
          level={levelInfo.level}
          currentXP={levelInfo.currentXP}
          maxXP={levelInfo.maxXP}
          label={`Nivel de Inteligencia — ${totalXP.toLocaleString()} XP total`}
        />
      </div>

      {/* Urgency Panel - only show if there are urgent items */}
      {urgencyItems.length > 0 && (
        <div className="game-card rounded-lg bg-[var(--card)] p-4 border-l-3 border-l-red-500/50">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="h-4 w-4 text-red-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Requiere tu Atencion
            </span>
            <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 ml-auto">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              {urgencyItems.length} asuntos
            </span>
          </div>
          <UrgencyPanel items={urgencyItems} />
        </div>
      )}

      {/* Power Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <PowerStat
          label="Emails Interceptados"
          value={stats.totalEmails}
          icon={Mail}
          color="cyan"
          subtitle="procesados por IA"
          delay={1}
        />
        <PowerStat
          label="Alertas Activas"
          value={stats.openAlerts}
          icon={AlertTriangle}
          color="amber"
          subtitle={`${stats.resolvedAlerts} resueltas`}
          delay={2}
        />
        <PowerStat
          label="Misiones Pendientes"
          value={stats.pendingActions}
          icon={Target}
          color="purple"
          subtitle={`${stats.completedActions} completadas`}
          delay={3}
        />
        <PowerStat
          label="Contactos en Riesgo"
          value={stats.atRiskContacts}
          icon={Users}
          color="red"
          subtitle={`de ${stats.totalContacts} totales`}
          delay={4}
        />
      </div>

      {/* Main grid: Radar + Alerts | Missions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Radar + Alert Feed */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Radar */}
            <div className="game-card rounded-lg bg-[var(--card)] p-4">
              <div className="flex items-center gap-2 mb-4">
                <Crosshair className="h-4 w-4 text-cyan-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Radar de Amenazas
                </span>
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {recentAlerts.length} senales
                </Badge>
              </div>
              <RadarWidget dots={radarDots} />
              <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-[var(--muted-foreground)]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-400" /> Critica
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" /> Alta
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" /> Media
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> Baja
                </span>
              </div>
            </div>

            {/* Latest Briefing */}
            <div className="game-card rounded-lg bg-[var(--card)] p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Scroll className="h-4 w-4 text-purple-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Ultimo Reporte
                  </span>
                </div>
                <Link href="/briefings" className="text-[10px] text-[var(--primary)] hover:underline">
                  Ver todos
                </Link>
              </div>
              {latestBriefing ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="info" className="text-[10px]">{latestBriefing.briefing_type}</Badge>
                    <span className="text-[10px] text-[var(--muted-foreground)]">
                      {timeAgo(latestBriefing.created_at)}
                    </span>
                  </div>
                  <div
                    className="prose prose-invert prose-sm max-h-52 overflow-hidden text-xs leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: latestBriefing.html_content?.slice(0, 600) || "" }}
                  />
                  <Link
                    href={`/briefings/${latestBriefing.id}`}
                    className="mt-3 inline-flex items-center gap-1 text-[10px] text-[var(--primary)] hover:underline"
                  >
                    <FileText className="h-3 w-3" /> Leer reporte completo
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">No hay reportes aun.</p>
              )}
            </div>
          </div>

          {/* Alert Feed */}
          <div className="game-card rounded-lg bg-[var(--card)] p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Feed de Alertas
                </span>
                {stats.openAlerts > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-red-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                    {stats.openAlerts} nuevas
                  </span>
                )}
              </div>
              <Link href="/alerts" className="text-[10px] text-[var(--primary)] hover:underline">
                Ver todas
              </Link>
            </div>
            {recentAlerts.length > 0 ? (
              <div className="space-y-1">
                {recentAlerts.map((alert) => (
                  <AlertFeedItem
                    key={alert.id}
                    id={alert.id}
                    title={alert.title}
                    severity={alert.severity}
                    contactName={alert.contact_name}
                    createdAt={alert.created_at}
                    isRead={alert.is_read}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-[var(--muted-foreground)]">
                <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Perimetro seguro — Sin alertas activas
              </div>
            )}
          </div>
        </div>

        {/* Right: Missions + Health */}
        <div className="space-y-6">
          {/* Mission Board */}
          <div className="game-card rounded-lg bg-[var(--card)] p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-purple-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Tablero de Misiones
                </span>
              </div>
              <Link href="/actions" className="text-[10px] text-[var(--primary)] hover:underline">
                Ver todas
              </Link>
            </div>
            {pendingActions.length > 0 ? (
              <div className="space-y-2">
                {pendingActions.map((action) => (
                  <MissionCard
                    key={action.id}
                    title={action.description}
                    contact={action.contact_name}
                    priority={action.priority as "high" | "medium" | "low"}
                    dueDate={action.due_date}
                    type={action.action_type}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-[var(--muted-foreground)]">
                <CheckSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Todas las misiones completadas
              </div>
            )}
          </div>

          {/* Client Health */}
          <div className="game-card rounded-lg bg-[var(--card)] p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Salud de Contactos
                </span>
              </div>
              <Link href="/contacts" className="text-[10px] text-[var(--primary)] hover:underline">
                Ver todos
              </Link>
            </div>
            {topContacts.length > 0 ? (
              <div className="space-y-2">
                {topContacts.map((contact) => (
                  <HealthBar
                    key={contact.id}
                    id={contact.id}
                    name={contact.name}
                    company={contact.company}
                    riskLevel={contact.risk_level}
                    sentimentScore={contact.sentiment_score ?? 0}
                    relationshipScore={contact.relationship_score ?? 50}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-[var(--muted-foreground)]">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Sin contactos registrados
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Achievements */}
      <div className="game-card rounded-lg bg-[var(--card)] p-4">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Logros
          </span>
          <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">
            {achievements.filter((a) => a.unlocked).length}/{achievements.length} desbloqueados
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {achievements.map((ach) => (
            <AchievementBadge
              key={ach.title}
              icon={ach.icon}
              title={ach.title}
              description={ach.description}
              unlocked={ach.unlocked}
              tier={ach.tier}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
