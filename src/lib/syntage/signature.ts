// src/lib/syntage/signature.ts
import crypto from "crypto";

/**
 * Verifies a Syntage webhook HMAC-SHA256 signature in constant time.
 *
 * Syntage signs the raw body with SYNTAGE_WEBHOOK_SECRET and sends the
 * digest in the X-Syntage-Signature header, optionally prefixed with "sha256=".
 */
export function verifySyntageSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const provided = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (provided.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}
