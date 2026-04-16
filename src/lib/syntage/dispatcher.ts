import type { SyntageEvent, HandlerCtx } from "@/lib/syntage/types";

export interface DispatcherHandlers {
  invoice:              (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  invoiceLineItem:      (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  invoicePayment:       (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  taxRetention:         (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  taxReturn:            (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  taxStatus:            (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  electronicAccounting: (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  credential:           (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  link:                 (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  extraction:           (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  fileCreated:          (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
}

/**
 * Routes a Syntage event to the appropriate handler by event.type.
 * Returns 'handled' if dispatched, 'unhandled' if type is unknown.
 */
export async function dispatchSyntageEvent(
  ctx: HandlerCtx,
  event: SyntageEvent,
  handlers: DispatcherHandlers,
): Promise<"handled" | "unhandled"> {
  const t = event.type;

  if (t === "invoice.created" || t === "invoice.updated" || t === "invoice.deleted") {
    await handlers.invoice(ctx, event);
    return "handled";
  }
  if (t === "invoice_line_item.created" || t === "invoice_line_item.updated") {
    await handlers.invoiceLineItem(ctx, event);
    return "handled";
  }
  if (t === "invoice_payment.created" || t === "invoice_payment.updated" || t === "invoice_payment.deleted") {
    await handlers.invoicePayment(ctx, event);
    return "handled";
  }

  if (t.startsWith("tax_retention.")) {
    await handlers.taxRetention(ctx, event);
    return "handled";
  }
  if (t.startsWith("tax_return.")) {
    await handlers.taxReturn(ctx, event);
    return "handled";
  }
  if (t.startsWith("tax_status.")) {
    await handlers.taxStatus(ctx, event);
    return "handled";
  }

  if (t.startsWith("electronic_accounting_record.")) {
    await handlers.electronicAccounting(ctx, event);
    return "handled";
  }

  if (t.startsWith("credential.")) { await handlers.credential(ctx, event); return "handled"; }
  if (t.startsWith("link."))       { await handlers.link(ctx, event);        return "handled"; }
  if (t.startsWith("extraction.")) { await handlers.extraction(ctx, event);  return "handled"; }
  if (t === "file.created")        { await handlers.fileCreated(ctx, event); return "handled"; }

  return "unhandled";
}
