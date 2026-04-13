import "server-only";

/**
 * Supabase joined relation helper.
 * Dependiendo del tipo de join, la relación vendrá como objeto o array.
 * Esta función extrae el nombre de la empresa en cualquier caso.
 */
export function joinedCompanyName(companies: unknown): string | null {
  if (!companies) return null;
  if (Array.isArray(companies)) {
    const first = companies[0] as { name?: string | null } | undefined;
    return first?.name ?? null;
  }
  return (companies as { name?: string | null }).name ?? null;
}
