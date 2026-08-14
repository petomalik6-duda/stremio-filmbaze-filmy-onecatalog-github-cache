import crypto from 'crypto';

const USE_INDEXED_FALLBACK = String(process.env.USE_INDEXED_FALLBACK || 'true').toLowerCase() !== 'false';
const INDEXED_FALLBACK_MAX_ITEMS = Math.max(1, Number(process.env.INDEXED_FALLBACK_MAX_ITEMS || 30));
const INDEXED_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.INDEXED_SEARCH_MAX_QUERIES || 4));
const JINA_API_KEY = String(process.env.JINA_API_KEY || '').trim();
const JINA_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.JINA_SEARCH_MAX_QUERIES || 2));
const INDEXED_TIMEOUT_MS = Math.max(3000, Number(process.env.INDEXED_TIMEOUT_MS || 12000));
const JINA_TIMEOUT_MS = Math.max(5000, Number(process.env.JINA_TIMEOUT_MS || 30000));

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

async function fetchText(url, headers = {}, timeoutMs = INDEXED_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FilmbazeCatalogRefresh/3.6.3)',
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
  // Search snippets often expose the first visible title as
  // "Zvukař · Poster for Dalloway" rather than "Poster for Zvukař".
  // Treat only the short phrase immediately before "Poster for" as a title.
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

  // Filmbáze home page exposes the same newest-movie / popular-series windows
  // and is frequently indexed more recently than the dedicated channel page.
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

function jinaResultEntries(payload) {
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
    const content = value.content || value.markdown || value.description || value.text || value.snippet || '';
    if (url || title || content) {
      const key = `${url}|${title}|${String(content).slice(0, 100)}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ url: String(url || ''), title: String(title || ''), content: String(content || '') });
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
  const entries = jinaResultEntries(payload);

  for (const entry of entries) {
    const combined = clean(`${entry.title} ${entry.content}`);
    if (!entry.url) continue;
    hints.push(...parseTrustedSnippet({
      title: entry.title,
      link: entry.url,
      description: entry.content,
      type,
      sourceUrl,
      evidence: 'jina-search-json'
    }));

    // Some Jina JSON responses put the whole page in content while title is
    // generic. For the exact channel/home page, parse the content directly too.
    if (trustedIndexPage(entry.url, sourceUrl, type, combined)) {
      hints.push(...parseLeadingHints(entry.content, type, sourceUrl, 'jina-search-json-content'));
      hints.push(...parseBeforePosterHints(entry.content, type, sourceUrl, 'jina-search-json-content'));
      hints.push(...parsePosterHints(entry.content, type, sourceUrl, 'jina-search-json-content'));
    }
  }

  return dedupeHints(hints).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
}

export function parseJinaSearch(text, type, sourceUrl) {
  const raw = String(text || '');
  const hints = [];
  const contexts = [];

  // s.jina.ai returns the top results with URLs and their extracted content.
  // Capture contexts around either the full channel URL or just its path because
  // markdown renderers may normalize the scheme/host representation.
  let channelPath = '';
  try { channelPath = new URL(sourceUrl).pathname.replace(/\/+$/, ''); } catch {}
  const needles = [sourceUrl, channelPath].filter(Boolean);

  for (const needle of needles) {
    let from = 0;
    while (true) {
      const index = raw.toLowerCase().indexOf(String(needle).toLowerCase(), from);
      if (index < 0) break;
      contexts.push(raw.slice(Math.max(0, index - 900), Math.min(raw.length, index + String(needle).length + 6500)));
      from = index + String(needle).length;
      if (contexts.length >= 8) break;
    }
    if (contexts.length >= 8) break;
  }

  // Some search responses omit the literal URL but include the channel heading.
  if (!contexts.length) {
    const marker = type === 'series'
      ? /Obl[ií]ben[eé] seri[aá]ly v č[eé]štin[eě]|Obl[ií]ben[eé] seri[aá]ly/i
      : /Novinky s česk[ýy]m dabingem|Nov[eé] filmy na internetu s česk[ýy]m dabingem/i;
    const match = raw.match(marker);
    if (match && typeof match.index === 'number') {
      contexts.push(raw.slice(Math.max(0, match.index - 700), Math.min(raw.length, match.index + 7000)));
    }
  }

  for (const context of contexts) {
    hints.push(...parseLeadingHints(context, type, sourceUrl, 'jina-search-source-content'));
    hints.push(...parseBeforePosterHints(context, type, sourceUrl, 'jina-search-source-content'));
    hints.push(...parsePosterHints(context, type, sourceUrl, 'jina-search-source-content'));
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

export function jinaQueries(type, sourceUrl) {
  let host = 'filmbaze.cz';
  try { host = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch {}

  if (type === 'series') {
    return [
      `site:${host} "Oblíbené seriály v češtině"`,
      `site:${host} "Oblíbené seriály"`,
      `"${sourceUrl}"`
    ];
  }

  return [
    `site:${host} "Novinky s českým dabingem"`,
    `site:${host} "Nové filmy na internetu s českým dabingem"`,
    `"${sourceUrl}"`
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
    }
  }

  return { items: dedupeHints(items), errors, successfulQueries };
}

async function fetchDuckDuckGoHints(type, sourceUrl, queries) {
  const items = [];
  const errors = [];
  let successfulQueries = 0;

  // Two DDG queries are enough as a secondary provider and keep public-search load low.
  for (const query of queries.slice(0, 2)) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const text = await fetchText(url, { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' });
      successfulQueries += 1;
      items.push(...parseDuckDuckGoHtml(text, type, sourceUrl));
      if (dedupeHints(items).length >= INDEXED_FALLBACK_MAX_ITEMS) break;
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
    }
  }

  return { items: dedupeHints(items), errors, successfulQueries };
}

async function fetchJinaHints(type, sourceUrl) {
  if (!JINA_API_KEY) return { items: [], errors: [], successfulQueries: 0, queries: [], responseBytes: 0, jsonResults: 0 };
  const items = [];
  const errors = [];
  let successfulQueries = 0;
  let responseBytes = 0;
  let jsonResults = 0;
  const queries = jinaQueries(type, sourceUrl).slice(0, JINA_SEARCH_MAX_QUERIES);

  for (const query of queries) {
    try {
      // Current Jina Reader/Search docs support ?q= and JSON output. JSON is
      // considerably more stable than parsing the rendered markdown wrapper.
      const url = `https://s.jina.ai/?q=${encodeURIComponent(query)}`;
      const text = await fetchText(url, {
        Authorization: `Bearer ${JINA_API_KEY}`,
        Accept: 'application/json',
        'X-No-Cache': 'true',
        'X-Timeout': '30'
      }, JINA_TIMEOUT_MS);
      successfulQueries += 1;
      responseBytes += Buffer.byteLength(text, 'utf8');

      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      if (parsed) {
        const entries = jinaResultEntries(parsed);
        jsonResults += entries.length;
        items.push(...parseJinaSearchJson(parsed, type, sourceUrl));
      } else {
        // Backward compatibility if Jina returns markdown/text despite Accept.
        items.push(...parseJinaSearch(text, type, sourceUrl));
      }

      // One trusted Filmbáze channel/home result is enough. Try the second Jina
      // query only if the first produced no usable catalog hint.
      if (dedupeHints(items).length > 0) break;
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
    }
  }

  return { items: dedupeHints(items), errors, successfulQueries, queries, responseBytes, jsonResults };
}

