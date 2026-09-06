import crypto from 'crypto';

const USE_INDEXED_FALLBACK = String(process.env.USE_INDEXED_FALLBACK || 'true').toLowerCase() !== 'false';
const INDEXED_FALLBACK_MAX_ITEMS = Math.max(1, Number(process.env.INDEXED_FALLBACK_MAX_ITEMS || 30));
const INDEXED_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.INDEXED_SEARCH_MAX_QUERIES || 4));
const INDEXED_TIMEOUT_MS = Math.max(3000, Number(process.env.INDEXED_TIMEOUT_MS || 12000));

const JINA_API_KEY = String(process.env.JINA_API_KEY || '').trim();
const JINA_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.JINA_SEARCH_MAX_QUERIES || 2));
const JINA_TIMEOUT_MS = Math.max(5000, Number(process.env.JINA_TIMEOUT_MS || 30000));

const BRAVE_SEARCH_API_KEY = String(process.env.BRAVE_SEARCH_API_KEY || '').trim();
const BRAVE_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.BRAVE_SEARCH_MAX_QUERIES || 2));
const BRAVE_TIMEOUT_MS = Math.max(5000, Number(process.env.BRAVE_TIMEOUT_MS || 15000));

const SERPAPI_KEY = String(process.env.SERPAPI_KEY || '').trim();
const SERPAPI_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.SERPAPI_SEARCH_MAX_QUERIES || 1));
const SERPAPI_TIMEOUT_MS = Math.max(5000, Number(process.env.SERPAPI_TIMEOUT_MS || 20000));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function safeUrlForLog(url) {
  try {
    const u = new URL(url);
    for (const key of ['api_key', 'key', 'token']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, 'REDACTED');
    }
    return u.toString();
  } catch {
    return String(url);
  }
}

