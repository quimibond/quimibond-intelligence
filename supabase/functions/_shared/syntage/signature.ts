/**
 * Verifica la firma de un webhook de Syntage (formato estilo Stripe):
 *   Header:  X-Satws-Signature: t=<unix_timestamp>,s=<hex_hmac>
 *   Firmado: `${timestamp}.${rawBody}` con HMAC-SHA256 y el signingSecret.
 * Versión Deno (Web Crypto) de src/lib/syntage/signature.ts.
 */
export async function verifySyntageSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  opts: { toleranceSeconds?: number; now?: () => number } = {},
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const { t, s } = parsed;

  const tolerance = opts.toleranceSeconds ?? 300;
  if (tolerance > 0) {
    const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
    if (Math.abs(nowSec - t) > tolerance) return false;
  }

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqualHex(s.toLowerCase(), expected);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseSignatureHeader(header: string): { t: number; s: string } | null {
  let t: number | null = null;
  let s: string | null = null;
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((x) => x?.trim());
    if (!key || value === undefined) continue;
    if (key === "t") {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) t = n;
    } else if (key === "s") {
      s = value;
    }
  }
  if (t === null || !s) return null;
  return { t, s };
}
