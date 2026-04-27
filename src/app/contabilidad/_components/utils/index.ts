export function formatPeriod(period: string): string {
  const months = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  const [y, m] = period.split("-");
  const idx = Number(m) - 1;
  return `${months[idx] ?? m} ${y?.slice(2) ?? ""}`;
}

export function isFresh(isoTimestamp: string | null | undefined, hoursWindow = 24): boolean {
  if (!isoTimestamp) return false;
  const age = Date.now() - new Date(isoTimestamp).getTime();
  return age < hoursWindow * 3600000;
}
