"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import { XPBar } from "@/components/gamified/xp-bar";
import { PowerStat } from "@/components/gamified/power-stat";
import { HealthBar } from "@/components/gamified/health-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  AlertTriangle,
  CheckSquare,
  Users,
  Shield,
  Clock,
  Target,
  FileText,
  Activity,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flame,
  Crosshair,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types matching the get_director_dashboard RPC response             */
/* ------------------------------------------------------------------ */

interface KPI {
  critical_alerts: number;
  overdue_actions: number;
  at_risk_contacts: number;
  pending_actions: number;
  resolved_alerts: number;
  completed_actions: number;
  total_emails: number;
}

interface OverdueAction {
  id: string;
  description: string;
  assignee_name: string | null;
  assignee_email: string | null;
  days_overdue: number;
  contact_name: string | null;
  reason: string | null;
}

interface CriticalAlert {
  id: string;
  title: string;
  severity: string;
  contact_name: string | null;
  business_impact: string | null;
  suggested_action: string | null;
  created_at: string;
}

interface AccountabilityRow {
  assignee_name: string | null;
  assignee_email: string | null;
  pending: number;
  overdue: number;
  completed: number;
}

interface ContactAtRisk {
  id: string;
  name: string;
  company: string | null;
  risk_level: string;
  sentiment_score: number;
  relationship_score: number;
  open_alerts: number;
  pending_actions: number;
}

interface LatestBriefing {
  id: string;
  briefing_type: string;
  html_content: string | null;
  created_at: string;
}

