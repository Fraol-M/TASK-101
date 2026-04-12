import knex from '../../common/db/knex.js';
import { NotFoundError, ConflictError } from '../../common/errors/AppError.js';
import { withTransaction } from '../../common/db/transaction.js';
import config from '../../config/env.js';
import { recommendationGenerationsTotal } from '../../common/metrics/metrics.js';
import { auditService } from '../admin/audit/audit.service.js';
import logger from '../../common/logging/logger.js';

const RETENTION_DAYS = config.personalization.historyRetentionDays;

export const personalizationService = {
  // ── View history ───────────────────────────────────────────────────────────

  async recordView({ accountId, entityType, stableId, versionId }) {
    await knex('entity_view_history').insert({
      account_id: accountId,
      entity_type: entityType,
      stable_id: stableId,
      version_id: versionId || null,
    });
    auditService.record({
      actorAccountId: accountId,
      actionType: 'personalization.view_recorded',
      entityType,
      entityId: stableId,
      afterSummary: { entityType, versionId: versionId || null },
    }).catch((err) => logger.warn({ err }, 'audit write failed'));
  },

  async getHistory(accountId, options = {}) {
    const pageSize = Math.min(options.pageSize || 20, 100);
    const page = options.page || 1;
    const since = new Date();
    since.setDate(since.getDate() - RETENTION_DAYS);
    const q = knex('entity_view_history')
      .where('account_id', accountId)
      .where('viewed_at', '>=', since.toISOString())
      .orderBy('viewed_at', 'desc');
    if (options.entityType) q.where('entity_type', options.entityType);
    const total = await q.clone().count('id as count').first().then((r) => Number(r.count));
    const rows = await q.limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total };
  },

  // ── Bookmarks ──────────────────────────────────────────────────────────────

  async addBookmark({ accountId, entityType, stableId }) {
    try {
      return await withTransaction(async (trx) => {
        const [bookmark] = await trx('entity_bookmarks')
          .insert({ account_id: accountId, entity_type: entityType, stable_id: stableId })
          .returning('*');
        await auditService.record({
          actorAccountId: accountId,
          actionType: 'personalization.bookmark_added',
          entityType,
          entityId: stableId,
          afterSummary: { entityType },
        }, trx);
        return bookmark;
      });
    } catch (err) {
      if (err.code === '23505') throw new ConflictError('Already bookmarked');
      throw err;
    }
  },

  async removeBookmark({ accountId, entityType, stableId }) {
    await withTransaction(async (trx) => {
      const deleted = await trx('entity_bookmarks')
        .where({ account_id: accountId, entity_type: entityType, stable_id: stableId })
        .delete();
      if (!deleted) throw new NotFoundError('Bookmark not found');
      await auditService.record({
        actorAccountId: accountId,
        actionType: 'personalization.bookmark_removed',
        entityType,
        entityId: stableId,
        beforeSummary: { entityType },
      }, trx);
    });
  },

  async getBookmarks(accountId, options = {}) {
    const pageSize = Math.min(options.pageSize || 20, 100);
    const page = options.page || 1;
    const q = knex('entity_bookmarks').where('account_id', accountId).orderBy('created_at', 'desc');
    if (options.entityType) q.where('entity_type', options.entityType);
    const total = await q.clone().count('id as count').first().then((r) => Number(r.count));
    const rows = await q.limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total };
  },

  // ── Preferences ────────────────────────────────────────────────────────────

  async getPreferences(accountId) {
    const rows = await knex('user_preferences').where('account_id', accountId);
    // Return as a flat key→value map
    return Object.fromEntries(rows.map((r) => [r.pref_key, r.pref_value]));
  },

  async setPreference(accountId, prefKey, prefValue) {
    return withTransaction(async (trx) => {
      const [pref] = await trx('user_preferences')
        .insert({
          account_id: accountId,
          pref_key: prefKey,
          pref_value: JSON.stringify(prefValue),
          updated_at: new Date().toISOString(),
        })
        .onConflict(['account_id', 'pref_key'])
        .merge(['pref_value', 'updated_at'])
        .returning('*');
      await auditService.record({
        actorAccountId: accountId,
        actionType: 'personalization.preference_set',
        entityType: 'preference',
        entityId: accountId,
        afterSummary: { prefKey },
      }, trx);
      return pref;
    });
  },

  async deletePreference(accountId, prefKey) {
    await withTransaction(async (trx) => {
      const deleted = await trx('user_preferences')
        .where({ account_id: accountId, pref_key: prefKey })
        .delete();
      if (!deleted) throw new NotFoundError('Preference not found');
      await auditService.record({
        actorAccountId: accountId,
        actionType: 'personalization.preference_deleted',
        entityType: 'preference',
        entityId: accountId,
        beforeSummary: { prefKey },
      }, trx);
    });
  },

  // ── Tag subscriptions ──────────────────────────────────────────────────────

  async getTagSubscriptions(accountId) {
    return knex('tag_subscriptions').where('account_id', accountId).orderBy('created_at', 'desc');
  },

  async addTagSubscription({ accountId, tag, tagType = 'topic' }) {
    try {
      return await withTransaction(async (trx) => {
        const [sub] = await trx('tag_subscriptions')
          .insert({ account_id: accountId, tag, tag_type: tagType })
          .returning('*');
        await auditService.record({
          actorAccountId: accountId,
          actionType: 'personalization.tag_subscribed',
          entityType: 'tag_subscription',
          entityId: accountId,
          afterSummary: { tag, tagType },
        }, trx);
        return sub;
      });
    } catch (err) {
      if (err.code === '23505') throw new ConflictError('Already subscribed to this tag');
      throw err;
    }
  },

  async removeTagSubscription({ accountId, tag }) {
    await withTransaction(async (trx) => {
      const deleted = await trx('tag_subscriptions')
        .where({ account_id: accountId, tag })
        .delete();
      if (!deleted) throw new NotFoundError('Tag subscription not found');
      await auditService.record({
        actorAccountId: accountId,
        actionType: 'personalization.tag_unsubscribed',
        entityType: 'tag_subscription',
        entityId: accountId,
        beforeSummary: { tag },
      }, trx);
    });
  },

  // ── Recommendations ────────────────────────────────────────────────────────

  /**
   * Generate ranked recommendations with a deterministic explanation for each item.
   *
   * Scoring rules (applied in order, additive):
   *   +N   per view in the last 30 days (N = view count)
   *   +3   if bookmarked
   *   +2   if entity_type matches a tag subscription
   *
   * Cold-start: when the user has no signals at all, fall back to the 10 most
   * recently published active entities across all entity types.
   *
   * Each recommendation item includes a `reasons` array explaining the score,
   * making the output fully explainable.
   *
   * @param {string} accountId
   * @returns {Array<{entityType, stableId, score, reasons}>}
   */
  async getRecommendations(accountId) {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    recommendationGenerationsTotal.inc();
    const [views, bookmarks, tagSubs] = await Promise.all([
      knex('entity_view_history')
        .where('account_id', accountId)
        .where('viewed_at', '>=', since.toISOString())
        .select('entity_type', 'stable_id')
        .count('id as view_count')
        .groupBy('entity_type', 'stable_id')
        .orderBy('view_count', 'desc')
        .limit(50),
      knex('entity_bookmarks')
        .where('account_id', accountId)
        .select('entity_type', 'stable_id'),
      knex('tag_subscriptions')
        .where('account_id', accountId)
        .select('tag', 'tag_type'),
    ]);

    const subscribedEntityTypes = new Set(
      tagSubs.filter((t) => t.tag_type === 'entity_type').map((t) => t.tag),
    );

    // ── Cold-start path ───────────────────────────────────────────────────────
    if (!views.length && !bookmarks.length && !tagSubs.length) {
      const coldRecs = await this._coldStartRecommendations(accountId);
      await this._persistExplanations(accountId, coldRecs);
      return coldRecs;
    }

    // ── Scored path ───────────────────────────────────────────────────────────
    const topicTags = new Set(
      tagSubs.filter((t) => t.tag_type === 'topic').map((t) => t.tag.toLowerCase()),
    );

    const scoreMap = new Map();

    const getOrCreate = (entityType, stableId) => {
      const key = `${entityType}:${stableId}`;
      if (!scoreMap.has(key)) {
        scoreMap.set(key, { entityType, stableId, score: 0, reasons: [] });
      }
      return scoreMap.get(key);
    };

    for (const v of views) {
      const count = Number(v.view_count);
      const item = getOrCreate(v.entity_type, v.stable_id);
      item.score += count;
      item.reasons.push({ type: 'frequently_viewed', viewCount: count });
    }

    for (const b of bookmarks) {
      const item = getOrCreate(b.entity_type, b.stable_id);
      item.score += 3;
      item.reasons.push({ type: 'bookmarked' });
    }

    // Users with only tag subscriptions and no view/bookmark history produce an empty
    // scoreMap at this point. Seed it with popular entities from subscribed types so
    // the subscription boost below has something to apply to.
    if (subscribedEntityTypes.size > 0 && !scoreMap.size) {
      const seedItems = await this._coldStartRecommendations(accountId);
      for (const item of seedItems) {
        getOrCreate(item.entityType, item.stableId);
      }
    }

    // Apply tag-subscription boost to all already-scored items of matching entity type
    for (const item of scoreMap.values()) {
      if (subscribedEntityTypes.has(item.entityType)) {
        item.score += 2;
        item.reasons.push({ type: 'tag_subscription', entityType: item.entityType });
      }
    }

    // Apply tag similarity scoring (Jaccard on topic tags vs. entity name tokens)
    if (topicTags.size > 0) {
      await this._applyTagSimilarity(scoreMap, topicTags);
    }

    const recommendations = [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    await this._persistExplanations(accountId, recommendations);
    return recommendations;
  },

  /**
   * Compute Jaccard similarity between user's topic tag subscriptions and entity name/tag tokens.
   * Applies an additive score boost (max +5) to each matching entity.
   *
   * @param {Map} scoreMap  The live score map keyed by "entityType:stableId"
   * @param {Set<string>} topicTags  Lowercase topic tags from the user's subscriptions
   */
  async _applyTagSimilarity(scoreMap, topicTags) {
    const ENTITY_TABLES = {
      university:             { table: 'university_versions',             idCol: 'university_id' },
      school:                 { table: 'school_versions',                 idCol: 'school_id' },
      major:                  { table: 'major_versions',                  idCol: 'major_id' },
      research_track:         { table: 'research_track_versions',         idCol: 'research_track_id' },
      enrollment_plan:        { table: 'enrollment_plan_versions',        idCol: 'enrollment_plan_id' },
      transfer_quota:         { table: 'transfer_quota_versions',         idCol: 'transfer_quota_id' },
      application_requirement: { table: 'application_requirement_versions', idCol: 'application_requirement_id' },
      retest_rule:            { table: 'retest_rule_versions',            idCol: 'retest_rule_id' },
    };

    // Group items by entity type for batched DB fetches
    const byType = new Map();
    for (const [key, item] of scoreMap) {
      if (!byType.has(item.entityType)) byType.set(item.entityType, []);
      byType.get(item.entityType).push({ key, stableId: item.stableId });
    }

    for (const [entityType, items] of byType) {
      const cfg = ENTITY_TABLES[entityType];
      if (!cfg) continue;
      const stableIds = items.map((i) => i.stableId);
      const rows = await knex(cfg.table)
        .whereIn(cfg.idCol, stableIds)
        .where('lifecycle_status', 'active')
        .select(
          knex.raw(`${cfg.idCol} AS stable_id`),
          knex.raw(`payload_json->>'name' AS name`),
          knex.raw(`payload_json->>'tags' AS tags`),
        );

      const entityData = new Map(rows.map((r) => [r.stable_id, r]));
      for (const { key, stableId } of items) {
        const data = entityData.get(stableId);
        if (!data) continue;

        // Entity token set = name words + explicit tag array from payload
        const nameTokens = (data.name || '').toLowerCase().split(/\s+/).filter(Boolean);
        let payloadTags = [];
        try { payloadTags = data.tags ? JSON.parse(data.tags) : []; } catch { /* ignore */ }
        const entitySet = new Set([...nameTokens, ...payloadTags.map((t) => String(t).toLowerCase())]);

        // Jaccard(topicTags, entitySet)
        const intersection = [...topicTags].filter((t) => entitySet.has(t)).length;
        const union = new Set([...topicTags, ...entitySet]).size;
        const similarity = union > 0 ? intersection / union : 0;

        if (similarity > 0) {
          const item = scoreMap.get(key);
          const boost = Math.round(similarity * 5); // max +5 for perfect overlap
          item.score += boost;
          item.reasons.push({ type: 'tag_similarity', similarity: Math.round(similarity * 100) / 100 });
        }
      }
    }
  },

  /**
   * Persist recommendation explanations for auditability.
   * Fire-and-forget (non-blocking) — never surfaces errors to the caller.
   */
  async _persistExplanations(accountId, recommendations) {
    if (!recommendations.length) return;
    const now = new Date().toISOString();
    const rows = recommendations.map((r) => ({
      account_id: accountId,
      entity_type: r.entityType,
      stable_id: r.stableId,
      score: r.score,
      reasons: JSON.stringify(r.reasons),
      generated_at: now,
    }));
    knex('recommendation_explanations').insert(rows).catch(() => {});
  },

  /**
   * Cold-start fallback: return up to 10 recommended active entities.
   *
   * Signal priority:
   *   1. Declared interests — entity_type tag subscriptions narrow the candidate pool.
   *   2. Popularity         — global view count in the last 30 days ranks candidates.
   *   3. Recency            — tie-breaks by published_at DESC.
   *
   * Used when a user has no view history, bookmarks, or tag subscriptions of their own.
   */
  async _coldStartRecommendations(accountId) {
    const ENTITY_VERSION_TABLES = [
      { table: 'university_versions',            entityType: 'university',            idCol: 'university_id' },
      { table: 'school_versions',                entityType: 'school',                idCol: 'school_id' },
      { table: 'major_versions',                 entityType: 'major',                 idCol: 'major_id' },
      { table: 'research_track_versions',        entityType: 'research_track',        idCol: 'research_track_id' },
      { table: 'enrollment_plan_versions',       entityType: 'enrollment_plan',       idCol: 'enrollment_plan_id' },
      { table: 'transfer_quota_versions',        entityType: 'transfer_quota',        idCol: 'transfer_quota_id' },
      { table: 'application_requirement_versions', entityType: 'application_requirement', idCol: 'application_requirement_id' },
      { table: 'retest_rule_versions',           entityType: 'retest_rule',           idCol: 'retest_rule_id' },
    ];

    // Check declared-interest entity_type tag subscriptions
    const subscribedTypes = await knex('tag_subscriptions')
      .where({ account_id: accountId, tag_type: 'entity_type' })
      .pluck('tag');

    const targetTables = subscribedTypes.length > 0
      ? ENTITY_VERSION_TABLES.filter((e) => subscribedTypes.includes(e.entityType))
      : ENTITY_VERSION_TABLES;

    const since = new Date();
    since.setDate(since.getDate() - 30);

    // Global popularity: total view count per entity in the last 30 days
    const popularity = await knex('entity_view_history')
      .select('entity_type', 'stable_id')
      .count('id as view_count')
      .where('viewed_at', '>=', since.toISOString())
      .groupBy('entity_type', 'stable_id');

    const popularityMap = new Map(
      popularity.map((r) => [`${r.entity_type}:${r.stable_id}`, Number(r.view_count)]),
    );

    const parts = await Promise.all(
      targetTables.map(({ table, entityType, idCol }) =>
        knex(table)
          .where('lifecycle_status', 'active')
          .orderBy('published_at', 'desc')
          .limit(20)
          .select(knex.raw(`'${entityType}' AS entity_type`), `${idCol} AS stable_id`, 'published_at'),
      ),
    );

    const basis = subscribedTypes.length > 0 ? 'declared_interest' : 'recently_popular';

    return parts
      .flat()
      .map((r) => ({
        entityType: r.entity_type,
        stableId: r.stable_id,
        publishedAt: r.published_at,
        popularity: popularityMap.get(`${r.entity_type}:${r.stable_id}`) || 0,
      }))
      .sort((a, b) => b.popularity - a.popularity || new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 10)
      .map((r) => ({
        entityType: r.entityType,
        stableId: r.stableId,
        score: 0,
        reasons: [{ type: 'cold_start', basis }],
      }));
  },
};