async function fetchText(url, headers = {}, timeoutMs = INDEXED_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FilmbazeCatalogRefresh/3.6.7)',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        ...headers
      }
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} from ${safeUrlForLog(url)}`);
      error.status = response.status;
      throw error;
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function isRateLimited(error) {
  return Number(error?.status || 0) === 429 || /\bHTTP 429\b/i.test(String(error?.message || error));
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

function getLocalPosterYear(value) {
  const text = String(value || '');
  const fullDate = text.match(/\b\d{1,2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*(19\d{2}|20\d{2})\b/);
  if (fullDate) return Number(fullDate[1]);
  const earlyYear = text.slice(0, 28).match(/\b(19\d{2}|20\d{2})\b/);
  return earlyYear ? Number(earlyYear[1]) : undefined;
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

  const hints = [];
  const regex = /Poster for\s+(.+?)(?=(?:\.\s+\d+(?:\.\d+)?\s*\/\s*10)|(?:\.\s+\d{1,2}\.\s*\d{1,2}\.\s*\d{4})|(?:\s+Poster for)|(?:\s*[·|]\s*)|$)/gi;
  const matches = [...raw.matchAll(regex)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const name = normalizeTitle(match[1]);
    if (!isUsableTitle(name)) continue;

    const start = match.index + match[0].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index : Math.min(raw.length, start + 120);
    const localAfter = raw.slice(start, Math.min(nextStart, start + 90));
    const year = getLocalPosterYear(localAfter);
    const hint = makeHint({ type, name, year, sourceUrl, evidence });
    if (hint) hints.push(hint);
  }

  return hints;
}

function parseLeadingHints(text, type, sourceUrl, evidence) {
  const raw = clean(text);
  const hints = [];
  const regex = /\b(19\d{2}|20\d{2})\.\s+(.+?)\s*[·|]\s*Poster for/gi;
  let match;
  while ((match = regex.exec(raw))) {
    const hint = makeHint({ type, name: match[2], year: Number(match[1]), sourceUrl, evidence });
    if (hint) hints.push(hint);
  }
  return hints;
}

function parseBeforePosterHints(text, type, sourceUrl, evidence) {
  const raw = clean(text);
  const hints = [];
  const regex = /(?:^|[.!?…]\s+|\s{2,})([^|·]{2,120}?)\s*[·|]\s*Poster for\s+/gi;
  let match;
  while ((match = regex.exec(raw))) {
    let name = clean(match[1]);
    name = name.replace(/^(?:Read more|Filmov[eé] novinky|Již brzy[^.!?]{0,80})\s*/i, '').trim();
    const year = getYear(name);
    name = normalizeTitle(name);
    const hint = makeHint({ type, name, year, sourceUrl, evidence });
    if (hint) hints.push(hint);
  }
  return hints;
}

function canonicalUrl(value) {
  try {
    const u = new URL(value);
    return {
      host: u.hostname.toLowerCase().replace(/^www\./, ''),
      path: (u.pathname.replace(/\/+$/, '') || '/').toLowerCase()
    };
  } catch {
    return null;
  }
}

function trustedIndexPage(link, sourceUrl, type, combinedText = '') {
  const a = canonicalUrl(link);
  const b = canonicalUrl(sourceUrl);
  if (!a || !b || a.host !== b.host) return false;
  if (a.path === b.path) return true;

  if (a.path === '/') {
    if (type === 'series') return /obl[ií]ben[eé]\s+seri[aá]ly|seri[aá]ly\s+v\s+č[eé]štin[eě]/i.test(combinedText);
    return /novinky\s+s\s+česk[ýy]m\s+dabingem|nov[eé]\s+filmy|česk[ýy]m\s+a\s+slovensk[ýy]m\s+dabingem/i.test(combinedText);
  }

  return false;
}

function parseTrustedSnippet({ title, link, description, type, sourceUrl, evidence }) {
  const combined = clean(`${title || ''} ${description || ''}`);
  if (!trustedIndexPage(link, sourceUrl, type, combined)) return [];
  return dedupeHints([
    ...parseLeadingHints(combined, type, sourceUrl, evidence),
    ...parseBeforePosterHints(combined, type, sourceUrl, evidence),
    ...parsePosterHints(combined, type, sourceUrl, evidence)
  ]);
}

export function parseBingRss(xml, type, sourceUrl) {
  const hints = [];
  const itemBlocks = String(xml || '').match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const title = xmlTag(block, 'title');
    const link = xmlTag(block, 'link');
    const description = xmlTag(block, 'description');
    hints.push(...parseTrustedSnippet({ title, link, description, type, sourceUrl, evidence: 'bing-rss-snippet' }));
  }
  return dedupeHints(hints).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
}

function decodeSearchRedirect(href) {
  const value = String(href || '').trim();
  if (!value) return '';
  try {
    const absolute = value.startsWith('//') ? `https:${value}` : value;
    const u = new URL(absolute, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : u.toString();
  } catch {
    return value;
  }
}

export function parseDuckDuckGoHtml(html, type, sourceUrl) {
  const hints = [];
  const raw = String(html || '');
  const regex = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\//gi;
  let match;
  while ((match = regex.exec(raw))) {
    const link = decodeSearchRedirect(decodeXml(match[1]));
    const title = clean(stripTags(match[2]));
    const description = clean(stripTags(match[3]));
    hints.push(...parseTrustedSnippet({ title, link, description, type, sourceUrl, evidence: 'duckduckgo-html-snippet' }));
  }
  return dedupeHints(hints).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
}

function jinaEntries(payload) {
  const out = [];
  const seen = new Set();
  const stack = [payload];
  while (stack.length) {
    const value = stack.shift();
    if (!value) continue;
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (typeof value !== 'object') continue;

    const url = value.url || value.link || value.sourceUrl || value.source_url || value?.source?.url || '';
    const title = value.title || value.name || '';
    const description = value.description || value.snippet || value.summary || '';
    const content = value.content || value.markdown || value.text || '';
    if (url || title || description || content) {
      const key = `${url}|${title}|${String(description).slice(0, 80)}|${String(content).slice(0, 80)}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ url: String(url), title: String(title), description: String(description), content: String(content) });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (['usage', 'tokens'].includes(key)) continue;
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return out;
}

