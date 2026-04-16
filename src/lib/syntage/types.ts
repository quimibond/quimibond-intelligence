// src/lib/syntage/types.ts

/** Envelope común de todos los webhooks Syntage. */
export interface SyntageEvent {
  id: string;
  type: string;
  taxpayer: { id: string; name?: string; personType?: "physical" | "legal" };
  source?: string;
  resource?: string;
  data: {
    object: Record<string, unknown>;
    changes?: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt?: string;
}

/** Contexto que cada handler recibe (inyección de dependencias). */
export interface HandlerCtx {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  odooCompanyId: number | null;
  taxpayerRfc: string;
}

/** Subset denormalizado de un CFDI Syntage. Todo lo demás vive en raw_payload. */
export interface SyntageInvoicePayload {
  id?: string;
  "@id"?: string;
  uuid: string;
  direction: "issued" | "received";
  tipoComprobante?: string;
  serie?: string;
  folio?: string;
  fechaEmision?: string;
  fechaTimbrado?: string;
  issuer?: { rfc?: string; name?: string; blacklistStatus?: string };
  receiver?: { rfc?: string; name?: string; blacklistStatus?: string };
  subtotal?: number;
  descuento?: number;
  total?: number;
  moneda?: string;
  tipoCambio?: number;
  impuestosTrasladados?: number;
  impuestosRetenidos?: number;
  metodoPago?: string;
  formaPago?: string;
  usoCfdi?: string;
  estadoSat?: "vigente" | "cancelado" | "cancelacion_pendiente";
  fechaCancelacion?: string | null;
}
