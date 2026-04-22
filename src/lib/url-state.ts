import type { z } from "zod";

type RawInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

/**
 * Parse Next.js 15 searchParams (or a URLSearchParams) into a typed shape
 * via zod. Uses zod's `.catch(...)` fallbacks so invalid URLs degrade to
 * defaults instead of throwing.
 */
export function parseSearchParams<T>(raw: RawInput, schema: z.ZodType<T>): T {
  const obj: Record<string, string> = {};
  if (raw instanceof URLSearchParams) {
    raw.forEach((value, key) => {
      // First occurrence wins; matches "pick first" semantics.
      if (!(key in obj)) obj[key] = value;
    });
  } else {
    for (const [key, value] of Object.entries(raw)) {
      if (value == null) continue;
      obj[key] = Array.isArray(value) ? (value[0] ?? "") : String(value);
    }
  }
  return schema.parse(obj);
}

export interface ToSearchStringOptions {
  /** Keys whose value equals this default are dropped (e.g., {page: 1}). */
  dropEqual?: Record<string, unknown>;
}

export function toSearchString(
  params: Record<string, unknown>,
  opts: ToSearchStringOptions = {}
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value === "") continue;
    if (opts.dropEqual && key in opts.dropEqual && opts.dropEqual[key] === value) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => v != null && sp.append(key, String(v)));
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
