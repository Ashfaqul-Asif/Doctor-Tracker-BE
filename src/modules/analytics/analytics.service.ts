import { cached } from '../../shared/cache.js';
import { zonedStartOfDay } from '../../shared/dateRange.js';
import { Doctor } from '../doctors/doctor.model.js';
import { Patient } from '../patients/patient.model.js';
import type { DashboardQuery, PerDoctorQuery, TimeseriesQuery } from './analytics.schema.js';

type Granularity = 'day' | 'week' | 'month';

interface Bucket {
  _id: Date | null;
  count: number;
}

/** Start of the window, `months` back from the current month, in the caller's zone. */
function windowStart(months: number, timezone: string): Date {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' });
  const [y, m] = fmt.format(now).split('-').map(Number);
  const totalMonths = y! * 12 + (m! - 1) - (months - 1);
  return zonedStartOfDay(timezone, Math.floor(totalMonths / 12), (totalMonths % 12) + 1, 1);
}

function localYmd(date: Date, timezone: string): [number, number, number] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(date).split('-').map(Number);
  return [y!, m!, d!];
}

/**
 * Snap an instant to the same bucket boundary `$dateTrunc` would produce.
 *
 * This has to match exactly. $dateTrunc emits LOCAL midnight (18:00 UTC the
 * previous day, for Asia/Dhaka), so a fill loop that starts at the caller's raw
 * `from` and steps in fixed increments generates keys at 00:00 UTC which never
 * line up — every bucket then reads as zero and the chart looks empty.
 */
function truncateToBucket(date: Date, granularity: Granularity, timezone: string): Date {
  const [y, m, d] = localYmd(date, timezone);

  if (granularity === 'month') return zonedStartOfDay(timezone, y, m, 1);

  const startOfDay = zonedStartOfDay(timezone, y, m, d);
  if (granularity === 'day') return startOfDay;

  // $dateTrunc's week starts on Sunday by default.
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    startOfDay,
  );
  const offset = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  // Date.UTC rolls a non-positive day back into the previous month for us.
  return zonedStartOfDay(timezone, y, m, d - (offset < 0 ? 0 : offset));
}

function stepDate(date: Date, granularity: Granularity, timezone: string): Date {
  const [y, m] = localYmd(date, timezone);

  if (granularity === 'month') {
    return zonedStartOfDay(timezone, m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1);
  }

  // Re-truncate after adding: a DST transition makes a local day 23 or 25 hours
  // long, so a fixed 24h step would drift off the boundary.
  const days = granularity === 'week' ? 7 : 1;
  return truncateToBucket(new Date(date.getTime() + days * 86_400_000 + 3_600_000), granularity, timezone);
}

/**
 * Fill gaps so a chart shows a continuous axis. MongoDB only returns buckets that
 * contain documents; without this a quiet week silently disappears from the line
 * rather than showing as zero, which misreads as missing data.
 */
function zeroFill(
  buckets: Bucket[],
  from: Date,
  to: Date,
  granularity: Granularity,
  timezone: string,
): Array<{ date: string; count: number }> {
  const found = new Map(
    buckets.filter((b) => b._id).map((b) => [new Date(b._id!).toISOString(), b.count]),
  );

  const out: Array<{ date: string; count: number }> = [];
  // Must start on a real bucket boundary, or none of the generated keys will match
  // what $dateTrunc produced.
  let cursor = truncateToBucket(from, granularity, timezone);
  let guard = 0;

  while (cursor < to && guard++ < 1200) {
    const iso = cursor.toISOString();
    out.push({ date: iso, count: found.get(iso) ?? 0 });
    cursor = stepDate(cursor, granularity, timezone);
  }

  return out;
}

/**
 * The whole dashboard in one round trip.
 *
 * $facet runs every sub-pipeline over a single pass of the matched documents,
 * instead of five sequential queries each re-reading the collection.
 *
 * Honest caveat: { deletedAt: null } is not a selective match, so only the leading
 * $match uses an index and the sub-pipelines scan its output. The win here is one
 * pass instead of five, plus the TTL cache. At a scale where that stops being
 * enough, the answer is a scheduled $merge into a pre-aggregated rollup collection.
 */
