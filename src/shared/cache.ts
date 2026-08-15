import { LRUCache } from 'lru-cache';

/**
 * Small in-process TTL cache for the two read patterns that are hit constantly and
 * tolerate mild staleness: filter facet lists and analytics rollups.
 *
 * Deliberately in-process: with more than one instance each replica keeps its own
 * copy, which is fine for data this cheap to recompute. A shared Redis cache is the
 * multi-instance answer and is noted in the README's scalability section.
 */
/** LRUCache requires values to be non-nullable; `NonNullable<unknown>` is `{}`. */
type CacheValue = NonNullable<unknown>;

const store = new LRUCache<string, CacheValue>({
  max: 500,
  ttl: 60_000,
});

export function cacheGet<T extends CacheValue>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet<T extends CacheValue>(key: string, value: T, ttlMs?: number): void {
  store.set(key, value, ttlMs ? { ttl: ttlMs } : undefined);
}

/** Read-through helper: compute only on a miss. */
export async function cached<T extends CacheValue>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key) as T | undefined;
  if (hit !== undefined) return hit;
  const value = await fn();
  store.set(key, value, { ttl: ttlMs });
  return value;
}

/** Invalidate by prefix after a write, so facets refresh promptly. */
export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function cacheClear(): void {
  store.clear();
}