interface DirectorDashboard {
  kpi: KPI;
  overdue_actions: OverdueAction[];
  critical_alerts: CriticalAlert[];
  accountability: AccountabilityRow[];
  contacts_at_risk: ContactAtRisk[];
  latest_briefing: LatestBriefing | null;
  pending_actions: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function calculateLevel(xp: number): { level: number; currentXP: number; maxXP: number } {
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const [data, setData] = useState<DirectorDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [briefingOpen, setBriefingOpen] = useState(false);

  useEffect(() => {
    async function fetchData() {
      const { data: rpcData, error } = await supabase.rpc("get_director_dashboard");

      if (error) {
        console.error("Error fetching director dashboard:", error);
        setLoading(false);
        return;
      }

      setData(rpcData as unknown as DirectorDashboard);
      setLoading(false);
    }
    fetchData();
  }, []);

  /* Loading state */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Activity className="h-8 w-8 text-[var(--accent-cyan)] animate-pulse mx-auto mb-3" />
          <div className="text-sm text-[var(--muted-foreground)]">Inicializando centro de comando...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center text-[var(--muted-foreground)]">
          <Shield className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No se pudo cargar el dashboard. Intenta recargar la pagina.</p>
        </div>
      </div>
    );
  }

  const { kpi, overdue_actions, critical_alerts, accountability, contacts_at_risk, latest_briefing } = data;

  /* XP calculation */
  const totalXP = (kpi.resolved_alerts ?? 0) * 10 + (kpi.completed_actions ?? 0) * 5 + (kpi.total_emails ?? 0);
  const levelInfo = calculateLevel(totalXP);

  const hasAttentionItems = critical_alerts.length > 0 || overdue_actions.length > 0;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Crosshair className="h-6 w-6 neon-text-cyan" />
            <h1 className="text-2xl font-black tracking-tight">Centro de Comando</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Dashboard ejecutivo — Decisiones y seguimiento
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <div className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
          SISTEMA ACTIVO
        </div>
      </div>

      {/* ── XP Bar ── */}
      <div className="game-card rounded-lg bg-[var(--card)] p-4">
        <XPBar
          level={levelInfo.level}
          currentXP={levelInfo.currentXP}
          maxXP={levelInfo.maxXP}
          label={`Nivel de Inteligencia — ${totalXP.toLocaleString()} XP total`}
        />
      </div>

      {/* ── 4 KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <PowerStat
          label="Alertas Criticas"
          value={kpi.critical_alerts}
          icon={AlertTriangle}
          color="red"
          subtitle="requieren decision"
          delay={1}
        />
        <PowerStat
          label="Acciones Vencidas"
          value={kpi.overdue_actions}
          icon={Clock}
          color="amber"
          subtitle="sin completar"
          delay={2}
        />
        <PowerStat
          label="Contactos en Riesgo"
          value={kpi.at_risk_contacts}
          icon={Flame}
          color="red"
          subtitle="relacion deteriorada"
          delay={3}
        />
        <PowerStat
          label="Acciones Pendientes"
          value={kpi.pending_actions}
          icon={Target}
          color="purple"
          subtitle={`${kpi.completed_actions} completadas`}
          delay={4}
        />
      </div>

      {/* ── Requiere tu Atencion ── */}
      {hasAttentionItems && (
        <Card className="border-l-4 border-l-[var(--destructive)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--destructive)]" />
              <span className="uppercase tracking-wider">Requiere tu Atencion</span>
              <Badge variant="destructive" className="ml-auto text-[10px]">
                {critical_alerts.length + overdue_actions.length} asuntos
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Critical / High Alerts */}
            {critical_alerts.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Alertas Criticas
                </div>
                {critical_alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-3 space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={alert.severity === "critical" ? "critical" : "high"}
                          className="text-[10px] shrink-0"
                        >
                          {alert.severity}
                        </Badge>
                        <span className="text-sm font-medium">{alert.title}</span>
                      </div>
                      <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">
                        {timeAgo(alert.created_at)}
                      </span>
                    </div>
                    {alert.contact_name && (
                      <div className="text-xs text-[var(--muted-foreground)]">
                        <span className="font-medium text-[var(--foreground)]">Contacto:</span> {alert.contact_name}
                      </div>
                    )}
                    {alert.business_impact && (
                      <div className="text-xs text-[var(--muted-foreground)]">
                        <span className="font-medium text-[var(--foreground)]">Impacto:</span> {alert.business_impact}
                      </div>
                    )}
                    {alert.suggested_action && (
                      <div className="text-xs text-[var(--accent-cyan)]">
                        <span className="font-medium">Accion sugerida:</span> {alert.suggested_action}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Overdue Actions */}
            {overdue_actions.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Acciones Vencidas
                </div>
                {overdue_actions.map((action) => (
                  <div
                    key={action.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-3 space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{action.description}</span>
                      <Badge variant="warning" className="text-[10px] shrink-0">
                        {action.days_overdue}d vencida
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
                      <span>
                        <span className="font-medium text-[var(--foreground)]">Responsable:</span>{" "}
                        {action.assignee_name || action.assignee_email || "Sin asignar"}
                      </span>
                      {action.contact_name && (
                        <span>
                          <span className="font-medium text-[var(--foreground)]">Contacto:</span> {action.contact_name}
                        </span>
                      )}
                    </div>
                    {action.reason && (
                      <div className="text-xs text-[var(--muted-foreground)]">
                        <span className="font-medium text-[var(--foreground)]">Motivo:</span> {action.reason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Accountability del Equipo ── */}
      {accountability.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--accent-cyan)]" />
              <span className="uppercase tracking-wider">Accountability del Equipo</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-2 pr-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      Responsable
                    </th>
                    <th className="text-center py-2 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      Pendientes
                    </th>
                    <th className="text-center py-2 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      Vencidas
                    </th>
                    <th className="text-center py-2 pl-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      Completadas
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accountability.map((row, idx) => {
                    const displayName = row.assignee_name || row.assignee_email || "Sin asignar";
                    return (
                      <tr
                        key={idx}
                        className="border-b border-[var(--border)] last:border-b-0"
                      >
                        <td className="py-2.5 pr-4 font-medium">{displayName}</td>
                        <td className="py-2.5 px-3 text-center">
                          <Badge variant="outline" className="text-xs tabular-nums">
                            {row.pending}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {row.overdue > 0 ? (
                            <Badge variant="destructive" className="text-xs tabular-nums">
                              {row.overdue}
                            </Badge>
                          ) : (
                            <Badge variant="success" className="text-xs tabular-nums">
                              0
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 pl-3 text-center">
                          <Badge variant="success" className="text-xs tabular-nums">
                            {row.completed}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Contactos en Riesgo ── */}
      {contacts_at_risk.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-[var(--destructive)]" />
              <span className="uppercase tracking-wider">Contactos en Riesgo</span>
              <Link href="/contacts" className="ml-auto">
                <Button variant="ghost" size="sm" className="text-xs gap-1">
                  Ver todos <ExternalLink className="h-3 w-3" />
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {contacts_at_risk.map((contact) => (
              <div key={contact.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <HealthBar
                    id={contact.id}
                    name={contact.name}
                    company={contact.company || ""}
                    riskLevel={contact.risk_level}
                    sentimentScore={contact.sentiment_score ?? 0}
                    relationshipScore={contact.relationship_score ?? 50}
                  />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {contact.open_alerts > 0 && (
                    <Badge variant="destructive" className="text-[10px]">
                      {contact.open_alerts} alerta{contact.open_alerts > 1 ? "s" : ""}
                    </Badge>
                  )}
                  {contact.pending_actions > 0 && (
                    <Badge variant="warning" className="text-[10px]">
                      {contact.pending_actions} accion{contact.pending_actions > 1 ? "es" : ""}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Latest Briefing (collapsible) ── */}
      {latest_briefing && (
        <Card>
          <CardHeader
            className="pb-3 cursor-pointer"
            onClick={() => setBriefingOpen((prev) => !prev)}
          >
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[var(--quest-epic)]" />
              <span className="uppercase tracking-wider">Ultimo Briefing</span>
              <Badge variant="info" className="text-[10px] ml-2">
                {latest_briefing.briefing_type}
              </Badge>
              <span className="text-[10px] text-[var(--muted-foreground)] ml-1">
                {timeAgo(latest_briefing.created_at)}
              </span>
              <span className="ml-auto">
                {briefingOpen ? (
                  <ChevronUp className="h-4 w-4 text-[var(--muted-foreground)]" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
                )}
              </span>
            </CardTitle>
          </CardHeader>
          {briefingOpen && (
            <CardContent>
              <div
                className="prose prose-invert prose-sm max-h-80 overflow-y-auto text-xs leading-relaxed"
                dangerouslySetInnerHTML={{ __html: latest_briefing.html_content?.slice(0, 2000) || "" }}
              />
              <div className="mt-3">
                <Link href={`/briefings/${latest_briefing.id}`}>
                  <Button variant="outline" size="sm" className="text-xs gap-1">
                    <FileText className="h-3 w-3" /> Leer reporte completo
                  </Button>
                </Link>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Empty state when nothing needs attention ── */}
      {!hasAttentionItems && contacts_at_risk.length === 0 && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center">
              <CheckSquare className="h-10 w-10 mx-auto mb-3 text-[var(--success)] opacity-60" />
              <p className="text-sm font-medium">Todo bajo control</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                No hay alertas criticas, acciones vencidas ni contactos en riesgo.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
