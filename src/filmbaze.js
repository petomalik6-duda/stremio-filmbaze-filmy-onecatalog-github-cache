import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { getWithRetry, isFilmbazeBlockedError, getFilmbazeRequestState } from './http.js';
import { fetchIndexedCatalogHints } from './indexed.js';

const MOVIES_URL =
  process.env.FILMBAZE_MOVIES_URL ||
  process.env.FILMBAZE_SOURCE_URL ||
  process.env.MOVIES_SOURCE_URL ||
  'https://filmbaze.cz/novinky-s-ceskym-dabingem-na-netu';

const SERIES_URL =
  process.env.FILMBAZE_SERIES_URL ||
  process.env.SERIES_SOURCE_URL ||
  'https://filmbaze.cz/oblibene-serialy-v-cestine';

const MOVIES_CHANNEL_ID = process.env.FILMBAZE_MOVIES_CHANNEL_ID || '48884';
const SERIES_CHANNEL_ID = process.env.FILMBAZE_SERIES_CHANNEL_ID || '50427';

const MAX_PAGES = Number(process.env.MAX_PAGES || 50);
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 2000);
const MAX_SERIES_ITEMS = Number(process.env.MAX_SERIES_ITEMS || process.env.MAX_SERIES || 2000);
const STRICT_MOVIE_FILTER = String(process.env.STRICT_MOVIE_FILTER || 'true').toLowerCase() !== 'false';
const USE_READER_FALLBACK = String(process.env.USE_READER_FALLBACK || 'true').toLowerCase() !== 'false';
const ENABLE_FILMBAZE_DETAIL = String(process.env.ENABLE_FILMBAZE_DETAIL || 'true').toLowerCase() !== 'false';
const FILMBAZE_DETAIL_LIMIT = Number(process.env.FILMBAZE_DETAIL_LIMIT || 2000);
const FILMBAZE_INCREMENTAL = String(process.env.FILMBAZE_INCREMENTAL || 'false').toLowerCase() === 'true';
const FILMBAZE_API_ONLY = String(process.env.FILMBAZE_API_ONLY || 'false').toLowerCase() === 'true';
const FILMBAZE_BETWEEN_CHANNELS_MS = Math.max(0, Number(process.env.FILMBAZE_BETWEEN_CHANNELS_MS || 4000));
const MAX_MOVIE_PAGES = Math.max(1, Number(process.env.MAX_MOVIE_PAGES || (FILMBAZE_INCREMENTAL ? 1 : MAX_PAGES)));
const MAX_SERIES_PAGES = Math.max(1, Number(process.env.MAX_SERIES_PAGES || (FILMBAZE_INCREMENTAL ? 1 : MAX_PAGES)));

let lastDebug = {
  movies: [],
  series: [],
  errors: []
};

export function getFilmbazeDebug() {
  return lastDebug;
}

function channelApiUrl(type, page) {
  const channelId = type === 'series' ? SERIES_CHANNEL_ID : MOVIES_CHANNEL_ID;
  const u = new URL(`https://filmbaze.cz/api/v1/channel/${channelId}`);
  u.searchParams.set('returnContentOnly', 'true');
  u.searchParams.set('restriction', '');
  u.searchParams.set('order', 'channelables.created_at:desc');
  u.searchParams.set('perPage', '50');
  u.searchParams.set('query', '');
  u.searchParams.set('page', String(page));
  return u.toString();
}

function pageUrls(baseUrl, page, type) {
  const api = channelApiUrl(type, page);
  if (FILMBAZE_API_ONLY) return [api];

  const variants = [api];

  const a = new URL(baseUrl);
  if (page > 1) a.searchParams.set('page', String(page));
  variants.push(a.toString());

  const b = new URL(baseUrl);
  if (page > 1) b.searchParams.set('content_page', String(page));
  variants.push(b.toString());

  return [...new Set(variants)];
}

function readerUrl(url) {
  return `https://r.jina.ai/${url}`;
}

function readerPageUrl(baseUrl, page) {
  const u = new URL(baseUrl);
  if (page > 1) u.searchParams.set('page', String(page));
  return readerUrl(u.toString());
}