export async function dashboard(query: DashboardQuery) {
  const { granularity, months, timezone } = query;
  const from = windowStart(months, timezone);

  return cached(
    `analytics:dashboard:${granularity}:${months}:${timezone}`,
    30_000,
    async () => {
      const [patientFacets, doctorFacets, topDoctors] = await Promise.all([
        Patient.aggregate([
          { $match: { deletedAt: null } },
          {
            $facet: {
              totals: [{ $count: 'total' }],
              byCondition: [
                { $group: { _id: '$condition', count: { $sum: 1 } } },
                { $sort: { count: -1, _id: 1 } },
                { $limit: 10 },
              ],
              byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
              byGender: [{ $group: { _id: '$gender', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
              trend: [
                { $match: { admittedAt: { $gte: from } } },
                {
                  $group: {
                    // timezone matters: without it a 00:30 Dhaka admission lands in
                    // the previous UTC day's bucket and the chart disagrees with
                    // the list view.
                    _id: { $dateTrunc: { date: '$admittedAt', unit: granularity, timezone } },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { _id: 1 } },
              ],
            },
          },
        ]),

        Doctor.aggregate([
          { $match: { deletedAt: null } },
          {
            $facet: {
              totals: [{ $count: 'total' }],
              bySpecialization: [
                { $group: { _id: '$specialization', count: { $sum: 1 } } },
                { $sort: { count: -1, _id: 1 } },
                { $limit: 10 },
              ],
              byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
              trend: [
                { $match: { createdAt: { $gte: from } } },
                {
                  $group: {
                    _id: { $dateTrunc: { date: '$createdAt', unit: granularity, timezone } },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { _id: 1 } },
              ],
            },
          },
        ]),

        patientsPerDoctor({ limit: 10, sort: 'desc' }),
      ]);

      const p = patientFacets[0] ?? {};
      const d = doctorFacets[0] ?? {};
      const totalPatients = p.totals?.[0]?.total ?? 0;
      const totalDoctors = d.totals?.[0]?.total ?? 0;
      const to = new Date();

      return {
        totals: {
          doctors: totalDoctors,
          patients: totalPatients,
          // Guarded: dividing by zero doctors yields Infinity, which JSON renders
          // as null and breaks the tile.
          avgPatientsPerDoctor:
            totalDoctors > 0 ? Number((totalPatients / totalDoctors).toFixed(2)) : 0,
        },
        patients: {
          byCondition: (p.byCondition ?? []).map((x: Bucket) => ({ label: x._id, count: x.count })),
          byStatus: (p.byStatus ?? []).map((x: Bucket) => ({ label: x._id, count: x.count })),
          byGender: (p.byGender ?? []).map((x: Bucket) => ({
            label: x._id ?? 'unspecified',
            count: x.count,
          })),
          trend: zeroFill(p.trend ?? [], from, to, granularity, timezone),
        },
        doctors: {
          bySpecialization: (d.bySpecialization ?? []).map((x: Bucket) => ({
            label: x._id,
            count: x.count,
          })),
          byStatus: (d.byStatus ?? []).map((x: Bucket) => ({ label: x._id, count: x.count })),
          trend: zeroFill(d.trend ?? [], from, to, granularity, timezone),
        },
        topDoctors,
        window: { from: from.toISOString(), to: to.toISOString(), granularity, timezone },
      };
    },
  );
}

/**
 * Patients per doctor — read from the Doctor collection, NOT by grouping patients.
 *
 * Grouping patients by doctorId only ever yields doctors who HAVE patients, so a
 * doctor with zero disappears from the chart — precisely the fact an admin most
 * needs to see. Reading the denormalised counter includes them, needs no
 * aggregation at all, and is a plain index scan on
 * { deletedAt: 1, patientCount: -1, _id: -1 }.
 */
export async function patientsPerDoctor(query: PerDoctorQuery) {
  const dir = query.sort === 'asc' ? 1 : -1;

  const doctors = await Doctor.find({ deletedAt: null })
    .select('name specialization patientCount')
    .sort({ patientCount: dir, _id: dir })
    .limit(query.limit)
    .lean();

  return doctors.map((d) => ({
    id: String(d._id),
    name: d.name,
    specialization: d.specialization,
    patientCount: d.patientCount ?? 0,
  }));
}

export async function timeseries(query: TimeseriesQuery) {
  const { granularity, months, timezone } = query;
  const from = query.from ? new Date(query.from) : windowStart(months, timezone);
  const to = query.to ? new Date(query.to) : new Date();

  const [patients, doctors] = await Promise.all([
    Patient.aggregate<Bucket>([
      { $match: { deletedAt: null, admittedAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$admittedAt', unit: granularity, timezone } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Doctor.aggregate<Bucket>([
      { $match: { deletedAt: null, createdAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$createdAt', unit: granularity, timezone } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return {
    patients: zeroFill(patients, from, to, granularity, timezone),
    doctors: zeroFill(doctors, from, to, granularity, timezone),
    window: { from: from.toISOString(), to: to.toISOString(), granularity, timezone },
  };
}

export async function bySpecialization() {
  return cached('analytics:by-specialization', 60_000, async () => {
    const rows = await Doctor.aggregate<Bucket>([
      { $match: { deletedAt: null } },
      { $group: { _id: '$specialization', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]);
    return rows.map((r) => ({ label: r._id, count: r.count }));
  });
}

export async function byCondition() {
  return cached('analytics:by-condition', 60_000, async () => {
    const rows = await Patient.aggregate<Bucket>([
      { $match: { deletedAt: null } },
      { $group: { _id: '$condition', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]);
    return rows.map((r) => ({ label: r._id, count: r.count }));
  });
}
