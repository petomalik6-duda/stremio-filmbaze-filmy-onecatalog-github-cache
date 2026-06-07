import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { getWithRetry } from './http.js';

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
  const variants = [];

  // Correct Filmbáze API discovered from browser Network.
  variants.push(channelApiUrl(type, page));

  // Public route variants as fallback.
  const a = new URL(baseUrl);
  if (page > 1) a.searchParams.set('page', String(page));
  variants.push(a.toString());

  const b = new URL(baseUrl);
  if (page > 1) b.searchParams.set('content_page', String(page));
  variants.push(b.toString());

  const c = new URL(baseUrl);
  if (page > 1) c.searchParams.set('p', String(page));
  variants.push(c.toString());

  return [...new Set(variants)];
}

function readerUrl(url) {
  return `https://r.jina.ai/${url}`;
}

async function fetchFilmbazePage(baseUrl, page, type) {
  let lastError = null;

  for (const url of pageUrls(baseUrl, page, type)) {
    // 0) Direct Filmbáze API JSON.
    if (url.includes('/api/v1/channel/')) {
      try {
        const response = await getWithRetry(url, {
          headers: {
            'Accept': 'application/json',
            'Referer': baseUrl
          }
        });

        if (typeof response.data === 'object') {
          return { payload: response.data, mode: 'channel-api', url };
        }
      } catch (error) {
        lastError = error;
        logPageError(type, page, 'channel-api', url, error.message);
      }
    }

    // 1) Inertia partial JSON first. This is important for pagination.
    try {
      const response = await getWithRetry(url, {
        headers: {
          'X-Inertia': 'true',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Inertia-Partial-Component': 'ChannelPage',
          'X-Inertia-Partial-Data': 'content,pagination',
          'Referer': baseUrl,
          'Accept': 'application/json,text/html;q=0.9,*/*;q=0.8'
        }
      });

      if (typeof response.data === 'object') return { payload: response.data, mode: 'inertia-json', url };

      const jsonPayload = extractJsonFromHtml(String(response.data || ''));
      if (jsonPayload) return { payload: jsonPayload, mode: 'inertia-html-json', url };
    } catch (error) {
      lastError = error;
      logPageError(type, page, 'inertia', url, error.message);
    }

    // 2) Plain HTML/Inertia page.
    try {
      const response = await getWithRetry(url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Referer': baseUrl
        }
      });

      if (typeof response.data === 'object') return { payload: response.data, mode: 'plain-json', url };

      const htmlPayload = extractJsonFromHtml(String(response.data || ''));
      if (htmlPayload) return { payload: htmlPayload, mode: 'html-json', url };
    } catch (error) {
      lastError = error;
      logPageError(type, page, 'html', url, error.message);
    }

    // 3) Reader fallback only for page 1. Reader usually cannot trigger infinite scroll pages.
    if (USE_READER_FALLBACK && page === 1) {
      try {
        const fallback = readerUrl(url);
        const response = await getWithRetry(fallback, {
          headers: { Accept: 'text/plain,text/markdown,*/*' }
        });
        return { payload: { __readerText: String(response.data || '') }, mode: 'reader', url: fallback };
      } catch (error) {
        lastError = error;
        logPageError(type, page, 'reader', url, error.message);
      }
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

  while (nextPage && pages < MAX_PAGES && all.length < maxItems) {
    pages += 1;

    const { payload, mode, url: usedUrl } = await fetchFilmbazePage(url, nextPage, type);

    if (payload?.__readerText) {
      const readerItems = parseReaderText(payload.__readerText, type, url);
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
      .filter(Boolean);

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
    else if (received >= perPage && pages < MAX_PAGES) nextPage += 1;
    else nextPage = null;
  }

  lastDebug[type === 'movie' ? 'movies' : 'series'] = debugRows;
  return dedupe(all).slice(0, maxItems);
}

function parseReaderText(text, type, sourceUrl) {
  const items = [];
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let name = null;

    const poster = line.match(/Poster for\s+(.+)/i);
    if (poster) name = cleanTitle(poster[1]);
    if (!name && isLikelyTitleLine(line)) name = cleanTitle(line);
    if (!name) continue;

    const nearby = [line, lines[i + 1], lines[i + 2], lines[i - 1]].filter(Boolean).join(' ');
    const year = getYear(nearby);

    items.push({
      source: 'Filmbáze',
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
      sourceUrl
    });
  }

  return dedupe(items);
}

function isLikelyTitleLine(line) {
  const t = clean(line);
  if (!t || t.length < 2 || t.length > 120) return false;
  if (/cookie|reklama|facebook|instagram|youtube|kontakt|podmínky|menu|filmbaze\.cz|javascript enabled|novinky s českým dabingem|oblíbené seriály/i.test(t)) return false;
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

export async function fetchFilmbazeItems() {
  lastDebug = { movies: [], series: [], errors: [] };

  const [movies, series] = await Promise.allSettled([
    fetchChannelItems({ url: MOVIES_URL, type: 'movie', maxItems: MAX_ITEMS }),
    fetchChannelItems({ url: SERIES_URL, type: 'series', maxItems: MAX_SERIES_ITEMS })
  ]);

  const movieItems = movies.status === 'fulfilled' ? movies.value : [];
  const seriesItems = series.status === 'fulfilled' ? series.value : [];

  if (movies.status === 'rejected') {
    console.error('[filmbaze] movies failed:', movies.reason.message);
    lastDebug.errors.push({ type: 'movie', error: movies.reason.message });
  }

  if (series.status === 'rejected') {
    console.error('[filmbaze] series failed:', series.reason.message);
    lastDebug.errors.push({ type: 'series', error: series.reason.message });
  }

  const items = [...movieItems, ...seriesItems];

  const sourceHash = crypto.createHash('sha1')
    .update(items.map(x => `${x.type}|${x.id}|${x.name}|${x.releaseDate}`).join('|'))
    .digest('hex');

  return { sourceUrl: MOVIES_URL, moviesUrl: MOVIES_URL, seriesUrl: SERIES_URL, sourceHash, items };
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