export async function fetchIndexedCatalogHints(type, sourceUrl) {
  if (!USE_INDEXED_FALLBACK) {
    return { items: [], used: false, providers: [], attemptedProviders: [], errors: [], queries: [], jinaConfigured: Boolean(JINA_API_KEY), jinaResponseBytes: 0, jinaJsonResults: 0, jinaSuccessfulQueries: 0 };
  }

  const queries = indexedQueries(type, sourceUrl);
  const providers = [];
  const attemptedProviders = [];
  const errors = [];
  const items = [];
  let jinaResponseBytes = 0;
  let jinaJsonResults = 0;
  let jinaSuccessfulQueries = 0;

  // API-backed search is preferred when configured. Unlike scraping a public
  // search HTML page, s.jina.ai has a documented authenticated API contract.
  if (JINA_API_KEY) {
    const jina = await fetchJinaHints(type, sourceUrl);
    attemptedProviders.push('jina-search');
    jinaResponseBytes += Number(jina.responseBytes || 0);
    jinaJsonResults += Number(jina.jsonResults || 0);
    jinaSuccessfulQueries += Number(jina.successfulQueries || 0);
    errors.push(...jina.errors.map(error => `jina-search: ${error}`));
    if (jina.items.length) {
      providers.push('jina-search');
      items.push(...jina.items);
    }
    // Keep provider diagnostics even when parsing yields zero hints.
    if (jina.queries?.length) queries.push(...jina.queries);
  }

  // Keep no-key providers as best-effort secondary discovery only.
  if (dedupeHints(items).length < Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) {
    const bing = await fetchBingHints(type, sourceUrl, queries);
    attemptedProviders.push('bing-rss');
    errors.push(...bing.errors.map(error => `bing-rss: ${error}`));
    if (bing.items.length) {
      providers.push('bing-rss');
      items.push(...bing.items);
    }
  }

  if (dedupeHints(items).length < Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) {
    const ddg = await fetchDuckDuckGoHints(type, sourceUrl, queries);
    attemptedProviders.push('duckduckgo-html');
    errors.push(...ddg.errors.map(error => `duckduckgo-html: ${error}`));
    if (ddg.items.length) {
      providers.push('duckduckgo-html');
      items.push(...ddg.items);
    }
  }

  const finalItems = dedupeHints(items).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
  return {
    items: finalItems,
    used: finalItems.length > 0,
    providers: [...new Set(providers)],
    attemptedProviders: [...new Set(attemptedProviders)],
    errors,
    queries,
    jinaConfigured: Boolean(JINA_API_KEY),
    jinaResponseBytes,
    jinaJsonResults,
    jinaSuccessfulQueries
  };
}
