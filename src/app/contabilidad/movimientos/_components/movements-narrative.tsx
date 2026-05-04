import type { CrossAccountNarrative } from "@/lib/queries/sp13/finanzas/cross-account-narrative";

export function MovementsNarrative({
  narrative,
}: {
  narrative: CrossAccountNarrative;
}) {
  return (
    <section className="rounded border-2 border-foreground/10 bg-gradient-to-r from-card to-muted/20 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-1">
          Insight principal
        </h3>
        <p className="text-[15px] leading-relaxed">{narrative.topInsight}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded border border-red-200 bg-red-50/40 p-4">
          <p className="text-sm font-medium text-red-900 mb-2">
            Las que más castigaron utilidad
          </p>
          <ul className="text-sm space-y-1.5 list-disc list-inside text-red-900">
            {narrative.biggestIncreases.map((s, i) => (
              <li key={i} className="leading-relaxed">
                {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-emerald-200 bg-emerald-50/40 p-4">
          <p className="text-sm font-medium text-emerald-900 mb-2">
            Las que ayudaron
          </p>
          <ul className="text-sm space-y-1.5 list-disc list-inside text-emerald-900">
            {narrative.biggestDecreases.map((s, i) => (
              <li key={i} className="leading-relaxed">
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {narrative.recommendations.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">
            Acciones priorizadas
          </h3>
          <ol className="space-y-1.5 list-decimal list-inside text-sm">
            {narrative.recommendations.map((r, i) => (
              <li key={i} className="leading-relaxed">
                {r}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
