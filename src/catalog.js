import { fetchFilmbazeItems } from './filmbaze.js';
import { tmdbResolve } from './tmdb.js';
import { readStore, writeStore, storePath } from './store.js';
import crypto from 'crypto';

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_HOURS || 24) * 60 * 60 * 1000;
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || 0);
const ENRICH_MOVIE_LIMIT = Number(process.env.ENRICH_MOVIE_LIMIT || ENRICH_LIMIT || 0);
const ENRICH_SERIES_LIMIT = Number(process.env.ENRICH_SERIES_LIMIT || ENRICH_LIMIT || 0);
const REPAIR_RETRY_HOURS = Number(process.env.REPAIR_RETRY_HOURS || 72);
const EPISODE_REPAIR_RETRY_HOURS = Number(process.env.EPISODE_REPAIR_RETRY_HOURS || 0);
const MIN_DESCRIPTION_LENGTH = Number(process.env.MIN_DESCRIPTION_LENGTH || 20);

let cache = {
  at: 0,
  metas: [],
  items: [],
  byId: new Map(),
  sourceHash: '',
  lastError: null,
  refreshStats: null
};
let running = null;
let runningStartedAt = 0;
let stage = 'idle';

function setStage(value) {
  stage = value;
  console.log('[stage]', value);
}

function buildIndex(metas) {
  return new Map((metas || []).map(meta => [meta.id, meta]));
}

async function loadFromDisk() {
  const store = await readStore();
  cache = {
    ...store,
    byId: buildIndex(store.metas),
    lastError: cache.lastError || store.lastError || null
  };
  return cache;
}

function isStale() {
  return !cache.at || Date.now() - cache.at > CACHE_TTL_MS;
}

function localId(item) {
  return `filmbaze:${item.type}:${item.id}`;
}

function validImdb(value) {
  return typeof value === 'string' && /^tt\d{5,}$/.test(value);
}

function cleanDescription(value) {
  return String(value || '')
    .split(/\n\n+/)
    .filter(part => !/^Zdroj:\s*Filmbáze$/i.test(part.trim()))
    .filter(part => !/^Filmbáze ID:/i.test(part.trim()))
    .join('\n\n')
    .trim();
}

