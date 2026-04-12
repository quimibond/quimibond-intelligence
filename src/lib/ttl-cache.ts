/**
 * Module-level TTL cache for deduplicating identical queries across re-renders
 * and short time windows. Use for data that is expensive to fetch but tolerates
 * 15-60s staleness (e.g. company profiles, KPI aggregates).
 *
 * Not a replacement for SWR — no revalidation, no subscriptions, no stampede
 * protection across concurrent callers. For that, install swr or @tanstack/react-query.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }

  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const p = (async () => {
    try {
      const value = await fetcher();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

export function invalidateCache(keyPrefix?: string) {
  if (!keyPrefix) {
    store.clear();
    return;
  }
  for (const k of store.keys()) {
    if (k.startsWith(keyPrefix)) store.delete(k);
  }
}