export function parseJinaSearchJson(payload, type, sourceUrl) {
  const hints = [];
  for (const entry of jinaEntries(payload)) {
    if (!entry.url) continue;
    const variants = [entry.description, entry.content, clean(`${entry.description} ${entry.content}`)].filter(Boolean);
    for (const text of variants) {
      hints.push(...parseTrustedSnippet({
        title: entry.title,
        link: entry.url,
        description: text,
        type,
        sourceUrl,
        evidence: 'jina-search-json'
      }));
    }
  }
  return dedupeHints(hints).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
}

export function parseSerpApiSearchJson(payload, type, sourceUrl) {
  const hints = [];
  const results = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
  for (const result of results) {
    const url = String(result?.link || result?.redirect_link || '');
    if (!url) continue;
    const title = clean(stripTags(result?.title || ''));
    const snippets = [result?.snippet, result?.description].map(value => clean(stripTags(value || ''))).filter(Boolean);
    for (const snippet of snippets) {
      hints.push(...parseTrustedSnippet({
        title,
        link: url,
        description: snippet,
        type,
        sourceUrl,
        evidence: 'serpapi-google-snippet'
      }));
    }
  }
  return dedupeHints(hints).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
}

export function parseBraveSearchJson(payload, type, sourceUrl) {
  const hints = [];
  const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  for (const result of results) {
    const url = String(result?.url || '');
    if (!url) continue;
    const title = clean(stripTags(result?.title || ''));
    const snippets = [result?.description, ...(Array.isArray(result?.extra_snippets) ? result.extra_snippets : [])]
      .map(value => clean(stripTags(value || '')))
      .filter(Boolean);
    for (const snippet of snippets) {
      hints.push(...parseTrustedSnippet({
        title,
        link: url,
        description: snippet,
        type,
        sourceUrl,
        evidence: 'brave-search-snippet'
      }));
    }
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

export function indexedQueries(type, sourceUrl) {
  let host = 'filmbaze.cz';
  let path = '';
  try {
    const u = new URL(sourceUrl);
    host = u.hostname.replace(/^www\./, '');
    path = u.pathname.replace(/\/+$/, '');
  } catch {}
  const year = new Date().getUTCFullYear();
  const base = [`site:${host}${path}`, `"${sourceUrl}"`];
  if (type === 'series') {
    base.push(`site:${host} "Oblíbené seriály v češtině"`);
    base.push(`site:${host} "Oblíbené seriály" ${year}`);
  } else {
    base.push(`site:${host} "Novinky s českým dabingem"`);
    base.push(`site:${host} "Nové filmy" "českým dabingem" ${year}`);
  }
  return [...new Set(base)].slice(0, INDEXED_SEARCH_MAX_QUERIES);
}

export function serpApiQueries(type, sourceUrl) {
  let host = 'filmbaze.cz';
  try { host = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch {}
  if (type === 'series') {
    return [
      `"${sourceUrl}"`,
      `site:${host} "Oblíbené seriály v češtině" "Poster for"`,
      `site:${host} "Oblíbené seriály v češtině"`
    ];
  }
  return [
    `"${sourceUrl}"`,
    `site:${host} "Novinky s českým dabingem" "Poster for"`,
    `site:${host} "Novinky s českým dabingem"`
  ];
}

export function braveQueries(type, sourceUrl) {
  let host = 'filmbaze.cz';
  try { host = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch {}
  if (type === 'series') {
    return [`site:${host} "Oblíbené seriály v češtině"`, `"${sourceUrl}"`];
  }
  return [`site:${host} "Novinky s českým dabingem"`, `"${sourceUrl}"`];
}

export function jinaQueries(type, sourceUrl) {
  let host = 'filmbaze.cz';
  try { host = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch {}
  if (type === 'series') {
    return [
      `"${sourceUrl}"`,
      `"Oblíbené seriály v češtině" "Poster for"`
    ];
  }
  return [
    `"${sourceUrl}"`,
    `"Novinky s českým dabingem" "Poster for"`
  ];
}

async function fetchBingHints(type, sourceUrl, queries) {
  const items = [];
  const errors = [];
  let successfulQueries = 0;
  for (const query of queries) {
    try {
      const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
      const text = await fetchText(url, { Accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8' });
      successfulQueries += 1;
      items.push(...parseBingRss(text, type, sourceUrl));
      if (dedupeHints(items).length >= INDEXED_FALLBACK_MAX_ITEMS) break;
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
      if (isRateLimited(error)) break;
    }
  }
  return { items: dedupeHints(items), errors, successfulQueries, queries };
}

async function fetchDuckDuckGoHints(type, sourceUrl, queries) {
  const items = [];
  const errors = [];
  let successfulQueries = 0;
  const selected = queries.slice(0, 2);
  for (const query of selected) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const text = await fetchText(url, { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' });
      successfulQueries += 1;
      items.push(...parseDuckDuckGoHtml(text, type, sourceUrl));
      if (dedupeHints(items).length >= INDEXED_FALLBACK_MAX_ITEMS) break;
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
      if (isRateLimited(error)) break;
    }
  }
  return { items: dedupeHints(items), errors, successfulQueries, queries: selected };
}

export function parseJinaSearchText(text, type, sourceUrl) {
  const raw = String(text || '');
  if (!raw) return [];

  let sourcePath = '';
  let host = 'filmbaze.cz';
  try {
    const parsed = new URL(sourceUrl);
    sourcePath = parsed.pathname.replace(/\/+$/, '');
    host = parsed.hostname.replace(/^www\./, '');
  } catch {}

  const normalized = raw
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\"/g, '"');
  const lower = normalized.toLowerCase();
  const contexts = [];
  const needles = [sourceUrl, `${host}${sourcePath}`, sourcePath]
    .filter(Boolean)
    .map(value => String(value).toLowerCase());

  for (const needle of needles) {
    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      contexts.push(normalized.slice(Math.max(0, index - 900), Math.min(normalized.length, index + needle.length + 9000)));
      from = index + Math.max(needle.length, 1);
      if (contexts.length >= 10) break;
    }
    if (contexts.length >= 10) break;
  }

  const sectionMarker = type === 'series'
    ? /Obl[ií]ben[eé] seri[aá]ly v č[eé]štin[eě]|Obl[ií]ben[eé] seri[aá]ly/i
    : /Novinky s česk[ýy]m dabingem|Nov[eé] filmy na internetu s česk[ýy]m dabingem/i;

  if (!contexts.length) {
    const marker = normalized.match(sectionMarker);
    if (marker && typeof marker.index === 'number') {
      contexts.push(normalized.slice(Math.max(0, marker.index - 700), Math.min(normalized.length, marker.index + 9000)));
    }
  }

  const hints = [];
  for (const context of contexts) {
    const contextLower = context.toLowerCase();
    const exactPage = Boolean(sourcePath && contextLower.includes(sourcePath.toLowerCase()));
    const correctSection = sectionMarker.test(context);
    if (!exactPage && !correctSection) continue;

    hints.push(...parseLeadingHints(context, type, sourceUrl, 'jina-search-text'));
    hints.push(...parseBeforePosterHints(context, type, sourceUrl, 'jina-search-text'));
    hints.push(...parsePosterHints(context, type, sourceUrl, 'jina-search-text'));
  }

  return dedupeHints(hints).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
}

async function fetchJinaHints(type, sourceUrl) {
  if (!JINA_API_KEY) return { items: [], errors: [], successfulQueries: 0, queries: [] };
  const items = [];
  const errors = [];
  let successfulQueries = 0;
  const queries = jinaQueries(type, sourceUrl).slice(0, JINA_SEARCH_MAX_QUERIES);

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    try {
      const params = new URLSearchParams({ q: query });
      params.append('site', 'filmbaze.cz');
      const text = await fetchText(`https://s.jina.ai/?${params.toString()}`, {
        Authorization: `Bearer ${JINA_API_KEY}`,
        Accept: 'application/json',
        'X-Locale': 'cs-CZ',
        'X-Timeout': '30'
      }, JINA_TIMEOUT_MS);
      successfulQueries += 1;

      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      if (parsed) items.push(...parseJinaSearchJson(parsed, type, sourceUrl));
      items.push(...parseJinaSearchText(text, type, sourceUrl));

      if (dedupeHints(items).length >= Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) break;
      if (index + 1 < queries.length) await sleep(1100);
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
      if (isRateLimited(error)) break;
    }
  }
  return { items: dedupeHints(items), errors, successfulQueries, queries };
}

async function fetchBraveHints(type, sourceUrl) {
  if (!BRAVE_SEARCH_API_KEY) return { items: [], errors: [], successfulQueries: 0, queries: [] };
  const items = [];
  const errors = [];
  let successfulQueries = 0;
  const queries = braveQueries(type, sourceUrl).slice(0, BRAVE_SEARCH_MAX_QUERIES);
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    try {
      const params = new URLSearchParams({
        q: query,
        count: '20',
        country: 'CZ',
        search_lang: 'cs',
        safesearch: 'moderate',
        extra_snippets: 'true'
      });
      const text = await fetchText(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
        Accept: 'application/json',
        'X-Subscription-Token': BRAVE_SEARCH_API_KEY
      }, BRAVE_TIMEOUT_MS);
      successfulQueries += 1;
      items.push(...parseBraveSearchJson(JSON.parse(text), type, sourceUrl));
      if (dedupeHints(items).length >= Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) break;
      if (index + 1 < queries.length) await sleep(1100);
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
      if (isRateLimited(error)) break;
    }
  }
  return { items: dedupeHints(items), errors, successfulQueries, queries };
}

async function fetchSerpApiHints(type, sourceUrl) {
  if (!SERPAPI_KEY) return {
    items: [], errors: [], successfulQueries: 0, queries: [], responseBytes: 0, results: 0, resultSamples: []
  };

  const items = [];
  const errors = [];
  const resultSamples = [];
  let successfulQueries = 0;
  let responseBytes = 0;
  let resultCount = 0;
  const queries = serpApiQueries(type, sourceUrl).slice(0, SERPAPI_SEARCH_MAX_QUERIES);

  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        engine: 'google',
        q: query,
        api_key: SERPAPI_KEY,
        hl: 'cs',
        gl: 'cz',
        google_domain: 'google.cz',
        num: '20',
        safe: 'active'
      });
      const text = await fetchText(`https://serpapi.com/search.json?${params.toString()}`, {
        Accept: 'application/json'
      }, SERPAPI_TIMEOUT_MS);
      successfulQueries += 1;
      responseBytes += Buffer.byteLength(text, 'utf8');
      const parsed = JSON.parse(text);
      if (parsed?.error) throw new Error(`SerpAPI: ${String(parsed.error).slice(0, 300)}`);
      const results = Array.isArray(parsed?.organic_results) ? parsed.organic_results : [];
      resultCount += results.length;
      for (const result of results.slice(0, 6)) {
        if (resultSamples.length >= 10) break;
        resultSamples.push({
          title: clean(stripTags(result?.title || '')).slice(0, 120),
          url: String(result?.link || '').slice(0, 240),
          hasSnippet: Boolean(clean(stripTags(result?.snippet || result?.description || ''))),
          position: Number(result?.position || 0) || undefined
        });
      }
      items.push(...parseSerpApiSearchJson(parsed, type, sourceUrl));
      if (dedupeHints(items).length > 0) break;
    } catch (error) {
      errors.push(`${query}: ${String(error?.message || error).replace(/api_key=[^&\s]+/gi, 'api_key=REDACTED')}`);
      if (isRateLimited(error)) break;
    }
  }

  return { items: dedupeHints(items), errors, successfulQueries, queries, responseBytes, results: resultCount, resultSamples };
}

