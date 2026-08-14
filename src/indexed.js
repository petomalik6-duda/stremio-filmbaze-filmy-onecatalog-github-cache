import crypto from 'crypto';

const USE_INDEXED_FALLBACK = String(process.env.USE_INDEXED_FALLBACK || 'true').toLowerCase() !== 'false';
const INDEXED_FALLBACK_MAX_ITEMS = Math.max(1, Number(process.env.INDEXED_FALLBACK_MAX_ITEMS || 20));
const JINA_API_KEY = String(process.env.JINA_API_KEY || '').trim();
const INDEXED_TIMEOUT_MS = Math.max(3000, Number(process.env.INDEXED_TIMEOUT_MS || 12000));

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function stripTags(value) {
  return decodeXml(String(value || '')).replace(/<[^>]+>/g, ' ');
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function xmlTag(block, tag) {
  const match = String(block || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? clean(stripTags(match[1])) : '';
}

async function fetchText(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXED_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FilmbazeCatalogRefresh/3.6.0)',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        ...headers
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTitle(value) {
  return clean(value)
    .replace(/^Poster for\s+/i, '')
    .replace(/\s+\(\d{4}\)\s*$/i, '')
    .replace(/\s+[\d.]+\s*\/\s*10\s*$/i, '')
    .replace(/\s+\d{1,3}\s*%\s*$/i, '')
    .replace(/[.·,:;]+$/g, '')
    .trim();
}

function getYear(value) {
  const match = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function stableSyntheticId(type, name, year) {
  const hash = crypto.createHash('sha1').update(`${type}|${name}|${year || ''}`).digest('hex').slice(0, 14);
  return `indexed-${type}-${hash}`;
}

function isUsableTitle(value) {
  const title = normalizeTitle(value);
  if (!title || title.length < 2 || title.length > 140) return false;
  if (/filmb[aá]ze|nov[eé] filmy|česk(ý|ym) dabing|obl[ií]ben[eé] seri[aá]ly|copyright|read more/i.test(title)) return false;
  if (/^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}$/.test(title)) return false;
  return true;
}

function makeHint({ type, name, year, filmbazeId = null, filmbazeUrl = null, sourceUrl, evidence }) {
  const safeName = normalizeTitle(name);
  if (!isUsableTitle(safeName)) return null;

  const safeYear = Number(year) || undefined;
  const id = filmbazeId ? String(filmbazeId) : stableSyntheticId(type, safeName, safeYear);
  const now = new Date().toISOString().slice(0, 10);

  return {
    source: 'Filmbáze-indexed',
    id,
    name: safeName,
    type,
    year: safeYear,
    releaseDate: safeYear ? `${safeYear}-01-01` : null,
    poster: null,
    background: null,
    rating: undefined,
    runtime: undefined,
    description: '',
    status: '',
    certification: '',
    dateAdded: now,
    lang: type === 'series' ? 'CZ' : 'CZ/SK',
    primaryVideo: null,
    sourceUrl,
    filmbazeUrl,
    indexedFallback: true,
    indexedEvidence: evidence || 'public-search-index'
  };
}

function parsePosterHints(text, type, sourceUrl, evidence) {
  const raw = clean(text);
  if (!raw) return [];

  const commonYear = getYear(raw) || new Date().getUTCFullYear();
  const hints = [];
  const regex = /Poster for\s+(.+?)(?=(?:\.\s+\d+(?:\.\d+)?\s*\/\s*10)|(?:\.\s+\d{1,2}\.\s*\d{1,2}\.\s*\d{4})|(?:\s+Poster for)|(?:\s*[·|]\s*)|$)/gi;
  let match;

  while ((match = regex.exec(raw))) {
    const name = normalizeTitle(match[1]);
    if (!isUsableTitle(name)) continue;

    const after = raw.slice(match.index, match.index + match[0].length + 120);
    const year = getYear(after) || commonYear;
    const hint = makeHint({ type, name, year, sourceUrl, evidence });
    if (hint) hints.push(hint);
  }

  return hints;
}

function sameSourcePage(link, sourceUrl) {
  try {
    const a = new URL(link);
    const b = new URL(sourceUrl);
    const norm = path => path.replace(/\/+$/, '') || '/';
    return a.hostname.toLowerCase().replace(/^www\./, '') === b.hostname.toLowerCase().replace(/^www\./, '')
      && norm(a.pathname) === norm(b.pathname);
  } catch {
    return false;
  }
}

function parseLeadingHint(text, type, sourceUrl, evidence) {
  const raw = clean(text);
  const match = raw.match(/\b(19\d{2}|20\d{2})\.\s+(.+?)\s*[·|]\s*Poster for/i);
  if (!match) return [];
  const hint = makeHint({ type, name: match[2], year: Number(match[1]), sourceUrl, evidence });
  return hint ? [hint] : [];
}

export function parseBingRss(xml, type, sourceUrl) {
  const hints = [];
  const itemBlocks = String(xml || '').match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const block of itemBlocks) {
    const title = xmlTag(block, 'title');
    const link = xmlTag(block, 'link');
    const description = xmlTag(block, 'description');

    // Only trust a snippet for the actual Filmbáze catalogue page.
    if (!sameSourcePage(link, sourceUrl)) continue;

    const combined = `${title} ${description}`;
    hints.push(...parseLeadingHint(combined, type, sourceUrl, 'bing-rss-source-snippet'));
    hints.push(...parsePosterHints(combined, type, sourceUrl, 'bing-rss-source-snippet'));
  }

  return dedupeHints(hints).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
}

export function parseJinaSearch(text, type, sourceUrl) {
  const raw = String(text || '');
  const hints = [];
  const escaped = sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...raw.matchAll(new RegExp(escaped, 'gi'))];

  for (const match of matches) {
    const context = raw.slice(Math.max(0, match.index - 500), match.index + sourceUrl.length + 1800);
    hints.push(...parseLeadingHint(context, type, sourceUrl, 'jina-search-source-snippet'));
    hints.push(...parsePosterHints(context, type, sourceUrl, 'jina-search-source-snippet'));
  }

  return dedupeHints(hints).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
}

