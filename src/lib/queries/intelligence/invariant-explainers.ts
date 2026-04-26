/**
 * Plain-language explanations for `reconciliation_issues.invariant_key`.
 *
 * Inbox surfaces these issues with technical descriptions like
 * "Odoo posted sin cfdi_uuid (post-addon-fix)" — meaningless to a CEO or
 * to Sandra. Each entry maps the invariant to:
 *   - title:        what should appear at the top of the detail page
 *   - what:         what the system observed in plain language
 *   - why:          why the CEO/responsible should care
 *   - howToFix:     ordered checklist of concrete next steps
 *   - autoCloses:   the condition under which auto-validate (cron each 30
 *                   minutes) will silently close the issue (so the CEO
 *                   knows when to ignore vs act).
 *   - severity:     short justification for the severity assigned.
 *
 * Keep entries terse: one sentence per field. The UI lays them out as
 * QuestionSection blocks, so prose padding hurts scannability.
 */

export interface InvariantExplainer {
  title: string;
  what: string;
  why: string;
  howToFix: string[];
  autoCloses: string;
  /** When the issue references a specific invoice/payment, this label
   *  prefixes the entity row in the UI. */
  entityLabel: "Factura" | "Pago" | "Pedido" | "Movimiento" | "Entidad";
}

const EXPLAINERS: Record<string, InvariantExplainer> = {
  "invoice.posted_without_uuid": {
    title: "Factura registrada en Odoo sin UUID timbrado",
    what:
      "Odoo tiene la factura en estado posted (cerrada) pero no encontramos su UUID del SAT. Eso significa: o no se timbró, o se timbró pero el addon no sincronizó el folio fiscal de regreso.",
    why:
      "Sin UUID no hay CFDI válido. El cliente no puede deducir, contabilidad no la puede usar para conciliación fiscal y no aparece en la auditoría SAT.",
    howToFix: [
      "Buscar la factura en Odoo por su nombre (ej: INV/2025/03/0185).",
      "Si NO está timbrada: timbrarla desde Odoo (botón Validar / Send to SAT).",
      "Si SÍ está timbrada en Odoo pero falta el UUID en Supabase: forzar sync del addon (run cron de qb19) y esperar 1h.",
      "Si después de eso sigue sin UUID, escalar a equipo de IT — puede ser un bug del PAC.",
    ],
    autoCloses:
      "Cuando el addon de Odoo sincroniza el cfdi_uuid o cuando el invariante detecta que SAT ya tiene el CFDI vigente.",
    entityLabel: "Factura",
  },

  "invoice.ar_sat_only_drift": {
    title: "CFDI emitido al SAT que no aparece en Odoo",
    what:
      "El SAT registra un CFDI que Quimibond emitió a un cliente, pero Odoo no tiene la factura correspondiente. Es un timbrado manual fuera del flujo del ERP.",
    why:
      "La cartera por cobrar de Odoo está incompleta — esa factura no se va a cobrar porque nadie sabe que existe en el sistema operativo. El cliente sí la recibió fiscalmente.",
    howToFix: [
      "Identificar al receptor del CFDI (ver UUID + RFC en metadata).",
      "Crear la factura en Odoo con el mismo monto/fecha del CFDI.",
      "Ligar manualmente el CFDI con la factura recién creada (mdm_link_invoice).",
      "O bien, si el CFDI fue un error: cancelarlo en SAT.",
    ],
    autoCloses:
      "Cuando se crea la factura en Odoo y el matcher la liga al CFDI por UUID o por monto + fecha + RFC.",
    entityLabel: "Factura",
  },

  "invoice.amount_mismatch": {
    title: "El monto de la factura difiere entre Odoo y SAT",
    what:
      "La misma factura existe en Odoo y en SAT pero con montos distintos por encima del umbral de tolerancia.",
    why:
      "Una de las dos fuentes está mal. Si el cliente paga el monto del SAT y Odoo dice otra cosa, se va a quedar una diferencia abierta en la cartera para siempre.",
    howToFix: [
      "Comparar el subtotal + IVA entre las dos fuentes (ver metadata.diff_mxn).",
      "Identificar la fuente correcta (normalmente SAT manda).",
      "Editar la factura del lado equivocado o crear una nota de crédito.",
    ],
    autoCloses:
      "Cuando los montos cuadran dentro del umbral de tolerancia (±$10 MXN o ±0.5%).",
    entityLabel: "Factura",
  },

  "invoice.amount_diff_post_fx": {
    title: "Diferencia de monto Odoo vs SAT después de aplicar tipo de cambio",
    what:
      "Factura en moneda extranjera. Aún convirtiendo Odoo y SAT a MXN con sus respectivos tipos de cambio, los totales no coinciden.",
    why:
      "Suele ser por TC distinto entre el SAT (DOF del día) y Odoo (TC manual o de pricelist). Si la diferencia es grande, alguien usó un TC equivocado.",
    howToFix: [
      "Revisar el TC usado en Odoo vs el TC del DOF en la fecha de timbrado.",
      "Si el TC de Odoo está mal, corregirlo en la factura.",
      "Si la diferencia es <1% es ruido normal — escalable a Silver SP6 para subir el umbral.",
    ],
    autoCloses:
      "Cuando los montos en MXN cuadran dentro del umbral, o cuando se corrige el TC en Odoo.",
    entityLabel: "Factura",
  },

  "invoice.date_drift": {
    title: "Diferencia de fechas entre Odoo y SAT",
    what:
      "La fecha de factura registrada en Odoo no coincide con la fecha de timbrado en SAT por más de N días.",
    why:
      "Puede afectar el corte mensual de ingresos contables vs fiscales. La factura puede caer en un mes para Odoo y otro para el SAT.",
    howToFix: [
      "Verificar cuál fecha es correcta (la del SAT es inmutable).",
      "Ajustar la fecha en Odoo si fue un error de captura.",
    ],
    autoCloses:
      "Cuando ambas fechas caen en el mismo mes calendario (umbral por defecto).",
    entityLabel: "Factura",
  },

  "invoice.state_mismatch_posted_cancelled": {
    title: "Odoo dice posted pero SAT dice cancelado",
    what:
      "La factura está cerrada y vigente para Odoo, pero el SAT ya recibió la cancelación.",
    why:
      "Odoo va a seguir cobrando una factura que fiscalmente ya no existe. El cliente no la va a pagar.",
    howToFix: [
      "Cancelar la factura en Odoo (estado=cancel) y, si aplica, emitir nota de crédito.",
      "Confirmar con el cliente por qué se canceló el CFDI.",
    ],
    autoCloses:
      "Cuando Odoo registra la factura como cancelled y los estados coinciden.",
    entityLabel: "Factura",
  },

  "invoice.state_mismatch_cancel_vigente": {
    title: "Odoo dice cancelada pero SAT dice vigente",
    what:
      "Alguien canceló la factura en Odoo sin cancelar el CFDI en el SAT.",
    why:
      "El cliente todavía tiene un CFDI válido por una factura que Quimibond da por inexistente. Riesgo de doble facturación o de que el cliente la pague y el dinero no encuentre destino.",
    howToFix: [
      "Cancelar el CFDI en SAT (proceso de cancelación con acuse del receptor).",
      "Si el cliente no acepta, revertir la cancelación en Odoo.",
    ],
    autoCloses:
      "Cuando ambos lados quedan cancelled o ambos vigentes.",
    entityLabel: "Factura",
  },

  "invoice.pending_operationalization": {
    title: "CFDI emitido en SAT pendiente de operacionalizar en Odoo",
    what:
      "El SAT tiene el CFDI pero no existe la factura correspondiente en Odoo (post-2021).",
    why:
      "Misma raíz que ar_sat_only_drift pero específica al período donde Odoo es la fuente operativa: la cartera/inventario está incompleta.",
    howToFix: [
      "Crear la factura en Odoo basada en el CFDI.",
      "Ligar manualmente con mdm_link_invoice usando el UUID.",
    ],
    autoCloses:
      "Cuando se crea y liga la factura en Odoo.",
    entityLabel: "Factura",
  },

  "invoice.missing_sat_timbrado": {
    title: "Factura en Odoo sin CFDI timbrado en SAT",
    what:
      "Misma situación que posted_without_uuid pero detectada por la ausencia de records SAT correspondientes (no por la ausencia de UUID en Odoo).",
    why:
      "La factura no es deducible para el cliente y Quimibond no puede contabilizar el ingreso fiscalmente.",
    howToFix: [
      "Timbrar la factura desde Odoo.",
      "Verificar que el PAC esté activo y el certificado del SAT vigente.",
    ],
    autoCloses:
      "Cuando aparece el CFDI correspondiente en SAT.",
    entityLabel: "Factura",
  },

  "invoice.credit_note_orphan": {
    title: "Nota de crédito SAT sin factura origen",
    what:
      "El SAT registra un egreso (nota de crédito) pero no encontramos la factura ingreso a la que aplica.",
    why:
      "Una nota de crédito reduce un ingreso. Sin saber a cuál factura aplica, contabilidad no puede ajustar la cartera ni el reporte de ventas.",
    howToFix: [
      "Buscar el UUID padre referenciado en el egreso.",
      "Crear la factura origen en Odoo si falta, o ligar la nota a la factura existente.",
    ],
    autoCloses:
      "Cuando el matcher resuelve el UUID padre.",
    entityLabel: "Factura",
  },

  "payment.registered_without_complement": {
    title: "Pago en Odoo sin complemento Tipo P en SAT",
    what:
      "Odoo registra una factura pagada en parcialidades (PPD) hace más de 30 días, pero el SAT no tiene el complemento de pago Tipo P correspondiente.",
    why:
      "Las facturas PPD requieren complemento por cada pago. Sin complemento, Quimibond está incumpliendo obligaciones fiscales y el cliente no puede deducir el pago.",
    howToFix: [
      "Emitir el complemento Tipo P en Odoo o desde el portal del PAC.",
      "Si la factura no era realmente PPD: cambiar el método de pago en Odoo.",
    ],
    autoCloses:
      "Cuando el complemento aparece en el SAT vinculado al UUID padre.",
    entityLabel: "Pago",
  },

  "payment.complement_without_payment": {
    title: "Complemento de pago en SAT sin pago en Odoo",
    what:
      "El SAT recibió un complemento Tipo P (un pago) pero Odoo no tiene el pago correspondiente registrado.",
    why:
      "El cliente ya pagó (lo registró en SAT), pero la cartera de Odoo lo sigue marcando como abierto. Riesgo de pedirle al cliente algo que ya pagó.",
    howToFix: [
      "Buscar el complemento por UUID o por monto + fecha + RFC.",
      "Registrar el pago en Odoo ligado a la factura correspondiente.",
      "Si fue un complemento por error: cancelarlo en SAT.",
    ],
    autoCloses:
      "Cuando el matcher liga el complemento con un pago de Odoo.",
    entityLabel: "Pago",
  },

  "inventory.move_without_accounting": {
    title: "Movimiento de inventario sin asiento contable",
    what:
      "Stock entró o salió del almacén pero no hay un asiento contable correspondiente en Odoo.",
    why:
      "Inventario y contabilidad no cuadran. El balance va a estar mal.",
    howToFix: [
      "Buscar el stock.move por su nombre (ej: TVAR/IN/02823).",
      "Validar el asiento contable manualmente desde Odoo.",
      "Si el journal del producto no tiene cuenta de inventario configurada, configurarla.",
    ],
    autoCloses:
      "Cuando el asiento contable se genera en Odoo.",
    entityLabel: "Movimiento",
  },

  "sale_chain.delivered_not_invoiced": {
    title: "Pedido entregado sin facturar",
    what:
      "El SO se entregó pero no se ha facturado al cliente. El gap puede ser de días o meses.",
    why:
      "Producto fuera del almacén sin CxC abierta. Riesgo de no cobrar nunca y de descuadre inventario vs ingresos.",
    howToFix: [
      "Generar la factura desde el SO en Odoo (botón Crear factura).",
      "Si la entrega fue parcial, facturar solo lo entregado.",
      "Si el cliente requiere consolidar varias entregas en una factura, agendar la facturación.",
    ],
    autoCloses:
      "Cuando se genera la factura cubriendo lo entregado.",
    entityLabel: "Pedido",
  },
};

const FALLBACK: InvariantExplainer = {
  title: "Inconsistencia detectada por el motor de reconciliación",
  what: "Una de las invariantes del silver layer detectó un desajuste entre fuentes que requiere atención manual.",
  why: "Sin resolverlo, los reportes financieros u operativos pueden mostrar números incorrectos.",
  howToFix: [
    "Abrir el detalle de la entidad referenciada para entender el contexto.",
    "Comparar los datos entre Odoo y SAT manualmente.",
    "Aplicar la corrección en la fuente que tiene el dato equivocado.",
  ],
  autoCloses: "Cuando el invariante deja de detectar la condición en su próxima corrida.",
  entityLabel: "Entidad",
};

/** Look up the explainer for an invariant_key, falling back to a generic
 *  description so the UI never renders a blank screen. */
export function explainInvariant(invariantKey: string | null): InvariantExplainer {
  if (!invariantKey) return FALLBACK;
  return EXPLAINERS[invariantKey] ?? FALLBACK;
}

/** Used by tests to detect new invariants emitted by the silver pipeline
 *  that we haven't authored an explainer for yet. */
export function knownInvariantKeys(): string[] {
  return Object.keys(EXPLAINERS);
}
