/**
 * Helper puro para construir hrefs de sort para tablas server-rendered.
 *
 * Uso típico (dentro de un server component):
 *
 * ```tsx
 * const toHref = makeSortHref({
 *   pathname: "/cobranza",
 *   searchParams: sp,
 *   paramPrefix: "inv_",
 *   paramKey: "sort",
 * });
 *
 * <DataTable
 *   sort={{ key: params.sort, dir: params.sortDir }}
 *   sortHref={toHref}
 *   columns={[{ key: "amount", header: "Saldo", sortable: true, cell: ... }]}
 * />
 * ```
 *
 * El valor de `sort` en la URL usa la convención: `sort=key` (asc) o
 * `sort=-key` (desc). Si `nextDir` es `null`, remueve el param (volver a
 * default).
 */

export type SearchParamInput =
  | Record<string, string | string[] | undefined>
  | undefined;

export function makeSortHref(opts: {
  pathname: string;
  searchParams: SearchParamInput;
  paramPrefix?: string;
  paramKey?: string;
}) {
  const { pathname, searchParams, paramPrefix = "", paramKey = "sort" } = opts;
  const fullKey = paramPrefix + paramKey;
  const fullPageKey = paramPrefix + "page";

  return function toHref(
    key: string,
    nextDir: "asc" | "desc" | null
  ): string {
    const params = new URLSearchParams();
    const sp = searchParams ?? {};
    for (const [k, v] of Object.entries(sp)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const vv of v) if (vv) params.append(k, vv);
      } else if (v) {
        params.set(k, v);
      }
    }
    params.delete(fullKey);
    params.delete(fullPageKey); // reset page al cambiar sort
    if (nextDir === "desc") params.set(fullKey, `-${key}`);
    else if (nextDir === "asc") params.set(fullKey, key);
    // nextDir === null → no set
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
}
