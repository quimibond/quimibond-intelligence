import type { AccountNarrative } from "@/lib/queries/sp13/finanzas/account-expense-narrative";

export function AccountNarrativeBlock({
  narrative,
}: {
  narrative: AccountNarrative;
}) {
  return (
    <section className="rounded border bg-gradient-to-r from-card to-muted/20 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-1">
          Qué es esta cuenta
        </h3>
        <p className="text-[15px] leading-relaxed">{narrative.whatIsThis}</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-2">
          Qué movió este período
        </h3>
        <ul className="space-y-1.5 list-disc list-inside text-sm">
          {narrative.driversThisPeriod.map((d, i) => (
            <li key={i} className="leading-relaxed">
              {d}
            </li>
          ))}
        </ul>
      </div>

      {narrative.recommendations.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">
            Recomendación operativa
          </h3>
          <ul className="space-y-1.5 list-disc list-inside text-sm">
            {narrative.recommendations.map((r, i) => (
              <li key={i} className="leading-relaxed">
                {r}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
