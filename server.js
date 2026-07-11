import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const PORT = Number(process.env.PORT || 7000);
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 100);
const ADDON_ID = 'cz.filmbaze.json.filmy.serialy.v347';
const ADDON_VERSION = PACKAGE_JSON.version || '3.4.7';
const DEFAULT_CACHE_FILE = path.join(__dirname, 'data', 'catalog-cache.json');

let selectedCacheFile = null;
let memoryCache = {
  file: null,
  mtimeMs: -1,
  items: [],
  raw: null,
  loadedAt: 0,
  byLookupId: new Map()
};

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


function setFreshResponseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidImdbId(value) {
  return typeof value === 'string' && /^tt\d{5,}$/.test(value);
}

function getType(item) {
  const value = String(item?.type || '').toLowerCase();
  return value === 'series' || value === 'tv' || value === 'show' ? 'series' : 'movie';
}

function getName(item) {
  return item?.name || item?.title || item?.originalName || item?.originalTitle || 'Bez názvu';
}

function getYear(item) {
  if (item?.year) return String(item.year);
  const value = item?.releaseDate || item?.firstAirDate || item?.released || '';
  const match = String(value).match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : '';
}

function getPoster(item) {
  return item?.poster || item?.posterUrl || item?.image || undefined;
}

function getBackground(item) {
  return item?.background || item?.backdrop || item?.backdropUrl || getPoster(item) || undefined;
}

function getDescription(item) {
  return item?.description || item?.overview || item?.plot || undefined;
}

function getFilmbazeId(item) {
  return item?._addon?.filmbazeId ?? item?.filmbazeId ?? (typeof item?.id === 'number' ? item.id : null);
}

function getStremioId(item) {
  const imdbId = item?.imdbId || item?._addon?.imdbId;
  if (isValidImdbId(imdbId)) return imdbId;
  if (isValidImdbId(item?.id)) return item.id;

  const tmdbId = item?.tmdbId || item?._addon?.tmdbId;
  if (tmdbId) return `tmdb:${tmdbId}`;

  const filmbazeId = getFilmbazeId(item);
  if (filmbazeId !== null && filmbazeId !== undefined) return `filmbaze:${filmbazeId}`;

  const key = normalizeText(`${getType(item)} ${getName(item)} ${getYear(item)}`);
  return `filmbaze:${key || 'unknown'}`;
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error('[cache] failed to read', file, error.message);
    return null;
  }
}

function findFallbackCacheFile() {
  const candidates = [
    DEFAULT_CACHE_FILE,
    path.join(__dirname, 'data', 'cache.json'),
    path.join(__dirname, 'data', 'filmbaze-cache.json'),
    path.join(__dirname, 'cache.json')
  ];
  return candidates.find(file => fs.existsSync(file)) || DEFAULT_CACHE_FILE;
}

function resolveCacheFile() {
  if (selectedCacheFile) return selectedCacheFile;
  const configured = process.env.CACHE_FILE;
  selectedCacheFile = configured
    ? (path.isAbsolute(configured) ? configured : path.join(__dirname, configured))
    : findFallbackCacheFile();
  return selectedCacheFile;
}