async function fetchReaderFallback(baseUrl, page, type, reason = '') {
  if (!USE_READER_FALLBACK) return null;

  const url = readerPageUrl(baseUrl, page);
  try {
    console.warn(`[filmbaze] trying safe reader fallback for ${type} page ${page}${reason ? ` after ${reason}` : ''}`);
    const response = await getWithRetry(url, {
      headers: {
        Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8',
        // Never trust an old Reader cache as evidence that the Filmbáze window
        // is current. Jina documents X-No-Cache / X-Cache-Tolerance for this.
        'X-No-Cache': 'true',
        'X-Cache-Tolerance': '0'
      }
    }, 1);
    const text = String(response.data || '');
    if (!text || isBlockedReaderResponse(text)) {
      throw new Error('Reader fallback returned no usable Filmbáze content.');
    }
    const items = parseReaderText(text, type, baseUrl);
    if (!items.length) {
      throw new Error('Reader fallback contained no explicit catalog titles.');
    }
    return { payload: { __readerText: text }, mode: 'reader-fallback', url };
  } catch (error) {
    logPageError(type, page, 'reader-fallback', url, error.message);
    console.warn(`[filmbaze] reader fallback failed for ${type} page ${page}: ${error.message}`);
    return null;
  }
}

function isBlockedReaderResponse(text) {
  const value = String(text || '');
  return /WEDOS\.protection|Security verification|Target URL returned error 401|\b401\s*Unauthorized\b|ALTCHA|security challenge|unusual activity from your browser|Req-ID:|Node:\s*ac\d+|Agent:\s*like Gecko/i.test(value);
}

async function fetchFilmbazePage(baseUrl, page, type) {
  let lastError = null;

  for (const url of pageUrls(baseUrl, page, type)) {
    const isApi = url.includes('/api/v1/channel/');

    if (isApi) {
      try {
        const response = await getWithRetry(url, {
          headers: {
            Accept: 'application/json',
            Referer: baseUrl
          }
        }, 1);

        if (typeof response.data === 'object' && response.data !== null) {
          return { payload: response.data, mode: 'channel-api', url };
        }

        const jsonPayload = extractJsonFromHtml(String(response.data || ''));
        if (jsonPayload) return { payload: jsonPayload, mode: 'channel-api-html-json', url };

        throw new Error('Filmbáze channel API returned no usable JSON payload.');
      } catch (error) {
        lastError = error;
        logPageError(type, page, 'channel-api', url, error.message);

        if (isFilmbazeBlockedError(error)) {
          const reader = await fetchReaderFallback(baseUrl, page, type, 'WEDOS/API block');
          if (reader) return reader;
          throw error;
        }

        if (FILMBAZE_API_ONLY) {
          const reader = await fetchReaderFallback(baseUrl, page, type, 'API failure');
          if (reader) return reader;
          throw error;
        }
        continue;
      }
    }

    // Public page fallback is disabled for the daily workflow. It is available only
    // for manual diagnostics because each fallback request increases WEDOS pressure.
    try {
      const response = await getWithRetry(url, {
        headers: {
          'X-Inertia': 'true',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Inertia-Partial-Component': 'ChannelPage',
          'X-Inertia-Partial-Data': 'content,pagination',
          Referer: baseUrl,
          Accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
        }
      }, 1);

      if (typeof response.data === 'object' && response.data !== null) {
        return { payload: response.data, mode: 'inertia-json', url };
      }

      const jsonPayload = extractJsonFromHtml(String(response.data || ''));
      if (jsonPayload) return { payload: jsonPayload, mode: 'inertia-html-json', url };
    } catch (error) {
      lastError = error;
      logPageError(type, page, 'inertia', url, error.message);
      if (isFilmbazeBlockedError(error)) throw error;
    }
  }

  throw lastError || new Error(`Could not fetch Filmbáze page ${baseUrl} page ${page}`);
}
function logPageError(type, page, mode, url, error) {
  lastDebug.errors.push({ type, page, mode, url, error });
  if (lastDebug.errors.length > 50) lastDebug.errors.shift();
}

