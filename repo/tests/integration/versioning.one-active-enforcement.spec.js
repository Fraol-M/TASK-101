import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for versioned entity one-active-version enforcement.
 * Covers university_versions and school_versions to verify the partial
 * unique index pattern holds across multiple entity types.
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

let knex;

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  // Ensure migrations are applied to test DB
  await knex.migrate.latest();
});

afterAll(async () => {
  await knex.destroy();
});

describe('One active version per entity', () => {
  it('partial unique index prevents two active versions', async () => {
    // This test verifies the DB-level constraint directly
    const [univ] = await knex('universities')
      .insert({ name_normalized: 'test university ' + Date.now(), created_by: null })
      .returning('*');

    const today = new Date().toISOString().split('T')[0];

    // Insert first active version
    await knex('university_versions').insert({
      university_id: univ.id,
      version_number: 1,
      lifecycle_status: 'active',
      effective_from: today,
      payload_json: JSON.stringify({ name: 'Test University' }),
    });

    // Attempting to insert a second active version should throw due to partial unique index
    await expect(
      knex('university_versions').insert({
        university_id: univ.id,
        version_number: 2,
        lifecycle_status: 'active',
        effective_from: today,
        payload_json: JSON.stringify({ name: 'Test University v2' }),
      }),
    ).rejects.toThrow();

    // Cleanup
    await knex('university_versions').where({ university_id: univ.id }).delete();
    await knex('universities').where({ id: univ.id }).delete();
  });

  it('allows scheduled version alongside active version', async () => {
    const [univ] = await knex('universities')
      .insert({ name_normalized: 'test univ scheduled ' + Date.now(), created_by: null })
      .returning('*');

    const today = new Date().toISOString().split('T')[0];
    const future = '2099-12-31';

    await knex('university_versions').insert({
      university_id: univ.id,
      version_number: 1,
      lifecycle_status: 'active',
      effective_from: today,
      payload_json: JSON.stringify({ name: 'Test' }),
    });

    // Scheduled version alongside active — this is allowed
    await expect(
      knex('university_versions').insert({
        university_id: univ.id,
        version_number: 2,
        lifecycle_status: 'scheduled',
        effective_from: future,
        payload_json: JSON.stringify({ name: 'Test Future' }),
      }),
    ).resolves.toBeDefined();

    // Cleanup
    await knex('university_versions').where({ university_id: univ.id }).delete();
    await knex('universities').where({ id: univ.id }).delete();
  });
});

describe('One active version per entity — school_versions', () => {
  it('partial unique index prevents two active school versions', async () => {
    const [univ] = await knex('universities')
      .insert({ name_normalized: 'school-test-univ ' + Date.now(), created_by: null })
      .returning('*');

    const [school] = await knex('schools')
      .insert({ university_id: univ.id, name_normalized: 'school of arts ' + Date.now() })
      .returning('*');

    const today = new Date().toISOString().split('T')[0];

    await knex('school_versions').insert({
      school_id: school.id,
      version_number: 1,
      lifecycle_status: 'active',
      effective_from: today,
      payload_json: JSON.stringify({ name: 'School of Arts' }),
    });

    await expect(
      knex('school_versions').insert({
        school_id: school.id,
        version_number: 2,
        lifecycle_status: 'active',
        effective_from: today,
        payload_json: JSON.stringify({ name: 'School of Arts v2' }),
      }),
    ).rejects.toThrow();

    // Cleanup
    await knex('school_versions').where({ school_id: school.id }).delete();
    await knex('schools').where({ id: school.id }).delete();
    await knex('universities').where({ id: univ.id }).delete();
  });

  it('allows superseded + active school versions for the same entity', async () => {
    const [univ] = await knex('universities')
      .insert({ name_normalized: 'school-test-univ2 ' + Date.now(), created_by: null })
      .returning('*');

    const [school] = await knex('schools')
      .insert({ university_id: univ.id, name_normalized: 'school of science ' + Date.now() })
      .returning('*');

    const today = new Date().toISOString().split('T')[0];

    // First version superseded (represents prior active, now retired)
    await knex('school_versions').insert({
      school_id: school.id,
      version_number: 1,
      lifecycle_status: 'superseded',
      effective_from: '2024-01-01',
      payload_json: JSON.stringify({ name: 'School of Science v1' }),
    });

    // Second version active — allowed because only one active exists
    await expect(
      knex('school_versions').insert({
        school_id: school.id,
        version_number: 2,
        lifecycle_status: 'active',
        effective_from: today,
        payload_json: JSON.stringify({ name: 'School of Science v2' }),
      }),
    ).resolves.toBeDefined();

    // Cleanup
    await knex('school_versions').where({ school_id: school.id }).delete();
    await knex('schools').where({ id: school.id }).delete();
    await knex('universities').where({ id: univ.id }).delete();
  });
});
