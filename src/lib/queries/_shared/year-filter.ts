/**
 * Year filter — convierte año seleccionado en rango de fechas [from, to).
 *
 * - `year = 'all'` → sin límites (desde 2019 hasta hoy+1)
 * - `year = <número>` → ['YYYY-01-01', 'YYYY+1-01-01')
 * - `year = 'current'` → año actual
 */

export type YearValue = number | 'all' | 'current';

export const MIN_AVAILABLE_YEAR = 2019;

export function resolveYear(value: YearValue | undefined): number | 'all' {
  if (value === 'all') return 'all';
  if (value === 'current' || value === undefined) return new Date().getFullYear();
  return value;
}

export function yearBounds(value: YearValue | undefined): { from: Date; to: Date } {
  const resolved = resolveYear(value);
  if (resolved === 'all') {
    return {
      from: new Date(`${MIN_AVAILABLE_YEAR}-01-01`),
      to: new Date(new Date().getFullYear() + 1, 0, 1),
    };
  }
  return {
    from: new Date(resolved, 0, 1),
    to: new Date(resolved + 1, 0, 1),
  };
}

export function parseYearParam(searchParam: string | string[] | undefined): YearValue {
  if (Array.isArray(searchParam)) searchParam = searchParam[0];
  if (!searchParam) return 'current';
  if (searchParam === 'all') return 'all';
  const n = parseInt(searchParam, 10);
  if (!Number.isFinite(n) || n < MIN_AVAILABLE_YEAR || n > new Date().getFullYear() + 1) {
    return 'current';
  }
  return n;
}

export function availableYears(maxYear: number = new Date().getFullYear()): number[] {
  const years: number[] = [];
  for (let y = maxYear; y >= MIN_AVAILABLE_YEAR; y--) years.push(y);
  return years;
}

export function yearLabel(value: YearValue): string {
  const resolved = resolveYear(value);
  return resolved === 'all' ? 'Todos los años' : String(resolved);
}