function extractJsonFromHtml(html) {
  const $ = cheerio.load(html);

  const app = $('#app').attr('data-page');
  if (app) {
    try { return JSON.parse(decodeHtml(app)); } catch {}
  }

  const dataPage = $('[data-page]').first().attr('data-page');
  if (dataPage) {
    try { return JSON.parse(decodeHtml(dataPage)); } catch {}
  }

  const text = $('body').text();
  if (text && /Poster for|Novinky s českým dabingem|Oblíbené seriály/i.test(text)) {
    return { __readerText: text };
  }

  return null;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getContent(payload) {
  // Page 1 from uploaded sample: payload.content.data
  if (payload?.content?.data && Array.isArray(payload.content.data)) return payload.content;

  // Later pages from user's browser payload: payload.pagination.data
  if (payload?.pagination?.data && Array.isArray(payload.pagination.data)) return payload.pagination;

  // Inertia variants.
  if (payload?.props?.content?.data && Array.isArray(payload.props.content.data)) return payload.props.content;
  if (payload?.props?.pagination?.data && Array.isArray(payload.props.pagination.data)) return payload.props.pagination;
  if (payload?.page?.props?.content?.data && Array.isArray(payload.page.props.content.data)) return payload.page.props.content;
  if (payload?.page?.props?.pagination?.data && Array.isArray(payload.page.props.pagination.data)) return payload.page.props.pagination;

  // Deep fallback: accept any object that looks like a Laravel paginator.
  const stack = [payload];
  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current.data) && current.data.length && current.data[0]?.name) {
      return current;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return null;
}

async function fetchChannelItems({ url, type, maxItems }) {
  const debugRows = [];
  const all = [];
  let nextPage = 1;
  let pages = 0;
  const seenPageSignatures = new Set();

  const pageLimit = type === 'series' ? MAX_SERIES_PAGES : MAX_MOVIE_PAGES;

  while (nextPage && pages < pageLimit && all.length < maxItems) {
    pages += 1;

    const { payload, mode, url: usedUrl } = await fetchFilmbazePage(url, nextPage, type);

    if (payload?.__readerText) {
      const readerItems = parseReaderText(payload.__readerText, type, url)
        .map((item, index) => ({
          ...item,
          channelOrder: all.length + index,
          page: nextPage
        }));
      all.push(...readerItems);
      debugRows.push({ page: nextPage, mode, url: usedUrl, raw: 'reader', normalized: readerItems.length, nextPage: null });
      break;
    }

    const content = getContent(payload);

    if (!content || !Array.isArray(content.data)) {
      debugRows.push({ page: nextPage, mode, url: usedUrl, raw: 0, normalized: 0, nextPage: null, note: 'no content.data' });
      break;
    }

    const pageItems = content.data
      .map(item => normalizeFilmbazeTitle(item, type, url))
      .filter(Boolean)
      .map((item, index) => ({
        ...item,
        channelOrder: all.length + index,
        page: nextPage
      }));

    const signature = content.data.map(x => x?.id).filter(Boolean).join(',');
    if (signature && seenPageSignatures.has(signature)) {
      debugRows.push({ page: nextPage, mode, url: usedUrl, raw: content.data.length, normalized: pageItems.length, nextPage: content.next_page || null, note: 'duplicate page stopped' });
      break;
    }
    if (signature) seenPageSignatures.add(signature);

    all.push(...pageItems);

    debugRows.push({
      page: nextPage,
      mode,
      url: usedUrl,
      currentPage: content.current_page,
      raw: content.data.length,
      normalized: pageItems.length,
      nextPage: content.next_page || null,
      perPage: content.per_page || null,
      from: content.from || null,
      to: content.to || null
    });

    const explicitNext = content.next_page || null;
    const received = Array.isArray(content.data) ? content.data.length : 0;
    const perPage = Number(content.per_page || 50);

    if (explicitNext) nextPage = Number(explicitNext);
    else if (received >= perPage && pages < pageLimit) nextPage += 1;
    else nextPage = null;
  }

  lastDebug[type === 'movie' ? 'movies' : 'series'] = debugRows;
  return dedupe(all).slice(0, maxItems);
}

