import { fetchFilmbazeItems } from './filmbaze.js';
import { tmdbSearch } from './tmdb.js';
import { readStore, writeStore, storePath } from './store.js';

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_HOURS || 24) * 60 * 60 * 1000;
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || 0);
const ENRICH_MOVIE_LIMIT = Number(process.env.ENRICH_MOVIE_LIMIT || ENRICH_LIMIT || 0);
const ENRICH_SERIES_LIMIT = Number(process.env.ENRICH_SERIES_LIMIT || ENRICH_LIMIT || 0);

let cache = { at: 0, metas: [], items: [], byId: new Map(), sourceHash: '', lastError: null };
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

function normalizeStremioSeriesVideos(videos, seriesId) {
  if (!Array.isArray(videos)) return [];

  return videos
    .filter(video => Number(video.season) > 0 && Number(video.episode) > 0)
    .map(video => ({
      ...video,
      // Stremio je najstabilnejšie, keď episode id začína ID seriálu.
      // Napr. tt34809853:1:1 namiesto tmdb:tv:276161:1:1
      id: `${seriesId}:${Number(video.season)}:${Number(video.episode)}`
    }));
}


function toMeta(item, tmdb = null) {
  const imdbId = tmdb?.imdbId || item.imdbId || null;
  const id = imdbId || localId(item);
  const seriesVideos = item.type === 'series' ? normalizeStremioSeriesVideos(tmdb?.videos || [], id) : [];

  const year = tmdb?.year || item.year;
  const poster = tmdb?.poster || item.poster;
  const background = tmdb?.background || item.background || poster;

  return {
    id,
    type: item.type,
    name: tmdb?.name || item.name,
    poster,
    background,
    description: [
      tmdb?.description || item.description || '',
      `Zdroj: Filmbáze`,
      item.id ? `Filmbáze ID: ${item.id}` : null
    ].filter(Boolean).join('\n\n'),
    releaseInfo: year ? String(year) : undefined,
    year,
    runtime: tmdb?.runtime ? `${tmdb.runtime} min` : item.runtime ? `${item.runtime} min` : undefined,
    genres: tmdb?.genres || ['CZ/SK'],
    imdbRating: tmdb?.rating || (item.rating ? String(item.rating) : undefined),
    cast: tmdb?.cast || [],
    director: tmdb?.director || [],
    behaviorHints: item.type === 'series'
      ? { defaultVideoId: seriesVideos[0]?.id || id }
      : { defaultVideoId: id },
    videos: item.type === 'series' ? seriesVideos : undefined,
    seriesInfo: item.type === 'series' ? { episodeCount: seriesVideos.length } : undefined,
    links: [
      item.id ? { name: 'Filmbáze', category: 'Info', url: `https://filmbaze.cz/title/${item.id}` } : null,
      tmdb?.tmdbId ? { name: 'TMDB', category: 'Info', url: (item.type === 'series' ? `https://www.themoviedb.org/tv/${tmdb.tmdbId}` : `https://www.themoviedb.org/movie/${tmdb.tmdbId}`) } : null,
      imdbId ? { name: 'IMDb', category: 'Info', url: `https://www.imdb.com/title/${imdbId}/` } : null
    ].filter(Boolean),
    _addon: {
      key: String(item.id),
      filmbazeId: item.id,
      tmdbId: tmdb?.tmdbId || item.tmdbId || null,
      imdbId,
      dateAdded: item.dateAdded,
      channelOrder: Number.isFinite(item.channelOrder) ? item.channelOrder : 999999,
      page: item.page || null,
      episodeCount: item.type === 'series' ? seriesVideos.length : 0,
      originalName: item.originalName || null,
      detailChecked: Boolean(item.detailChecked),
      sourceTitle: item.name
    }
  };
}


function tmdbFromFilmbazeItem(item) {
  if (!item?.tmdbId && !item?.imdbId && !item?.originalName) return null;

  return {
    tmdbId: item.tmdbId || null,
    imdbId: item.imdbId || null,
    type: item.type,
    name: item.originalName || item.name,
    year: item.year,
    poster: item.poster,
    background: item.background,
    description: item.description,
    rating: item.rating,
    runtime: item.runtime,
    genres: ['CZ/SK'],
    cast: [],
    director: [],
    videos: []
  };
}

