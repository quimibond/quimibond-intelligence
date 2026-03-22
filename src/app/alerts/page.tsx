'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { cn, timeAgo } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  Clock,
  MessageSquare,
  Shield,
  TrendingUp,
  ChevronRight,
  Zap,
} from 'lucide-react'

interface Alert {
  id: string
  alert_type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  account: string
  related_contact: string
  contact_name: string
  state: 'new' | 'acknowledged' | 'resolved'
  is_read: boolean
  created_at: string
  resolved_at: string | null
  business_impact: string | null
  suggested_action: string | null
  user_feedback: 'helpful' | 'not_helpful' | 'partially_helpful' | null
  feedback_comment: string | null
  time_to_resolve_hours: number | null
}

type TabValue = 'new' | 'acknowledged' | 'resolved' | 'all'

const ALERT_TYPE_LABELS: Record<string, string> = {
  no_response: 'Sin respuesta',
  stalled_thread: 'Hilo estancado',
  sentiment: 'Sentimiento',
  risk: 'Riesgo',
  opportunity: 'Oportunidad',
  accountability: 'Responsabilidad',
  communication_gap: 'Brecha comunicación',
  high_volume: 'Alto volumen',
}

function getSeverityIcon(severity: string) {
  switch (severity) {
    case 'critical':
      return <Zap className="w-4 h-4" />
    case 'high':
      return <AlertTriangle className="w-4 h-4" />
    case 'medium':
      return <Shield className="w-4 h-4" />
    case 'low':
      return <TrendingUp className="w-4 h-4" />
    default:
      return null
  }
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'high'
    case 'medium':
      return 'medium'
    case 'low':
      return 'low'
    default:
      return 'default'
  }
}

function AlertSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <Skeleton className="w-1 h-32 flex-shrink-0" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-6 w-20" />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface ResolveModalProps {
  alertId: string
  onClose: () => void
  onFeedbackSubmitted: () => void
}

