import { Info } from "lucide-react";

export function CostCentersIntro() {
  return (
    <section className="rounded-md border border-blue-200 bg-blue-50/50 p-4 text-sm">
      <div className="flex items-start gap-2">
        <Info size={16} className="mt-0.5 shrink-0 text-blue-700" />
        <div className="space-y-2">
          <p>
            <strong>Régimen actual:</strong> AVCO + workcenters solo en Tejido
            Circular (go-live mayo 2026). Acabado, Tintorería, Entretelas e
            Inspección/Empaque <strong>no absorben MOD+overhead al producto</strong>{" "}
            al producirse — viven en gasto del período.
          </p>
          <p className="text-muted-foreground">
            Este desglose calcula <em>burden rate</em> por unidad producida
            usando la nómina (501.06.*) y overhead fábrica (504.01.*) que
            cargaron a cada centro durante el período. Sirve para dimensionar
            cuánto debería costar cada workcenter cuando se configure en Odoo.
          </p>
        </div>
      </div>
    </section>
  );
}