function mergeCacheLayers(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;

  const rawItems = Array.isArray(json.items) ? json.items : [];
  const metas = Array.isArray(json.metas) ? json.metas : [];

  if (metas.length) {
    const rawById = new Map(rawItems.map(item => [String(item?.id ?? ''), item]));
    return metas.map(meta => {
      const filmbazeId = meta?._addon?.filmbazeId;
      const raw = filmbazeId !== undefined && filmbazeId !== null
        ? rawById.get(String(filmbazeId))
        : null;

      return {
        ...(raw || {}),
        ...meta,
        id: meta.id,
        filmbazeId: filmbazeId ?? raw?.id ?? null,
        imdbId: meta.imdbId || meta?._addon?.imdbId || raw?.imdbId || null,
        tmdbId: meta.tmdbId || meta?._addon?.tmdbId || raw?.tmdbId || null,
        originalName: meta?._addon?.originalName || raw?.originalName || meta.originalName || null,
        dateAdded: meta?._addon?.dateAdded || raw?.dateAdded || meta.dateAdded || null,
        channelOrder: Number.isFinite(meta?._addon?.channelOrder)
          ? meta._addon.channelOrder
          : Number.isFinite(raw?.channelOrder) ? raw.channelOrder : 999999,
        page: meta?._addon?.page || raw?.page || null,
        videos: Array.isArray(meta.videos) ? meta.videos : []
      };
    });
  }

  if (rawItems.length) return rawItems;
  if (Array.isArray(json.movies) || Array.isArray(json.series)) {
    return [
      ...(json.movies || []).map(item => ({ ...item, type: item.type || 'movie' })),
      ...(json.series || []).map(item => ({ ...item, type: item.type || 'series' }))
    ];
  }
  return [];
}

function addLookup(map, type, key, item) {
  if (!key) return;
  map.set(`${type}:${key}`, item);
}

function buildLookupIndex(items) {
  const map = new Map();
  for (const item of items) {
    const type = getType(item);
    const stremioId = getStremioId(item);
    const imdbId = item?.imdbId || item?._addon?.imdbId;
    const tmdbId = item?.tmdbId || item?._addon?.tmdbId;
    const filmbazeId = getFilmbazeId(item);

    addLookup(map, type, stremioId, item);
    addLookup(map, type, imdbId, item);
    addLookup(map, type, tmdbId ? String(tmdbId) : null, item);
    addLookup(map, type, tmdbId ? `tmdb:${tmdbId}` : null, item);
    addLookup(map, type, filmbazeId !== null ? String(filmbazeId) : null, item);
    addLookup(map, type, filmbazeId !== null ? `filmbaze:${filmbazeId}` : null, item);
  }
  return map;
}

function loadCache() {
  const file = resolveCacheFile();
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { file, items: [], raw: null, loadedAt: memoryCache.loadedAt, explicit: Boolean(process.env.CACHE_FILE) };
  }

  if (memoryCache.file === file && memoryCache.mtimeMs === stat.mtimeMs && memoryCache.raw) {
    return { ...memoryCache, explicit: Boolean(process.env.CACHE_FILE) };
  }

  const raw = readJsonSafe(file);
  const items = mergeCacheLayers(raw);
  memoryCache = {
    file,
    mtimeMs: stat.mtimeMs,
    items,
    raw,
    loadedAt: Date.now(),
    byLookupId: buildLookupIndex(items)
  };
  console.log('[cache] loaded', file, 'items:', items.length);
  return { ...memoryCache, explicit: Boolean(process.env.CACHE_FILE) };
}

