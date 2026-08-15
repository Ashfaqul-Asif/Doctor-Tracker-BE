/**
 * Timezone-correct date boundaries.
 *
 * "date-wise" filtering is meaningless without a timezone. `datePreset=today` and
 * `$dateTrunc` both default to UTC, so for a user at UTC+6 a record created at
 * 09:00 local on the 3rd lands in the 2nd's bucket, and "today" starts at 6am.
 * Roughly a quarter of each day's records land in the wrong bucket — visible as a
 * chart that disagrees with the list view, with nothing actually erroring.
 */

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7d'
  | 'last30d'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear';

export const DATE_PRESETS: readonly DatePreset[] = [
  'today',
  'yesterday',
  'last7d',
  'last30d',
  'thisMonth',
  'lastMonth',
  'thisYear',
] as const;

/**
 * Read the wall-clock Y/M/D in `timeZone` for a given instant. Intl is the only
 * dependency-free way to do this correctly across DST.
 */
function partsIn(timeZone: string, at: Date): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(at).split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

/**
 * The UTC offset of `timeZone` at a given instant, in minutes. Computed rather than
 * assumed, so zones with DST stay correct across the boundary.
 */
function offsetMinutes(timeZone: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24, // some locales render midnight as hour 24
    Number(p.minute),
    Number(p.second),
  );
  // Compare against the same instant with milliseconds zeroed, since the formatted
  // parts have second resolution.
  return (asUtc - (at.getTime() - at.getMilliseconds())) / 60_000;
}

/** The UTC instant corresponding to local midnight of Y-M-D in `timeZone`. */
export function zonedStartOfDay(timeZone: string, y: number, m: number, d: number): Date {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  // Apply the offset that is in effect near that local midnight, then correct once
  // in case the first guess landed on the other side of a DST transition.
  const guess = new Date(naive - offsetMinutes(timeZone, new Date(naive)) * 60_000);
  const corrected = new Date(naive - offsetMinutes(timeZone, guess) * 60_000);
  return corrected;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Resolve a preset into a half-open UTC instant range [from, to).
 * Half-open avoids the classic off-by-one where `<=` on an end-of-day boundary
 * either drops or double-counts records landing exactly on midnight.
 */
export function resolvePreset(
  preset: DatePreset,
  timeZone: string,
  now = new Date(),
): { from: Date; to: Date } {
  const { y, m, d } = partsIn(timeZone, now);
  const startToday = zonedStartOfDay(timeZone, y, m, d);

  switch (preset) {
    case 'today':
      return { from: startToday, to: addDays(startToday, 1) };
    case 'yesterday':
      return { from: addDays(startToday, -1), to: startToday };
    case 'last7d':
      return { from: addDays(startToday, -6), to: addDays(startToday, 1) };
    case 'last30d':
      return { from: addDays(startToday, -29), to: addDays(startToday, 1) };
    case 'thisMonth':
      return {
        from: zonedStartOfDay(timeZone, y, m, 1),
        to: zonedStartOfDay(timeZone, m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1),
      };
    case 'lastMonth':
      return {
        from: zonedStartOfDay(timeZone, m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 1),
        to: zonedStartOfDay(timeZone, y, m, 1),
      };
    case 'thisYear':
      return { from: zonedStartOfDay(timeZone, y, 1, 1), to: zonedStartOfDay(timeZone, y + 1, 1, 1) };
  }
}

/**
 * Build a Mongo range clause from an explicit from/to pair. `dateTo` is treated as
 * an inclusive *day* when it carries no time component, so `dateTo=2026-08-15`
 * includes everything that happened on the 15th rather than nothing at all.
 */
export function resolveExplicitRange(
  timeZone: string,
  dateFrom?: string,
  dateTo?: string,
): { from?: Date; to?: Date } {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const out: { from?: Date; to?: Date } = {};

  if (dateFrom) {
    if (dateOnly.test(dateFrom)) {
      const [y, m, d] = dateFrom.split('-').map(Number);
      out.from = zonedStartOfDay(timeZone, y!, m!, d!);
    } else {
      out.from = new Date(dateFrom);
    }
  }

  if (dateTo) {
    if (dateOnly.test(dateTo)) {
      const [y, m, d] = dateTo.split('-').map(Number);
      out.to = addDays(zonedStartOfDay(timeZone, y!, m!, d!), 1); // half-open
    } else {
      out.to = new Date(dateTo);
    }
  }

  return out;
}
