import Link from "next/link";
import { ExternalLink, Wrench } from "lucide-react";
import { getAllPendingActions } from "@/lib/queries/sp13/odoo-pending-actions";
import { formatCurrencyMXN, formatDate } from "@/lib/formatters";

export const revalidate = 300;
export const metadata = { title: "Pendientes Odoo" };

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Medio",
  low: "Bajo",
};

const SEVERITY_PILL: Record<string, string> = {
  critical: "bg-red-100 text-red-900",
  high: "bg-amber-100 text-amber-900",
  medium: "bg-blue-100 text-blue-900",
  low: "bg-gray-100 text-gray-900",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Pendiente",
  in_progress: "En proceso",
  resolved: "Resuelto",
  wont_fix: "No se hará",
};

const STATUS_PILL: Record<string, string> = {
  open: "bg-orange-100 text-orange-900",
  in_progress: "bg-blue-100 text-blue-900",
  resolved: "bg-emerald-100 text-emerald-900",
  wont_fix: "bg-gray-100 text-gray-700",
};

const AREA_LABEL: Record<string, string> = {
  contabilidad: "Contabilidad",
  productos: "Productos",
  inventario: "Inventario",
  ventas: "Ventas",
  compras: "Compras",
};

export default async function OdooPendientesPage() {
  const actions = await getAllPendingActions();

  const open = actions.filter((a) => a.status === "open");
  const inProgress = actions.filter((a) => a.status === "in_progress");
  const resolved = actions.filter((a) => a.status === "resolved");
  const wontFix = actions.filter((a) => a.status === "wont_fix");

  const totalImpactOpen = open.reduce(
    (s, a) => s + (a.estimatedImpactMxn ?? 0),
    0
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      <header className="border-b pb-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Sistema · Configuración Odoo
        </p>
        <h1 className="text-2xl font-bold mt-1">
          Pendientes de configurar en Odoo para fix de raíz
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          Cada vez que el sistema descubre un problema cuya causa raíz vive en
          la configuración de Odoo (no se puede arreglar 100% en silver), se
          registra aquí con el fix concreto que hay que aplicar y el
          workaround actual mientras tanto.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Kpi label="Pendientes abiertos" value={String(open.length)} tone={open.length > 0 ? "warning" : undefined} />
          <Kpi label="En proceso" value={String(inProgress.length)} />
          <Kpi label="Resueltos" value={String(resolved.length)} tone="success" />
          <Kpi
            label="Impacto estimado abiertos"
            value={formatCurrencyMXN(totalImpactOpen, { compact: true })}
            sub="por mes"
          />
        </div>
      </header>

      {open.length > 0 ? (
        <Section title="🔴 Pendientes" actions={open} />
      ) : (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3">
          ✓ No hay acciones pendientes abiertas.
        </p>
      )}

      {inProgress.length > 0 ? (
        <Section title="🟡 En proceso" actions={inProgress} />
      ) : null}

      {resolved.length > 0 ? (
        <Section title="✅ Resueltos" actions={resolved} dimmed />
      ) : null}

      {wontFix.length > 0 ? (
        <Section title="❌ No se hará" actions={wontFix} dimmed />
      ) : null}
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warning" | "success";
}) {
  const valueColor =
    tone === "warning"
      ? "text-amber-700"
      : tone === "success"
        ? "text-emerald-700"
        : "";
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub ? (
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  actions,
  dimmed,
}: {
  title: string;
  actions: Awaited<ReturnType<typeof getAllPendingActions>>;
  dimmed?: boolean;
}) {
  return (
    <section className={dimmed ? "opacity-60" : ""}>
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <ul className="space-y-3">
        {actions.map((a) => (
          <li
            key={a.actionKey}
            id={a.actionKey}
            className="rounded border bg-card p-4 space-y-3 scroll-mt-24"
          >
            <div className="flex items-start gap-2 flex-wrap">
              <Wrench size={16} className="text-muted-foreground mt-1 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap mb-1">
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${SEVERITY_PILL[a.severity]}`}
                  >
                    {SEVERITY_LABEL[a.severity]}
                  </span>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_PILL[a.status]}`}
                  >
                    {STATUS_LABEL[a.status]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {AREA_LABEL[a.area] ?? a.area}
                  </span>
                  {a.assignee ? (
                    <span className="text-xs text-muted-foreground">
                      · 👤 {a.assignee}
                    </span>
                  ) : null}
                  {a.estimatedImpactMxn != null ? (
                    <span className="text-xs text-muted-foreground">
                      · 💰 ~
                      {formatCurrencyMXN(a.estimatedImpactMxn, {
                        compact: true,
                      })}
                      /mes
                    </span>
                  ) : null}
                </div>
                <h3 className="text-base font-semibold">{a.title}</h3>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                EL PROBLEMA
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {a.problemDescription}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                FIX EN ODOO
              </p>
              <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans bg-muted/30 rounded p-3">
                {a.fixInOdoo}
              </pre>
            </div>

            {a.workaroundInSilver ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">
                  WORKAROUND ACTUAL EN SILVER
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground italic">
                  {a.workaroundInSilver}
                </p>
              </div>
            ) : null}

            <div className="flex items-baseline gap-3 flex-wrap text-xs text-muted-foreground border-t pt-2">
              {a.evidenceUrl ? (
                <Link
                  href={a.evidenceUrl}
                  className="inline-flex items-center gap-1 hover:underline text-foreground"
                >
                  Ver evidencia <ExternalLink size={11} />
                </Link>
              ) : null}
              <span>Abierto desde {formatDate(a.createdAt)}</span>
              {a.resolvedAt ? (
                <span>· Resuelto {formatDate(a.resolvedAt)}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