function dedupeHints(items) {
  const seenIds = new Set();
  const seenTitleYears = new Set();
  const out = [];

  for (const item of items || []) {
    if (!item) continue;
    const idKey = `${item.type}:${item.id}`.toLowerCase();
    const titleKey = `${item.type}:${normalizeTitle(item.name).toLowerCase()}:${item.year || ''}`;
    if (seenIds.has(idKey) || seenTitleYears.has(titleKey)) continue;
    seenIds.add(idKey);
    seenTitleYears.add(titleKey);
    out.push(item);
  }

  return out;
}

function bingQuery(type) {
  return type === 'series'
    ? 'site:filmbaze.cz "Oblíbené seriály" "Poster for"'
    : 'site:filmbaze.cz "Nové filmy na internetu s českým dabingem" "Poster for"';
}

async function fetchBingHints(type, sourceUrl) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(bingQuery(type))}`;
  const text = await fetchText(url, {
    Accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'
  });
  return parseBingRss(text, type, sourceUrl);
}

async function fetchJinaHints(type, sourceUrl) {
  if (!JINA_API_KEY) return [];
  const url = `https://s.jina.ai/?q=${encodeURIComponent(bingQuery(type))}`;
  const text = await fetchText(url, {
    Authorization: `Bearer ${JINA_API_KEY}`,
    Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8'
  });
  return parseJinaSearch(text, type, sourceUrl);
}

export async function fetchIndexedCatalogHints(type, sourceUrl) {
  if (!USE_INDEXED_FALLBACK) {
    return { items: [], used: false, providers: [], errors: [] };
  }

  const providers = [];
  const errors = [];
  const items = [];

  if (JINA_API_KEY) {
    try {
      const jina = await fetchJinaHints(type, sourceUrl);
      if (jina.length) {
        providers.push('jina-search');
        items.push(...jina);
      }
    } catch (error) {
      errors.push(`jina-search: ${error.message}`);
    }
  }

  try {
    const bing = await fetchBingHints(type, sourceUrl);
    if (bing.length) {
      providers.push('bing-rss');
      items.push(...bing);
    }
  } catch (error) {
    errors.push(`bing-rss: ${error.message}`);
  }

  return {
    items: dedupeHints(items).slice(0, INDEXED_FALLBACK_MAX_ITEMS),
    used: items.length > 0,
    providers,
    errors
  };
}
