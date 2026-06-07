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

const MAX_PAGES = Number(process.env.MAX_PAGES || 30);
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 1200);
const MAX_SERIES_ITEMS = Number(process.env.MAX_SERIES_ITEMS || process.env.MAX_SERIES || 1200);
const STRICT_MOVIE_FILTER = String(process.env.STRICT_MOVIE_FILTER || 'true').toLowerCase() !== 'false';
const USE_READER_FALLBACK = String(process.env.USE_READER_FALLBACK || 'true').toLowerCase() !== 'false';

function pageUrl(baseUrl, page) {
  const url = new URL(baseUrl);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

function readerUrl(url) {
  return `https://r.jina.ai/${url}`;
}

async function fetchFilmbazePage(baseUrl, page) {
  const url = pageUrl(baseUrl, page);

  // 1) Skús normálne HTML. Filmbáze často vloží JSON do Inertia data-page.
  try {
    const response = await getWithRetry(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });

    if (typeof response.data === 'object') return response.data;

    const htmlPayload = extractJsonFromHtml(String(response.data || ''));
    if (htmlPayload) return htmlPayload;
  } catch (error) {
    console.error('[filmbaze] html fetch failed:', url, error.message);
  }

  // 2) Skús Inertia JSON.
  try {
    const response = await getWithRetry(url, {
      headers: {
        'X-Inertia': 'true',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json'
      }
    });

    if (typeof response.data === 'object') return response.data;

    const jsonPayload = extractJsonFromHtml(String(response.data || ''));
    if (jsonPayload) return jsonPayload;
  } catch (error) {
    console.error('[filmbaze] inertia fetch failed:', url, error.message);
  }

  // 3) Textový reader fallback.
  if (USE_READER_FALLBACK) {
    const fallback = readerUrl(url);
    const response = await getWithRetry(fallback, {
      headers: {
        'Accept': 'text/plain,text/markdown,*/*'
      }
    });

    return {
      __readerText: String(response.data || '')
    };
  }

  throw new Error(`Could not fetch Filmbáze page ${url}`);
}

function extractJsonFromHtml(html) {
  const $ = cheerio.load(html);

  const app = $('#app').attr('data-page');
  if (app) {
    try {
      return JSON.parse(decodeHtml(app));
    } catch (error) {
      console.error('[filmbaze] failed to parse #app data-page:', error.message);
    }
  }

  // Filmbáze/Laravel môže mať JSON aj v inom atribúte.
  const dataPage = $('[data-page]').first().attr('data-page');
  if (dataPage) {
    try {
      return JSON.parse(decodeHtml(dataPage));
    } catch (error) {
      console.error('[filmbaze] failed to parse generic data-page:', error.message);
    }
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
  if (payload?.content?.data) return payload.content;
  if (payload?.props?.content?.data) return payload.props.content;
  if (payload?.page?.props?.content?.data) return payload.page.props.content;

  const stack = [payload];
  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current.data) && current.data.length && current.data[0]?.name) return current;
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return null;
}

async function fetchChannelItems({ url, type, maxItems }) {
  const all = [];
  let nextPage = 1;
  let pages = 0;

  while (nextPage && pages < MAX_PAGES && all.length < maxItems) {
    pages += 1;
    console.log(`[filmbaze] fetching ${type} page ${nextPage}`);

    const payload = await fetchFilmbazePage(url, nextPage);

    if (payload?.__readerText) {
      const readerItems = parseReaderText(payload.__readerText, type, url);
      all.push(...readerItems);
      break;
    }

    const content = getContent(payload);

    if (!content || !Array.isArray(content.data)) {
      console.error('[filmbaze] no content.data keys:', Object.keys(payload || {}));
      break;
    }

    const pageItems = content.data
      .map(item => normalizeFilmbazeTitle(item, type, url))
      .filter(Boolean);

    all.push(...pageItems);

    nextPage = content.next_page || null;
  }

  return dedupe(all).slice(0, maxItems);
}

function parseReaderText(text, type, sourceUrl) {
  const items = [];
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    let name = null;

    const poster = line.match(/Poster for\s+(.+)/i);
    if (poster) name = cleanTitle(poster[1]);

    // Reader často vypíše samostatné riadky titulov.
    if (!name && isLikelyTitleLine(line)) {
      name = cleanTitle(line);
    }

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
  const [movies, series] = await Promise.allSettled([
    fetchChannelItems({ url: MOVIES_URL, type: 'movie', maxItems: MAX_ITEMS }),
    fetchChannelItems({ url: SERIES_URL, type: 'series', maxItems: MAX_SERIES_ITEMS })
  ]);

  const movieItems = movies.status === 'fulfilled' ? movies.value : [];
  const seriesItems = series.status === 'fulfilled' ? series.value : [];

  if (movies.status === 'rejected') console.error('[filmbaze] movies failed:', movies.reason.message);
  if (series.status === 'rejected') console.error('[filmbaze] series failed:', series.reason.message);

  const items = [...movieItems, ...seriesItems];

  const sourceHash = crypto
    .createHash('sha1')
    .update(items.map(x => `${x.type}|${x.id}|${x.name}|${x.releaseDate}`).join('|'))
    .digest('hex');

  return {
    sourceUrl: MOVIES_URL,
    moviesUrl: MOVIES_URL,
    seriesUrl: SERIES_URL,
    sourceHash,
    items
  };
}

function normalizeFilmbazeTitle(item, requestedType, sourceUrl) {
  if (!item) return null;

  const isSeries = Boolean(item.is_series) || requestedType === 'series';
  if (requestedType === 'movie' && isSeries) return null;

  const name = clean(item.name);
  if (!name) return null;

  if (STRICT_MOVIE_FILTER && !item.poster && !item.backdrop) return null;

  const releaseDate = item.release_date || item.first_air_date || null;
  const year = getYear(releaseDate);

  return {
    source: 'Filmbáze',
    id: item.id,
    name,
    type: requestedType === 'series' ? 'series' : 'movie',
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
    lang: requestedType === 'series' ? 'CZ' : 'CZ/SK',
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