function parseReaderText(text, type, sourceUrl) {
  if (isBlockedReaderResponse(text)) {
    console.warn(`[filmbaze] rejected blocked reader response for ${type}`);
    return [];
  }

  const items = [];
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const poster = line.match(/Poster for\s+(.+)/i);
    if (!poster) continue;

    const name = cleanTitle(poster[1]);
    if (!name || !isLikelyTitleLine(name)) continue;

    const nearby = [line, lines[i + 1], lines[i + 2], lines[i + 3], lines[i - 1]].filter(Boolean).join(' ');
    const year = getYear(nearby);

    items.push({
      source: 'Filmbáze-reader',
      id: `reader-${type}-${hash(`${name}-${year || ''}`)}`,
      name,
      type,
      year,
      releaseDate: year ? `${year}-01-01` : null,
      poster: null,
      background: null,
      rating: undefined,
      runtime: undefined,
      description: '',
      status: '',
      certification: '',
      dateAdded: '',
      lang: type === 'series' ? 'CZ' : 'CZ/SK',
      primaryVideo: null,
      sourceUrl,
      readerFallback: true
    });
  }

  return dedupe(items);
}

function isLikelyTitleLine(line) {
  const t = clean(line);
  if (!t || t.length < 2 || t.length > 120) return false;
  if (/cookie|reklama|facebook|instagram|youtube|kontakt|podmínky|menu|filmbaze\.cz|javascript enabled|novinky s českým dabingem|oblíbené seriály|WEDOS|security verification|unauthorized|security challenge|unusual activity|Req-ID|Node:|Agent:|Markdown Content|Target URL returned error/i.test(t)) return false;
  if (/^\d+(\.\d+)?\s*\/\s*10$/.test(t)) return false;
  if (/^\d{1,3}\s*%$/.test(t)) return false;
  if (/^(film|filmy|seriál|seriály|žánry|hrají|režie|více|read more)$/i.test(t)) return false;
  return true;
}

function cleanTitle(value) {
  return clean(value)
    .replace(/\s+\(\d{4}\).*$/g, '')
    .replace(/\s+\d+(\.\d+)?\s*\/\s*10.*$/g, '')
    .replace(/\s+\d{1,3}\s*%.*$/g, '')
    .replace(/^Poster for\s+/i, '')
    .trim();
}


async function fetchFilmbazeDetail(item) {
  if (!ENABLE_FILMBAZE_DETAIL || !item?.id) return item;

  const detailUrls = [
    `https://filmbaze.cz/api/v1/title/${item.id}`,
    `https://filmbaze.cz/api/v1/titles/${item.id}`,
    `https://filmbaze.cz/api/title/${item.id}`,
    `https://filmbaze.cz/title/${item.id}`
  ];

  for (const url of detailUrls) {
    try {
      const response = await getWithRetry(url, {
        headers: {
          Accept: url.includes('/api/') ? 'application/json,text/html;q=0.9,*/*;q=0.8' : 'text/html,application/json;q=0.9,*/*;q=0.8',
          Referer: item.sourceUrl || 'https://filmbaze.cz/'
        }
      });

      const payload = typeof response.data === 'object'
        ? response.data
        : extractJsonFromHtml(String(response.data || ''));

      const ids = extractExternalIds(payload);
      const originalName = extractOriginalName(payload);

      if (ids.imdbId || ids.tmdbId || originalName) {
        return {
          ...item,
          imdbId: ids.imdbId || item.imdbId || null,
          tmdbId: ids.tmdbId || item.tmdbId || null,
          originalName: originalName || item.originalName || null,
          detailChecked: true
        };
      }
    } catch {}
  }

  return { ...item, detailChecked: true };
}

function extractExternalIds(payload) {
  const ids = { imdbId: null, tmdbId: null };

  const scan = value => {
    if (!value || (ids.imdbId && ids.tmdbId)) return;

    if (typeof value === 'string') {
      const imdb = value.match(/\btt\d{6,12}\b/i);
      if (imdb && !ids.imdbId) ids.imdbId = imdb[0];

      const tmdbUrl = value.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/i);
      if (tmdbUrl && !ids.tmdbId) ids.tmdbId = Number(tmdbUrl[1]);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) scan(item);
      return;
    }

    if (typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        const k = key.toLowerCase();

        if (!ids.imdbId && typeof val === 'string' && ['imdb_id', 'imdbid', 'imdb'].includes(k)) {
          const imdb = val.match(/\btt\d{6,12}\b/i);
          if (imdb) ids.imdbId = imdb[0];
        }

        if (!ids.tmdbId && ['tmdb_id', 'tmdbid', 'tmdb'].includes(k)) {
          const n = Number(val);
          if (Number.isFinite(n) && n > 0) ids.tmdbId = n;
        }

        scan(val);
      }
    }
  };

  scan(payload);
  return ids;
}

