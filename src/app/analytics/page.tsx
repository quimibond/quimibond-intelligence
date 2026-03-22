"use client"

import { useEffect, useState } from "react"
import { BarChart3 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { cn, timeAgo, formatCurrency } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type TopicDistribution = {
  topic_category: string
  count: number
}

type AlertDistribution = {
  alert_type: string
  category: string
  count: number
}

type HealthScore = {
  bucket: string
  count: number
}

type CrossDepartmentTopic = {
  topic: string
  dept_list: string[]
  account_list: string[]
  times_seen: number
  sev: string
}

type TopEntity = {
  name: string
  entity_type: string
  fact_count: number
}

type SystemStats = {
  total_emails: number
  total_contacts: number
  total_alerts: number
  total_topics: number
  total_entities: number
  total_facts: number
}

export default function AnalyticsPage() {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Data states
  const [topicDistribution, setTopicDistribution] = useState<TopicDistribution[]>([])
  const [alertDistribution, setAlertDistribution] = useState<AlertDistribution[]>([])
  const [healthScores, setHealthScores] = useState<HealthScore[]>([])
  const [crossDeptTopics, setCrossDeptTopics] = useState<CrossDepartmentTopic[]>([])
  const [topEntities, setTopEntities] = useState<TopEntity[]>([])
  const [systemStats, setSystemStats] = useState<SystemStats>({
    total_emails: 0,
    total_contacts: 0,
    total_alerts: 0,
    total_topics: 0,
    total_entities: 0,
    total_facts: 0,
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const fetchAnalytics = async () => {
      try {
        setLoading(true)
        setError(null)

        // 1. Topic Distribution
        const { data: topics, error: topicsErr } = await supabase
          .from("topics")
          .select("topic_category")
          .then((res) => {
            if (res.error) return { data: null, error: res.error }
            const counts: Record<string, number> = {}
            res.data?.forEach((row: any) => {
              counts[row.topic_category] = (counts[row.topic_category] || 0) + 1
            })
            const sorted = Object.entries(counts)
              .map(([category, count]) => ({ topic_category: category, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 13)
            return { data: sorted, error: null }
          })

        if (topicsErr) throw topicsErr
        setTopicDistribution(topics || [])

        // 2. Alert Distribution
        const { data: alertData, error: alertErr } = await supabase
          .from("alert_type_catalog")
          .select(
            `
            alert_type,
            category,
            alerts(id)
          `
          )

        if (alertErr) throw alertErr

        const alertCounts: AlertDistribution[] = (alertData || [])
          .map((atc: any) => ({
            alert_type: atc.alert_type,
            category: atc.category || "General",
            count: atc.alerts?.length || 0,
          }))
          .sort((a, b) => b.count - a.count)

        setAlertDistribution(alertCounts)

        // 3. Health Score Distribution
        const { data: scoreData, error: scoreErr } = await supabase.rpc(
          "get_latest_health_scores"
        )

        if (scoreErr) throw scoreErr

        const healthBuckets: Record<string, number> = {
          Saludable: 0,
          "En observación": 0,
          "En riesgo": 0,
        }

        ;(scoreData || []).forEach((score: any) => {
          if (score.overall_score >= 70) {
            healthBuckets["Saludable"]++
          } else if (score.overall_score >= 40) {
            healthBuckets["En observación"]++
          } else {
            healthBuckets["En riesgo"]++
          }
        })

        const healthArray = Object.entries(healthBuckets)
          .map(([bucket, count]) => ({ bucket, count }))
          .filter((h) => h.count > 0)

        setHealthScores(healthArray)

        // 4. Cross-Department Topics
        const { data: crossDept, error: crossErr } = await supabase.rpc(
          "detect_cross_department_topics"
        )

        if (crossErr) throw crossErr
        setCrossDeptTopics(crossDept || [])

        // 5. Top Entities by Facts
        const { data: entitiesData, error: entitiesErr } = await supabase
          .from("entities")
          .select(
            `
            id,
            name,
            entity_type,
            facts(id)
          `
          )
          .order("name")

        if (entitiesErr) throw entitiesErr

        const topEnts = (entitiesData || [])
          .map((e: any) => ({
            name: e.name,
            entity_type: e.entity_type || "Unknown",
            fact_count: e.facts?.length || 0,
          }))
          .sort((a, b) => b.fact_count - a.fact_count)
          .slice(0, 10)

        setTopEntities(topEnts)

        // 6. System Stats
        const [emailRes, contactRes, alertRes, topicRes, entityRes, factRes] =
          await Promise.all([
            supabase.from("emails").select("id", { count: "exact", head: true }),
            supabase.from("contacts").select("id", { count: "exact", head: true }),
            supabase.from("alerts").select("id", { count: "exact", head: true }),
            supabase.from("topics").select("id", { count: "exact", head: true }),
            supabase.from("entities").select("id", { count: "exact", head: true }),
            supabase.from("facts").select("id", { count: "exact", head: true }),
          ])

        setSystemStats({
          total_emails: emailRes.count || 0,
          total_contacts: contactRes.count || 0,
          total_alerts: alertRes.count || 0,
          total_topics: topicRes.count || 0,
          total_entities: entityRes.count || 0,
          total_facts: factRes.count || 0,
        })
      } catch (err) {
        console.error("Analytics fetch error:", err)
        setError(err instanceof Error ? err.message : "Error al cargar analítica")
      } finally {
        setLoading(false)
      }
    }

    fetchAnalytics()
  }, [mounted])

  const getSeverityBadgeVariant = (sev: string) => {
    const lower = sev.toLowerCase()
    if (lower === "crítico" || lower === "critical") return "critical"
    if (lower === "alto" || lower === "high") return "high"
    if (lower === "medio" || lower === "medium") return "medium"
    return "low"
  }

  const getHealthCardColor = (bucket: string): string => {
    if (bucket === "Saludable") return "var(--success)"
    if (bucket === "En observación") return "var(--warning)"
    return "var(--destructive)"
  }

  const maxTopicCount = Math.max(...topicDistribution.map((t) => t.count), 1)
  const maxAlertCount = Math.max(...alertDistribution.map((a) => a.count), 1)

  if (!mounted) return null

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <div className="border-b border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] p-2">
              <BarChart3 className="h-6 w-6 text-[var(--card)]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--foreground)]">
                Inteligencia Analítica
              </h1>
              <p className="text-sm text-[var(--muted-foreground)]">
                Resumen agregado del sistema de inteligencia
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8">
        {error && (
          <div className="mb-6 rounded-lg border border-[var(--destructive)] bg-[var(--destructive)]/10 p-4 text-[var(--destructive)]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-96 items-center justify-center">
            <div className="text-center">
              <div className="mb-4 inline-block h-10 w-10 animate-spin rounded-full border-4 border-[var(--muted-foreground)] border-t-[var(--primary)]" />
              <p className="text-[var(--muted-foreground)]">Cargando analítica...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Top Stats Row */}
            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card className="game-card float-in group relative overflow-hidden border border-[var(--border)] bg-[var(--card)]">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-0 group-hover:opacity-5 transition-opacity" />
                <div className="relative p-6">
                  <p className="text-sm text-[var(--muted-foreground)]">Emails Totales</p>
                  <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                    {systemStats.total_emails}
                  </p>
                  <div className="mt-3 h-1 w-full bg-gradient-to-r from-[var(--primary)] to-transparent rounded-full" />
                </div>
              </Card>

              <Card className="game-card float-in group relative overflow-hidden border border-[var(--border)] bg-[var(--card)]">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-0 group-hover:opacity-5 transition-opacity" />
                <div className="relative p-6">
                  <p className="text-sm text-[var(--muted-foreground)]">Contactos</p>
                  <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                    {systemStats.total_contacts}
                  </p>
                  <div className="mt-3 h-1 w-full bg-gradient-to-r from-[var(--info)] to-transparent rounded-full" />
                </div>
              </Card>

              <Card className="game-card float-in group relative overflow-hidden border border-[var(--border)] bg-[var(--card)]">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-0 group-hover:opacity-5 transition-opacity" />
                <div className="relative p-6">
                  <p className="text-sm text-[var(--muted-foreground)]">Alertas</p>
                  <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                    {systemStats.total_alerts}
                  </p>
                  <div className="mt-3 h-1 w-full bg-gradient-to-r from-[var(--warning)] to-transparent rounded-full" />
                </div>
              </Card>

              <Card className="game-card float-in group relative overflow-hidden border border-[var(--border)] bg-[var(--card)]">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-0 group-hover:opacity-5 transition-opacity" />
                <div className="relative p-6">
                  <p className="text-sm text-[var(--muted-foreground)]">Salud Promedio</p>
                  <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                    {healthScores.length > 0
                      ? Math.round(
                          (healthScores.reduce((sum, h) => {
                            if (h.bucket === "Saludable") return sum + 80 * h.count
                            if (h.bucket === "En observación")
                              return sum + 55 * h.count
                            return sum + 20 * h.count
                          }, 0) /
                            healthScores.reduce((sum, h) => sum + h.count, 0)) *
                            10
                        ) / 10
                      : 0}
                    %
                  </p>
                  <div className="mt-3 h-1 w-full bg-gradient-to-r from-[var(--success)] to-transparent rounded-full" />
                </div>
              </Card>
            </div>

            {/* Health Score Distribution */}
            {healthScores.length > 0 && (
              <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                {healthScores.map((health) => (
                  <Card
                    key={health.bucket}
                    className="game-card float-in border border-[var(--border)] bg-[var(--card)] p-6"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-[var(--muted-foreground)]">
                          {health.bucket}
                        </p>
                        <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">
                          {health.count}
                        </p>
                      </div>
                      <div
                        className="h-12 w-12 rounded-full opacity-20"
                        style={{
                          backgroundColor: getHealthCardColor(health.bucket),
                        }}
                      />
                    </div>
                    <div
                      className="mt-4 h-1 w-full rounded-full"
                      style={{
                        backgroundColor: getHealthCardColor(health.bucket),
                      }}
                    />
                  </Card>
                ))}
              </div>
            )}

            {/* Two Column Grid */}
            <div className="mb-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
              {/* Left Column */}
              <div className="space-y-8">
                {/* Topic Distribution */}
                <Card className="game-card border border-[var(--border)] bg-[var(--card)] p-6">
                  <h2 className="mb-6 text-lg font-semibold text-[var(--foreground)]">
                    Distribución de Tópicos
                  </h2>
                  <div className="space-y-4">
                    {topicDistribution.length > 0 ? (
                      topicDistribution.map((topic) => {
                        const percentage = (topic.count / maxTopicCount) * 100
                        return (
                          <div key={topic.topic_category} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-[var(--muted-foreground)]">
                                {topic.topic_category}
                              </span>
                              <span className="text-xs font-semibold text-[var(--foreground)]">
                                {topic.count}
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]/30">
                              <div
                                className="h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)]"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <p className="text-sm text-[var(--muted-foreground)]">
                        Sin datos disponibles
                      </p>
                    )}
                  </div>
                </Card>

                {/* Alert Type Breakdown */}
                <Card className="game-card border border-[var(--border)] bg-[var(--card)] p-6">
                  <h2 className="mb-6 text-lg font-semibold text-[var(--foreground)]">
                    Alertas por Tipo
                  </h2>
                  <div className="space-y-3">
                    {alertDistribution.length > 0 ? (
                      alertDistribution.map((alert) => {
                        const percentage = (alert.count / maxAlertCount) * 100
                        return (
                          <div key={alert.alert_type} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-[var(--foreground)]">
                                  {alert.alert_type}
                                </p>
                                <p className="text-xs text-[var(--muted-foreground)]">
                                  {alert.category}
                                </p>
                              </div>
                              <span className="text-xs font-semibold text-[var(--foreground)]">
                                {alert.count}
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]/30">
                              <div
                                className="h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-[var(--warning)] to-[var(--destructive)]"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <p className="text-sm text-[var(--muted-foreground)]">
                        Sin datos disponibles
                      </p>
                    )}
                  </div>
                </Card>
              </div>

              {/* Right Column */}
              <div className="space-y-8">
                {/* Cross-Department Topics */}
                <Card className="game-card border border-[var(--border)] bg-[var(--card)] p-6">
                  <h2 className="mb-6 text-lg font-semibold text-[var(--foreground)]">
                    Tópicos Interdepartamentales
                  </h2>
                  <div className="space-y-4">
                    {crossDeptTopics.length > 0 ? (
                      crossDeptTopics.slice(0, 8).map((signal, idx) => (
                        <div
                          key={idx}
                          className="rounded-lg border border-[var(--border)] bg-gradient-to-r from-[var(--primary)]/5 to-[var(--secondary)]/5 p-4"
                        >
                          <div className="mb-2 flex items-start justify-between">
                            <h3 className="font-semibold text-[var(--foreground)]">
                              {signal.topic}
                            </h3>
                            <Badge variant={getSeverityBadgeVariant(signal.sev)}>
                              {signal.sev}
                            </Badge>
                          </div>
                          <p className="mb-3 text-xs text-[var(--muted-foreground)]">
                            Visto {signal.times_seen} veces
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {signal.dept_list.slice(0, 3).map((dept) => (
                              <Badge
                                key={dept}
                                variant="secondary"
                                className="text-xs"
                              >
                                {dept}
                              </Badge>
                            ))}
                            {signal.dept_list.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{signal.dept_list.length - 3}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--muted-foreground)]">
                        Sin tópicos interdepartamentales
                      </p>
                    )}
                  </div>
                </Card>

                {/* Top Entities */}
                <Card className="game-card border border-[var(--border)] bg-[var(--card)] p-6">
                  <h2 className="mb-6 text-lg font-semibold text-[var(--foreground)]">
                    Entidades Principales
                  </h2>
                  <div className="space-y-3">
                    {topEntities.length > 0 ? (
                      topEntities.map((entity, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-lg bg-[var(--muted)]/20 px-4 py-3"
                        >
                          <div className="flex-1">
                            <p className="font-medium text-[var(--foreground)]">
                              {entity.name}
                            </p>
                            <p className="text-xs text-[var(--muted-foreground)]">
                              {entity.entity_type}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge
                              variant="outline"
                              className="text-xs font-semibold"
                            >
                              {entity.fact_count} hechos
                            </Badge>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--muted-foreground)]">
                        Sin entidades disponibles
                      </p>
                    )}
                  </div>
                </Card>
              </div>
            </div>

            {/* System Stats Summary */}
            <Card className="game-card border border-[var(--border)] bg-gradient-to-r from-[var(--primary)]/5 to-[var(--secondary)]/5 p-6">
              <h2 className="mb-6 text-lg font-semibold text-[var(--foreground)]">
                Estadísticas del Sistema
              </h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-lg bg-[var(--card)] p-4">
                  <p className="text-xs text-[var(--muted-foreground)]">Emails</p>
                  <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">
                    {systemStats.total_emails}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--card)] p-4">
                  <p className="text-xs text-[var(--muted-foreground)]">Contactos</p>
                  <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">
                    {systemStats.total_contacts}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--card)] p-4">
                  <p className="text-xs text-[var(--muted-foreground)]">Alertas</p>
                  <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">
                    {systemStats.total_alerts}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--card)] p-4">
                  <p className="text-xs text-[var(--muted-foreground)]">Tópicos</p>
                  <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">
                    {systemStats.total_topics}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--card)] p-4">
                  <p className="text-xs text-[var(--muted-foreground)]">Entidades</p>
                  <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">
                    {systemStats.total_entities}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--card)] p-4">
                  <p className="text-xs text-[var(--muted-foreground)]">Hechos</p>
                  <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">
                    {systemStats.total_facts}
                  </p>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
