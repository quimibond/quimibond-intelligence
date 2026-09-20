-- 2026-09-19a — Situación de la empresa (plan A, paso 1): esquema y catálogo.
-- Spec: qb19/docs/superpowers/specs/2026-09-18-situacion-empresa-design.md §3–§5.
-- Supabase guarda SEÑALES DERIVADAS (una fila por hecho, con modelo+id del
-- documento de Odoo), nunca cifras copiadas. Idempotente.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- ya existe, en el esquema public (025_utility_improvements.sql)

-- 3.2 Catálogo: lo que no está aquí no existe para la IA.
CREATE TABLE IF NOT EXISTS public.senales_config (
  senal           text PRIMARY KEY,
  titulo          text NOT NULL,
  area            text NOT NULL CHECK (area IN ('comercial','operaciones','compras','finanzas','calidad_sgi','rh','sistemas','direccion')),
  tipo            text NOT NULL CHECK (tipo IN ('obligacion','credito','problema','riesgo','oportunidad','higiene')),
  fuente          text NOT NULL CHECK (fuente IN ('odoo','memoria','watchdog')),
  activa          boolean NOT NULL DEFAULT true,
  umbrales        jsonb NOT NULL DEFAULT '{}'::jsonb,
  severidad_base  smallint NOT NULL DEFAULT 2 CHECK (severidad_base BETWEEN 1 AND 5),
  severidad_max   smallint NOT NULL DEFAULT 4 CHECK (severidad_max BETWEEN 1 AND 5),
  reglas_calidad  jsonb NOT NULL DEFAULT '{}'::jsonb,
  agrupar_por     text NOT NULL DEFAULT 'contraparte' CHECK (agrupar_por IN ('contraparte','documento','responsable','situacion','payload','ninguno')),
  agregar         text NOT NULL DEFAULT 'suma' CHECK (agregar IN ('suma','cuenta','maximo')),
  cada_horas      integer NOT NULL DEFAULT 1 CHECK (cada_horas >= 1),
  sin_datos_horas integer,
  descripcion     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.senales_config IS 'Catálogo de señales (spec §3.2/§4). umbrales: parámetros de la consulta en la fuente (p.ej. {"dias":7}); reglas_calidad: {"antigua_dias":30,"zombie_dias":90,"vencida_dias":21,"limpieza":"…"}; agrupar_por decide qué señales forman una situación; agregar decide el valor agregado (suma de valor, cuenta de filas o máximo); cada_horas: turno del push; sin_datos_horas: edad del último lote bueno a partir de la cual la señal se reporta sin_datos (default 2×cada_horas).';

-- 3.1 Señales: una fila por episodio.
CREATE TABLE IF NOT EXISTS public.senales (
  id                        bigserial PRIMARY KEY,
  clave                     text NOT NULL,
  episodio                  integer NOT NULL DEFAULT 1,
  senal                     text NOT NULL REFERENCES public.senales_config(senal),
  area                      text NOT NULL,
  tipo                      text NOT NULL,
  fuente                    text NOT NULL,
  agrupador                 text NOT NULL DEFAULT 'todas',
  documentos                jsonb NOT NULL DEFAULT '[]'::jsonb,
  company_id                bigint,
  odoo_partner_id           integer,
  responsable_odoo_user_id  integer,
  valor                     numeric,
  valor_texto               text,
  vence                     date,
  primera_vista             timestamptz NOT NULL DEFAULT now(),
  vista_en                  timestamptz NOT NULL DEFAULT now(),
  valor_cambio_en           timestamptz NOT NULL DEFAULT now(),
  resuelta_en               timestamptz,
  calidad                   text NOT NULL DEFAULT 'viva' CHECK (calidad IN ('viva','antigua','zombie','dato_malo','vencida_memoria','ignorada')),
  calidad_motivo            text,
  payload                   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS senales_abierta_uniq ON public.senales (clave) WHERE resuelta_en IS NULL;
CREATE INDEX IF NOT EXISTS senales_senal_idx    ON public.senales (senal, resuelta_en);
CREATE INDEX IF NOT EXISTS senales_area_idx     ON public.senales (area, calidad) WHERE resuelta_en IS NULL;
CREATE INDEX IF NOT EXISTS senales_company_idx  ON public.senales (company_id);
CREATE INDEX IF NOT EXISTS senales_clave_idx    ON public.senales (clave);
COMMENT ON TABLE public.senales IS 'Hechos determinísticos con clave estable (spec §3.1). Una fila por episodio: si la clave reaparece tras resolverse, fila nueva con episodio+1. agrupador lo calcula senales_ingestar según senales_config.agrupar_por (company:<id>, doc:<modelo>:<id>, user:<id>, grupo:<payload.grupo>, todas). payload.fecha_base (date) alimenta la regla zombie; payload.dato_malo (texto) la etiqueta dato_malo; payload.ultimo_correo (timestamptz) las reglas antigua/vencida_memoria.';

-- 3.1.1 Lotes: un lote por señal y corrida. La resolución solo ocurre con lote completo.
CREATE TABLE IF NOT EXISTS public.senales_lotes (
  id              bigserial PRIMARY KEY,
  senal           text NOT NULL REFERENCES public.senales_config(senal),
  fuente          text NOT NULL,
  corrida         uuid NOT NULL,
  recibido_en     timestamptz NOT NULL DEFAULT now(),
  n_claves        integer NOT NULL DEFAULT 0,
  n_nuevas        integer NOT NULL DEFAULT 0,
  n_actualizadas  integer NOT NULL DEFAULT 0,
  n_resueltas     integer NOT NULL DEFAULT 0,
  ok              boolean NOT NULL DEFAULT true,
  error           text
);
CREATE INDEX IF NOT EXISTS senales_lotes_senal_idx ON public.senales_lotes (senal, recibido_en DESC);
CREATE INDEX IF NOT EXISTS senales_lotes_corrida_idx ON public.senales_lotes (corrida);

-- 3.3 Situaciones: unidades de atención.
CREATE TABLE IF NOT EXISTS public.situaciones (
  id                            bigserial PRIMARY KEY,
  clave                         text NOT NULL UNIQUE,
  senal                         text NOT NULL REFERENCES public.senales_config(senal),
  agrupador                     text NOT NULL,
  area                          text NOT NULL,
  tipo                          text NOT NULL,
  titulo                        text NOT NULL,
  resumen                       text,
  company_id                    bigint,
  odoo_partner_id               integer,
  documentos                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidencia                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  responsable_sugerido_user_id  integer,
  responsable_motivo            text,
  severidad                     smallint NOT NULL DEFAULT 2 CHECK (severidad BETWEEN 1 AND 5),
  desde                         date NOT NULL DEFAULT current_date,
  vence                         date,
  estado                        text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','empeoro','mejoro','resuelta','descartada','delegada')),
  calidad                       text NOT NULL DEFAULT 'viva',
  recomendacion                 text,
  delegacion                    jsonb,
  historia                      jsonb NOT NULL DEFAULT '[]'::jsonb,
  n_senales                     integer NOT NULL DEFAULT 0,
  valor                         numeric,
  valor_texto                   text,
  ultimo_cambio                 text,
  ultimo_cambio_en              timestamptz NOT NULL DEFAULT now(),
  version                       integer NOT NULL DEFAULT 1,
  ia_version                    integer NOT NULL DEFAULT 0,
  ia_modelo                     text,
  fusionada_en                  bigint REFERENCES public.situaciones(id),
  resuelta_en                   timestamptz,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS situaciones_abiertas_idx ON public.situaciones (area, severidad DESC) WHERE estado NOT IN ('resuelta','descartada') AND fusionada_en IS NULL;
CREATE INDEX IF NOT EXISTS situaciones_company_idx ON public.situaciones (company_id);
CREATE INDEX IF NOT EXISTS situaciones_titulo_trgm ON public.situaciones USING gin (titulo gin_trgm_ops);
COMMENT ON TABLE public.situaciones IS 'Agrupación determinística de señales (clave senal|agrupador; spec §3.3). SQL crea/actualiza/resuelve; la IA solo escribe titulo, resumen, recomendacion, severidad (en banda), responsable sugerido y fusiones (ia_version = version cuando la redacción está al día). dias_abierta y dias_sin_cambio se calculan en las RPCs (Postgres no admite columnas generadas con now()). fusionada_en: absorbida por otra situación (sale del mapa; reversible).';

-- 3.4 Reglas del CEO.
CREATE TABLE IF NOT EXISTS public.situacion_reglas (
  id             bigserial PRIMARY KEY,
  alcance        text NOT NULL CHECK (alcance IN ('senal','contraparte','documento','situacion')),
  clave_alcance  text NOT NULL,
  accion         text NOT NULL CHECK (accion IN ('ignorar','no_es_problema','severidad_fija','responsable_fijo')),
  valor          jsonb NOT NULL DEFAULT '{}'::jsonb,
  motivo         text,
  vigente_hasta  timestamptz,
  creada_por     text NOT NULL DEFAULT 'ceo',
  creada_en      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.situacion_reglas IS 'Decisiones del CEO que persisten (spec §3.4). clave_alcance: senal → nombre de la señal; contraparte → company:<id> o partner:<odoo_partner_id>; documento → <modelo>:<id>; situacion → clave de la situación.';

-- 3.5 Bitácora de corridas.
CREATE TABLE IF NOT EXISTS public.situacion_corridas (
  id             bigserial PRIMARY KEY,
  corrida        uuid NOT NULL,
  origen         text NOT NULL DEFAULT 'manual',
  iniciada_en    timestamptz NOT NULL DEFAULT now(),
  sql_lista_en   timestamptz,
  terminada_en   timestamptz,
  n_senales      integer,
  n_candidatas   integer,
  n_nuevas       integer,
  n_actualizadas integer,
  n_resueltas    integer,
  n_redactadas   integer,
  n_fusiones     integer,
  n_ignoradas    integer,
  tokens_in      integer,
  tokens_out     integer,
  modelo         text,
  errores        jsonb NOT NULL DEFAULT '[]'::jsonb,
  detalle        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS situacion_corridas_inicio_idx ON public.situacion_corridas (iniciada_en DESC);

-- §4 regla 1: personas detrás de buzones compartidos (lo manda _push_users desde qb.memoria.mailbox).
CREATE TABLE IF NOT EXISTS public.buzon_personas (
  buzon         text NOT NULL,
  odoo_user_id  integer NOT NULL,
  area          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buzon, odoo_user_id)
);

CREATE OR REPLACE FUNCTION public.buzon_personas_reemplazar(p_filas jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM buzon_personas;
  INSERT INTO buzon_personas (buzon, odoo_user_id, area)
  SELECT lower(f->>'buzon'), (f->>'odoo_user_id')::int, f->>'area'
  FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) f
  WHERE coalesce(f->>'buzon', '') <> '' AND (f->>'odoo_user_id') IS NOT NULL
  ON CONFLICT (buzon, odoo_user_id) DO UPDATE SET area = EXCLUDED.area, updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.buzon_personas_reemplazar(jsonb) FROM public, anon, authenticated;

-- Permisos: solo service_role (Odoo, Edge Functions y el MCP usan la service key).
REVOKE ALL ON public.senales_config, public.senales, public.senales_lotes, public.situaciones,
              public.situacion_reglas, public.situacion_corridas, public.buzon_personas FROM anon, authenticated;

-- Catálogo inicial (spec §4). Los umbrales se cambian con UPDATE, no con despliegue.
INSERT INTO public.senales_config (senal, titulo, area, tipo, fuente, umbrales, severidad_base, severidad_max, reglas_calidad, agrupar_por, agregar, cada_horas, descripcion) VALUES
-- Comercial
('entrega_vencida', 'Entrega vencida', 'comercial', 'obligacion', 'odoo', '{}', 3, 5, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'Salidas a cliente (stock.picking outgoing) no hechas ni canceladas con fecha programada pasada, por cliente.'),
('pedido_sin_fecha', 'Pedido sin fecha comprometida', 'comercial', 'riesgo', 'odoo', '{}', 2, 3, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'Pedidos confirmados sin commitment_date y con líneas por entregar.'),
('cliente_sin_respuesta', 'Cliente sin respuesta', 'comercial', 'obligacion', 'memoria', '{"dias":3}', 3, 5, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'Conversaciones donde el último correo es del cliente y llevan más de N días sin respuesta nuestra, por empresa.'),
('compromiso_correo', 'Compromiso por correo', 'comercial', 'obligacion', 'memoria', '{}', 2, 4, '{"antigua_dias":30,"vencida_dias":21}', 'contraparte', 'cuenta', 1, 'Pendientes de la memoria (memoria_thread_summaries.pendientes) donde quien=nosotros, uno por conversación y texto.'),
('cliente_callado', 'Cliente callado', 'comercial', 'riesgo', 'memoria', '{"factor":2,"min_dias":14,"min_correos":6}', 2, 4, '{"antigua_dias":45}', 'contraparte', 'cuenta', 24, 'Clientes de Odoo sin correo entrante en más de 2× su intervalo habitual (mediana de días entre correos entrantes, 12 meses).'),
('oportunidad_demanda', 'Demanda detectada en correo', 'comercial', 'oportunidad', 'memoria', '{"dias":60}', 2, 3, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'Señales de demanda (customer_demand_signals) de los últimos N días, una por señal.'),
('lead_frio', 'Oportunidad fría', 'comercial', 'oportunidad', 'odoo', '{"dias":14}', 1, 3, '{"antigua_dias":30,"zombie_dias":120}', 'responsable', 'cuenta', 6, 'crm.lead abierta sin cambio de etapa ni actividad en N días.'),
('venta_margen_negativo', 'Venta con margen negativo', 'comercial', 'problema', 'odoo', '{"dias":90}', 3, 4, '{"antigua_dias":30}', 'contraparte', 'suma', 6, 'Líneas de pedido confirmadas con margen < 0 (últimos N días). Costo 0 o precio 0 = dato_malo.'),
('producto_pierde', 'Producto que pierde', 'comercial', 'problema', 'odoo', '{}', 3, 4, '{"antigua_dias":60}', 'payload', 'suma', 6, 'qb.producto.rentabilidad con semáforo rojo (12 meses).'),
('cliente_pierde', 'Cliente que pierde', 'comercial', 'problema', 'odoo', '{}', 3, 4, '{"antigua_dias":60}', 'contraparte', 'suma', 6, 'qb.cliente.rentabilidad con semáforo rojo (12 meses).'),
('cotizacion_bajo_costo', 'Cotización bajo costo', 'comercial', 'riesgo', 'odoo', '{"dias_vigencia":15}', 3, 4, '{"antigua_dias":30}', 'contraparte', 'cuenta', 6, 'qb.cotizacion en borrador o presentada con semáforo rojo; por vencer si validez_hasta ≤ hoy+N.'),
-- Operaciones
('op_atrasada', 'Orden de producción atrasada', 'operaciones', 'problema', 'odoo', '{"dias":7}', 3, 4, '{"antigua_dias":30,"zombie_dias":90,"limpieza":"Cancelar o cerrar en Fabricación las OPs confirmadas hace más de 90 días sin movimientos."}', 'responsable', 'cuenta', 1, 'mrp.production confirmada/en progreso con inicio planeado hace más de N días, por responsable.'),
('op_sin_componentes', 'OP de la semana sin componentes', 'operaciones', 'riesgo', 'odoo', '{"dias":7}', 3, 4, '{"antigua_dias":14}', 'responsable', 'cuenta', 1, 'OPs que arrancan en los próximos N días con componentes sin reservar (reservation_state != assigned).'),
('tiempos_excepcion', 'Tiempo de máquina fuera de rango', 'operaciones', 'problema', 'odoo', '{"dias":7}', 2, 3, '{"antigua_dias":14}', 'payload', 'cuenta', 6, 'qb.workorder.excepcion de la última semana (lento, rápido, sin horas), por tipo.'),
('existencia_negativa', 'Existencia negativa', 'operaciones', 'problema', 'odoo', '{}', 2, 4, '{"antigua_dias":30,"limpieza":"Ajustar inventario en la ubicación: la cantidad negativa es un error de captura o un consumo sin recepción."}', 'payload', 'cuenta', 1, 'stock.quant en ubicaciones internas con quantity < 0, por ubicación.'),
('reorden_pendiente', 'Reorden pendiente', 'operaciones', 'obligacion', 'odoo', '{}', 2, 3, '{"antigua_dias":14}', 'ninguno', 'cuenta', 1, 'Reglas de reabastecimiento con qty_to_order > 0.'),
('transferencia_atorada', 'Transferencia atorada', 'operaciones', 'problema', 'odoo', '{"dias":7}', 2, 3, '{"antigua_dias":30,"zombie_dias":90,"limpieza":"Cancelar en Inventario las transferencias internas en espera de más de 90 días."}', 'payload', 'cuenta', 1, 'stock.picking internas/de producción confirmadas o en espera hace más de N días, por tipo de operación.'),
('familia_saturada', 'Familia de máquinas saturada', 'operaciones', 'riesgo', 'odoo', '{"pct":90}', 3, 4, '{"antigua_dias":30}', 'documento', 'maximo', 6, 'qb.familia.carga con utilización ≥ N %.'),
('mantenimiento_abierto', 'Mantenimiento abierto', 'operaciones', 'obligacion', 'odoo', '{"dias":7}', 2, 4, '{"antigua_dias":30,"zombie_dias":180}', 'responsable', 'cuenta', 1, 'maintenance.request en etapa no final hace más de N días, o preventivo con fecha pasada.'),
-- Compras
('recepcion_vencida', 'Recepción vencida', 'compras', 'credito', 'odoo', '{}', 3, 4, '{"antigua_dias":30,"zombie_dias":120}', 'contraparte', 'cuenta', 1, 'Entradas de proveedor (stock.picking incoming) no hechas con fecha programada pasada, por proveedor.'),
('oc_sin_confirmacion', 'Orden de compra sin acuse', 'compras', 'riesgo', 'odoo', '{"dias":5}', 2, 3, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'purchase.order confirmada hace más de N días sin referencia del proveedor ni recepción.'),
('proveedor_esperando', 'Proveedor espera respuesta nuestra', 'compras', 'obligacion', 'memoria', '{}', 2, 4, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'Conversaciones abiertas con proveedor donde esperando_a=nosotros.'),
('esperando_proveedor', 'Esperamos al proveedor', 'compras', 'credito', 'memoria', '{}', 2, 3, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'Conversaciones abiertas con proveedor donde esperando_a=ellos.'),
('aprobacion_pendiente', 'Aprobación pendiente', 'compras', 'obligacion', 'odoo', '{"dias":2}', 2, 4, '{"antigua_dias":30}', 'responsable', 'cuenta', 1, 'approval.request nueva/pendiente hace más de N días y purchase.requisition abiertas.'),
('precio_compra_subio', 'Precio de compra subió', 'compras', 'riesgo', 'odoo', '{"pct":15,"meses":6,"dias":30}', 2, 3, '{"antigua_dias":30}', 'contraparte', 'cuenta', 6, 'Último precio de compra de un producto (N días) vs promedio de los M meses previos > pct %.'),
('actividad_vencida_oc', 'Actividad vencida en compras', 'compras', 'obligacion', 'odoo', '{}', 2, 3, '{"antigua_dias":30,"zombie_dias":180}', 'responsable', 'cuenta', 1, 'mail.activity vencida sobre purchase.order, por usuario.'),
('proveedor_reprobado', 'Proveedor reprobado', 'compras', 'riesgo', 'odoo', '{"score":70}', 2, 3, '{"antigua_dias":60}', 'contraparte', 'maximo', 24, 'Última sgi.supplier.eval por proveedor con score < N.'),
-- Finanzas
('cartera_vencida', 'Cartera vencida', 'finanzas', 'credito', 'odoo', '{"rfc_relacionados":["GQU920609JNA","MITJ991130TV7","MIDJ4003178X9","MIPJ691003QJ1","AOMS630418PP1"]}', 3, 5, '{"antigua_dias":30}', 'contraparte', 'suma', 1, 'Facturas de cliente publicadas, no pagadas o parciales, con vencimiento pasado, por cliente. RFC en rfc_relacionados = dato_malo (parte relacionada).'),
('promesa_pago_vencida', 'Promesa de pago vencida', 'finanzas', 'credito', 'memoria', '{}', 3, 5, '{"antigua_dias":30,"vencida_dias":21}', 'contraparte', 'cuenta', 1, 'email_pending_actions tipo promesa_pago abiertas con deadline pasado; cae en la situación de cartera_vencida del mismo cliente por contraparte.'),
('cxp_vencida', 'Cuentas por pagar vencidas', 'finanzas', 'obligacion', 'odoo', '{}', 3, 4, '{"antigua_dias":30}', 'contraparte', 'suma', 1, 'Facturas de proveedor publicadas, no pagadas o parciales, vencidas, por proveedor.'),
('factura_proveedor_borrador', 'Factura de proveedor en borrador', 'finanzas', 'obligacion', 'odoo', '{"dias":3}', 2, 3, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'account.move in_invoice en borrador hace más de N días.'),
('entregado_sin_facturar', 'Entregado sin facturar', 'finanzas', 'credito', 'odoo', '{}', 3, 4, '{"antigua_dias":30}', 'contraparte', 'suma', 1, 'sale.order con invoice_status = to invoice, por cliente.'),
('banco_sin_conciliar', 'Banco sin conciliar', 'finanzas', 'obligacion', 'odoo', '{}', 2, 4, '{"antigua_dias":30}', 'payload', 'cuenta', 1, 'account.bank.statement.line no conciliadas, por diario, con antigüedad.'),
('cfdi_cancelacion_pendiente', 'CFDI con cancelación pendiente', 'finanzas', 'obligacion', 'odoo', '{}', 2, 3, '{"antigua_dias":14}', 'contraparte', 'cuenta', 1, 'account.move con l10n_mx_edi_cfdi_state = cancel_requested.'),
('sat_discrepancia', 'Discrepancia Odoo ↔ SAT', 'finanzas', 'problema', 'odoo', '{}', 3, 4, '{"antigua_dias":30}', 'payload', 'cuenta', 6, 'sat.compare.line con issue en (monto, moneda, cancelado_odoo, cancelado_sat, solo_sat, solo_odoo), por tipo de discrepancia.'),
('sat_complemento', 'Complemento de pago faltante o duplicado', 'finanzas', 'problema', 'odoo', '{}', 3, 4, '{"antigua_dias":30}', 'payload', 'cuenta', 6, 'sat.pago.compare con issue en (sin_complemento, complemento_duplicado).'),
('sat_extraccion_detenida', 'Extracción del SAT detenida', 'finanzas', 'problema', 'odoo', '{"dias":3}', 4, 5, '{}', 'ninguno', 'maximo', 1, 'res.company.sat_data_until_* con más de N días de atraso.'),
('nomina_borrador', 'Nómina en borrador', 'finanzas', 'obligacion', 'odoo', '{"dias":3}', 2, 3, '{"antigua_dias":30,"zombie_dias":120,"limpieza":"Confirmar o cancelar en Nómina los recibos en borrador de periodos ya pagados."}', 'payload', 'cuenta', 6, 'hr.payslip en borrador con date_to < hoy − N, por lote/periodo.'),
('cash_bajo_piso', 'Efectivo bajo el piso', 'finanzas', 'riesgo', 'odoo', '{}', 4, 5, '{}', 'ninguno', 'maximo', 6, 'Semanas de la proyección de flujo con saldo final < saldo mínimo; runway = primera semana ≤ 0.'),
('indicador_financiero_rojo', 'Indicador financiero en rojo', 'finanzas', 'problema', 'odoo', '{"nombres":["DSO","cartera","DPO"],"dias":60}', 3, 4, '{"antigua_dias":45}', 'payload', 'cuenta', 6, 'sgi.indicator.measure validadas en rojo cuyo indicador se llama como alguno de umbrales.nombres.'),
-- Calidad / SGI
('indicador_rojo', 'Indicador en rojo', 'calidad_sgi', 'problema', 'odoo', '{"dias":60}', 2, 4, '{"antigua_dias":45}', 'payload', 'cuenta', 6, 'sgi.indicator.measure con semaphore=rojo y state=validado, periodo reciente, por indicador.'),
('accion_correctiva_vencida', 'Acción correctiva vencida', 'calidad_sgi', 'obligacion', 'odoo', '{}', 3, 4, '{"antigua_dias":30,"zombie_dias":180}', 'responsable', 'cuenta', 1, 'sgi.action.line con state=vencida, por responsable.'),
('nc_abierta', 'No conformidad abierta', 'calidad_sgi', 'problema', 'odoo', '{"dias":7}', 2, 4, '{"antigua_dias":30,"zombie_dias":180}', 'responsable', 'cuenta', 1, 'quality.alert en etapa no final hace más de N días.'),
('reclamacion_cliente', 'Reclamación de cliente', 'calidad_sgi', 'problema', 'memoria', '{}', 3, 5, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'Conversaciones abiertas con cliente en tono tenso.'),
('calibracion_vencida', 'Calibración vencida', 'calidad_sgi', 'obligacion', 'odoo', '{}', 3, 4, '{"antigua_dias":30}', 'ninguno', 'cuenta', 6, 'maintenance.equipment con sgi_calibration_state=vencido o sgi_do_not_use.'),
('legal_incumplido', 'Requisito legal incumplido', 'calidad_sgi', 'obligacion', 'odoo', '{}', 3, 5, '{"antigua_dias":45}', 'ninguno', 'cuenta', 6, 'sgi.legal.requirement con compliance_state en (no_cumple, parcial) o next_eval_date ≤ hoy.'),
('riesgo_sin_tratar', 'Riesgo sin tratar', 'calidad_sgi', 'riesgo', 'odoo', '{}', 3, 4, '{"antigua_dias":45}', 'ninguno', 'cuenta', 6, 'sgi.risk con attention_level en (inmediata, alto) y state=identificado.'),
('ppap_rechazado', 'PPAP rechazado', 'calidad_sgi', 'problema', 'odoo', '{}', 3, 4, '{"antigua_dias":30}', 'contraparte', 'cuenta', 6, 'sgi.ppap con state=rechazado.'),
('auditoria_pendiente', 'Auditoría pendiente', 'calidad_sgi', 'obligacion', 'odoo', '{}', 2, 3, '{"antigua_dias":45}', 'responsable', 'cuenta', 24, 'sgi.audit.program.line pendiente cuyo mes planeado ya pasó.'),
('fuente_sgi_apagada', 'Fuente de alertas SGI apagada', 'calidad_sgi', 'higiene', 'odoo', '{}', 1, 2, '{}', 'ninguno', 'cuenta', 6, 'sgi.alert.source con enabled=false y suppressed_count > 0: explica silencios.'),
-- RH
('aprobacion_rh', 'Aprobación de RH pendiente', 'rh', 'obligacion', 'odoo', '{"dias":2}', 2, 3, '{"antigua_dias":30}', 'responsable', 'cuenta', 1, 'approval.request de categoría RH pendiente y hr.leave por aprobar.'),
('pendiente_rh_correo', 'Pendiente de RH por correo', 'rh', 'obligacion', 'memoria', '{}', 2, 4, '{"antigua_dias":30}', 'contraparte', 'cuenta', 1, 'Pendientes (quien=nosotros) en conversaciones de los buzones de RH.'),
('evaluacion_vencida', 'Evaluación vencida', 'rh', 'obligacion', 'odoo', '{}', 1, 3, '{"antigua_dias":45}', 'responsable', 'cuenta', 24, 'hr.appraisal vencida y sgi.competence.gap abierta.'),
-- Sistemas
('ticket_abierto', 'Ticket abierto', 'sistemas', 'obligacion', 'odoo', '{"dias":7}', 2, 3, '{"antigua_dias":30,"zombie_dias":180}', 'responsable', 'cuenta', 1, 'helpdesk.ticket no resuelto hace más de N días.'),
('job_caido', 'Proceso automático caído', 'sistemas', 'problema', 'watchdog', '{}', 4, 5, '{}', 'ninguno', 'cuenta', 1, 'Lo que el watchdog (Edge Function health) detecta: jobs pg_cron atrasados, push de Odoo viejo, lotes de señales sin llegar.'),
-- Dirección
('carga_actividades', 'Actividades vencidas', 'direccion', 'obligacion', 'odoo', '{}', 2, 4, '{"antigua_dias":30,"zombie_dias":180,"limpieza":"Cerrar o cancelar en Odoo las actividades vencidas hace más de 180 días; no describen trabajo real."}', 'responsable', 'suma', 1, 'mail.activity vencidas por usuario (fila aparte para las de más de 180 días, que caen en zombie).'),
('firma_pendiente', 'Firma pendiente', 'direccion', 'obligacion', 'odoo', '{"dias":7}', 2, 3, '{"antigua_dias":30,"zombie_dias":180}', 'responsable', 'cuenta', 6, 'sign.request enviada hace más de N días sin completar.'),
('acuse_documento', 'Acuse de documento pendiente', 'direccion', 'obligacion', 'odoo', '{}', 1, 2, '{"antigua_dias":45}', 'responsable', 'cuenta', 24, 'sgi.document.ack con state=pendiente, por persona.'),
('acuerdo_direccion_vencido', 'Acuerdo de dirección vencido', 'direccion', 'obligacion', 'odoo', '{}', 3, 4, '{"antigua_dias":45}', 'responsable', 'cuenta', 24, 'sgi.management.review.agreement con deadline pasado y sin cerrar.'),
('obligacion_legado', 'Obligación (qb_obligation)', 'direccion', 'obligacion', 'odoo', '{}', 2, 3, '{"antigua_dias":30}', 'documento', 'cuenta', 1, 'Puente hasta retirar qb_obligation (plan B, paso 6): sus registros abiertos, uno por obligación.'),
('delegacion_estado', 'Estado de delegación', 'direccion', 'obligacion', 'odoo', '{}', 1, 2, '{}', 'situacion', 'cuenta', 1, 'Eventos hecha/cancelada de actividades delegadas (plan B, paso 5). Sin consulta en este plan.')
ON CONFLICT (senal) DO NOTHING;

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Situación plan A paso 1: esquema (senales, senales_lotes, senales_config, situaciones, situacion_reglas, situacion_corridas, buzon_personas) y catálogo inicial',
        jsonb_build_object('migration', '20260919a_situacion_esquema'));
COMMIT;