function normalizeStremioSeriesVideos(videos, seriesId) {
  if (!Array.isArray(videos)) return [];

  const seen = new Set();
  return videos
    .filter(video => Number(video.season) > 0 && Number(video.episode) > 0)
    .map(video => {
      const season = Number(video.season);
      const episode = Number(video.episode);
      return {
        ...video,
        id: `${seriesId}:${season}:${episode}`,
        season,
        episode
      };
    })
    .filter(video => {
      const key = `${video.season}:${video.episode}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
}

function tmdbFromFilmbazeItem(item) {
  if (!item?.tmdbId && !item?.imdbId && !item?.originalName && !item?.poster) return null;

  return {
    tmdbId: item.tmdbId || null,
    imdbId: item.imdbId || null,
    type: item.type,
    name: item.name,
    originalName: item.originalName || '',
    year: item.year,
    releaseDate: item.releaseDate || '',
    poster: item.poster,
    background: item.background,
    description: item.description,
    rating: item.rating,
    runtime: item.runtime,
    genres: ['CZ/SK'],
    cast: [],
    director: [],
    videos: Array.isArray(item.videos) ? item.videos : []
  };
}

function repairReasons(meta, item) {
  if (!meta) return ['new-item'];

  const reasons = [];
  const tmdbId = meta.tmdbId || meta._addon?.tmdbId || item?.tmdbId;
  const imdbId = meta.imdbId || meta._addon?.imdbId || item?.imdbId;
  const description = cleanDescription(meta.description || item?.description);

  if (meta.type !== item.type) reasons.push('wrong-type');
  if (!tmdbId) reasons.push('missing-tmdb');
  if (!validImdb(imdbId)) reasons.push('missing-imdb');
  if (!meta.poster && !item?.poster) reasons.push('missing-poster');
  if (description.length < MIN_DESCRIPTION_LENGTH) reasons.push('missing-description');
  if (item.type === 'series' && (!Array.isArray(meta.videos) || meta.videos.length === 0)) {
    reasons.push('missing-episodes');
  }

  return reasons;
}

function repairAllowed(meta, reasons = []) {
  if (!meta?._addon?.lastRepairAt) return true;
  const last = Date.parse(meta._addon.lastRepairAt);
  if (!Number.isFinite(last)) return true;

  // Missing series episodes are retried independently from generic metadata repairs.
  // New shows are often added to TMDB before their season/episode data is complete.
  const retryHours = reasons.includes('missing-episodes')
    ? EPISODE_REPAIR_RETRY_HOURS
    : REPAIR_RETRY_HOURS;

  return Date.now() - last >= retryHours * 60 * 60 * 1000;
}

function toMeta(item, resolved = null, previous = null, repair = {}) {
  const direct = tmdbFromFilmbazeItem(item);
  const tmdb = resolved || direct;

  const imdbId = tmdb?.imdbId || item.imdbId || previous?.imdbId || previous?._addon?.imdbId || null;
  const tmdbId = tmdb?.tmdbId || item.tmdbId || previous?.tmdbId || previous?._addon?.tmdbId || null;
  const previousId = previous?.id;
  const id = validImdb(imdbId)
    ? imdbId
    : (previousId && !validImdb(previousId) ? previousId : localId(item));

  const previousVideos = Array.isArray(previous?.videos) ? previous.videos : [];
  const resolvedVideos = Array.isArray(tmdb?.videos) && tmdb.videos.length ? tmdb.videos : previousVideos;
  const seriesVideos = item.type === 'series' ? normalizeStremioSeriesVideos(resolvedVideos, id) : [];

  const year = tmdb?.year || item.year || previous?.year;
  const poster = tmdb?.poster || item.poster || previous?.poster;
  const background = tmdb?.background || item.background || previous?.background || poster;
  const descriptionText = tmdb?.description || item.description || cleanDescription(previous?.description) || '';
  const runtime = tmdb?.runtime || item.runtime || String(previous?.runtime || '').replace(/\s*min$/i, '') || undefined;

  const previousAttempts = Number(previous?._addon?.repairAttempts || 0);
  const attempted = Boolean(repair.attempted);
  const repairAttempts = attempted ? previousAttempts + 1 : previousAttempts;
  const lastRepairAt = attempted ? new Date().toISOString() : previous?._addon?.lastRepairAt || null;

  const meta = {
    id,
    type: item.type,
    name: tmdb?.name || previous?.name || item.name,
    poster,
    background,
    description: [
      descriptionText,
      'Zdroj: Filmbáze',
      item.id ? `Filmbáze ID: ${item.id}` : null
    ].filter(Boolean).join('\n\n'),
    releaseInfo: year ? String(year) : undefined,
    year,
    imdbId: validImdb(imdbId) ? imdbId : undefined,
    tmdbId: tmdbId || undefined,
    runtime: runtime ? `${runtime} min` : undefined,
    genres: Array.isArray(tmdb?.genres) && tmdb.genres.length
      ? tmdb.genres
      : Array.isArray(previous?.genres) && previous.genres.length
        ? previous.genres
        : ['CZ/SK'],
    imdbRating: tmdb?.rating || previous?.imdbRating || (item.rating ? String(item.rating) : undefined),
    cast: Array.isArray(tmdb?.cast) && tmdb.cast.length ? tmdb.cast : (previous?.cast || []),
    director: Array.isArray(tmdb?.director) && tmdb.director.length ? tmdb.director : (previous?.director || []),
    behaviorHints: item.type === 'series'
      ? { defaultVideoId: seriesVideos[0]?.id || `${id}:1:1` }
      : { defaultVideoId: id },
    videos: item.type === 'series' ? seriesVideos : undefined,
    seriesInfo: item.type === 'series' ? { episodeCount: seriesVideos.length } : undefined,
    links: [
      item.id ? { name: 'Filmbáze', category: 'Info', url: `https://filmbaze.cz/title/${item.id}` } : null,
      tmdbId ? {
        name: 'TMDB',
        category: 'Info',
        url: item.type === 'series'
          ? `https://www.themoviedb.org/tv/${tmdbId}`
          : `https://www.themoviedb.org/movie/${tmdbId}`
      } : null,
      validImdb(imdbId) ? { name: 'IMDb', category: 'Info', url: `https://www.imdb.com/title/${imdbId}/` } : null
    ].filter(Boolean),
    _addon: {
      ...(previous?._addon || {}),
      key: String(item.id),
      filmbazeId: item.id,
      tmdbId: tmdbId || null,
      imdbId: validImdb(imdbId) ? imdbId : null,
      dateAdded: item.dateAdded,
      channelOrder: Number.isFinite(item.channelOrder) ? item.channelOrder : 999999,
      page: item.page || null,
      episodeCount: item.type === 'series' ? seriesVideos.length : 0,
      originalName: item.originalName || tmdb?.originalName || previous?._addon?.originalName || null,
      detailChecked: Boolean(item.detailChecked),
      sourceTitle: item.name,
      repairAttempts,
      lastRepairAt,
      repairStatus: attempted ? (repair.resolved ? 'resolved' : 'not-found') : (previous?._addon?.repairStatus || null),
      lastRepairReasons: attempted ? (repair.reasons || []) : (previous?._addon?.lastRepairReasons || [])
    }
  };

  meta._addon.remainingIssues = repairReasons(meta, item);
  return meta;
}

