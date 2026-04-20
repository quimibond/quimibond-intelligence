import "server-only";

/**
 * Helpers para parsear `searchParams` de páginas Next 15 y
 * convertirlos a filtros tipados para las queries.
 *
 * Convenciones (mantener consistentes entre páginas):
 * - `q`     → búsqueda libre
 * - `from`  → fecha inicio (YYYY-MM-DD)
 * - `to`    → fecha fin (YYYY-MM-DD)
 * - `page`  → 1-indexed
 * - `size`  → pageSize (default 25)
 * - `sort`  → "column" o "-column" (prefix `-` = DESC)
 */

export type SearchParamInput =
  | Record<string, string | string[] | undefined>
  | undefined;

export interface TableParams {
  q?: string;
  from?: string;
  to?: string;
  page: number;
  size: number;
  sort?: string;
  sortDir: "asc" | "desc";
  /** Raw facet values por key */
  facets: Record<string, string[]>;
}

const DEFAULT_SIZE = 25;
const MAX_SIZE = 200;

export function parseTableParams(
  sp: SearchParamInput,
  opts: {
    defaultSize?: number;
    facetKeys?: string[];
    defaultSort?: string;
    /**
     * Si la página tiene varias tablas, usar prefijos distintos para evitar
     * colisiones de params (`inv_q`, `age_q`, `orders_from`...).
     */
    prefix?: string;
  } = {}
): TableParams {
  const params = sp ?? {};
  const defaultSize = opts.defaultSize ?? DEFAULT_SIZE;
  const prefix = opts.prefix ?? "";
  const key = (k: string) => `${prefix}${k}`;

  const q = pickString(params[key("q")]);
  const from = pickString(params[key("from")]);
  const to = pickString(params[key("to")]);

  const pageRaw = Number(pickString(params[key("page")]) ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  const sizeRaw = Number(
    pickString(params[key("size")]) ?? String(defaultSize)
  );
  const size =
    Number.isFinite(sizeRaw) && sizeRaw > 0
      ? Math.min(Math.floor(sizeRaw), MAX_SIZE)
      : defaultSize;

  const sortRaw = pickString(params[key("sort")]) ?? opts.defaultSort ?? undefined;
  let sort: string | undefined;
  let sortDir: "asc" | "desc" = "desc";
  if (sortRaw) {
    if (sortRaw.startsWith("-")) {
      sort = sortRaw.slice(1);
      sortDir = "desc";
    } else {
      sort = sortRaw;
      sortDir = "asc";
    }
  }

  const facets: Record<string, string[]> = {};
  for (const fk of opts.facetKeys ?? []) {
    const val = params[key(fk)];
    if (val == null) continue;
    if (Array.isArray(val)) facets[fk] = val.filter(Boolean);
    else if (val) facets[fk] = [val];
  }

  return { q, from, to, page, size, sort, sortDir, facets };
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v[0] || undefined;
  return v || undefined;
}

/** Rango 0-indexed para Supabase `.range(from, to)` */
export function paginationRange(page: number, size: number): [number, number] {
  const from = (Math.max(1, page) - 1) * size;
  const to = from + size - 1;
  return [from, to];
}

/**
 * Lee el param `cols` (o `${prefix}cols`) y lo convierte a lista de keys.
 * Si no existe, retorna `undefined` para que el <DataTable> use el default.
 */
export function parseVisibleKeys(
  sp: SearchParamInput,
  prefix = ""
): string[] | undefined {
  const raw = sp?.[`${prefix}cols`];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  return value.split(",").filter(Boolean);
}

/** Normaliza un rango de fechas, agregando 1 día al `to` para queries `lt` exclusive. */
export function endOfDay(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  try {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}
