import crypto from "crypto";

/**
 * Verifies a Syntage webhook signature.
 *
 * Syntage (formerly sat.ws) uses a Stripe-style signature format:
 *   Header:  X-Satws-Signature: t=<unix_timestamp>,s=<hex_hmac>
 *   Signed:  `${timestamp}.${rawBody}`
 *   HMAC:    SHA-256 with the webhook endpoint's signingSecret as key
 *
 * Optionally enforces a timestamp tolerance window (default 5 min) to resist
 * replay attacks. Pass `toleranceSeconds: 0` to disable (discouraged).
 *
 * Returns true iff header parses cleanly, HMAC matches in constant time,
 * and timestamp is within tolerance.
 */
export function verifySyntageSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  opts: { toleranceSeconds?: number; now?: () => number } = {},
): boolean {
  if (!signatureHeader || !secret) return false;

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;

  const { t, s } = parsed;

  const tolerance = opts.toleranceSeconds ?? 300;
  if (tolerance > 0) {
    const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
    if (Math.abs(nowSec - t) > tolerance) return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  if (s.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(s, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

/**
 * Parses header of shape `t=<int>,s=<hex>` (order-agnostic, tolerates extra whitespace).
 * Returns null if malformed.
 */
function parseSignatureHeader(header: string): { t: number; s: string } | null {
  let t: number | null = null;
  let s: string | null = null;

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map(x => x?.trim());
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