function mergeSourceIntoExisting(existing, item) {
  return toMeta(item, null, existing, { attempted: false });
}

async function enrichItem(item, previous, reasons) {
  try {
    const resolved = await tmdbResolve(item);
    return toMeta(item, resolved, previous, {
      attempted: true,
      resolved: Boolean(resolved),
      reasons
    });
  } catch (error) {
    console.error('[tmdb] enrich failed:', item.name, error.message);
    return toMeta(item, null, previous, {
      attempted: true,
      resolved: false,
      reasons
    });
  }
}

function sourceItemKey(item) {
  return `${item?.type || ''}:${item?.id || ''}`;
}

function normalizeSourceTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceTitleYearKey(item) {
  const title = normalizeSourceTitle(item?.name || item?.title || item?.originalName || '');
  const year = Number(item?.year || String(item?.releaseDate || '').match(/\b(19\d{2}|20\d{2})\b/)?.[1] || 0);
  return title ? `${item?.type || ''}:${title}:${year || ''}` : '';
}

function reconcileReaderItemsWithPrevious(newItems, oldItems) {
  const previousByTitleYear = new Map();
  for (const oldItem of oldItems || []) {
    const key = sourceTitleYearKey(oldItem);
    if (key && !previousByTitleYear.has(key)) previousByTitleYear.set(key, oldItem);
  }

  return (newItems || []).map(item => {
    if (!item?.readerFallback) return item;
    const previous = previousByTitleYear.get(sourceTitleYearKey(item));
    if (!previous) return item;

    // Keep the real Filmbáze id and source fields from the previous cache, while
    // using the reader order to move currently listed titles to the front.
    return {
      ...previous,
      ...item,
      id: previous.id,
      poster: previous.poster || item.poster || null,
      background: previous.background || item.background || null,
      description: previous.description || item.description || '',
      releaseDate: previous.releaseDate || item.releaseDate || null,
      dateAdded: previous.dateAdded || item.dateAdded || '',
      imdbId: previous.imdbId || item.imdbId || null,
      tmdbId: previous.tmdbId || item.tmdbId || null,
      originalName: previous.originalName || item.originalName || null,
      readerFallback: true
    };
  });
}

function sourceHash(items) {
  return crypto.createHash('sha1')
    .update((items || []).map(x => `${x.type}|${x.id}|${x.name}|${x.releaseDate || ''}`).join('|'))
    .digest('hex');
}

