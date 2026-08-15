import { describe, expect, it } from 'vitest';
import {
  buildSearchQuery,
  buildSearchSuffixes,
  MAX_SUFFIX_LEN,
  normalizeSearchText,
} from '../src/shared/searchIndex.js';
import { Doctor } from '../src/modules/doctors/doctor.model.js';
import { API, loginAgent, makeDoctor } from './helpers/app.js';

describe('suffix index construction', () => {
  it('produces every suffix, so any substring is reachable as a prefix', () => {
    const suffixes = buildSearchSuffixes(['Asif']);
    expect(suffixes).toEqual(expect.arrayContaining(['asif', 'sif', 'if']));
  });

  it('folds case and diacritics', () => {
    expect(normalizeSearchText('José  MARÍN')).toBe('jose marin');
    expect(buildSearchSuffixes(['José'])).toContain('jose');
  });

  it('caps suffix length so storage stays O(L x 24), not O(L^2)', () => {
    const long = 'a'.repeat(60);
    for (const s of buildSearchSuffixes([long])) {
      expect(s.length).toBeLessThanOrEqual(MAX_SUFFIX_LEN);
    }
  });

  it('anchors the probe and omits the `i` flag (both required for an index scan)', () => {
    const q = buildSearchQuery<Record<string, unknown>>('qul') as {
      searchSuffixes: RegExp;
    };
    expect(q.searchSuffixes.source.startsWith('^')).toBe(true);
    expect(q.searchSuffixes.flags).toBe('');
  });

  it('escapes regex metacharacters instead of letting them alter the pattern', () => {
    const q = buildSearchQuery<Record<string, unknown>>('a.*b') as { searchSuffixes: RegExp };
    expect(q.searchSuffixes.source).toBe('^a\\.\\*b');
  });

  it('adds an exact verification clause when the term exceeds the stored cap', () => {
    const term = 'x'.repeat(MAX_SUFFIX_LEN + 5);
    const q = buildSearchQuery<Record<string, unknown>>(term, ['name']) as { $and?: unknown[] };
    // Without this the query would match on only the first 24 chars.
    expect(q.$and).toHaveLength(2);
  });

  it('returns null below the minimum length rather than matching everything', () => {
    expect(buildSearchQuery('a')).toBeNull();
  });
});

describe('GET /doctors?search — the acceptance requirement', () => {
  /**
   * The stated requirement: a doctor named "Ashfaqul Asif" must be found by `Ash`,
   * by `asif`, and by `qul` — the last one is mid-word, which is what rules out
   * text indexes and prefix-only schemes.
   */
  it.each(['Ash', 'ash', 'asif', 'Asif', 'qul', 'ashfa', 'sif', 'faqul', 'ul asi'])(
    'finds "Ashfaqul Asif" by the substring %j',
    async (term) => {
      const agent = await loginAgent();
      await makeDoctor({ name: 'Ashfaqul Asif', email: 'target@test.dev' });
      await makeDoctor({ name: 'Zubair Khan', email: 'other@test.dev' });

      const res = await agent.get(`${API}/doctors`).query({ search: term });

      expect(res.status).toBe(200);
      expect(res.body.data.map((d: { name: string }) => d.name)).toEqual(['Ashfaqul Asif']);
    },
  );

  it('matches across every indexed field, not just name', async () => {
    const agent = await loginAgent();
    await makeDoctor({ name: 'Someone Else', specialization: 'Cardiology', email: 'x@test.dev' });

    // "rdiol" is mid-word inside "Cardiology".
    const res = await agent.get(`${API}/doctors`).query({ search: 'rdiol' });
    expect(res.body.data).toHaveLength(1);
  });

  it('rejects a one-character term with 422 rather than scanning everything', async () => {
    const agent = await loginAgent();
    const res = await agent.get(`${API}/doctors`).query({ search: 'a' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('keeps searchSuffixes out of the API response', async () => {
    const agent = await loginAgent();
    await makeDoctor({ name: 'Hidden Field', email: 'hf@test.dev' });
    const res = await agent.get(`${API}/doctors`).query({ search: 'Hidden' });
    expect(res.body.data[0]).not.toHaveProperty('searchSuffixes');
  });

  it('rebuilds the index when a searchable field is edited', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ name: 'Original Name', email: 'edit@test.dev' });

    await agent.patch(`${API}/doctors/${doctor.id}`).send({ name: 'Ashfaqul Asif' }).expect(200);

    const found = await agent.get(`${API}/doctors`).query({ search: 'qul' });
    expect(found.body.data).toHaveLength(1);

    const gone = await agent.get(`${API}/doctors`).query({ search: 'Original' });
    expect(gone.body.data).toHaveLength(0);
  });

  it('does not leak archived doctors into search results', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ name: 'Ashfaqul Asif', email: 'del@test.dev' });
    await Doctor.updateOne({ _id: doctor._id }, { $set: { deletedAt: new Date() } });

    const res = await agent.get(`${API}/doctors`).query({ search: 'qul' });
    expect(res.body.data).toHaveLength(0);
  });
});
