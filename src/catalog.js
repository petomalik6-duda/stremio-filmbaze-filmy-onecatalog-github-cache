import { scrapeFilmovenovinky, itemKey } from './scrape.js';
import { fetchCsfdMeta, searchCsfd } from './csfd.js';
import { tmdbByImdb, tmdbSearch } from './tmdb.js';
import { readStore, writeStore, storePath } from './store.js';

const MAX_ITEMS = Number(process.env.MAX_ITEMS || 1000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_HOURS || 24) * 60 * 60 * 1000;
const REFRESH_NEW_ONLY = String(process.env.REFRESH_NEW_ONLY || 'true').toLowerCase() !== 'false';
const CSFD_SEARCH_FALLBACK = String(process.env.CSFD_SEARCH_FALLBACK || 'false').toLowerCase() === 'true';
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || 0);
const REFRESH_LOCK_TIMEOUT_MS = Number(process.env.REFRESH_LOCK_TIMEOUT_MS || 180000);
const HIDE_UNMATCHED_ITEMS = String(process.env.HIDE_UNMATCHED_ITEMS || 'false').toLowerCase() === 'true';
const STRICT_MOVIE_FILTER = String(process.env.STRICT_MOVIE_FILTER || 'true').toLowerCase() !== 'false';

let cache = { at: 0, metas: [], byId: new Map(), items: [], sourceHash: '', lastError: null };
let running = null;
let runningStartedAt = 0;
let stage = 'idle';

function setStage(value) {
  stage = value;
  console.log('[refresh-stage]', value);
}

function buildIndex(metas) { return new Map((metas || []).map(m => [m.id, m])); }
function imdbIdFromUrl(url) {
  const m = String(url || '').match(/title\/(tt\d+)/i);
  return m ? m[1] : null;
}
function stremioId(item, csfd, tmdb) {
  return tmdb?.imdbId || csfd?.imdbId || imdbIdFromUrl(item.imdbUrl) || `filmbaze:${Buffer.from(`${item.type}-${item.name}-${item.year}-${item.lang}`).toString('base64url')}`;
}
function score(meta) { const n = Number(meta.imdbRating || 0); return Number.isFinite(n) ? n : 0; }
function tmdbUrl(type, id) { return `https://www.themoviedb.org/${type === 'series' ? 'tv' : 'movie'}/${id}`; }
function placeholderPoster(name) { return `https://placehold.co/500x750?text=${encodeURIComponent(String(name || 'CZ/SK').slice(0, 35))}`; }

function localMeta(item) {
  return toMeta(item, {}, null);
}

function toMeta(item, csfd = {}, tmdb = null) {
  const type = item.type === 'series' ? 'series' : 'movie';
  const id = stremioId(item, csfd, tmdb);
  const imdbId = tmdb?.imdbId || csfd?.imdbId || imdbIdFromUrl(item.imdbUrl) || null;
  const displayName = item.name || tmdb?.name || 'Bez názvu';
  const links = [
    item.csfdUrl ? { name: 'ČSFD', category: 'Info', url: item.csfdUrl } : null,
    imdbId ? { name: 'IMDb', category: 'Info', url: `https://www.imdb.com/title/${imdbId}/` } : null,
    tmdb?.tmdbId ? { name: 'TMDB', category: 'Info', url: tmdbUrl(type, tmdb.tmdbId) } : null,
    item.detailUrl ? { name: 'FilmovéNovinky', category: 'Info', url: item.detailUrl } : null,
    item.sourceUrl ? { name: 'Zdroj', category: 'Info', url: item.sourceUrl } : null
  ].filter(Boolean);

  const descriptionParts = [
    tmdb?.description || csfd.description || '',
    item.originalName ? `Originálny názov: ${item.originalName}` : null,
    `Dabing: ${item.lang || 'CZ/SK'}`,
    item.dateAdded ? `Pridané: ${item.dateAdded}` : null,
    item.csfdUrl ? `ČSFD: ${item.csfdUrl}` : null,
    item.imdbUrl ? `IMDb URL: ${item.imdbUrl}` : null,
    imdbId ? `IMDb: ${imdbId}` : null,
    tmdb?.tmdbId ? `TMDB: ${tmdb.tmdbId}` : null
  ].filter(Boolean);

  return {
    id,
    type,
    name: displayName,
    poster: tmdb?.poster || csfd.poster || placeholderPoster(displayName),
    background: tmdb?.background || tmdb?.poster || csfd.poster || placeholderPoster(displayName),
    description: descriptionParts.join('\n\n'),
    releaseInfo: tmdb?.releaseInfo || item.year || undefined,
    year: Number(tmdb?.releaseInfo || item.year) || undefined,
    runtime: tmdb?.runtime,
    genres: [...new Set([...(tmdb?.genres || []), ...(csfd.genres || []), item.lang].filter(Boolean))],
    imdbRating: tmdb?.imdbRating,
    director: tmdb?.director,
    cast: tmdb?.cast,
    links,
    behaviorHints: { defaultVideoId: id },
    videos: tmdb?.trailer ? [{ id: `yt:${tmdb.trailer}`, title: 'Trailer', released: item.dateAdded }] : undefined,
    _addon: { key: item.key || itemKey(item), dateAdded: item.dateAdded, lang: item.lang, csfdUrl: item.csfdUrl || null, imdbUrl: item.imdbUrl || null, imdbId, tmdbId: tmdb?.tmdbId || null, sourceType: type, titleRaw: item.titleRaw }
  };
}

