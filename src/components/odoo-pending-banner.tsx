import "server-only";
import Link from "next/link";
import { ArrowRight, Wrench } from "lucide-react";
import { getPendingActionByKey } from "@/lib/queries/sp13/odoo-pending-actions";
import { formatCurrencyMXN } from "@/lib/formatters";

const SEVERITY_STYLE: Record<
  string,
  { border: string; bg: string; pillBg: string; pillText: string }
> = {
  critical: {
    border: "border-red-300",
    bg: "bg-red-50/50",
    pillBg: "bg-red-100",
    pillText: "text-red-900",
  },
  high: {
    border: "border-amber-300",
    bg: "bg-amber-50/50",
    pillBg: "bg-amber-100",
    pillText: "text-amber-900",
  },
  medium: {
    border: "border-blue-300",
    bg: "bg-blue-50/40",
    pillBg: "bg-blue-100",
    pillText: "text-blue-900",
  },
  low: {
    border: "border-gray-300",
    bg: "bg-gray-50/50",
    pillBg: "bg-gray-100",
    pillText: "text-gray-900",
  },
};

const STATUS_LABEL: Record<string, string> = {
  open: "Pendiente",
  in_progress: "En proceso",
  resolved: "Resuelto",
  wont_fix: "No se hará",
};

/**
 * Banner inline que muestra una acción pendiente de Odoo en el contexto
 * donde es relevante. Si la acción está resuelta o no existe, no renderiza nada.
 */
export async function OdooPendingBanner({
  actionKey,
  inline = false,
}: {
  actionKey: string;
  inline?: boolean;
}) {
  const action = await getPendingActionByKey(actionKey);
  if (!action) return null;
  if (action.status === "resolved" || action.status === "wont_fix") return null;

  const style = SEVERITY_STYLE[action.severity] ?? SEVERITY_STYLE.medium;

  return (
    <div
      className={`rounded border ${style.border} ${style.bg} ${inline ? "p-3" : "p-4"} space-y-2`}
    >
      <div className="flex items-start gap-2">
        <Wrench
          size={16}
          className="text-foreground/60 mt-0.5 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${style.pillBg} ${style.pillText}`}
            >
              Acción pendiente Odoo · {action.severity}
            </span>
            <span className="text-xs text-muted-foreground">
              {STATUS_LABEL[action.status] ?? action.status}
              {action.assignee ? ` · ${action.assignee}` : ""}
            </span>
            {action.estimatedImpactMxn != null ? (
              <span className="text-xs text-muted-foreground">
                · impacto ~
                {formatCurrencyMXN(action.estimatedImpactMxn, { compact: true })}
                /mes
              </span>
            ) : null}
          </div>
          <p className="text-sm font-medium mt-1">{action.title}</p>
          {!inline ? (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {action.problemDescription.slice(0, 220)}
              {action.problemDescription.length > 220 ? "…" : ""}
            </p>
          ) : null}
          <Link
            href={`/sistema/odoo-pendientes#${action.actionKey}`}
            className="inline-flex items-center gap-1 text-xs font-medium mt-1.5 hover:underline"
          >
            Ver detalle y fix en Odoo <ArrowRight size={11} />
          </Link>
        </div>
      </div>
    </div>
  );
}
