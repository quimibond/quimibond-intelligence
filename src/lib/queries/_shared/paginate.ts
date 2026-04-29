/**
 * Paginate Supabase PostgREST queries past the server's `db-max-rows=1000`
 * cap.
 *
 * The Supabase platform enforces a 1000-row cap at the PostgREST layer that
 * `.range(0, 49999)` does NOT bypass — the server clamps regardless of the
 * client-supplied range. For any aggregate that iterates over a result set
 * larger than 1000 rows, the missing rows silently disappear from the
 * calculation (audit 2026-04-29 found ~$20M of expense missing from /contabilidad
 * P&L because the y:2025 expense bucket has 1,263 rows).
 *
 * Usage:
 *
 *   const rows = await paginateAll(({ from, to }) =>
 *     sb
 *       .from("canonical_invoices")
 *       .select("amount_total_mxn_resolved, invoice_date")
 *       .eq("direction", "issued")
 *       .gte("invoice_date", lookback)
 *       .order("invoice_date", { ascending: true })
 *       .order("canonical_id", { ascending: true })  // STABLE secondary key
 *       .range(from, to)
 *   );
 *
 * REQUIREMENTS:
 *   - The query MUST include a stable ORDER BY (otherwise pages may overlap
 *     or skip rows). Prefer (date, primary_key) tuples.
 *   - The selected columns are returned typed as the row type of the builder.
 *
 * Hard guard at 100k rows. Bump if you legitimately need more.
 */

// PromiseLike (not Promise) so callers can return a PostgrestFilterBuilder
// directly — supabase-js builders are thenable but not native Promises.
type SupabaseQueryResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

interface PageBounds {
  from: number;
  to: number;
}

const DEFAULT_PAGE_SIZE = 1000;
const MAX_TOTAL_ROWS = 100_000;

export async function paginateAll<T>(
  buildPage: (bounds: PageBounds) => SupabaseQueryResult<T>,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildPage({ from, to });
    if (error) {
      throw new Error(`paginateAll: ${error.message}`);
    }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    if (from + pageSize >= MAX_TOTAL_ROWS) {
      throw new Error(
        `paginateAll: exceeded MAX_TOTAL_ROWS (${MAX_TOTAL_ROWS}). ` +
          `Consider tightening filters or splitting the query.`
      );
    }
  }
  return all;
}
