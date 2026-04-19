import { notFound } from "next/navigation";
import {
  Building2,
  Flame,
  Inbox,
  Mail,
  UserCheck,
  UserCircle,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  CompanyLink,
  DateDisplay,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getContactDetail } from "@/lib/queries/contacts";

export const dynamic = "force-dynamic";

const riskVariant: Record<
  string,
  "success" | "info" | "warning" | "danger" | "secondary"
> = {
  low: "success",
  medium: "info",
  high: "warning",
  critical: "danger",
};

const riskLabel: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
};

function healthColor(score: number | null): "success" | "info" | "warning" | "danger" {
  if (score == null) return "info";
  if (score >= 80) return "success";
  if (score >= 60) return "info";
  if (score >= 40) return "warning";
  return "danger";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = await getContactDetail(id);
  return { title: contact?.name ?? "Contacto" };
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = await getContactDetail(id);
  if (!contact) notFound();

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Contactos", href: "/contactos" },
          { label: contact.name ?? "Contacto" },
        ]}
        title={contact.name ?? "Sin nombre"}
        subtitle={contact.company_name ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {contact.risk_level && (
              <Badge variant={riskVariant[contact.risk_level] ?? "secondary"}>
                Riesgo {riskLabel[contact.risk_level] ?? contact.risk_level}
              </Badge>
            )}
            {contact.is_customer && <Badge variant="info">Cliente</Badge>}
            {contact.is_supplier && (
              <Badge variant="secondary">Proveedor</Badge>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Health score"
          value={contact.current_health_score ?? 0}
          format="number"
          icon={UserCircle}
          tone={healthColor(contact.current_health_score)}
          subtitle="0–100"
        />
        <KpiCard
          title="Sentimiento"
          value={
            contact.sentiment_score != null
              ? Number(contact.sentiment_score.toFixed(2))
              : 0
          }
          format="number"
          icon={UserCheck}
          subtitle="−1 a +1"
          tone={
            contact.sentiment_score == null
              ? "default"
              : contact.sentiment_score >= 0.5
                ? "success"
                : contact.sentiment_score >= 0
                  ? "info"
                  : "warning"
          }
        />
        <KpiCard
          title="Emails enviados"
          value={contact.total_emails}
          format="number"
          icon={Mail}
          subtitle="por este contacto"
        />
        <KpiCard
          title="Insights activos"
          value={contact.active_insights}
          format="number"
          icon={Inbox}
          tone={contact.active_insights > 0 ? "warning" : "default"}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Contacto */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Datos de contacto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            <InfoRow icon={Mail} label="Email" value={contact.email} copyable />
            <InfoRow
              icon={Building2}
              label="Empresa"
              value={
                contact.company_id && contact.company_name ? (
                  <CompanyLink
                    companyId={contact.company_id}
                    name={contact.company_name}
                  />
                ) : (
                  "—"
                )
              }
            />
            <InfoRow
              icon={Flame}
              label="Última actividad"
              value={
                contact.last_activity ? (
                  <DateDisplay date={contact.last_activity} relative />
                ) : (
                  "—"
                )
              }
            />
          </CardContent>
        </Card>

        {/* Metadata / sistema */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Datos del sistema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            <InfoRow
              label="ID interno"
              value={
                <span className="font-mono text-[11px]">{contact.id}</span>
              }
            />
            <InfoRow
              label="Odoo partner ID"
              value={
                contact.odoo_partner_id ? (
                  <span className="font-mono text-[11px]">
                    {contact.odoo_partner_id}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <InfoRow
              label="Entity ID (KG)"
              value={
                contact.entity_id ? (
                  <span className="font-mono text-[11px]">
                    {contact.entity_id.slice(0, 8)}…
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <InfoRow
              label="Creado"
              value={
                contact.created_at ? (
                  <DateDisplay date={contact.created_at} />
                ) : (
                  "—"
                )
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  copyable,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  copyable?: boolean;
}) {
  const isEmpty = value == null || value === "—" || value === "";
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-sm break-words">
          {isEmpty ? (
            <span className="text-muted-foreground">—</span>
          ) : copyable && typeof value === "string" ? (
            <a
              href={
                label.toLowerCase() === "email"
                  ? `mailto:${value}`
                  : label.toLowerCase() === "teléfono"
                    ? `tel:${value}`
                    : undefined
              }
              className="hover:text-primary transition-colors"
            >
              {value}
            </a>
          ) : (
            value
          )}
        </div>
      </div>
    </div>
  );
}
