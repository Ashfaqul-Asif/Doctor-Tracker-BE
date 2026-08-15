import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './cache.js';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(page = 1, limit = DEFAULT_LIMIT): Pagination {
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

/**
 * Structural, not Model<T>. Each schema's toJSON transform alters its hydrated
 * document type, so the nominal Model<T> generics of Doctor and Patient are
 * mutually unassignable — this only needs the three members it actually calls.
 */
interface CountableModel {
  collection: { name: string };
  estimatedDocumentCount(): PromiseLike<number>;
  countDocuments(filter: Record<string, unknown>): PromiseLike<number>;
}

function filterKey(collection: string, filter: Record<string, unknown>): string {
  // RegExp does not survive JSON.stringify, so serialise it explicitly — otherwise
  // every search term would collapse to the same cache key and return a wrong count.
  const stable = JSON.stringify(filter, (_k, v) =>
    v instanceof RegExp ? `__re:${v.source}:${v.flags}` : v,
  );
  return `count:${collection}:${createHash('sha1').update(stable).digest('hex')}`;
}

/**
 * Count documents for a filter, cheaply.
 *
 * Two optimisations over a plain countDocuments on every request:
 *   - an empty filter uses estimatedDocumentCount(), an O(1) metadata read;
 *   - otherwise the exact count is cached briefly, so paging 1 -> 2 -> 3 through the
 *     same filter pays for the count once instead of three times.
 *
 * The cache means `total` can lag a concurrent insert by a few seconds. That is an
 * acceptable trade for a list view, and it is never used for correctness decisions.
 */
export async function countFor(
  model: CountableModel,
  filter: Record<string, unknown>,
  ttlMs = 15_000,
): Promise<number> {
  if (Object.keys(filter).length === 0) {
    return model.estimatedDocumentCount();
  }

  const key = filterKey(model.collection.name, filter);
  const hit = cacheGet<number>(key);
  if (hit !== undefined) return hit;

  const total = await model.countDocuments(filter);
  cacheSet(key, total, ttlMs);
  return total;
}
