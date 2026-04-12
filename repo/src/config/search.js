import config from './env.js';

/**
 * Search configuration.
 * Uses PostgreSQL full-text search with a custom grad_search text search
 * configuration that includes thesaurus synonym expansion.
 */
export const searchConfig = Object.freeze({
  // PostgreSQL text search configuration name (defined in baseline migration)
  tsConfig: 'grad_search',
  defaultLanguage: config.search.defaultLanguage,
  // ts_headline options
  headline: {
    startSel: '<mark>',
    stopSel: '</mark>',
    maxWords: 35,
    minWords: 15,
    shortWord: 3,
  },
  // Active version ranking boost multiplier
  activeVersionBoost: 1.5,
  defaultPageSize: 20,
  maxPageSize: 100,
});
