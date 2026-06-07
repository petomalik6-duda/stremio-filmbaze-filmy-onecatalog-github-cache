import crypto from 'crypto';
import { getWithRetry } from './http.js';
import * as cheerio from 'cheerio';

export const MOVIES_SOURCE_URL = process.env.MOVIES_SOURCE_URL || 'https://www.filmbaze.cz/novinky-s-ceskym-dabingem-na-netu';
export const SERIES_SOURCE_URL = process.env.SERIES_SOURCE_URL || '';

const UA = 'Mozilla/5.0 (compatible; StremioFilmbazeAddon/1.0; +https://www.stremio.com/)';
const USE_READER_FALLBACK = String(process.env.USE_READER_FALLBACK || 'true').toLowerCase() !== 'false';
const STRICT_MOVIE_FILTER = String(process.env.STRICT_MOVIE_FILTER || 'true').toLowerCase() !== 'false';
const REQUIRE_YEAR_FOR_LOCAL_ITEMS = String(process.env.REQUIRE_YEAR_FOR_LOCAL_ITEMS || 'true').toLowerCase() !== 'false';

function absUrl(href, base) { if (!href) return null; try { return new URL(href, base).toString(); } catch { return null; } }
function clean(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function today() { return new Date().toISOString().slice(0, 10); }
function readerUrl(url) {
  // Correct Jina Reader format. It expects original URL after https://r.jina.ai/http://r.jina.ai/http:// is NOT valid.
  // For https://example.com/path => https://r.jina.ai/http://r.jina.ai/http://example.com/path would fail with 422.
  return `https://r.jina.ai/http://r.jina.ai/http://${url}`;
}

function parseDate(text) {
  const t = clean(text);
  let m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return null;
}

function langFromText(text) {
  const t = String(text || '');
  if (/slovensk[ýy]\s+dabing|sk\s+dabing|\(SK\)/i.test(t)) return 'SK';
  if (/cz\/sk|sk\/cz/i.test(t)) return 'CZ/SK';
  return 'CZ';
}

export function itemKey(item) {
  return `${item.type}|${item.name}|${item.originalName || ''}|${item.year}|${item.lang}`.toLowerCase();
}

function isProbablyNotMovieLine(text) {
  const t = clean(text).toLowerCase();
  if (!t || t.length < 3 || t.length > 240) return true;
  const badPatterns = [
    /cookie/, /reklama/, /newsletter/, /facebook|instagram|youtube|tiktok/,
    /kontakt/, /podmínky|podmienky/, /ochrana osobních údajů|ochrana osobných údajov/,
    /přihláš|prihlás/, /registr/, /menu/, /domů|domov/,
    /skip to/, /komentář|komentár/, /diskuse|diskusia/, /zdroj:/,
    /tagy:/, /kategorie:|kategórie:/, /sdílet|zdieľať/,
    /pokračovat|pokračovať/, /filmbaze\.cz/,
    /novinky s českým dabingem/, /filmy online/, /seriály/,
    /streamovací služby/, /netflix|disney\+|prime video|hbo max|apple tv/
  ];
  return badPatterns.some(rx => rx.test(t));
}

function hasMovieShape(text) {
  const t = clean(text);
  const hasYear = /\((19\d{2}|20\d{2})\)/.test(t) || /\b(19\d{2}|20\d{2})\b/.test(t);
  if (REQUIRE_YEAR_FOR_LOCAL_ITEMS && !hasYear) return false;
  return true;
}

function isBadParsedTitle(name) {
  const n = clean(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!n || n.length < 2 || n.length > 120) return true;
  const bad = ['cz','sk','cz sk','dabing','titulky','nove filmy','filmbaze','filmy online','serialy','netflix','disney','prime video','hbo','max','komentar','reklama','menu'];
  return bad.some(x => n === x || n.startsWith(x + ' '));
}

function parseTitleParts(raw) {
  let t = clean(raw)
    .replace(/^[-*•\s]+/g, '')
    .replace(/\s+\|\s*Filmbáze.*$/i, '')
    .replace(/\s+-\s*Filmbáze.*$/i, '')
    .replace(/novinky s českým dabingem/ig, '')
    .replace(/český dabing|cesky dabing|cz dabing|slovenský dabing|sk dabing/ig, '')
    .trim();

  const yearMatch = t.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : '';

  let name = t
    .replace(/\((19\d{2}|20\d{2})\)/g, '')
    .replace(/\b(19\d{2}|20\d{2})\b/g, '')
    .replace(/\((CZ\/SK|SK\/CZ|CZ|SK)\)/ig, '')
    .replace(/\s+-\s*(Netflix|Apple TV\+?|Prime Video|Disney\+?|HBO|Max).*$/i, '')
    .replace(/\s+IMDb\s+.*$/i, '')
    .replace(/\s+ČSFD\s+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const [local, ...rest] = name.split('/').map(s => clean(s)).filter(Boolean);
  return { name: local || name, originalName: rest.join(' / '), year, lang: langFromText(raw), type: 'movie' };
}

function readerUrls(url) {
  const noScheme = String(url).replace(/^https?:\/\//i, '');
  return [
    `https://r.jina.ai/http://r.jina.ai/http://${noScheme}`,
    `https://r.jina.ai/http://r.jina.ai/http://https://${noScheme}`
  ];
}

async function fetchPage(url) {
  const urls = [
    url,
    url.replace('https://www.filmbaze.cz/', 'https://filmbaze.cz/'),
    url.replace('https://filmbaze.cz/', 'https://www.filmbaze.cz/')
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);

  let lastError = null;

  for (const directUrl of urls) {
    console.log('[scrape] fetching direct', directUrl);
    try {
      const { data } = await getWithRetry(directUrl, { headers: { 'User-Agent': UA } });
      console.log('[scrape] direct fetched', directUrl, 'bytes=', String(data || '').length);
      return { data, mode: 'direct', url: directUrl };
    } catch (e) {
      lastError = e;
      console.error('[scrape] direct failed:', directUrl, e.message);
    }
  }

  if (!USE_READER_FALLBACK) throw lastError;

  for (const sourceUrl of urls) {
    for (const fallback of readerUrls(sourceUrl)) {
      console.log('[scrape] fetching reader fallback', fallback);
      try {
        const { data } = await getWithRetry(fallback, { headers: { 'User-Agent': UA } });
        console.log('[scrape] reader fetched bytes=', String(data || '').length);
        return { data, mode: 'reader', url: fallback };
      } catch (e) {
        lastError = e;
        console.error('[scrape] reader failed:', fallback, e.message);
      }
    }
  }

  throw lastError;
}

function extractLinks($, el, baseUrl) {
  return $(el).find('a').map((_j, a) => absUrl($(a).attr('href'), baseUrl)).get().filter(Boolean);
}
function safeHost(url) { try { return new URL(url).hostname; } catch { return ''; } }
function findPoster($, el, baseUrl) {
  const img = $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('data-lazy-src') || $(el).find('img').first().attr('src');
  return img ? absUrl(img, baseUrl) : null;
}

function makeMovieItemFromText(text, currentDate, sourceUrl = MOVIES_SOURCE_URL) {
  if (STRICT_MOVIE_FILTER && (isProbablyNotMovieLine(text) || !hasMovieShape(text))) return null;
  const parts = parseTitleParts(text);
  if (!parts.name || parts.name.length < 2 || parts.name.length > 150 || isBadParsedTitle(parts.name)) return null;
  const item = { titleRaw: clean(text), ...parts, type: 'movie', dateAdded: currentDate || parseDate(text) || today(), sourceUrl, detailUrl: null, csfdUrl: null, imdbUrl: null, poster: null, links: [] };
  item.key = itemKey(item);
  return item;
}

function makeMovieItem($, el, text, currentDate, baseUrl) {
  const links = extractLinks($, el, baseUrl);
  const csfdUrl = links.find(href => /(^|\.)csfd\.(cz|sk)/i.test(safeHost(href))) || null;
  const imdbUrl = links.find(href => /(^|\.)imdb\.com/i.test(safeHost(href))) || null;
  const detailUrl = links.find(href => /filmbaze\.cz/i.test(safeHost(href))) || links.find(Boolean) || null;
  const item = makeMovieItemFromText(text, currentDate, baseUrl);
  if (!item) return null;
  item.csfdUrl = csfdUrl;
  item.imdbUrl = imdbUrl;
  item.detailUrl = detailUrl;
  item.poster = findPoster($, el, baseUrl);
  item.links = links;
  return item;
}

function parseTextList(rawText, sourceUrl) {
  const lines = String(rawText || '').split(/\r?\n/).map(line => clean(line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'))).filter(Boolean);
  const items = [];
  let currentDate = null;
  for (const line of lines) {
    const date = parseDate(line);
    if (date && line.length < 80) { currentDate = date; continue; }
    const item = makeMovieItemFromText(line, currentDate, sourceUrl);
    if (item) items.push(item);
  }
  return unique(items);
}

export async function scrapeMovies(maxItems = 1000) {
  const { data, mode } = await fetchPage(MOVIES_SOURCE_URL);
  const raw = String(data || '');
  let items = [];
  if (mode === 'reader' || !/<html|<body|<li|<article/i.test(raw)) {
    items = parseTextList(raw, MOVIES_SOURCE_URL);
  } else {
    const $ = cheerio.load(raw);
    let currentDate = null;
    const selectors = ['article','.post','.entry','.item','.movie','.film','.card','li','h2','h3'].join(',');
    $(selectors).each((_i, el) => {
      const tag = el.tagName?.toLowerCase();
      const text = clean($(el).text());
      const maybeDate = parseDate(text);
      if ((tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') && maybeDate) currentDate = maybeDate;
      const item = makeMovieItem($, el, text, currentDate, MOVIES_SOURCE_URL);
      if (item) items.push(item);
    });
    if (items.length === 0) items = parseTextList($.text(), MOVIES_SOURCE_URL);
  }
  items = unique(items).slice(0, maxItems).map((x, i) => ({ ...x, type: 'movie', order: i }));
  const sourceHash = crypto.createHash('sha1').update(items.map(i => i.key).join('|') || raw).digest('hex');
  console.log('[scrape] filmbaze movies items=', items.length, 'mode=', mode);
  return { sourceUrl: MOVIES_SOURCE_URL, sourceHash, items };
}

export async function scrapeSeries(_maxItems = 0) {
  console.log('[scrape] series disabled');
  return { sourceUrl: SERIES_SOURCE_URL, sourceHash: '', items: [] };
}

function unique(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item?.key || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

export async function scrapeFilmovenovinky(maxItems = 1000) {
  const moviesResult = await scrapeMovies(maxItems);
  const sourceHash = crypto.createHash('sha1').update(`${moviesResult.sourceHash}|filmbaze`).digest('hex');
  return { sourceUrl: MOVIES_SOURCE_URL, sourceHash, items: moviesResult.items };
}
