import type { FilterQuery } from 'mongoose';
import { buildSearchQuery } from './searchIndex.js';
import { parsePagination, type Pagination } from './pagination.js';
import { resolveExplicitRange, resolvePreset, type DatePreset } from './dateRange.js';
import type { IncludeDeleted, SortOrder } from './types.js';

/**
 * One filter/sort builder shared by doctors and patients.
 *
 * Centralising it means the soft-delete predicate is injected in exactly one place,
 * the sort whitelist is enforced in exactly one place, and the `_id` tiebreaker
 * (see below) can never be forgotten on a new endpoint.
 */

export interface ListQueryConfig {
  /** Fields matched with $in from a comma-separated param. */
  inFields?: string[];
  /** Numeric range params: { patientCount: ['minPatients', 'maxPatients'] }. */
  rangeFields?: Record<string, [string, string]>;
  /** Sort keys the caller may use. Anything else is rejected upstream by zod. */
  sortable: string[];
  /** Date fields the caller may filter on, first entry is the default. */
  dateFields: string[];
  /** Document paths used by the long-search verification branch. */
  searchRawFields: string[];
}

export interface ListQueryInput {
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
  datePreset?: DatePreset;
  timezone: string;
  includeDeleted?: IncludeDeleted;
  [key: string]: unknown;
}

export interface BuiltListQuery<T> {
  filter: FilterQuery<T>;
  sort: Record<string, 1 | -1>;
  pagination: Pagination;
}

function csvToArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Soft-delete predicate. Every compound index in the schema leads with `deletedAt`,
 * so all three variants stay index-served rather than degrading to a post-filter.
 */
function deletedClause(mode: IncludeDeleted = 'false'): Record<string, unknown> {
  if (mode === 'true') return {}; // no constraint — index still usable via other keys
  if (mode === 'only') return { deletedAt: { $ne: null } };
  return { deletedAt: null };
}

export function buildListQuery<T>(
  config: ListQueryConfig,
  input: ListQueryInput,
): BuiltListQuery<T> {
  const filter: Record<string, unknown> = { ...deletedClause(input.includeDeleted) };

  // --- substring search (see searchIndex.ts) ---------------------------------
  if (input.search) {
    const clause = buildSearchQuery<T>(input.search, config.searchRawFields);
    if (clause) Object.assign(filter, clause);
  }

  // --- multi-select equality filters ----------------------------------------
  for (const field of config.inFields ?? []) {
    const values = csvToArray(input[field]);
    // An absent param must not become { field: undefined } — Mongo reads that as
    // { field: null } and silently returns nothing.
    if (values.length === 1) filter[field] = values[0];
    else if (values.length > 1) filter[field] = { $in: values };
  }

  // --- numeric ranges --------------------------------------------------------
  for (const [field, [minKey, maxKey]] of Object.entries(config.rangeFields ?? {})) {
    const min = input[minKey];
    const max = input[maxKey];
    const clause: Record<string, number> = {};
    if (typeof min === 'number' && Number.isFinite(min)) clause.$gte = min;
    if (typeof max === 'number' && Number.isFinite(max)) clause.$lte = max;
    if (Object.keys(clause).length) filter[field] = clause;
  }

  // --- date range ------------------------------------------------------------
  const dateField =
    input.dateField && config.dateFields.includes(input.dateField)
      ? input.dateField
      : config.dateFields[0]!;

  let from: Date | undefined;
  let to: Date | undefined;

  if (input.datePreset) {
    ({ from, to } = resolvePreset(input.datePreset, input.timezone));
  } else if (input.dateFrom || input.dateTo) {
    ({ from, to } = resolveExplicitRange(input.timezone, input.dateFrom, input.dateTo));
  }

  if (from || to) {
    const clause: Record<string, Date> = {};
    if (from) clause.$gte = from;
    if (to) clause.$lt = to; // half-open, matches resolvePreset
    filter[dateField] = clause;
  }

  // --- sort ------------------------------------------------------------------
  const sortBy = input.sortBy && config.sortable.includes(input.sortBy) ? input.sortBy : 'createdAt';
  const dir: 1 | -1 = input.sortOrder === 'asc' ? 1 : -1;

  /**
   * The `_id` tiebreaker is not cosmetic.
   *
   * sort({ createdAt: -1 }) alone is non-deterministic whenever two documents share
   * a createdAt — and bulk inserts guarantee ties. MongoDB may order tied documents
   * differently between two queries, so paging 1 -> 2 can show the same record twice
   * and skip another entirely. Nothing errors; the data is just quietly wrong, and
   * it looks like a frontend bug.
   *
   * _id is unique, so appending it produces a total order. The compound indexes are
   * declared with a matching trailing _id, so this costs nothing at query time.
   */
  const sort: Record<string, 1 | -1> = sortBy === '_id' ? { _id: dir } : { [sortBy]: dir, _id: dir };

  return {
    filter: filter as FilterQuery<T>,
    sort,
    pagination: parsePagination(input.page, input.limit),
  };
}