function preservePreviousSourceOnPartialFetch(fetched, current) {
  const rawNewItems = Array.isArray(fetched?.items) ? fetched.items : [];
  const oldItems = Array.isArray(current?.items) ? current.items : [];
  const newItems = reconcileReaderItemsWithPrevious(rawNewItems, oldItems);
  fetched = { ...fetched, items: newItems };
  const forceFullSource = String(process.env.FORCE_FULL_SOURCE_REFRESH || 'false').toLowerCase() === 'true';
  if (forceFullSource || !oldItems.length) return fetched;

  // forceFull controls TMDB metadata enrichment only. It must not disable source
  // preservation when the daily source fetch intentionally reads just page 1.

  const minSafeItems = Number(process.env.MIN_SAFE_SOURCE_ITEMS || 500);
  const minSafeRatio = Number(process.env.MIN_SAFE_SOURCE_RATIO || 0.70);
  const ratio = oldItems.length ? newItems.length / oldItems.length : 1;
  const partial = newItems.length < minSafeItems || ratio < minSafeRatio;
  if (!partial) return fetched;

  console.warn(`[refresh] partial Filmbáze response detected: ${newItems.length}/${oldItems.length}; preserving previous source items and re-ranking fresh titles first`);

  const mergeType = type => {
    const fresh = newItems
      .filter(item => item?.type === type)
      .sort((a, b) => Number(a?.channelOrder ?? 999999) - Number(b?.channelOrder ?? 999999));
    const freshKeys = new Set(fresh.map(sourceItemKey));
    const preserved = oldItems
      .filter(item => item?.type === type && !freshKeys.has(sourceItemKey(item)))
      .sort((a, b) => {
        const order = Number(a?.channelOrder ?? 999999) - Number(b?.channelOrder ?? 999999);
        if (order) return order;
        return String(b?.dateAdded || '').localeCompare(String(a?.dateAdded || ''));
      });

    return [...fresh, ...preserved].map((item, index) => ({
      ...item,
      channelOrder: index,
      page: item?.page || Math.floor(index / 50) + 1
    }));
  };

  const known = [...mergeType('movie'), ...mergeType('series')];
  const knownKeys = new Set(known.map(sourceItemKey));
  const other = [...newItems, ...oldItems].filter(item => !knownKeys.has(sourceItemKey(item)));
  const items = [...known, ...other];

  return {
    ...fetched,
    items,
    sourceHash: sourceHash(items),
    partialFetch: true,
    rawFetchedItems: newItems.length
  };
}

function buildRefreshStats({ sourceChanged, fetchedItems }) {
  return {
    at: new Date().toISOString(),
    sourceChanged,
    fetchedItems,
    newItems: 0,
    reusedItems: 0,
    repairedItems: 0,
    repairFailed: 0,
    repairDeferred: 0,
    enrichedMovies: 0,
    enrichedSeries: 0
  };
}

function validateInMemory(items, metas) {
  if (!Array.isArray(items) || !items.length) throw new Error('Refresh produced no source items.');
  if (!Array.isArray(metas) || !metas.length) throw new Error('Refresh produced no metas.');
  if (metas.length < Math.floor(items.length * 0.8)) {
    throw new Error(`Meta count too low: ${metas.length}/${items.length}`);
  }

  const ids = new Set();
  for (const meta of metas) {
    if (!meta?.id || !meta?.name || !['movie', 'series'].includes(meta?.type)) {
      throw new Error('Refresh produced invalid meta item.');
    }
    if (ids.has(meta.id)) throw new Error(`Duplicate Stremio ID: ${meta.id}`);
    ids.add(meta.id);
  }
}

export function isRefreshRunning() {
  return Boolean(running);
}

export function refreshCacheBackground(options = {}) {
  if (running) return running;

  running = refreshCache(options).catch(error => {
    cache.lastError = error.message;
    setStage('failed');
    console.error('[refresh] failed', error);
    return cache.metas || [];
  });

  return running;
}