function extractOriginalName(payload) {
  let found = null;
  const keys = new Set(['original_name', 'original_title', 'originalname', 'originaltitle', 'english_name', 'english_title']);

  const scan = value => {
    if (!value || found) return;

    if (Array.isArray(value)) {
      for (const item of value) scan(item);
      return;
    }

    if (typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        if (!found && keys.has(key.toLowerCase()) && typeof val === 'string' && val.trim().length > 1) {
          found = val.trim();
          return;
        }
        scan(val);
      }
    }
  };

  scan(payload);
  return found;
}

async function enrichFilmbazeDetails(items) {
  if (!ENABLE_FILMBAZE_DETAIL || FILMBAZE_DETAIL_LIMIT <= 0) return items;

  const out = [];
  let checked = 0;

  for (const item of items) {
    if (checked < FILMBAZE_DETAIL_LIMIT) {
      out.push(await fetchFilmbazeDetail(item));
      checked += 1;
    } else {
      out.push(item);
    }
  }

  return out;
}


export async function fetchFilmbazeItems() {
  lastDebug = { movies: [], series: [], errors: [] };

  let movieItems = [];
  let seriesItems = [];
  let blocked = false;
  let blockReason = null;

  try {
    movieItems = await fetchChannelItems({ url: MOVIES_URL, type: 'movie', maxItems: MAX_ITEMS });
  } catch (error) {
    console.error('[filmbaze] movies failed:', error.message);
    lastDebug.errors.push({ type: 'movie', error: error.message, code: error.code || null });
    blocked = isFilmbazeBlockedError(error);
    if (blocked) blockReason = error.message;
  }

  if (!blocked && FILMBAZE_BETWEEN_CHANNELS_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, FILMBAZE_BETWEEN_CHANNELS_MS));
  }

  if (!blocked) {
    try {
      seriesItems = await fetchChannelItems({ url: SERIES_URL, type: 'series', maxItems: MAX_SERIES_ITEMS });
    } catch (error) {
      console.error('[filmbaze] series failed:', error.message);
      lastDebug.errors.push({ type: 'series', error: error.message, code: error.code || null });
      if (isFilmbazeBlockedError(error)) {
        blocked = true;
        blockReason = error.message;
      }
    }
  }

  const requestState = getFilmbazeRequestState();
  let indexedFallback = false;
  let indexedProviders = [];
  let indexedAttemptedProviders = [];
  let indexedQueries = [];
  let indexedErrors = [];
  let indexedItems = [];
  let indexedJinaConfigured = false;

  // When WEDOS blocks the origin, discover only a small newest-title window
  // from public search-index snippets. The complete historical cache is kept
  // by catalog.js; these hints can only add/re-rank items after strict checks.
  if (blocked || requestState.circuitOpen) {
    const [movieIndexed, seriesIndexed] = await Promise.all([
      fetchIndexedCatalogHints('movie', MOVIES_URL),
      fetchIndexedCatalogHints('series', SERIES_URL)
    ]);

    indexedItems = [...movieIndexed.items, ...seriesIndexed.items];
    indexedFallback = indexedItems.length > 0;
    indexedProviders = [...new Set([...movieIndexed.providers, ...seriesIndexed.providers])];
    indexedAttemptedProviders = [...new Set([...(movieIndexed.attemptedProviders || []), ...(seriesIndexed.attemptedProviders || [])])];
    indexedQueries = [...new Set([...(movieIndexed.queries || []), ...(seriesIndexed.queries || [])])];
    indexedErrors = [...movieIndexed.errors, ...seriesIndexed.errors];
    indexedJinaConfigured = Boolean(movieIndexed.jinaConfigured || seriesIndexed.jinaConfigured);

    console.log(`[filmbaze] indexed fallback attempted providers: ${indexedAttemptedProviders.join(', ') || 'none'}`);
    console.log(`[filmbaze] indexed fallback queries: ${indexedQueries.join(' || ') || 'none'}`);
    console.log(`[filmbaze] Jina Search configured: ${indexedJinaConfigured}`);
    if (indexedFallback) {
      console.warn(`[filmbaze] indexed fallback discovered ${indexedItems.length} current catalog hints via ${indexedProviders.join(', ') || 'public index'}`);
      console.log('[filmbaze] indexed titles:', indexedItems.slice(0, 20).map(item => `${item.type}:${item.name}${item.year ? ` (${item.year})` : ''}`).join(' | '));
      movieItems = mergeHints(movieItems, indexedItems.filter(item => item.type === 'movie'));
      seriesItems = mergeHints(seriesItems, indexedItems.filter(item => item.type === 'series'));
    } else {
      console.warn('[filmbaze] indexed fallback produced no usable hints.');
      if (indexedErrors.length) console.warn('[filmbaze] indexed fallback errors:', indexedErrors.join(' | '));
    }
  }

  const items = await enrichFilmbazeDetails([...movieItems, ...seriesItems]);

  const sourceHash = crypto.createHash('sha1')
    .update(items.map(x => `${x.type}|${x.id}|${x.name}|${x.releaseDate}`).join('|'))
    .digest('hex');

  return {
    sourceUrl: MOVIES_URL,
    moviesUrl: MOVIES_URL,
    seriesUrl: SERIES_URL,
    sourceHash,
    items,
    blocked: blocked || requestState.circuitOpen,
    blockReason: blockReason || requestState.reason || null,
    requestState,
    incremental: FILMBAZE_INCREMENTAL,
    indexedFallback,
    indexedProviders,
    indexedAttemptedProviders,
    indexedQueries,
    indexedErrors,
    indexedItems: indexedItems.length,
    indexedJinaConfigured
  };
}

