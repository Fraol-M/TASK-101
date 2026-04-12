/**
 * Migration 015 — Search synonym dictionary.
 * Stores domain synonyms used for application-level query expansion in the
 * search service (e.g. "AI" → ["artificial intelligence", "machine learning"]).
 * Using a table rather than a filesystem thesaurus keeps the setup portable
 * across Docker environments.
 * Depends on: 000 (grad_search FTS config)
 */

export async function up(knex) {
  await knex.schema.createTable('search_synonyms', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    // Canonical term (normalised to lowercase)
    t.text('term').notNullable().unique();
    // Array of synonym strings — stored lowercase, expanded at query time
    t.specificType('synonyms', 'TEXT[]').notNullable().defaultTo(knex.raw("'{}'::text[]"));
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX idx_search_synonyms_term ON search_synonyms(term)');

  // Seed common academic/admissions domain synonyms
  await knex('search_synonyms').insert([
    { term: 'ai',                    synonyms: ['artificial intelligence', 'machine learning', 'deep learning', 'ml'] },
    { term: 'cs',                    synonyms: ['computer science', 'computing', 'software engineering'] },
    { term: 'ml',                    synonyms: ['machine learning', 'artificial intelligence', 'ai'] },
    { term: 'phd',                   synonyms: ['doctorate', 'doctoral', 'doctor of philosophy'] },
    { term: 'ms',                    synonyms: ['master of science', 'masters', 'graduate degree'] },
    { term: 'mba',                   synonyms: ['master of business administration', 'business graduate'] },
    { term: 'nlp',                   synonyms: ['natural language processing', 'computational linguistics'] },
    { term: 'cv',                    synonyms: ['computer vision', 'image recognition', 'visual computing'] },
    { term: 'bioinformatics',        synonyms: ['computational biology', 'genomics', 'systems biology'] },
    { term: 'data science',          synonyms: ['data analytics', 'statistics', 'big data', 'data engineering'] },
  ]);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('search_synonyms');
}