async function enrichItem(item) {
  const direct = tmdbFromFilmbazeItem(item);

  if (direct?.imdbId || direct?.tmdbId) {
    if (item.type !== 'series' || direct.videos?.length) {
      return toMeta(item, direct);
    }
  }

  if (ENRICH_LIMIT <= 0 && ENRICH_MOVIE_LIMIT <= 0 && ENRICH_SERIES_LIMIT <= 0) {
    return toMeta(item, direct);
  }

  try {
    const tmdb = await tmdbSearch(item.originalName || item.name, item.year, item.type, item.runtime);
    return toMeta(item, tmdb || direct);
  } catch (error) {
    console.error('[tmdb] enrich failed:', item.name, error.message);
    return toMeta(item, direct);
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
      const fetched = await fetchFilmbazeItems();

      setStage(`fetched-${fetched.items.length}-items`);

      if (!fetched.items.length) {
        throw new Error('Filmbáze JSON returned 0 items.');
      }

      if (!forceFull && current.sourceHash === fetched.sourceHash && current.metas.length) {
        setStage('source-unchanged');
        cache = {
          ...current,
          at: Date.now(),
          byId: buildIndex(current.metas),
          lastError: null
        };
        await writeStore({
          at: cache.at,
          sourceHash: cache.sourceHash,
          items: cache.items,
          metas: cache.metas,
          lastError: null
        });
        return cache.metas;
      }

      const oldByFilmbazeId = new Map(
        (current.metas || [])
          .map(meta => [String(meta._addon?.filmbazeId || ''), meta])
          .filter(([key]) => key)
      );

      const metas = [];
      let enrichedMovies = 0;
      let enrichedSeries = 0;

      setStage('build-metadata');

      for (const item of fetched.items) {
        const existing = !forceFull ? oldByFilmbazeId.get(String(item.id)) : null;

        if (existing) {
          metas.push(existing);
          continue;
        }

        const isSeries = item.type === 'series';
        const limit = isSeries ? ENRICH_SERIES_LIMIT : ENRICH_MOVIE_LIMIT;
        const used = isSeries ? enrichedSeries : enrichedMovies;

        if (limit > 0 && used < limit) {
          metas.push(await enrichItem(item));
          if (isSeries) enrichedSeries += 1;
          else enrichedMovies += 1;
        } else {
          metas.push(toMeta(item));
        }
      }

      cache = {
        at: Date.now(),
        sourceHash: fetched.sourceHash,
        items: fetched.items,
        metas,
        byId: buildIndex(metas),
        lastError: null
      };

      setStage('write-cache');
      await writeStore({
        at: cache.at,
        sourceHash: cache.sourceHash,
        items: cache.items,
        metas: cache.metas,
        lastError: null
      });

      setStage('done');
      return metas;
    } catch (error) {
      cache.lastError = error.message;
      setStage('failed');

      await writeStore({
        at: cache.at || 0,
        sourceHash: cache.sourceHash || '',
        items: cache.items || [],
        metas: cache.metas || [],
        lastError: error.message
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

  if (isStale() && !running) {
    refreshCacheBackground().catch(() => {});
  }

  return cache.metas || [];
}

export async function getMetaById(id) {
  if (!cache.at) await loadFromDisk();
  return cache.byId.get(id) || null;
}

function sortByFilmbazeChannelOrder(a, b) {
  const ao = Number.isFinite(a._addon?.channelOrder) ? a._addon.channelOrder : 999999;
  const bo = Number.isFinite(b._addon?.channelOrder) ? b._addon.channelOrder : 999999;

  if (ao !== bo) return ao - bo;

  return String(b._addon?.dateAdded || '').localeCompare(String(a._addon?.dateAdded || ''));
}

export function filterCatalog(metas, id, type) {
  if (id === 'filmbaze-filmy' && type === 'movie') {
    return [...metas]
      .filter(meta => meta.type === 'movie')
      .sort(sortByFilmbazeChannelOrder);
  }

  if (id === 'filmbaze-serialy' && type === 'series') {
    return [...metas]
      .filter(meta => meta.type === 'series')
      .sort(sortByFilmbazeChannelOrder);
  }

  return [];
}

export function searchCatalog(metas, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return metas;

  return metas.filter(meta =>
    `${meta.name} ${meta.description || ''} ${(meta.genres || []).join(' ')}`.toLowerCase().includes(q)
  );
}

export async function getCatalogStats() {
  if (!cache.at) await loadFromDisk();
  const metas = cache.metas || [];

  return {
    at: cache.at,
    generatedAt: cache.at ? new Date(cache.at).toISOString() : null,
    stale: isStale(),
    refreshRunning: Boolean(running),
    refreshStartedAt: runningStartedAt ? new Date(runningStartedAt).toISOString() : null,
    refreshAgeSeconds: runningStartedAt ? Math.round((Date.now() - runningStartedAt) / 1000) : 0,
    stage,
    lastError: cache.lastError,
    items: metas.length,
    visibleItems: metas.length,
    cacheFile: storePath(),
    movies: metas.filter(m => m.type === 'movie').length,
    series: metas.filter(m => m.type === 'series').length,
    withFilmbaze: metas.filter(m => m._addon?.filmbazeId).length,
    withImdb: metas.filter(m => m._addon?.imdbId).length,
    withTmdb: metas.filter(m => m._addon?.tmdbId).length,
    detailChecked: metas.filter(m => m._addon?.detailChecked).length,
    seriesWithEpisodes: metas.filter(m => m.type === 'series' && Array.isArray(m.videos) && m.videos.length > 0).length,
    totalEpisodes: metas.filter(m => m.type === 'series' && Array.isArray(m.videos)).reduce((sum, m) => sum + m.videos.length, 0)
  };
}