async function enrichItem(item) {
  let csfdUrl = item.csfdUrl;

  if (item.type !== 'series' && !csfdUrl && CSFD_SEARCH_FALLBACK) {
    csfdUrl = await searchCsfd(item.originalName || item.name, item.year) || await searchCsfd(item.name, item.year);
  }

  const normalizedItem = { ...item, csfdUrl };
  const csfd = item.type === 'series' ? {} : await fetchCsfdMeta(csfdUrl);

  let tmdb = await tmdbByImdb(csfd.imdbId, item.type);
  if (!tmdb) tmdb = await tmdbSearch(item.originalName || item.name, item.year, item.type);
  if (!tmdb && item.originalName) tmdb = await tmdbSearch(item.name, item.year, item.type);

  return toMeta(normalizedItem, csfd, tmdb);
}

async function loadFromDisk() {
  const store = await readStore();
  cache = { ...store, byId: buildIndex(store.metas), lastError: cache.lastError || store.lastError || null };
  return cache;
}

function isStale() {
  return !cache.at || Date.now() - cache.at > CACHE_TTL_MS;
}

function runningExpired() {
  return running && runningStartedAt && Date.now() - runningStartedAt > REFRESH_LOCK_TIMEOUT_MS;
}

export function isRefreshRunning() {
  if (runningExpired()) {
    cache.lastError = `Refresh lock expired after ${REFRESH_LOCK_TIMEOUT_MS}ms at stage: ${stage}`;
    running = null;
    runningStartedAt = 0;
    setStage('expired');
    return false;
  }
  return Boolean(running);
}

export function refreshCacheBackground(options = {}) {
  if (isRefreshRunning()) return running;
  return refreshCache(options).catch(e => {
    cache.lastError = e.message;
    setStage('failed');
    console.error('Background refresh failed:', e);
    return cache.metas || [];
  });
}

export async function refreshCache({ forceFull = false } = {}) {
  if (isRefreshRunning()) return running;

  runningStartedAt = Date.now();

  running = (async () => {
    try {
      setStage('load-disk-cache');
      const current = cache.at ? cache : await loadFromDisk();

      setStage('scrape-filmovenovinky');
      const scraped = await scrapeFilmovenovinky(MAX_ITEMS);

      setStage(`scraped-${scraped.items.length}-items`);

      if (!scraped.items.length) {
        cache.lastError = 'Scraper returned 0 items. Check MOVIES_SOURCE_URL or website HTML.';
        await writeStore({ at: current.at || 0, sourceHash: current.sourceHash || '', items: current.items || [], metas: current.metas || [], lastError: cache.lastError });
        return current.metas || [];
      }

      if (!forceFull && current.sourceHash === scraped.sourceHash && current.metas.length) {
        setStage('source-unchanged');
        cache = { ...current, at: Date.now(), byId: buildIndex(current.metas), lastError: null };
        await writeStore({ at: cache.at, sourceHash: cache.sourceHash, items: cache.items, metas: cache.metas, lastError: null });
        return cache.metas;
      }

      setStage('build-metadata');
      const oldByKey = new Map((current.metas || []).map(m => [m._addon?.key, m]).filter(([k]) => k));
      const metas = [];
      let enriched = 0;

      for (const item of scraped.items) {
        const key = item.key || itemKey(item);
        const reusable = !forceFull && REFRESH_NEW_ONLY && oldByKey.get(key);

        if (reusable) {
          metas.push(reusable);
          continue;
        }

        // ENRICH_LIMIT=0 znamená: žiadne CSFD/TMDB HTTP volania, iba rýchle lokálne metadata.
        if (ENRICH_LIMIT <= 0 || (!forceFull && enriched >= ENRICH_LIMIT)) {
          metas.push(localMeta(item));
          continue;
        }

        try {
          metas.push(await enrichItem(item));
          enriched += 1;
        } catch (e) {
          console.error('Enrich failed:', item.name, e.message);
          metas.push(localMeta(item));
        }
      }

      setStage('write-cache');
      cache = { at: Date.now(), sourceHash: scraped.sourceHash, items: scraped.items, metas, byId: buildIndex(metas), lastError: null };
      await writeStore({ at: cache.at, sourceHash: cache.sourceHash, items: cache.items, metas: cache.metas, lastError: null });

      setStage('done');
      return metas;
    } catch (e) {
      cache.lastError = e.message;
      setStage('failed');
      await writeStore({ at: cache.at || 0, sourceHash: cache.sourceHash || '', items: cache.items || [], metas: cache.metas || [], lastError: e.message }).catch(() => {});
      throw e;
    }
  })();

  try {
    return await running;
  } finally {
    running = null;
    runningStartedAt = 0;
  }
}

