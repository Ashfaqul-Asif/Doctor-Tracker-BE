/**
 * Normalise a `.lean()` result into the API's document shape.
 *
 * `.lean()` is used on every list path because skipping Mongoose hydration is a
 * real performance win — but it also skips the schema's toJSON transform. Without
 * this, list endpoints would return `_id` while create/get return `id`, and
 * `searchSuffixes` could leak. One helper keeps the contract identical on both
 * paths.
 */
export function toApi<T extends Record<string, unknown>>(doc: T): Record<string, unknown> {
  const { _id, searchSuffixes: _s, __v: _v, ...rest } = doc;
  return { id: String(_id), ...rest };
}

export function toApiList<T extends Record<string, unknown>>(docs: T[]): Record<string, unknown>[] {
  return docs.map(toApi);
}
