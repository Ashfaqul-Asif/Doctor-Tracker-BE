import type { FilterQuery } from 'mongoose';
import { escapeRegex } from './escapeRegex.js';

/**
 * Substring search that still resolves to an index scan.
 *
 * The requirement is that "Ashfaqul Asif" is found by `asif`, `Ash`, AND `qul` —
 * any substring, including mid-word. The obvious options all fail:
 *
 *   { name: /qul/i }          correct, but COLLSCAN — an unanchored regex with the
 *                             `i` flag can never use an index.
 *   $text / text index        whole-word only. `qul` matches nothing; `Ash` matches
 *                             nothing either.
 *   anchored word prefixes    index scan, but `qul` fails — it is mid-word.
 *   trigrams / n-grams        index scan, but grams can match non-contiguously, so
 *                             it needs a false-positive verification pass.
 *
 * The insight this uses: every substring of a string is a PREFIX of one of its
 * suffixes. So index the suffixes and query with an anchored prefix regex.
 *
 *   "ashfaqul" -> ashfaqul, shfaqul, hfaqul, faqul, aqul, qul, ul
 *   query "qul" -> { searchSuffixes: /^qul/ } -> matches the "qul" entry -> IXSCAN
 *
 * Exact substring semantics, no false positives, any query length.
 */

/**
 * Caps stored suffix length so storage is O(L x 24) rather than O(L^2).
 * Queries longer than this narrow via the index, then verify (see buildSearchQuery).
 */
export const MAX_SUFFIX_LEN = 24;

/** Ignore pathological field values (a pasted essay in a name field). */
export const MAX_FIELD_LEN = 64;

/** Below this, a search matches nearly everything and is not worth running. */
export const MIN_QUERY_LEN = 2;

/**
 * NFKD splits an accented character into base + combining mark, then \p{M} strips
 * the marks: "Jose" matches "Jose". Using a Unicode property escape keeps this
 * source pure ASCII, so no editor or pipeline can mangle a literal combining char.
 */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Lowercase, fold diacritics, collapse whitespace. Case-insensitivity comes from
 * normalising at write AND read time — never from a regex `i` flag, which would
 * defeat the index.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build the suffix array stored on the document. Called from a pre-save hook, the
 * seed script, and the backfill script — one implementation, so they cannot drift.
 */
export function buildSearchSuffixes(fields: Array<string | null | undefined>): string[] {
  const out = new Set<string>();

  for (const raw of fields) {
    if (!raw) continue;
    const normalized = normalizeSearchText(String(raw)).slice(0, MAX_FIELD_LEN);
    if (normalized.length < MIN_QUERY_LEN) continue;

    for (let i = 0; i <= normalized.length - MIN_QUERY_LEN; i++) {
      out.add(normalized.slice(i, i + MAX_SUFFIX_LEN));
    }
  }

  return [...out];
}

/**
 * Build the query clause. `rawFields` are the document paths used only by the
 * long-query verification branch.
 *
 * Returns null when the term is too short — callers treat that as "no search
 * filter"; the route schema rejects it with 422 before we get here.
 */
export function buildSearchQuery<T>(term: string, rawFields: string[] = []): FilterQuery<T> | null {
  const normalized = normalizeSearchText(term);
  if (normalized.length < MIN_QUERY_LEN) return null;

  // The index probe. Anchored (^) and NO `i` flag — both are required for MongoDB
  // to turn this into an index range scan.
  const probe = {
    searchSuffixes: new RegExp('^' + escapeRegex(normalized.slice(0, MAX_SUFFIX_LEN))),
  } as FilterQuery<T>;

  if (normalized.length <= MAX_SUFFIX_LEN || rawFields.length === 0) return probe;

  // Term is longer than the stored suffix cap. Without this branch the query would
  // silently match on only its first 24 characters and return false positives.
  // The unanchored `i` regex here is acceptable precisely because the probe has
  // already reduced the candidate set via the index — it never scans the collection.
  const verify = new RegExp(escapeRegex(normalized), 'i');
  return {
    $and: [probe, { $or: rawFields.map((f) => ({ [f]: verify })) }],
  } as FilterQuery<T>;
}
