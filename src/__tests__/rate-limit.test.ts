import { describe, it, expect } from "vitest";
import { checkRateLimit, getClientId } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows first request", () => {
    const result = checkRateLimit("test-1", 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("tracks multiple requests", () => {
    const key = "test-multi-" + Date.now();
    checkRateLimit(key, 3, 60_000);
    checkRateLimit(key, 3, 60_000);
    const result = checkRateLimit(key, 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("blocks when limit exceeded", () => {
    const key = "test-exceed-" + Date.now();
    checkRateLimit(key, 2, 60_000);
    checkRateLimit(key, 2, 60_000);
    const result = checkRateLimit(key, 2, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetMs).toBeGreaterThan(0);
  });
});

describe("getClientId", () => {
  it("extracts x-forwarded-for header", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientId(req)).toBe("1.2.3.4");
  });

  it("extracts x-real-ip header", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "10.0.0.1" },
    });
    expect(getClientId(req)).toBe("10.0.0.1");
  });

  it("returns anonymous when no headers", () => {
    const req = new Request("http://localhost");
    expect(getClientId(req)).toBe("anonymous");
  });
});
