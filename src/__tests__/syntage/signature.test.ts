import { describe, it, expect } from "vitest";
import { verifySyntageSignature } from "@/lib/syntage/signature";
import crypto from "crypto";

describe("verifySyntageSignature (Syntage X-Satws-Signature format)", () => {
  const secret = "test-secret-abc123";
  const body = '{"id":"evt_test","type":"invoice.created"}';

  // Fixed "now" so our test timestamps are always in-tolerance.
  const fixedNowMs = 1_776_000_000_000;
  const now = () => fixedNowMs;
  const t = Math.floor(fixedNowMs / 1000);

  function sign(ts: number, payload: string): string {
    return crypto.createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  }

  it("accepts a valid `t=...,s=...` signature", () => {
    const s = sign(t, body);
    const header = `t=${t},s=${s}`;
    expect(verifySyntageSignature(body, header, secret, { now })).toBe(true);
  });

  it("accepts parts in any order and with spaces", () => {
    const s = sign(t, body);
    const header = ` s=${s} , t=${t} `;
    expect(verifySyntageSignature(body, header, secret, { now })).toBe(true);
  });

  it("rejects invalid signature value", () => {
    const header = `t=${t},s=deadbeef`;
    expect(verifySyntageSignature(body, header, secret, { now })).toBe(false);
  });

  it("rejects when t is outside tolerance (default 5min)", () => {
    const s = sign(t - 3600, body);
    const header = `t=${t - 3600},s=${s}`;
    expect(verifySyntageSignature(body, header, secret, { now })).toBe(false);
  });

  it("accepts stale timestamps when toleranceSeconds=0", () => {
    const s = sign(t - 3600, body);
    const header = `t=${t - 3600},s=${s}`;
    expect(
      verifySyntageSignature(body, header, secret, { now, toleranceSeconds: 0 }),
    ).toBe(true);
  });

  it("rejects malformed header (missing t or s)", () => {
    const s = sign(t, body);
    expect(verifySyntageSignature(body, `s=${s}`, secret, { now })).toBe(false);
    expect(verifySyntageSignature(body, `t=${t}`, secret, { now })).toBe(false);
  });

  it("rejects empty or missing header", () => {
    expect(verifySyntageSignature(body, "", secret, { now })).toBe(false);
  });

  it("rejects when body is tampered", () => {
    const s = sign(t, body);
    const header = `t=${t},s=${s}`;
    expect(verifySyntageSignature(body + "tamper", header, secret, { now })).toBe(false);
  });

  it("rejects when secret mismatches", () => {
    const s = sign(t, body);
    const header = `t=${t},s=${s}`;
    expect(verifySyntageSignature(body, header, "wrong-secret", { now })).toBe(false);
  });
});