function normalizeEpisode(baseId, item, raw, index) {
  const season = Number(raw?.season ?? raw?.seasonNumber ?? raw?.s ?? 1) || 1;
  const episode = Number(raw?.episode ?? raw?.episodeNumber ?? raw?.number ?? raw?.e ?? index + 1) || index + 1;
  return {
    id: `${baseId}:${season}:${episode}`,
    title: raw?.title || raw?.name || `${getName(item)} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
    season,
    episode,
    released: raw?.released || raw?.airDate || raw?.firstAired || item?.releaseDate || item?.firstAirDate || undefined,
    overview: raw?.overview || raw?.description || getDescription(item),
    thumbnail: raw?.thumbnail || raw?.poster || raw?.image || getPoster(item) || getBackground(item)
  };
}

function realSeriesVideos(item, baseId) {
  const source = Array.isArray(item?.videos) ? item.videos : Array.isArray(item?.episodes) ? item.episodes : [];
  const seen = new Set();
  return source
    .map((episode, index) => normalizeEpisode(baseId, item, episode, index))
    .filter(episode => {
      const key = `${episode.season}:${episode.episode}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
}

function buildSeriesVideos(item, baseId) {
  const videos = realSeriesVideos(item, baseId);
  if (videos.length) return videos;
  return [{
    id: `${baseId}:1:1`,
    title: `${getName(item)} S01E01`,
    season: 1,
    episode: 1,
    released: item?.releaseDate || item?.firstAirDate || undefined,
    overview: getDescription(item),
    thumbnail: getPoster(item) || getBackground(item)
  }];
}

function firstSeriesVideoId(item, baseId) {
  const first = Array.isArray(item?.videos) ? item.videos[0] : Array.isArray(item?.episodes) ? item.episodes[0] : null;
  if (!first) return `${baseId}:1:1`;
  const season = Number(first.season ?? first.seasonNumber ?? 1) || 1;
  const episode = Number(first.episode ?? first.episodeNumber ?? first.number ?? 1) || 1;
  return `${baseId}:${season}:${episode}`;
}

function toMetaPreview(item) {
  const id = getStremioId(item);
  const type = getType(item);
  const meta = {
    id,
    type,
    name: getName(item),
    poster: getPoster(item),
    background: getBackground(item),
    description: getDescription(item),
    releaseInfo: getYear(item) || undefined,
    imdbId: isValidImdbId(item?.imdbId) ? item.imdbId : undefined,
    genres: Array.isArray(item?.genres) ? item.genres : undefined,
    behaviorHints: { defaultVideoId: type === 'series' ? firstSeriesVideoId(item, id) : id }
  };
  if (item?.runtime) meta.runtime = String(item.runtime).includes('min') ? item.runtime : `${item.runtime} min`;
  if (type === 'series') meta.seriesInfo = { episodeCount: realSeriesVideos(item, id).length };
  return meta;
}

function toMetaDetail(item) {
  const id = getStremioId(item);
  const type = getType(item);
  const meta = {
    id,
    type,
    name: getName(item),
    poster: getPoster(item),
    background: getBackground(item),
    description: getDescription(item),
    releaseInfo: getYear(item) || undefined,
    imdbId: isValidImdbId(item?.imdbId) ? item.imdbId : undefined,
    genres: Array.isArray(item?.genres) ? item.genres : undefined,
    released: item?.releaseDate || item?.firstAirDate || undefined,
    cast: Array.isArray(item?.cast) ? item.cast : undefined,
    director: Array.isArray(item?.director) ? item.director : undefined,
    videos: [],
    behaviorHints: {}
  };

  if (item?.runtime) meta.runtime = String(item.runtime).includes('min') ? item.runtime : `${item.runtime} min`;

  if (type === 'movie') {
    meta.videos = [{
      id,
      title: getName(item),
      released: item?.releaseDate || undefined,
      overview: getDescription(item),
      thumbnail: getPoster(item) || getBackground(item)
    }];
    meta.behaviorHints.defaultVideoId = id;
  } else {
    const videos = buildSeriesVideos(item, id);
    meta.videos = videos;
    meta.seriesInfo = { episodeCount: videos.length };
    meta.behaviorHints.defaultVideoId = videos[0].id;
  }

  return meta;
}

function matchSearch(item, query) {
  if (!query) return true;
  const needle = normalizeText(query);
  const haystack = normalizeText([
    getName(item),
    item?.originalName,
    item?.originalTitle,
    getYear(item),
    item?.imdbId,
    item?.tmdbId
  ].filter(Boolean).join(' '));
  return haystack.includes(needle);
}

function parseStremioExtra(extra = '') {
  const result = {};
  for (const part of String(extra).replace(/\.json$/, '').split('&')) {
    const [key, ...rest] = part.split('=');
    if (key) result[decodeURIComponent(key)] = decodeURIComponent(rest.join('=') || '');
  }
  return result;
}

function sortCatalog(a, b) {
  const first = Number(a?.channelOrder ?? a?._addon?.channelOrder ?? 999999);
  const second = Number(b?.channelOrder ?? b?._addon?.channelOrder ?? 999999);
  if (first !== second) return first - second;
  return String(b?.dateAdded || b?._addon?.dateAdded || '').localeCompare(String(a?.dateAdded || a?._addon?.dateAdded || ''));
}

function cacheStats(cache) {
  const items = cache.items;
  const movies = items.filter(item => getType(item) === 'movie');
  const series = items.filter(item => getType(item) === 'series');
  const ids = items.map(getStremioId);
  const seriesWithEpisodes = series.filter(item => realSeriesVideos(item, getStremioId(item)).length > 0);
  const totalEpisodes = series.reduce((sum, item) => sum + realSeriesVideos(item, getStremioId(item)).length, 0);

  return {
    items: items.length,
    movies: movies.length,
    series: series.length,
    withImdb: items.filter(item => isValidImdbId(item?.imdbId || item?._addon?.imdbId)).length,
    withTmdb: items.filter(item => item?.tmdbId || item?._addon?.tmdbId).length,
    missingPoster: items.filter(item => !getPoster(item)).length,
    seriesWithEpisodes: seriesWithEpisodes.length,
    seriesWithoutEpisodes: series.length - seriesWithEpisodes.length,
    totalEpisodes,
    duplicateIds: ids.length - new Set(ids).size
  };
}

const manifest = {
  id: ADDON_ID,
  version: ADDON_VERSION,
  name: 'Filmbáze CZ/SK filmy a seriály',
  description: 'Jeden katalóg filmov s CZ/SK dabingom z Filmbáze JSON dát.',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'filmbaze-filmy',
      name: 'Filmbáze – CZ/SK filmy',
      extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }]
    },
    {
      type: 'series',
      id: 'filmbaze-serialy',
      name: 'Filmbáze – seriály v češtině',
      extra: [{ name: 'skip', isRequired: false }, { name: 'search', isRequired: false }]
    }
  ],
  idPrefixes: ['tt', 'filmbaze:', 'tmdb:'],
  behaviorHints: { configurable: false, configurationRequired: false }
};

