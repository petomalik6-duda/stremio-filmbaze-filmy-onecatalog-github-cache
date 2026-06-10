'use strict';

/**
 * ADAPTER FILE - uprav iba túto časť podľa názvov v tvojom addone.
 *
 * Cieľ: po refresh-cache načítať cache, opraviť položky bez streamu
 * a uložiť cache späť do data/cache súboru.
 */

const fs = require('fs');
const path = require('path');
const { repairFilmbazeStreams } = require('./filmbaze-stream-repair');

// 1) Ak máš cache inde, uprav cestu tu.
const CACHE_CANDIDATES = [
  path.join(__dirname, '..', 'data', 'cache.json'),
  path.join(__dirname, '..', 'data', 'filmbaze-cache.json'),
  path.join(__dirname, '..', 'cache.json')
];

function findCacheFile() {
  const found = CACHE_CANDIDATES.find(p => fs.existsSync(p));
  if (!found) {
    throw new Error('Nenašiel som cache súbor. Uprav CACHE_CANDIDATES v scripts/repair-filmbaze-after-refresh.js');
  }
  return found;
}

function loadCache() {
  const file = findCacheFile();
  const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, cache };
}

function getItems(cache) {
  if (Array.isArray(cache.items)) return cache.items;
  if (Array.isArray(cache.metas)) return cache.metas;
  if (cache.data && Array.isArray(cache.data.items)) return cache.data.items;
  throw new Error('V cache nevidím pole items/metas. Uprav getItems() v repair-filmbaze-after-refresh.js');
}

function saveCache(file, cache) {
  fs.writeFileSync(file, JSON.stringify(cache, null, 2));
}

// 2) Táto funkcia sa pokúsi použiť existujúci scraper z tvojho projektu.
// Ak sa tvoje funkcie volajú inak, uprav require a názvy funkcií nižšie.
async function findFreshFilmbazeItems() {
  const candidates = [
    './filmbaze',
    './scrape-filmbaze',
    './scraper-filmbaze',
    './refresh-cache'
  ];

  for (const rel of candidates) {
    try {
      const mod = require(rel);
      if (typeof mod.scrapeFilmbazeMovies === 'function') {
        return await mod.scrapeFilmbazeMovies({ pages: Number(process.env.REPAIR_PAGES || 3), withDetail: true });
      }
      if (typeof mod.scrapeMovies === 'function') {
        return await mod.scrapeMovies({ pages: Number(process.env.REPAIR_PAGES || 3), withDetail: true });
      }
      if (typeof mod.getLatestMovies === 'function') {
        return await mod.getLatestMovies({ pages: Number(process.env.REPAIR_PAGES || 3), withDetail: true });
      }
    } catch (_) {}
  }

  throw new Error('Neviem nájsť scraper Filmbáze. V repair-filmbaze-after-refresh.js napoj findFreshFilmbazeItems() na tvoju existujúcu funkciu.');
}

async function getFilmbazeDetail(detailUrl) {
  const candidates = ['./filmbaze', './scrape-filmbaze', './scraper-filmbaze', './refresh-cache'];
  for (const rel of candidates) {
    try {
      const mod = require(rel);
      if (typeof mod.parseFilmbazeDetail === 'function') return await mod.parseFilmbazeDetail(detailUrl);
      if (typeof mod.getFilmbazeDetail === 'function') return await mod.getFilmbazeDetail(detailUrl);
      if (typeof mod.parseDetail === 'function') return await mod.parseDetail(detailUrl);
    } catch (_) {}
  }
  return null;
}

async function enrichImdbFromTmdb(tmdbId) {
  const candidates = ['./tmdb', './tmdb-repair', './refresh-cache'];
  for (const rel of candidates) {
    try {
      const mod = require(rel);
      if (typeof mod.getImdbIdFromTmdb === 'function') return await mod.getImdbIdFromTmdb(tmdbId);
      if (typeof mod.tmdbExternalIds === 'function') {
        const ids = await mod.tmdbExternalIds(tmdbId, 'movie');
        return ids?.imdb_id || ids?.imdbId || null;
      }
    } catch (_) {}
  }
  return null;
}

async function repairAfterRefresh({ limit = 300 } = {}) {
  const { file, cache } = loadCache();
  const items = getItems(cache);

  const result = await repairFilmbazeStreams({
    items,
    limit,
    save: async () => saveCache(file, cache),
    findFreshFilmbazeItems,
    getFilmbazeDetail,
    enrichImdbFromTmdb
  });

  saveCache(file, cache);
  return { ...result, cacheFile: file };
}

module.exports = { repairAfterRefresh };
