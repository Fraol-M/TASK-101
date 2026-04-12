import knex from '../../common/db/knex.js';
import { searchConfig } from '../../config/search.js';
import { searchQueriesTotal } from '../../common/metrics/metrics.js';

const { tsConfig, headline, activeVersionBoost, defaultPageSize, maxPageSize } = searchConfig;

/**
 * Full-text search across all versioned university-data entities.
 *
 * Uses PostgreSQL's ts_rank_cd (cover density ranking) to score results.
 * Only active versions are searched by default; archived/superseded are excluded.
 */
export const searchService = {
  /**
   * Search across all entity types.
   *
   * @param {string} queryText
   * @param {object} options
   * @param {string[]} [options.entityTypes]  Filter to specific entity types
   * @param {number}  [options.page]
   * @param {number}  [options.pageSize]
   * @param {string}  [options.accountId]     For logging
   * @param {string}  [options.requestId]
   */
  /**
   * Expand a query term by looking up its synonyms in the search_synonyms table.
   * Returns an array of all terms (original + synonyms, deduplicated).
   */
  async _expandSynonyms(queryText) {
    const terms = queryText
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/gi, '').trim())
      .filter(Boolean);

    if (!terms.length) return [queryText];

    const rows = await knex('search_synonyms').whereIn('term', terms).select('term', 'synonyms');
    const synonymMap = new Map(rows.map((r) => [r.term, r.synonyms]));

    const expanded = new Set([queryText]);
    for (const term of terms) {
      const synonyms = synonymMap.get(term) || [];
      for (const s of synonyms) {
        expanded.add(s);
      }
    }
    return [...expanded];
  },

  async search(queryText, options = {}) {
    if (!queryText?.trim()) return { rows: [], total: 0, queryText };
    searchQueriesTotal.inc();

    const pageSize = Math.min(options.pageSize || defaultPageSize, maxPageSize);
    const page = options.page || 1;
    const offset = (page - 1) * pageSize;

    const entityTypes = options.entityTypes?.length ? options.entityTypes : null;
    const lifecycleStatuses = options.lifecycleStatus?.length
      ? options.lifecycleStatus
      : ['active', 'scheduled', 'superseded'];
    const effectiveFrom = options.effectiveFrom || null;
    const effectiveTo = options.effectiveTo || null;
    const nameContains = options.nameContains || null;
    const descriptionContains = options.descriptionContains || null;
    // tags: each element checked via JSON containment — entity matches if its tags array
    // contains at least one of the requested values.
    const filterTags = options.tags?.length ? options.tags : null;

    // Expand query with synonyms for richer recall
    const expandedTerms = await this._expandSynonyms(queryText);

    // We use a UNION ALL across entity version tables — each entity emits the same columns
    const entityConfigs = [
      { table: 'university_versions',            entityType: 'university',            idCol: 'university_id' },
      { table: 'school_versions',                entityType: 'school',                idCol: 'school_id' },
      { table: 'major_versions',                 entityType: 'major',                 idCol: 'major_id' },
      { table: 'research_track_versions',        entityType: 'research_track',        idCol: 'research_track_id' },
      { table: 'enrollment_plan_versions',       entityType: 'enrollment_plan',       idCol: 'enrollment_plan_id' },
      { table: 'transfer_quota_versions',        entityType: 'transfer_quota',        idCol: 'transfer_quota_id' },
      { table: 'application_requirement_versions', entityType: 'application_requirement', idCol: 'application_requirement_id' },
      { table: 'retest_rule_versions',           entityType: 'retest_rule',           idCol: 'retest_rule_id' },
    ].filter((e) => !entityTypes || entityTypes.includes(e.entityType));

    if (!entityConfigs.length) return { rows: [], total: 0, queryText };

    const start = Date.now();

    // Build a combined tsquery from the original term and all synonym expansions.
    // Each term becomes a websearch_to_tsquery clause joined with ||.
    // websearch_to_tsquery supports quoted phrases and exclusions; it also uses
    // the grad_search config (unaccent + english_stem) for normalisation.
    const tsqueryExpr = expandedTerms
      .map(() => `websearch_to_tsquery(?, ?)`)
      .join(' || ');
    const tsqueryParams = expandedTerms.flatMap((t) => [tsConfig, t]);

    // Build UNION ALL query
    const statusPlaceholders = lifecycleStatuses.map(() => '?').join(', ');
    // Tag OR-match: payload_json->'tags' @> '["t"]'::jsonb for each tag
    const tagClause = filterTags
      ? `AND (${filterTags.map(() => `payload_json->'tags' @> ?::jsonb`).join(' OR ')})`
      : '';

    const unionParts = entityConfigs.map(({ table, entityType, idCol }) =>
      knex.raw(
        `
        SELECT
          ? AS entity_type,
          ${idCol} AS stable_id,
          id AS version_id,
          lifecycle_status,
          payload_json->>'name' AS name,
          payload_json->>'description' AS description,
          ts_rank_cd(search_vector, (${tsqueryExpr}))
            * CASE WHEN lifecycle_status = 'active' THEN ${activeVersionBoost} ELSE 1.0 END AS rank,
          ts_headline(
            ?,
            payload_json->>'name' || ' ' || COALESCE(payload_json->>'description', ''),
            (${tsqueryExpr}),
            ?
          ) AS headline
        FROM ${table}
        WHERE search_vector @@ (${tsqueryExpr})
          AND lifecycle_status IN (${statusPlaceholders})
          ${effectiveFrom ? 'AND effective_from >= ?' : ''}
          ${effectiveTo ? 'AND effective_from <= ?' : ''}
          ${nameContains ? "AND payload_json->>'name' ILIKE ?" : ''}
          ${descriptionContains ? "AND payload_json->>'description' ILIKE ?" : ''}
          ${tagClause}
        `,
        [
          entityType,
          ...tsqueryParams,
          tsConfig,
          ...tsqueryParams,
          `StartSel=${headline.startSel},StopSel=${headline.stopSel},MaxWords=${headline.maxWords},MinWords=${headline.minWords}`,
          ...tsqueryParams,
          ...lifecycleStatuses,
          ...(effectiveFrom ? [effectiveFrom] : []),
          ...(effectiveTo ? [effectiveTo] : []),
          ...(nameContains ? [`%${nameContains}%`] : []),
          ...(descriptionContains ? [`%${descriptionContains}%`] : []),
          ...(filterTags ? filterTags.map((t) => JSON.stringify([t])) : []),
        ],
      ).toString()
    );

    const unionSQL = unionParts.join('\nUNION ALL\n');

    const results = await knex.raw(
      `
      SELECT * FROM (
        ${unionSQL}
      ) combined
      ORDER BY rank DESC
      LIMIT ? OFFSET ?
      `,
      [pageSize, offset],
    );

    const countResult = await knex.raw(
      `
      SELECT COUNT(*) AS total FROM (
        ${unionSQL}
      ) combined
      `,
      [],
    );

    const total = Number(countResult.rows[0]?.total || 0);
    const durationMs = Date.now() - start;

    // Log query asynchronously (non-blocking)
    if (options.accountId) {
      knex('search_query_log')
        .insert({
          account_id: options.accountId,
          query_text: queryText.substring(0, 1000),
          entity_type: entityTypes?.join(',') || 'all',
          result_count: total,
          duration_ms: durationMs,
        })
        .catch(() => {}); // Never let logging failures affect the response
    }

    return {
      rows: results.rows,
      total,
      queryText,
      durationMs,
    };
  },

  /**
   * Suggest query completions based on existing entity names.
   * Returns up to 10 name prefixes.
   *
   * @param {string} prefix
   */
  async suggest(prefix) {
    if (!prefix?.trim() || prefix.length < 2) return [];

    const tables = [
      'university_versions',
      'school_versions',
      'major_versions',
    ];

    const parts = tables.map((t) =>
      knex(t)
        .where('lifecycle_status', 'active')
        .whereRaw("payload_json->>'name' ILIKE ?", [`${prefix}%`])
        .select(knex.raw("payload_json->>'name' AS name"))
        .limit(5)
    );

    const results = await Promise.all(parts);
    const names = [...new Set(results.flat().map((r) => r.name).filter(Boolean))];
    return names.slice(0, 10);
  },
};