function mergeHints(primaryItems, hints) {
  const out = [];
  const seenIds = new Set();
  const titleKey = item => `${item.type}:${clean(item.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}:${item.year || ''}`;
  const seenTitles = new Set();

  // Public-index hints represent the newest visible window, so rank them first.
  for (const item of [...(hints || []), ...(primaryItems || [])]) {
    const idKey = `${item.type}:${item.id}`.toLowerCase();
    const key = titleKey(item);
    if (seenIds.has(idKey) || seenTitles.has(key)) continue;
    out.push(item);
    seenIds.add(idKey);
    seenTitles.add(key);
  }

  return out.map((item, index) => ({ ...item, channelOrder: index, page: item.page || 1 }));
}

function normalizeFilmbazeTitle(item, requestedType, sourceUrl) {
  if (!item) return null;

  const realIsSeries = Boolean(item.is_series);
  const type = requestedType === 'series' ? 'series' : 'movie';

  if (requestedType === 'movie' && realIsSeries) return null;
  if (requestedType === 'series' && !realIsSeries) return null;

  const name = clean(item.name);
  if (!name) return null;
  if (STRICT_MOVIE_FILTER && !item.poster && !item.backdrop) return null;

  const releaseDate = item.release_date || item.first_air_date || null;
  const year = getYear(releaseDate);

  return {
    source: 'Filmbáze',
    id: item.id,
    name,
    type,
    year,
    releaseDate,
    poster: item.poster || null,
    background: item.backdrop || item.poster || null,
    rating: item.rating || undefined,
    runtime: item.runtime || undefined,
    description: item.description || '',
    status: item.status || '',
    certification: item.certification || '',
    dateAdded: releaseDate ? String(releaseDate).slice(0, 10) : '',
    lang: type === 'series' ? 'CZ' : 'CZ/SK',
    primaryVideo: item.primary_video || null,
    imdbId: item.imdb_id || item.imdbId || null,
    tmdbId: item.tmdb_id || item.tmdbId || null,
    originalName: item.original_name || item.original_title || item.originalName || null,
    sourceUrl
  };
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getYear(value) {
  const m = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}

function hash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = String(`${item.type}-${item.id || `${item.name}-${item.year}`}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
