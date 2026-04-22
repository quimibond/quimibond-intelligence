import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseSearchParams, toSearchString } from "@/lib/url-state";

describe("parseSearchParams", () => {
  const schema = z.object({
    q: z.string().catch(""),
    page: z.coerce.number().int().min(1).catch(1),
    severity: z.enum(["critical", "high", "medium", "low"]).optional().catch(undefined),
  });

  it("parses plain object from Next.js searchParams", () => {
    const out = parseSearchParams({ q: "acme", page: "3", severity: "critical" }, schema);
    expect(out).toEqual({ q: "acme", page: 3, severity: "critical" });
  });

  it("parses URLSearchParams instance", () => {
    const sp = new URLSearchParams("q=acme&page=3");
    const out = parseSearchParams(sp, schema);
    expect(out.q).toBe("acme");
    expect(out.page).toBe(3);
  });

  it("applies defaults for invalid values (catch)", () => {
    const out = parseSearchParams({ page: "not-a-number", severity: "bogus" }, schema);
    expect(out.page).toBe(1);
    expect(out.severity).toBeUndefined();
  });

  it("handles array values — picks first", () => {
    const out = parseSearchParams({ q: ["a", "b"] }, schema);
    expect(out.q).toBe("a");
  });
});

describe("toSearchString", () => {
  it("serializes defined keys, skips undefined/null/empty-string", () => {
    expect(toSearchString({ q: "acme", page: 2, foo: undefined, bar: null, baz: "" }))
      .toBe("?q=acme&page=2");
  });

  it("skips page=1 (default)", () => {
    expect(toSearchString({ q: "x", page: 1 }, { dropEqual: { page: 1 } })).toBe("?q=x");
  });

  it("returns empty string when all keys dropped", () => {
    expect(toSearchString({ page: 1 }, { dropEqual: { page: 1 } })).toBe("");
  });
});