function handleCatalog(req, res) {
  try {
    const { type, id } = req.params;
    if (!['movie', 'series'].includes(type)) return res.json({ metas: [] });
    if (type === 'movie' && id !== 'filmbaze-filmy') return res.json({ metas: [] });
    if (type === 'series' && id !== 'filmbaze-serialy') return res.json({ metas: [] });

    const skip = Math.max(0, Number(req.query.skip || 0));
    const search = String(req.query.search || '');
    const cache = loadCache();
    const metas = cache.items
      .filter(item => getType(item) === type)
      .filter(item => matchSearch(item, search))
      .sort(sortCatalog)
      .slice(skip, skip + PAGE_SIZE)
      .map(toMetaPreview);

    setFreshResponseHeaders(res);
    return res.json({ metas });
  } catch (error) {
    console.error('[catalog] error', error);
    return res.status(500).json({ metas: [], error: error.message });
  }
}

app.get('/', (req, res) => {
  setFreshResponseHeaders(res);
  res.type('html').send(`<h1>Filmbáze Stremio addon v${ADDON_VERSION}</h1><p><a href="/manifest.json">manifest.json</a></p><p><a href="/health">health</a></p><p><a href="/cache.json">cache.json</a></p>`);
});

app.get('/manifest.json', (req, res) => {
  setFreshResponseHeaders(res);
  res.json(manifest);
});

