export function ExecutiveSummary({
  summary,
  whyWonOrLost,
  topThreeWins,
  topThreeLosses,
}: {
  summary: string;
  whyWonOrLost: string;
  topThreeWins: string[];
  topThreeLosses: string[];
}) {
  const paragraphs = summary.split(/\n\n+/).filter(Boolean);
  return (
    <section className="mt-8 print:break-inside-avoid">
      <h2 className="text-xl font-semibold mb-3">Resumen ejecutivo</h2>
      <div className="space-y-3 text-[15px] leading-relaxed">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      <div className="mt-6 rounded border bg-muted/30 p-4">
        <p className="font-medium mb-1">¿Por qué se ganó o perdió este mes?</p>
        <p className="text-sm leading-relaxed">{whyWonOrLost}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div className="rounded border border-emerald-200 bg-emerald-50/50 p-4">
          <p className="text-sm font-medium text-emerald-900 mb-2">
            Top 3 cosas que salieron bien
          </p>
          <ul className="text-sm space-y-1.5 list-disc list-inside text-emerald-900">
            {topThreeWins.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-red-200 bg-red-50/50 p-4">
          <p className="text-sm font-medium text-red-900 mb-2">
            Top 3 cosas que costaron
          </p>
          <ul className="text-sm space-y-1.5 list-disc list-inside text-red-900">
            {topThreeLosses.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
