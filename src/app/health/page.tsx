'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, timeAgo, formatCurrency } from '@/lib/utils';
import {
  HeartPulse,
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  Zap,
  ChevronRight,
} from 'lucide-react';

interface HealthContact {
  contact_email: string;
  contact_name: string;
  company: string;
  is_customer: boolean;
  overall_score: number;
  previous_score: number;
  trend: 'improving' | 'stable' | 'declining' | 'critical';
  communication_score: number;
  financial_score: number;
  sentiment_score: number;
  responsiveness_score: number;
  engagement_score: number;
  risk_signals: string[];
  opportunity_signals: string[];
  total_invoiced_last_quarter: number;
  avg_response_time: number;
  last_activity: string;
  contact_id?: string;
}

interface SummaryStats {
  total_contacts: number;
  at_risk_count: number;
  healthy_count: number;
  average_score: number;
}

type TrendFilter = 'all' | 'improving' | 'stable' | 'declining' | 'critical';
type CustomerFilter = 'all' | 'customers' | 'prospects';

const trendLabels: Record<string, string> = {
  improving: 'Mejorando',
  stable: 'Estable',
  declining: 'Declinando',
  critical: 'Crítico',
};

const trendVariants: Record<string, string> = {
  improving: 'success',
  stable: 'info',
  declining: 'warning',
  critical: 'critical',
};

function getTrendIcon(trend: string) {
  switch (trend) {
    case 'improving':
      return <TrendingUp className="w-4 h-4 text-[var(--success)]" />;
    case 'declining':
      return <TrendingDown className="w-4 h-4 text-[var(--warning)]" />;
    case 'critical':
      return <AlertCircle className="w-4 h-4 text-[var(--severity-critical)]" />;
    default:
      return <Minus className="w-4 h-4 text-[var(--muted-foreground)]" />;
  }
}

function getHealthLevel(score: number): 'high' | 'mid' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

function getRiskLevel(score: number): string {
  if (score < 40) return 'critical';
  if (score < 70) return 'warning';
  return 'success';
}