export async function fetchIndexedCatalogHints(type, sourceUrl) {
  if (!USE_INDEXED_FALLBACK) {
    return {
      items: [], used: false, providers: [], attemptedProviders: [], errors: [], queries: [],
      serpApiConfigured: Boolean(SERPAPI_KEY), serpApiResponseBytes: 0, serpApiResults: 0,
      serpApiSuccessfulQueries: 0, serpApiResultSamples: []
    };
  }

  const items = [];
  const providers = [];
  const attemptedProviders = [];
  const errors = [];
  const allQueries = [];
  const baseQueries = indexedQueries(type, sourceUrl);
  allQueries.push(...baseQueries);

  let serpApiResponseBytes = 0;
  let serpApiResults = 0;
  let serpApiSuccessfulQueries = 0;
  const serpApiResultSamples = [];

  // Start with keyless public indexes. They cost nothing and avoid burning paid
  // provider quota every day while WEDOS rejects GitHub-hosted source requests.
  const bing = await fetchBingHints(type, sourceUrl, baseQueries);
  attemptedProviders.push('bing-rss');
  errors.push(...bing.errors.map(error => `bing-rss: ${error}`));
  if (bing.items.length) {
    providers.push('bing-rss');
    items.push(...bing.items);
  }

  if (dedupeHints(items).length < Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) {
    const ddg = await fetchDuckDuckGoHints(type, sourceUrl, baseQueries);
    attemptedProviders.push('duckduckgo-html');
    errors.push(...ddg.errors.map(error => `duckduckgo-html: ${error}`));
    if (ddg.items.length) {
      providers.push('duckduckgo-html');
      items.push(...ddg.items);
    }
  }

  // Jina Search and Brave Search were already implemented in the repository but
  // were never called. Use them before SerpAPI when keys are configured.
  if (JINA_API_KEY && dedupeHints(items).length < Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) {
    const jina = await fetchJinaHints(type, sourceUrl);
    attemptedProviders.push('jina-search');
    allQueries.push(...jina.queries);
    errors.push(...jina.errors.map(error => `jina-search: ${error}`));
    if (jina.items.length) {
      providers.push('jina-search');
      items.push(...jina.items);
    }
  }

  if (BRAVE_SEARCH_API_KEY && dedupeHints(items).length < Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) {
    const brave = await fetchBraveHints(type, sourceUrl);
    attemptedProviders.push('brave-search');
    allQueries.push(...brave.queries);
    errors.push(...brave.errors.map(error => `brave-search: ${error}`));
    if (brave.items.length) {
      providers.push('brave-search');
      items.push(...brave.items);
    }
  }

  // SerpAPI is last because an exhausted account currently returns 429. One 429
  // stops this provider immediately so a daily run does not waste more requests.
  if (SERPAPI_KEY && dedupeHints(items).length < Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) {
    const serp = await fetchSerpApiHints(type, sourceUrl);
    attemptedProviders.push('serpapi-google');
    allQueries.push(...serp.queries);
    serpApiResponseBytes += Number(serp.responseBytes || 0);
    serpApiResults += Number(serp.results || 0);
    serpApiSuccessfulQueries += Number(serp.successfulQueries || 0);
    serpApiResultSamples.push(...(serp.resultSamples || []));
    errors.push(...serp.errors.map(error => `serpapi-google: ${error}`));
    if (serp.items.length) {
      providers.push('serpapi-google');
      items.push(...serp.items);
    }
  }

  const finalItems = dedupeHints(items).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
  return {
    items: finalItems,
    used: finalItems.length > 0,
    providers: [...new Set(providers)],
    attemptedProviders: [...new Set(attemptedProviders)],
    errors,
    queries: [...new Set(allQueries)],
    serpApiConfigured: Boolean(SERPAPI_KEY),
    serpApiResponseBytes,
    serpApiResults,
    serpApiSuccessfulQueries,
    serpApiResultSamples: serpApiResultSamples.slice(0, 10),
    jinaConfigured: Boolean(JINA_API_KEY),
    braveConfigured: Boolean(BRAVE_SEARCH_API_KEY)
  };
}
