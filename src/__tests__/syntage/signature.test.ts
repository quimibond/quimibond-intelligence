// src/__tests__/syntage/signature.test.ts
import { describe, it, expect } from "vitest";
import { verifySyntageSignature } from "@/lib/syntage/signature";
import crypto from "crypto";

describe("verifySyntageSignature", () => {
  const secret = "test-secret-abc123";
  const body = '{"id":"evt_test","type":"invoice.created"}';
  const validSig = crypto.createHmac("sha256", secret).update(body).digest("hex");

  it("returns true for a valid HMAC-SHA256 signature", () => {
    expect(verifySyntageSignature(body, validSig, secret)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    expect(verifySyntageSignature(body, "nope", secret)).toBe(false);
  });

  it("returns false when signature header is missing (empty string)", () => {
    expect(verifySyntageSignature(body, "", secret)).toBe(false);
  });

  it("is constant-time — resistant to timing attacks", () => {
    const almost = validSig.slice(0, -1) + "0";
    expect(verifySyntageSignature(body, almost, secret)).toBe(false);
  });

  it("accepts signature with 'sha256=' prefix (common webhook format)", () => {
    expect(verifySyntageSignature(body, `sha256=${validSig}`, secret)).toBe(true);
  });
});
