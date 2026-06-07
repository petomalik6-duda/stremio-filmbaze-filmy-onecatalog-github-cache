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

function pageUrl(baseUrl, page) {
  const url = new URL(baseUrl);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

async function fetchFilmbazePage(baseUrl, page) {
  const url = pageUrl(baseUrl, page);

  const response = await getWithRetry(url, {
    headers: {
      'X-Inertia': 'true',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json'
    }
  });

  if (typeof response.data === 'object') return response.data;

  return extractJsonFromHtml(String(response.data || ''));
}

function extractJsonFromHtml(html) {
  const $ = cheerio.load(html);

  const app = $('#app').attr('data-page');
  if (app) {
    try {
      return JSON.parse(app.replace(/&quot;/g, '"'));
    } catch {}
  }

  const scripts = $('script').map((_i, el) => $(el).text()).get();
  for (const script of scripts) {
    const candidates = [
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/,
      /window\.__inertiaPage\s*=\s*(\{[\s\S]*?\});/
    ];

    for (const rx of candidates) {
      const m = script.match(rx);
      if (m) {
        try { return JSON.parse(m[1]); } catch {}
      }
    }
  }

  throw new Error('Could not extract Filmbáze JSON from response.');
}

function getContent(payload) {
  if (payload?.content?.data) return payload.content;
  if (payload?.props?.content?.data) return payload.props.content;

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
    const content = getContent(payload);

    if (!content || !Array.isArray(content.data)) {
      throw new Error(`Filmbáze JSON ${type} page ${nextPage} has no content.data`);
    }

    const pageItems = content.data
      .map(item => normalizeFilmbazeTitle(item, type, url))
      .filter(Boolean);

    all.push(...pageItems);

    nextPage = content.next_page || null;
  }

  return dedupe(all).slice(0, maxItems);
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
  if (requestedType === 'series' && !isSeries && item.model_type === 'title' && item.is_series === false) {
    // Some Filmbáze channels may still use title objects; for the series channel, allow them as series.
  }

  const name = clean(item.name);
  if (!name) return null;

  if (STRICT_MOVIE_FILTER && !item.poster) return null;

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

function dedupe(items) {
  const seen = new Set();

  return items.filter(item => {
    const key = String(`${item.type}-${item.id || `${item.name}-${item.year}`}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
