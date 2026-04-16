import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";

/**
 * E2E: exercises the running webhook endpoint with a simulated payload.
 *
 * PRE-REQUISITO: dev server corriendo en localhost:3000 con:
 *  - SYNTAGE_WEBHOOK_SECRET=test-secret
 *  - syntage_entity_map seeded con taxpayer_rfc='TESTRFC000' → odoo_company_id=1
 *
 * Skip automáticamente si no hay server (detecta via fetch).
 *
 * Para correrlo:
 *   # Shell 1:
 *   SYNTAGE_WEBHOOK_SECRET=test-secret npm run dev
 *   # Shell 2:
 *   SYNTAGE_WEBHOOK_SECRET=test-secret npx vitest run src/__tests__/syntage/webhook-e2e.test.ts
 *
 * Antes, poblar syntage_entity_map con una row de test:
 *   INSERT INTO syntage_entity_map (taxpayer_rfc, odoo_company_id, alias, priority)
 *   VALUES ('TESTRFC000', 1, 'E2E Test Entity', 'primary')
 *   ON CONFLICT (taxpayer_rfc) DO NOTHING;
 *
 * Y al terminar, cleanup:
 *   DELETE FROM syntage_invoices        WHERE taxpayer_rfc = 'TESTRFC000';
 *   DELETE FROM syntage_webhook_events  WHERE event_id LIKE 'e2e_%';
 *   DELETE FROM syntage_entity_map      WHERE taxpayer_rfc = 'TESTRFC000';
 */
const BASE_URL = process.env.SYNTAGE_E2E_URL ?? "http://localhost:3000";
const SECRET = process.env.SYNTAGE_WEBHOOK_SECRET ?? "test-secret";
const TEST_RFC = process.env.SYNTAGE_E2E_TEST_RFC ?? "TESTRFC000";

function sign(body: string): string {
  return crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

async function serverIsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE_URL}/api/syntage/webhook`);
    return r.ok;
  } catch {
    return false;
  }
}

describe("POST /api/syntage/webhook (E2E)", () => {
  let up = false;
  beforeAll(async () => { up = await serverIsUp(); });

  it.runIf(up)("401s on invalid signature", async () => {
    const body = JSON.stringify({ id: "e2e_1", type: "invoice.created", taxpayer: { id: TEST_RFC }, data: { object: {} }, createdAt: "2026-04-16T00:00:00Z" });
    const res = await fetch(`${BASE_URL}/api/syntage/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-syntage-signature": "bad" },
      body,
    });
    expect(res.status).toBe(401);
  });

  it.runIf(up)("accepts a valid invoice.created and persists it", async () => {
    const uuid = `e2e-${Date.now()}-0001`;
    const body = JSON.stringify({
      id: `e2e_inv_${Date.now()}`,
      type: "invoice.created",
      taxpayer: { id: TEST_RFC },
      data: {
        object: {
          "@id": `/invoices/${uuid}`,
          uuid,
          direction: "received",
          tipoComprobante: "I",
          serie: "A", folio: "100",
          fechaEmision: "2026-04-15T10:00:00Z",
          issuer: { rfc: "SUPPTEST", name: "Supplier Test" },
          receiver: { rfc: TEST_RFC, name: "Test Entity" },
          subtotal: 100, total: 116, moneda: "MXN", tipoCambio: 1,
          estadoSat: "vigente",
        },
      },
      createdAt: new Date().toISOString(),
    });
    const res = await fetch(`${BASE_URL}/api/syntage/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-syntage-signature": sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result).toBe("handled");
  });

  it.runIf(up)("deduplicates on duplicate event_id", async () => {
    const dupId = `e2e_dup_${Date.now()}`;
    const body = JSON.stringify({
      id: dupId,
      type: "invoice.created",
      taxpayer: { id: TEST_RFC },
      data: {
        object: {
          "@id": `/invoices/dup-${Date.now()}`, uuid: `dup-${Date.now()}`,
          direction: "received", tipoComprobante: "I",
          issuer: { rfc: "SUPP" }, receiver: { rfc: TEST_RFC },
          total: 10, moneda: "MXN",
        },
      },
      createdAt: new Date().toISOString(),
    });
    const headers = { "content-type": "application/json", "x-syntage-signature": sign(body) };
    const r1 = await fetch(`${BASE_URL}/api/syntage/webhook`, { method: "POST", headers, body });
    const r2 = await fetch(`${BASE_URL}/api/syntage/webhook`, { method: "POST", headers, body });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect((await r2.json()).duplicate).toBe(true);
  });

  it.runIf(up)("rejects unmapped taxpayer gracefully (200 + skipped)", async () => {
    const body = JSON.stringify({
      id: `e2e_unmapped_${Date.now()}`,
      type: "invoice.created",
      taxpayer: { id: "ZZZZ999999ZZZ" },
      data: { object: { "@id": "/invoices/z", uuid: `z-${Date.now()}`, direction: "received", issuer: {}, receiver: {}, moneda: "MXN" } },
      createdAt: new Date().toISOString(),
    });
    const res = await fetch(`${BASE_URL}/api/syntage/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-syntage-signature": sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("unmapped_taxpayer");
  });
});