export async function getCatalog() {
  if (!cache.at) await loadFromDisk();

  if (isStale() && !isRefreshRunning()) {
    refreshCacheBackground().catch(() => {});
  }

  return cache.metas || [];
}

export async function getMetaById(id) {
  if (!cache.at) await loadFromDisk();
  return cache.byId.get(id) || null;
}

export async function getCatalogStats() {
  if (!cache.at) await loadFromDisk();
  const metas = cache.metas || [];

  return {
    at: cache.at,
    generatedAt: cache.at ? new Date(cache.at).toISOString() : null,
    stale: isStale(),
    refreshRunning: isRefreshRunning(),
    refreshStartedAt: runningStartedAt ? new Date(runningStartedAt).toISOString() : null,
    refreshAgeSeconds: runningStartedAt ? Math.round((Date.now() - runningStartedAt) / 1000) : 0,
    stage,
    lastError: cache.lastError,
    items: metas.length,
    visibleItems: HIDE_UNMATCHED_ITEMS
      ? metas.filter(m => Boolean(m._addon?.tmdbId) || Boolean(m._addon?.imdbId) || Boolean(m._addon?.csfdUrl) || (typeof m.id === 'string' && m.id.startsWith('tt'))).length
      : metas.length,
    hideUnmatchedItems: HIDE_UNMATCHED_ITEMS,
    cacheFile: storePath(),
    movies: metas.filter(m => m.type === 'movie').length,
    series: metas.filter(m => m.type === 'series').length,
    cz: metas.filter(m => m._addon?.lang === 'CZ').length,
    sk: metas.filter(m => m._addon?.lang === 'SK').length,
    czsk: metas.filter(m => m._addon?.lang === 'CZ/SK').length,
    withCsfd: metas.filter(m => m._addon?.csfdUrl).length,
    withImdb: metas.filter(m => m._addon?.imdbId).length,
    withTmdb: metas.filter(m => m._addon?.tmdbId).length
  };
}

export function searchCatalog(metas, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return metas;
  return metas.filter(m => `${m.name} ${m.description || ''} ${(m.genres || []).join(' ')} ${m._addon?.titleRaw || ''}`.toLowerCase().includes(q));
}


function looksLikeRealMovieMeta(meta) {
  if (!STRICT_MOVIE_FILTER) return true;

  const name = String(meta.name || '').trim();
  if (!name || name.length < 2 || name.length > 120) return false;

  const raw = String(meta._addon?.titleRaw || meta.description || name);
  const hasYear = Boolean(meta.year || meta.releaseInfo || /\b(19\d{2}|20\d{2})\b/.test(raw));
  const hasExternal = Boolean(meta._addon?.tmdbId || meta._addon?.imdbId || meta._addon?.csfdUrl || (typeof meta.id === 'string' && meta.id.startsWith('tt')));

  const bad = /cookie|reklama|menu|kontakt|newsletter|facebook|instagram|youtube|filmovenovinky\.sk|nové filmy s dabingom|tipy na dobrý film|seriály|streamovacie služby/i;
  if (bad.test(name) || bad.test(raw)) return false;

  // Ak nemá externé ID, musí mať aspoň rok. Tým sa odstránia textové položky zo stránky.
  if (!hasExternal && !hasYear) return false;

  return true;
}

export function filterCatalog(metas, id, type) {
  let arr = [...metas].filter(m => m.type === 'movie').filter(looksLikeRealMovieMeta);

  if (id !== 'filmbaze-filmy') return [];

  if (HIDE_UNMATCHED_ITEMS) {
    arr = arr.filter(m =>
      Boolean(m._addon?.tmdbId) ||
      Boolean(m._addon?.imdbId) ||
      Boolean(m._addon?.csfdUrl) ||
      (typeof m.id === 'string' && m.id.startsWith('tt'))
    );
  }

  return arr.sort((a, b) => String(b._addon?.dateAdded || '').localeCompare(String(a._addon?.dateAdded || '')));
}