function HealthBar({
  score,
  className = '',
}: {
  score: number;
  className?: string;
}) {
  const level = getHealthLevel(score);
  return (
    <div
      className={cn(
        'health-bar-track h-2 bg-muted rounded-full overflow-hidden',
        className
      )}
    >
      <div
        className="health-bar-fill h-full transition-all duration-300"
        data-level={level}
        style={{
          width: `${score}%`,
          backgroundColor: `var(--health-${level})`,
        }}
      />
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const riskLevel = getRiskLevel(score);
  const variant =
    riskLevel === 'critical'
      ? 'critical'
      : riskLevel === 'warning'
        ? 'warning'
        : 'success';

  return (
    <Badge variant={variant} className="font-bold text-sm">
      {score}
    </Badge>
  );
}

function HealthContactRow({
  contact,
  index,
}: {
  contact: HealthContact;
  index: number;
}) {
  const initials = contact.contact_name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const avatarColor =
    contact.overall_score < 40
      ? 'bg-[var(--severity-critical)]'
      : contact.overall_score < 70
        ? 'bg-[var(--warning)]'
        : 'bg-[var(--success)]';

  return (
    <div
      className="group game-card opacity-0 animate-in fade-in slide-in-from-bottom-4"
      style={{
        animationDelay: `${index * 50}ms`,
        animationFillMode: 'forwards',
      }}
    >
      <Card className="hover:border-[var(--primary)] hover:shadow-md transition-all cursor-pointer">
        <CardContent className="p-6">
          <div className="space-y-4">
            {/* Top Row: Avatar, Name, Customer Badge */}
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm',
                  avatarColor
                )}
              >
                {initials}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-[var(--foreground)] truncate">
                      {contact.contact_name}
                    </h3>
                    <p className="text-xs text-[var(--muted-foreground)] truncate">
                      {contact.company}
                    </p>
                  </div>
                  {contact.is_customer && (
                    <Badge
                      variant="success"
                      className="shrink-0 text-xs font-medium"
                    >
                      Cliente
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {contact.contact_email}
                </p>
              </div>
            </div>

            {/* Overall Score with Health Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted-foreground)]">
                  Salud General
                </span>
                <div className="flex items-center gap-2">
                  <ScoreBadge score={contact.overall_score} />
                  {getTrendIcon(contact.trend)}
                </div>
              </div>
              <HealthBar score={contact.overall_score} />
            </div>

            {/* Sub-Scores Grid */}
            <div className="grid grid-cols-5 gap-2 pt-2 border-t border-[var(--border)]">
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">Comunic.</p>
                <HealthBar
                  score={contact.communication_score}
                  className="h-1"
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">Finanzas</p>
                <HealthBar
                  score={contact.financial_score}
                  className="h-1"
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">Sentim.</p>
                <HealthBar score={contact.sentiment_score} className="h-1" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">Respons.</p>
                <HealthBar
                  score={contact.responsiveness_score}
                  className="h-1"
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">Comprom.</p>
                <HealthBar score={contact.engagement_score} className="h-1" />
              </div>
            </div>

            {/* Signals and Activity */}
            <div className="space-y-3 pt-2 border-t border-[var(--border)]">
              {/* Risk and Opportunity Signals */}
              {(contact.risk_signals.length > 0 ||
                contact.opportunity_signals.length > 0) && (
                <div className="flex flex-wrap gap-1">
                  {contact.risk_signals.slice(0, 2).map((signal, idx) => (
                    <Badge
                      key={`risk-${idx}`}
                      variant="critical"
                      className="text-xs font-medium px-2 py-1"
                    >
                      <AlertCircle className="w-3 h-3 mr-1 inline" />
                      {signal}
                    </Badge>
                  ))}
                  {contact.opportunity_signals.slice(0, 2).map((signal, idx) => (
                    <Badge
                      key={`opp-${idx}`}
                      variant="success"
                      className="text-xs font-medium px-2 py-1"
                    >
                      <Zap className="w-3 h-3 mr-1 inline" />
                      {signal}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Bottom Info Row */}
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <span>
                  Última actividad:{' '}
                  <span className="font-medium">
                    {timeAgo(contact.last_activity)}
                  </span>
                </span>
                {contact.total_invoiced_last_quarter > 0 && (
                  <span className="font-medium text-[var(--success)]">
                    {formatCurrency(contact.total_invoiced_last_quarter)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Link */}
          <Link
            href={`/contacts/${contact.contact_email}`}
            className="absolute inset-0 rounded-lg"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  isLoading,
  icon: Icon,
  variant = 'default',
}: {
  label: string;
  value: string | number;
  isLoading: boolean;
  icon?: React.ComponentType<any>;
  variant?: 'default' | 'critical' | 'success' | 'warning';
}) {
  const colorMap = {
    default: 'text-[var(--muted-foreground)]',
    critical: 'text-[var(--severity-critical)]',
    success: 'text-[var(--success)]',
    warning: 'text-[var(--warning)]',
  };

  return (
    <Card className="game-card opacity-0 animate-in fade-in slide-in-from-bottom-4">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--muted-foreground)]">
              {label}
            </p>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p
                className={cn(
                  'text-3xl font-bold',
                  variant !== 'default' && colorMap[variant]
                )}
              >
                {value}
              </p>
            )}
          </div>
          {Icon && (
            <Icon className={cn('h-8 w-8', colorMap[variant])} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function HealthPage() {
  const [contacts, setContacts] = useState<HealthContact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<HealthContact[]>([]);
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('all');
  const [customerFilter, setCustomerFilter] = useState<CustomerFilter>('all');

  useEffect(() => {
    fetchHealthData();
  }, []);

  const fetchHealthData = async () => {
    try {
      setLoading(true);

      // Fetch customer health dashboard
      const { data: healthData, error: healthError } = await supabase.rpc(
        'get_customer_health_dashboard',
        {
          p_min_score: 0,
          p_max_score: 100,
        }
      );

      if (healthError) throw healthError;

      // Fetch contact IDs for linking
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('id, email');

      const contactMap = new Map(
        (contactsData || []).map((c: any) => [c.email, c.id])
      );

      // Enrich health data with contact IDs
      const enrichedData = (healthData || []).map((item: any) => ({
        ...item,
        contact_id: contactMap.get(item.contact_email),
      }));

      setContacts(enrichedData);

      // Calculate summary stats
      const atRiskCount = enrichedData.filter(
        (c: any) => c.overall_score < 40
      ).length;
      const healthyCount = enrichedData.filter(
        (c: any) => c.overall_score >= 70
      ).length;
      const avgScore =
        enrichedData.length > 0
          ? Math.round(
              enrichedData.reduce(
                (sum: number, c: any) => sum + c.overall_score,
                0
              ) / enrichedData.length
            )
          : 0;

      setStats({
        total_contacts: enrichedData.length,
        at_risk_count: atRiskCount,
        healthy_count: healthyCount,
        average_score: avgScore,
      });
    } catch (error) {
      console.error('Error fetching health data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Apply filters
  useEffect(() => {
    let result = contacts;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (contact) =>
          contact.contact_name?.toLowerCase().includes(query) ||
          contact.contact_email?.toLowerCase().includes(query) ||
          contact.company?.toLowerCase().includes(query)
      );
    }

    // Trend filter
    if (trendFilter !== 'all') {
      result = result.filter((contact) => contact.trend === trendFilter);
    }

    // Customer filter
    if (customerFilter === 'customers') {
      result = result.filter((contact) => contact.is_customer);
    } else if (customerFilter === 'prospects') {
      result = result.filter((contact) => !contact.is_customer);
    }

    // Sort by score (worst first)
    result.sort((a, b) => a.overall_score - b.overall_score);

    setFilteredContacts(result);
  }, [searchQuery, trendFilter, customerFilter, contacts]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-2 opacity-0 animate-in fade-in slide-in-from-bottom-4">
        <div className="flex items-center gap-3">
          <HeartPulse className="w-8 h-8 text-[var(--primary)]" />
          <h1 className="text-3xl font-bold text-[var(--foreground)]">
            Salud de Clientes
          </h1>
        </div>
        <p className="text-[var(--muted-foreground)]">
          Monitoreo en tiempo real de la salud y relación con clientes
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total de Contactos"
          value={stats?.total_contacts || 0}
          isLoading={loading}
          icon={HeartPulse}
        />
        <StatCard
          label="En Riesgo (< 40)"
          value={stats?.at_risk_count || 0}
          isLoading={loading}
          icon={AlertCircle}
          variant="critical"
        />
        <StatCard
          label="Saludables (≥ 70)"
          value={stats?.healthy_count || 0}
          isLoading={loading}
          icon={TrendingUp}
          variant="success"
        />
        <StatCard
          label="Puntuación Promedio"
          value={stats?.average_score || 0}
          isLoading={loading}
          variant={
            (stats?.average_score || 0) < 40
              ? 'critical'
              : (stats?.average_score || 0) < 70
                ? 'warning'
                : 'success'
          }
        />
      </div>

      {/* Filter Bar */}
      <Card className="opacity-0 animate-in fade-in slide-in-from-bottom-4">
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Buscar por nombre, empresa o email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-[var(--background)] border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
              />
            </div>

            {/* Filter Controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Trend Filter */}
              <div>
                <label className="text-xs font-medium text-[var(--muted-foreground)] mb-2 block">
                  Tendencia
                </label>
                <select
                  value={trendFilter}
                  onChange={(e) => setTrendFilter(e.target.value as TrendFilter)}
                  className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-md text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  <option value="all">Todas</option>
                  <option value="improving">Mejorando</option>
                  <option value="stable">Estable</option>
                  <option value="declining">Declinando</option>
                  <option value="critical">Crítico</option>
                </select>
              </div>

              {/* Customer Filter */}
              <div>
                <label className="text-xs font-medium text-[var(--muted-foreground)] mb-2 block">
                  Tipo de Contacto
                </label>
                <select
                  value={customerFilter}
                  onChange={(e) =>
                    setCustomerFilter(e.target.value as CustomerFilter)
                  }
                  className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-md text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  <option value="all">Todos</option>
                  <option value="customers">Clientes</option>
                  <option value="prospects">Prospectos</option>
                </select>
              </div>

              {/* Results Count */}
              <div className="flex items-end">
                <p className="text-sm text-[var(--muted-foreground)]">
                  Mostrando{' '}
                  <span className="font-bold text-[var(--foreground)]">
                    {filteredContacts.length}
                  </span>{' '}
                  de{' '}
                  <span className="font-bold text-[var(--foreground)]">
                    {contacts.length}
                  </span>{' '}
                  contactos
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contacts List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="flex-1 space-y-3">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                      <div className="grid grid-cols-5 gap-2 pt-2">
                        {[1, 2, 3, 4, 5].map((j) => (
                          <Skeleton key={j} className="h-2 w-full" />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredContacts.length > 0 ? (
        <div className="space-y-4">
          {filteredContacts.map((contact, index) => (
            <HealthContactRow
              key={contact.contact_email}
              contact={contact}
              index={index}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <HeartPulse className="w-12 h-12 text-[var(--muted-foreground)] mx-auto mb-4 opacity-50" />
            <p className="text-[var(--muted-foreground)] font-medium">
              No hay contactos que coincidan con los filtros
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-2">
              Intenta con diferentes criterios de búsqueda o filtros
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
