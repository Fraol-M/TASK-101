import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for searchService against a real PostgreSQL database.
 *
 * These tests replace the service-mocked coverage in tests/api/search.spec.js
 * for the critical logic paths: FTS match, lifecycle-status-based rank boost,
 * archive exclusion, and synonym expansion.
 *
 * Requires a real PostgreSQL test database (graddb_test) with migrations applied
 * (including the grad_search FTS config from p7 migrations).
 * Run with: npm run test:integration
 */

const TS = Date.now();

let knex;
let searchService;

// Unique word that won't collide with other test data and will survive any English
// stemmer pass unchanged (or symmetrically on both index and query sides).
const UNIQUE_TERM = `xyvexion${TS}`;

const cleanup = {
  universityIds: [],
  synonymTerms: [],
};

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  const mod = await import('../../src/modules/search/search.service.js');
  searchService = mod.searchService;
});

afterAll(async () => {
  if (cleanup.universityIds.length) {
    // Version rows have a FK to universities with onDelete RESTRICT, so delete versions first
    for (const univId of cleanup.universityIds) {
      await knex('university_versions').where({ university_id: univId }).delete();
    }
    await knex('universities').whereIn('id', cleanup.universityIds).delete();
  }
  if (cleanup.synonymTerms.length) {
    await knex('search_synonyms').whereIn('term', cleanup.synonymTerms).delete();
  }
  await knex.destroy();
});

async function insertUniversity(name) {
  const [univ] = await knex('universities')
    .insert({ name_normalized: name.toLowerCase() })
    .returning('id');
  cleanup.universityIds.push(univ.id);
  return univ;
}

async function insertVersion(universityId, { status, name, versionNumber = 1 }) {
  const today = new Date().toISOString().split('T')[0];
  await knex('university_versions').insert({
    university_id: universityId,
    version_number: versionNumber,
    lifecycle_status: status,
    effective_from: today,
    payload_json: JSON.stringify({ name, description: `Description for ${name}` }),
  });
}

describe('searchService.search — FTS against real DB', () => {
  it('finds an active version whose name contains the search term', async () => {
    const univ = await insertUniversity(`${UNIQUE_TERM} Institute`);
    await insertVersion(univ.id, { status: 'active', name: `${UNIQUE_TERM} Institute of Technology` });

    const result = await searchService.search(UNIQUE_TERM);

    expect(result.total).toBeGreaterThanOrEqual(1);
    const match = result.rows.find((r) => r.stable_id === univ.id);
    expect(match).toBeDefined();
    expect(match.entity_type).toBe('university');
  });

  it('ranks active version higher than a superseded version of the same entity', async () => {
    const univ = await insertUniversity(`${UNIQUE_TERM} Comparative`);

    // Insert active version first (v1)
    await insertVersion(univ.id, {
      status: 'active',
      name: `${UNIQUE_TERM} Active Version`,
      versionNumber: 1,
    });
    // Insert superseded version (v2) — same stable ID, different version row
    await insertVersion(univ.id, {
      status: 'superseded',
      name: `${UNIQUE_TERM} Superseded Version`,
      versionNumber: 2,
    });

    const result = await searchService.search(UNIQUE_TERM);
    // Both versions should appear since superseded is included
    const rows = result.rows.filter((r) => r.stable_id === univ.id);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Active version must be ranked higher (appears first in DESC order)
    const activeIndex = rows.findIndex((r) => r.lifecycle_status === 'active');
    const supersededIndex = rows.findIndex((r) => r.lifecycle_status === 'superseded');
    expect(activeIndex).toBeLessThan(supersededIndex);
  });

  it('excludes archived versions from search results', async () => {
    const univ = await insertUniversity(`${UNIQUE_TERM} Archived`);
    await insertVersion(univ.id, {
      status: 'archived',
      name: `${UNIQUE_TERM} Archived Version`,
      versionNumber: 1,
    });

    const result = await searchService.search(UNIQUE_TERM);
    const archivedMatches = result.rows.filter(
      (r) => r.stable_id === univ.id && r.lifecycle_status === 'archived',
    );
    expect(archivedMatches).toHaveLength(0);
  });

  it('returns empty result for an empty query', async () => {
    const result = await searchService.search('');
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe('searchService.search — synonym expansion', () => {
  it('returns entities matching a synonym of the query term', async () => {
    // Insert a university whose name contains the canonical term (not the query term)
    const canonicalName = `${UNIQUE_TERM}canon`;
    const synonymTerm = `${UNIQUE_TERM}syn`;
    const univ = await insertUniversity(canonicalName);
    await insertVersion(univ.id, {
      status: 'active',
      name: `${canonicalName} University`,
      versionNumber: 1,
    });

    // Add a synonym entry: searching for synonymTerm should expand to canonicalName
    await knex('search_synonyms').insert({
      term: synonymTerm,
      synonyms: [canonicalName],
    });
    cleanup.synonymTerms.push(synonymTerm);

    // Search using the synonym — the service should expand it to canonicalName
    const result = await searchService.search(synonymTerm);
    const match = result.rows.find((r) => r.stable_id === univ.id);
    expect(match).toBeDefined();
  });
});

describe('searchService.suggest — prefix matching', () => {
  it('returns name suggestions for a prefix that matches an active university version', async () => {
    // Use a unique prefix so it doesn't collide with other test data
    const prefix = `ZzSuggest${TS}`;
    const univ = await insertUniversity(prefix.toLowerCase());
    await insertVersion(univ.id, {
      status: 'active',
      name: `${prefix} University of Sciences`,
      versionNumber: 1,
    });

    const suggestions = await searchService.suggest(prefix);
    expect(suggestions.some((s) => s.toLowerCase().startsWith(prefix.toLowerCase()))).toBe(true);
  });

  it('returns empty array for a prefix shorter than 2 characters', async () => {
    const result = await searchService.suggest('z');
    expect(result).toEqual([]);
  });
});
