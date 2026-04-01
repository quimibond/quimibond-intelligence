"use client";

import Link from "next/link";
import {
  Building2, CheckCircle2, ChevronRight, Clock, DollarSign,
  Lightbulb, UserCheck,
} from "lucide-react";
import type { AgentInsight, AIAgent, AgentRun, Company, Contact } from "@/lib/types";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface InsightCardProps {
  insight: AgentInsight;
  agent: AIAgent | null;
  agentRun: AgentRun | null;
  company: Company | null;
  contact: Contact | null;
}

export function InsightCard({ insight, agent, agentRun, company, contact }: InsightCardProps) {
  const isDone = ["acted_on", "dismissed", "expired"].includes(insight.state ?? "");
  const dc = getDomainConfig(agent?.domain ?? "");
  const AgentIcon = dc.icon;

  const confidence = insight.confidence ?? 0;
  const evidence = Array.isArray(insight.evidence) ? (insight.evidence as unknown[]) : [];
  const showEvidence = evidence.length > 0 && !(typeof evidence[0] === "object" && evidence[0] !== null && "priority_tier" in evidence[0]);

  return (
    <>
      {/* Main insight card */}
      <Card className={cn(isDone && "opacity-60")}>
        <CardContent className="pt-5 space-y-4">
          {/* Agent header + state */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", dc.bg)}>
                <AgentIcon className={cn("h-4 w-4", dc.color)} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{agent?.name ?? "Agente"}</p>
                {agentRun && (
                  <p className="text-[10px] text-muted-foreground">
                    Analizado {timeAgo(agentRun.completed_at ?? agentRun.started_at)}
                    {agentRun.duration_seconds != null && ` \u00b7 ${agentRun.duration_seconds}s`}
                  </p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {isDone ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {insight.state === "acted_on" ? "Actuado" : insight.state === "dismissed" ? "Descartado" : "Expirado"}
                </Badge>
              ) : (
                <Badge variant="secondary">Pendiente</Badge>
              )}
            </div>
          </div>

          {/* Badges row: severity + type + category + business impact + assignee dept */}
          <div className="flex items-center gap-2 flex-wrap">
            {insight.severity && <SeverityBadge severity={insight.severity} />}
            <Badge variant="outline" className="text-[10px]">{insight.insight_type}</Badge>
            {insight.category && (
              <Badge variant="outline" className="text-[10px]">{insight.category}</Badge>
            )}
            {(insight.business_impact_estimate ?? 0) > 0 && (
              <Badge variant="critical" className="gap-1 text-[10px]">
                <DollarSign className="h-3 w-3" />{formatCurrency(insight.business_impact_estimate)}
              </Badge>
            )}
          </div>

          {/* Title */}
          <h1 className="text-lg md:text-xl font-bold leading-tight">{insight.title}</h1>

          {/* Description */}
          <p className="text-sm text-muted-foreground leading-relaxed">{insight.description}</p>

          {/* Recommendation */}
          {insight.recommendation && (
            <div className="rounded-lg bg-success/5 border border-success/20 p-3 md:p-4">
              <p className="text-xs font-semibold text-success-foreground mb-1 flex items-center gap-1">
                <Lightbulb className="h-3.5 w-3.5" /> Accion recomendada
              </p>
              <p className="text-sm font-medium">{insight.recommendation}</p>
            </div>
          )}

          {/* Confidence bar */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground shrink-0">Confianza</span>
            <Progress value={confidence * 100} className="h-2 flex-1 max-w-40" />
            <span className={cn(
              "text-sm font-bold tabular-nums",
              confidence >= 0.85 ? "text-success" : confidence >= 0.7 ? "text-warning" : "text-muted-foreground"
            )}>
              {(confidence * 100).toFixed(0)}%
            </span>
          </div>

          {/* Assignee */}
          {insight.assignee_name && (
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
              <UserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground leading-none mb-0.5">Responsable</p>
                <p className="text-sm font-medium truncate">
                  {insight.assignee_name}
                  {insight.assignee_department && (
                    <span className="text-muted-foreground font-normal"> &middot; {insight.assignee_department}</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Evidence */}
          {showEvidence && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Evidencia:</p>
              <ul className="space-y-1">
                {evidence.map((e, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-muted-foreground/50 mt-0.5 shrink-0">&bull;</span>
                    <span className="break-words">{typeof e === "string" ? e : JSON.stringify(e)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Meta footer */}
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground pt-2 border-t">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(insight.created_at)}</span>
            {insight.category && <span>{insight.category}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Company link card */}
      {company && (
        <Link href={`/companies/${company.id}`}>
          <Card className="hover:border-primary/20 transition-colors">
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{company.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      {company.is_customer && <span>Cliente</span>}
                      {company.is_supplier && <span>Proveedor</span>}
                      {(company.lifetime_value ?? 0) > 0 && <span>{formatCurrency(company.lifetime_value)} lifetime</span>}
                      {(company.total_pending ?? 0) > 0 && <span className="text-danger">{formatCurrency(company.total_pending)} pendiente</span>}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Contact link card */}
      {contact && (
        <Link href={`/contacts/${contact.id}`}>
          <Card className="hover:border-primary/20 transition-colors">
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    contact.risk_level === "high" || contact.risk_level === "critical"
                      ? "bg-danger/15 text-danger-foreground"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {contact.name?.charAt(0) ?? "?"}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{contact.name ?? contact.email}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {contact.role && <span className="truncate">{contact.role}</span>}
                      {contact.current_health_score != null && (
                        <span className={cn(
                          "font-medium shrink-0",
                          contact.current_health_score >= 60 ? "text-success" : contact.current_health_score >= 40 ? "text-warning" : "text-danger"
                        )}>
                          Score: {contact.current_health_score}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}
    </>
  );
}