app.get('/health', (req, res) => {
  const cache = loadCache();
  const stats = cacheStats(cache);
  const generatedAt = cache.raw?.at ? new Date(cache.raw.at).toISOString() : null;
  const latestMovies = cache.items
    .filter(item => getType(item) === 'movie')
    .sort(sortCatalog)
    .slice(0, 10)
    .map(item => ({ name: getName(item), filmbazeId: getFilmbazeId(item), channelOrder: item?.channelOrder ?? item?._addon?.channelOrder ?? null }));
  const latestSeries = cache.items
    .filter(item => getType(item) === 'series')
    .sort(sortCatalog)
    .slice(0, 5)
    .map(item => ({ name: getName(item), filmbazeId: getFilmbazeId(item), channelOrder: item?.channelOrder ?? item?._addon?.channelOrder ?? null }));
  setFreshResponseHeaders(res);
  res.json({
    ok: stats.items > 0,
    addon: ADDON_ID,
    version: ADDON_VERSION,
    cacheFile: cache.file,
    cacheLoadedAt: cache.loadedAt ? new Date(cache.loadedAt).toISOString() : null,
    cacheGeneratedAt: generatedAt,
    cacheAgeMinutes: cache.raw?.at ? Math.round((Date.now() - Number(cache.raw.at)) / 60000) : null,
    sourceHash: cache.raw?.sourceHash || null,
    lastError: cache.raw?.lastError || null,
    refreshStats: cache.raw?.refreshStats || null,
    pageSize: PAGE_SIZE,
    latestMovies,
    latestSeries,
    ...stats
  });
});

app.get('/cache.json', (req, res) => {
  const cache = loadCache();
  setFreshResponseHeaders(res);
  return res.json(cache.raw || { at: 0, items: [], metas: [], lastError: 'cache not loaded' });
});

app.get('/catalog/:type/:id.json', handleCatalog);
app.get('/catalog/:type/:id/:extra.json', (req, res) => {
  req.query = { ...req.query, ...parseStremioExtra(req.params.extra) };
  return handleCatalog(req, res);
});

app.get('/meta/:type/:id.json', (req, res) => {
  try {
    const cache = loadCache();
    const type = req.params.type === 'series' ? 'series' : 'movie';
    const item = cache.byLookupId.get(`${type}:${req.params.id}`);
    if (!item) return res.json({ meta: null });
    setFreshResponseHeaders(res);
    return res.json({ meta: toMetaDetail(item) });
  } catch (error) {
    console.error('[meta] error', error);
    return res.status(500).json({ meta: null, error: error.message });
  }
});

app.get('/debug/cache', (req, res) => {
  setFreshResponseHeaders(res);
  const cache = loadCache();
  res.json({
    ok: true,
    file: cache.file,
    loadedAt: cache.loadedAt,
    rawStats: cache.raw?.refreshStats || null,
    ...cacheStats(cache),
    sample: cache.items.slice(0, 10).map(item => ({
      id: getStremioId(item),
      filmbazeId: getFilmbazeId(item),
      name: getName(item),
      type: getType(item),
      imdbId: item?.imdbId || item?._addon?.imdbId || null,
      tmdbId: item?.tmdbId || item?._addon?.tmdbId || null,
      videos: realSeriesVideos(item, getStremioId(item)).length
    }))
  });
});

app.get('/debug/item/:type/:id', (req, res) => {
  setFreshResponseHeaders(res);
  const cache = loadCache();
  const type = req.params.type === 'series' ? 'series' : 'movie';
  const item = cache.byLookupId.get(`${type}:${req.params.id}`);
  if (!item) return res.status(404).json({ ok: false, error: 'item not found' });
  const meta = toMetaDetail(item);
  return res.json({
    ok: true,
    stremioId: getStremioId(item),
    filmbazeId: getFilmbazeId(item),
    imdbId: item?.imdbId || item?._addon?.imdbId || null,
    tmdbId: item?.tmdbId || item?._addon?.tmdbId || null,
    type: getType(item),
    videosCount: Array.isArray(meta.videos) ? meta.videos.length : 0,
    defaultVideoId: meta.behaviorHints?.defaultVideoId || null,
    meta
  });
});

app.listen(PORT, () => {
  loadCache();
  console.log(`Filmbáze addon v${ADDON_VERSION} running on port ${PORT}`);
});