function ResolveModal({ alertId, onClose, onFeedbackSubmitted }: ResolveModalProps) {
  const [feedback, setFeedback] = useState<'helpful' | 'not_helpful' | 'partially_helpful' | null>(
    null
  )
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const { error } = await supabase
        .from('alerts')
        .update({
          user_feedback: feedback,
          feedback_comment: comment || null,
        })
        .eq('id', alertId)

      if (error) throw error

      onFeedbackSubmitted()
      onClose()
    } catch (err) {
      console.error('Error submitting feedback:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isValid = feedback !== null

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
      <p className="text-sm font-medium">¿Fue útil esta alerta?</p>
      <div className="flex gap-2">
        <Button
          variant={feedback === 'helpful' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFeedback('helpful')}
          disabled={isSubmitting}
        >
          Útil
        </Button>
        <Button
          variant={feedback === 'partially_helpful' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFeedback('partially_helpful')}
          disabled={isSubmitting}
        >
          Parcial
        </Button>
        <Button
          variant={feedback === 'not_helpful' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFeedback('not_helpful')}
          disabled={isSubmitting}
        >
          No ayudó
        </Button>
      </div>
      {feedback && (
        <Input
          placeholder="Comentario opcional..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={isSubmitting}
          className="text-sm"
        />
      )}
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
        >
          {isSubmitting ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>
    </div>
  )
}

function AlertCard({
  alert,
  onStateChange,
}: {
  alert: Alert
  onStateChange: (alertId: string, newState: Alert['state'], resolved_at?: string) => void
}) {
  const [isResolvingFeedback, setIsResolvingFeedback] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  const handleReview = async () => {
    setIsUpdating(true)
    try {
      const { error } = await supabase
        .from('alerts')
        .update({ state: 'acknowledged', is_read: true })
        .eq('id', alert.id)

      if (error) throw error
      onStateChange(alert.id, 'acknowledged')
    } catch (err) {
      console.error('Error updating alert:', err)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleResolve = async () => {
    setIsUpdating(true)
    try {
      const resolvedAt = new Date().toISOString()
      const { error } = await supabase
        .from('alerts')
        .update({
          state: 'resolved',
          resolved_at: resolvedAt,
          is_read: true,
        })
        .eq('id', alert.id)

      if (error) throw error
      onStateChange(alert.id, 'resolved', resolvedAt)
      setIsResolvingFeedback(true)
    } catch (err) {
      console.error('Error resolving alert:', err)
    } finally {
      setIsUpdating(false)
    }
  }

  const borderColor =
    alert.severity === 'critical'
      ? 'border-l-red-600'
      : alert.severity === 'high'
        ? 'border-l-orange-600'
        : alert.severity === 'medium'
          ? 'border-l-yellow-600'
          : 'border-l-blue-600'

  return (
    <Card className={cn('border-l-4', borderColor)}>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="font-semibold text-base leading-tight">{alert.title}</h3>
              <Badge variant={getSeverityColor(alert.severity)}>
                <span className="inline-flex items-center gap-1.5">
                  {getSeverityIcon(alert.severity)}
                  {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
                </span>
              </Badge>
              <Badge variant="outline">{ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type}</Badge>
            </div>

            <p className="text-sm text-foreground leading-relaxed">{alert.description}</p>

            {alert.business_impact && (
              <div className="p-3 bg-muted/40 rounded border border-muted text-sm">
                <p className="font-medium text-xs text-muted-foreground mb-1">Impacto comercial</p>
                <p className="text-foreground">{alert.business_impact}</p>
              </div>
            )}

            {alert.suggested_action && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Acción sugerida</p>
                <p className="text-sm text-foreground">{alert.suggested_action}</p>
              </div>
            )}

            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pt-2">
              {alert.contact_name && (
                <Link
                  href={`/contacts/${alert.related_contact}`}
                  className="hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span className="hover:underline">{alert.contact_name}</span>
                </Link>
              )}
              {alert.account && (
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  {alert.account}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 ml-auto">
                <Clock className="w-3.5 h-3.5" />
                {timeAgo(alert.created_at)}
              </span>
            </div>
          </div>
        </div>

        {isResolvingFeedback && alert.state === 'resolved' ? (
          <ResolveModal
            alertId={alert.id}
            onClose={() => setIsResolvingFeedback(false)}
            onFeedbackSubmitted={() => {
              setIsResolvingFeedback(false)
            }}
          />
        ) : (
          <div className="flex gap-2 pt-2">
            {alert.state === 'new' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReview}
                disabled={isUpdating}
                className="gap-1.5"
              >
                <Eye className="w-4 h-4" />
                Revisar
              </Button>
            )}
            {(alert.state === 'new' || alert.state === 'acknowledged') && (
              <Button
                variant="default"
                size="sm"
                onClick={handleResolve}
                disabled={isUpdating}
                className="gap-1.5"
              >
                <CheckCircle className="w-4 h-4" />
                Resolver
              </Button>
            )}
            {alert.state === 'resolved' && alert.user_feedback && (
              <div className="text-xs text-muted-foreground py-2 px-1">
                Feedback: {alert.user_feedback === 'helpful' ? '✓ Útil' : alert.user_feedback === 'partially_helpful' ? '~ Parcial' : '✗ No ayudó'}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabValue>('new')

  useEffect(() => {
    fetchAlerts()
  }, [])

  async function fetchAlerts() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('alerts')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      setAlerts(data || [])
    } catch (err) {
      console.error('Error fetching alerts:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleStateChange(
    alertId: string,
    newState: Alert['state'],
    resolved_at?: string
  ) {
    setAlerts((prev) =>
      prev.map((alert) =>
        alert.id === alertId
          ? {
              ...alert,
              state: newState,
              is_read: true,
              ...(resolved_at && { resolved_at }),
            }
          : alert
      )
    )
  }

  // Filter alerts by state
  const filteredAlerts = alerts.filter((alert) => {
    if (activeTab === 'all') return true
    if (activeTab === 'new') return alert.state === 'new'
    if (activeTab === 'acknowledged') return alert.state === 'acknowledged'
    if (activeTab === 'resolved') return alert.state === 'resolved'
    return true
  })

  // Sort: critical first, then by date (most recent first)
  const sortedAlerts = filteredAlerts.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    const severityA = severityOrder[a.severity as keyof typeof severityOrder] ?? 4
    const severityB = severityOrder[b.severity as keyof typeof severityOrder] ?? 4

    if (severityA !== severityB) return severityA - severityB

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const counts = {
    new: alerts.filter((a) => a.state === 'new').length,
    acknowledged: alerts.filter((a) => a.state === 'acknowledged').length,
    resolved: alerts.filter((a) => a.state === 'resolved').length,
    all: alerts.length,
  }

  const unreadCount = alerts.filter((a) => !a.is_read).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Alertas</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {unreadCount} {unreadCount === 1 ? 'alerta sin leer' : 'alertas sin leer'}
            </p>
          )}
        </div>
      </div>

      <Tabs defaultValue="new" value={activeTab} onValueChange={(val) => setActiveTab(val as TabValue)}>
        <TabsList className="grid w-full max-w-md grid-cols-4">
          <TabsTrigger value="new" className="relative">
            Nuevas
            {counts.new > 0 && (
              <span className="ml-1.5 px-2 py-0.5 bg-red-600 text-white text-xs rounded-full">
                {counts.new}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="acknowledged">
            En Revisión
            {counts.acknowledged > 0 && (
              <span className="ml-1.5 px-2 py-0.5 bg-yellow-600 text-white text-xs rounded-full">
                {counts.acknowledged}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resueltas
            {counts.resolved > 0 && (
              <span className="ml-1.5 px-2 py-0.5 bg-green-600 text-white text-xs rounded-full">
                {counts.resolved}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">
            Todas
            {counts.all > 0 && (
              <span className="ml-1.5 px-2 py-0.5 bg-slate-600 text-white text-xs rounded-full">
                {counts.all}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-4 mt-6">
          {loading ? (
            <>
              <AlertSkeleton />
              <AlertSkeleton />
              <AlertSkeleton />
            </>
          ) : sortedAlerts.length > 0 ? (
            sortedAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onStateChange={handleStateChange} />
            ))
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <Eye className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground">No hay alertas nuevas</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="acknowledged" className="space-y-4 mt-6">
          {loading ? (
            <>
              <AlertSkeleton />
              <AlertSkeleton />
            </>
          ) : sortedAlerts.length > 0 ? (
            sortedAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onStateChange={handleStateChange} />
            ))
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground">No hay alertas en revisión</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="resolved" className="space-y-4 mt-6">
          {loading ? (
            <>
              <AlertSkeleton />
              <AlertSkeleton />
            </>
          ) : sortedAlerts.length > 0 ? (
            sortedAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onStateChange={handleStateChange} />
            ))
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <CheckCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground">No hay alertas resueltas</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-4 mt-6">
          {loading ? (
            <>
              <AlertSkeleton />
              <AlertSkeleton />
              <AlertSkeleton />
            </>
          ) : sortedAlerts.length > 0 ? (
            sortedAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onStateChange={handleStateChange} />
            ))
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <AlertTriangle className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground">No hay alertas</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