export async function refreshCache({ forceFull = false } = {}) {
  if (running) return running;
  runningStartedAt = Date.now();

  running = (async () => {
    try {
      setStage('load-disk-cache');
      const current = cache.at ? cache : await loadFromDisk();

      setStage('fetch-filmbaze-json');
      const rawFetched = await fetchFilmbazeItems();

      // A WEDOS block with zero usable source items must never touch the stored cache.
      // The workflow exits successfully, validates the previous cache and commits nothing.
      if (rawFetched.blocked && rawFetched.items.length === 0 && current.metas.length) {
        console.warn(`[refresh] Filmbáze blocked this run: ${rawFetched.blockReason || 'WEDOS security response'}`);
        console.warn(`[refresh] Keeping previous cache unchanged (${current.metas.length} metas).`);
        setStage('filmbaze-blocked-cache-preserved');
        return current.metas;
      }

      const fetched = preservePreviousSourceOnPartialFetch(rawFetched, current);
      setStage(`fetched-${rawFetched.items.length}-items${fetched.partialFetch ? '-partial-preserved' : ''}`);

      if (!fetched.items.length) throw new Error('Filmbáze JSON returned 0 items.');

      const sourceChanged = current.sourceHash !== fetched.sourceHash;
      const oldByFilmbazeId = new Map(
        (current.metas || [])
          .map(meta => [String(meta._addon?.filmbazeId || ''), meta])
          .filter(([key]) => key)
      );

      const repairable = fetched.items.filter(item => {
        const existing = oldByFilmbazeId.get(String(item.id));
        const reasons = repairReasons(existing, item);
        return Boolean(existing && reasons.length && repairAllowed(existing, reasons));
      }).length;

      if (!forceFull && !sourceChanged && current.metas.length && repairable === 0) {
        setStage('source-unchanged-no-repairs');
        const refreshStats = buildRefreshStats({ sourceChanged: false, fetchedItems: fetched.items.length });
        refreshStats.reusedItems = current.metas.length;
        refreshStats.sourceBlocked = Boolean(rawFetched.blocked);
        refreshStats.sourceBlockReason = rawFetched.blockReason || null;
        refreshStats.filmbazeRequests = Number(rawFetched.requestState?.requests || 0);
        refreshStats.incrementalSourceFetch = Boolean(rawFetched.incremental);

        cache = {
          ...current,
          at: Date.now(),
          refreshStats,
          byId: buildIndex(current.metas),
          lastError: null
        };
        await writeStore({
          at: cache.at,
          sourceHash: cache.sourceHash,
          items: cache.items,
          metas: cache.metas,
          lastError: null,
          refreshStats
        });
        return cache.metas;
      }

      const stats = buildRefreshStats({ sourceChanged, fetchedItems: fetched.rawFetchedItems ?? fetched.items.length });
      stats.partialFetch = Boolean(fetched.partialFetch);
      stats.preservedSourceItems = fetched.partialFetch ? fetched.items.length - (fetched.rawFetchedItems || 0) : 0;
      stats.sourceBlocked = Boolean(rawFetched.blocked);
      stats.sourceBlockReason = rawFetched.blockReason || null;
      stats.filmbazeRequests = Number(rawFetched.requestState?.requests || 0);
      stats.incrementalSourceFetch = Boolean(rawFetched.incremental);
      const metas = [];
      let movieBudgetUsed = 0;
      let seriesBudgetUsed = 0;

      setStage('build-metadata');

      for (const item of fetched.items) {
        const existing = oldByFilmbazeId.get(String(item.id));
        const reasons = repairReasons(existing, item);
        const isSeries = item.type === 'series';
        const limit = forceFull
          ? Number.POSITIVE_INFINITY
          : (isSeries ? ENRICH_SERIES_LIMIT : ENRICH_MOVIE_LIMIT);
        const used = isSeries ? seriesBudgetUsed : movieBudgetUsed;
        const eligibleRepair = Boolean(existing && reasons.length && repairAllowed(existing, reasons));
        const isNew = !existing;
        const shouldEnrich = (isNew || eligibleRepair || forceFull) && used < limit;

        if (shouldEnrich) {
          const meta = await enrichItem(item, existing, reasons);
          metas.push(meta);

          if (isSeries) {
            seriesBudgetUsed += 1;
            stats.enrichedSeries += 1;
          } else {
            movieBudgetUsed += 1;
            stats.enrichedMovies += 1;
          }

          if (isNew) stats.newItems += 1;
          else if (meta._addon?.repairStatus === 'resolved') stats.repairedItems += 1;
          else stats.repairFailed += 1;
          continue;
        }

        if (existing) {
          metas.push(mergeSourceIntoExisting(existing, item));
          stats.reusedItems += 1;
          if (reasons.length) stats.repairDeferred += 1;
        } else {
          metas.push(toMeta(item));
          stats.newItems += 1;
          if (reasons.length) stats.repairDeferred += 1;
        }
      }

      validateInMemory(fetched.items, metas);

      cache = {
        at: Date.now(),
        sourceHash: fetched.sourceHash,
        items: fetched.items,
        metas,
        byId: buildIndex(metas),
        lastError: null,
        refreshStats: stats
      };

      setStage('write-cache');
      await writeStore({
        at: cache.at,
        sourceHash: cache.sourceHash,
        items: cache.items,
        metas: cache.metas,
        lastError: null,
        refreshStats: stats
      });

      setStage('done');
      console.log('[refresh] stats:', JSON.stringify(stats));
      return metas;
    } catch (error) {
      cache.lastError = error.message;
      setStage('failed');

      await writeStore({
        at: cache.at || 0,
        sourceHash: cache.sourceHash || '',
        items: cache.items || [],
        metas: cache.metas || [],
        lastError: error.message,
        refreshStats: cache.refreshStats || null
      }).catch(() => {});

      throw error;
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
  if (isStale() && !running) refreshCacheBackground().catch(() => {});
  return cache.metas || [];
}

export async function getMetaById(id) {
  if (!cache.at) await loadFromDisk();
  return cache.byId.get(id) || null;
}

function sortByFilmbazeChannelOrder(a, b) {
  const first = Number.isFinite(a._addon?.channelOrder) ? a._addon.channelOrder : 999999;
  const second = Number.isFinite(b._addon?.channelOrder) ? b._addon.channelOrder : 999999;
  if (first !== second) return first - second;
  return String(b._addon?.dateAdded || '').localeCompare(String(a._addon?.dateAdded || ''));
}

export function filterCatalog(metas, id, type) {
  if (id === 'filmbaze-filmy' && type === 'movie') {
    return [...metas].filter(meta => meta.type === 'movie').sort(sortByFilmbazeChannelOrder);
  }
  if (id === 'filmbaze-serialy' && type === 'series') {
    return [...metas].filter(meta => meta.type === 'series').sort(sortByFilmbazeChannelOrder);
  }
  return [];
}

export function searchCatalog(metas, query) {
  const value = String(query || '').trim().toLowerCase();
  if (!value) return metas;
  return metas.filter(meta =>
    `${meta.name} ${meta.description || ''} ${(meta.genres || []).join(' ')}`.toLowerCase().includes(value)
  );
}

export async function getCatalogStats() {
  if (!cache.at) await loadFromDisk();
  const metas = cache.metas || [];
  const ids = metas.map(meta => meta.id);
  const duplicateIds = ids.length - new Set(ids).size;

  return {
    at: cache.at,
    generatedAt: cache.at ? new Date(cache.at).toISOString() : null,
    stale: isStale(),
    refreshRunning: Boolean(running),
    refreshStartedAt: runningStartedAt ? new Date(runningStartedAt).toISOString() : null,
    refreshAgeSeconds: runningStartedAt ? Math.round((Date.now() - runningStartedAt) / 1000) : 0,
    stage,
    lastError: cache.lastError,
    refreshStats: cache.refreshStats || null,
    items: metas.length,
    visibleItems: metas.length,
    cacheFile: storePath(),
    movies: metas.filter(meta => meta.type === 'movie').length,
    series: metas.filter(meta => meta.type === 'series').length,
    withFilmbaze: metas.filter(meta => meta._addon?.filmbazeId).length,
    withImdb: metas.filter(meta => validImdb(meta.imdbId || meta._addon?.imdbId)).length,
    withTmdb: metas.filter(meta => meta.tmdbId || meta._addon?.tmdbId).length,
    missingPoster: metas.filter(meta => !meta.poster).length,
    missingDescription: metas.filter(meta => cleanDescription(meta.description).length < MIN_DESCRIPTION_LENGTH).length,
    duplicateIds,
    detailChecked: metas.filter(meta => meta._addon?.detailChecked).length,
    seriesWithEpisodes: metas.filter(meta => meta.type === 'series' && Array.isArray(meta.videos) && meta.videos.length > 0).length,
    seriesWithoutEpisodes: metas.filter(meta => meta.type === 'series' && (!Array.isArray(meta.videos) || meta.videos.length === 0)).length,
    totalEpisodes: metas
      .filter(meta => meta.type === 'series' && Array.isArray(meta.videos))
      .reduce((sum, meta) => sum + meta.videos.length, 0)
  };
}
