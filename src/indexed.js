import crypto from 'crypto';

const USE_INDEXED_FALLBACK = String(process.env.USE_INDEXED_FALLBACK || 'true').toLowerCase() !== 'false';
const INDEXED_FALLBACK_MAX_ITEMS = Math.max(1, Number(process.env.INDEXED_FALLBACK_MAX_ITEMS || 30));
const INDEXED_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.INDEXED_SEARCH_MAX_QUERIES || 4));
const JINA_API_KEY = String(process.env.JINA_API_KEY || '').trim();
const JINA_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.JINA_SEARCH_MAX_QUERIES || 2));
const BRAVE_SEARCH_API_KEY = String(process.env.BRAVE_SEARCH_API_KEY || '').trim();
const BRAVE_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.BRAVE_SEARCH_MAX_QUERIES || 2));
const INDEXED_TIMEOUT_MS = Math.max(3000, Number(process.env.INDEXED_TIMEOUT_MS || 12000));
const JINA_TIMEOUT_MS = Math.max(5000, Number(process.env.JINA_TIMEOUT_MS || 30000));
const BRAVE_TIMEOUT_MS = Math.max(5000, Number(process.env.BRAVE_TIMEOUT_MS || 15000));
const SERPAPI_KEY = String(process.env.SERPAPI_KEY || '').trim();
const SERPAPI_SEARCH_MAX_QUERIES = Math.max(1, Number(process.env.SERPAPI_SEARCH_MAX_QUERIES || 2));
const SERPAPI_TIMEOUT_MS = Math.max(5000, Number(process.env.SERPAPI_TIMEOUT_MS || 20000));

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
        'User-Agent': 'Mozilla/5.0 (compatible; FilmbazeCatalogRefresh/3.6.6)',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        ...headers
      }
    });
    if (!response.ok) {
      let safeUrl = String(url);
      try {
        const u = new URL(url);
        for (const key of ['api_key', 'key', 'token']) if (u.searchParams.has(key)) u.searchParams.set(key, 'REDACTED');
        safeUrl = u.toString();
      } catch {}
      throw new Error(`HTTP ${response.status} from ${safeUrl}`);
    }
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
    // Jina Search JSON can expose the SERP snippet in `description` while the
    // fetched page body is in `content`.  Keep BOTH: in 3.6.3 we preferred
    // content and silently discarded the useful description, which could turn
    // valid search results into zero catalog hints.
    const description = value.description || value.snippet || value.summary || '';
    const content = value.content || value.markdown || value.text || '';
    if (url || title || description || content) {
      const key = `${url}|${title}|${String(description).slice(0, 80)}|${String(content).slice(0, 80)}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          url: String(url || ''),
          title: String(title || ''),
          description: String(description || ''),
          content: String(content || '')
        });
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
    if (!entry.url) continue;

    // Parse SERP description and fetched content independently.  Search engines
    // often keep the fresh `Poster for ...` window only in description, while
    // content starts with a generic channel introduction.
    const textVariants = [
      entry.description,
      entry.content,
      clean(`${entry.description || ''} ${entry.content || ''}`)
    ].filter(Boolean);

    for (const text of textVariants) {
      hints.push(...parseTrustedSnippet({
        title: entry.title,
        link: entry.url,
        description: text,
        type,
        sourceUrl,
        evidence: 'jina-search-json'
      }));
    }

    const combined = clean(`${entry.title || ''} ${entry.description || ''} ${entry.content || ''}`);
    // Some Jina JSON responses put the whole page in content while title is
    // generic. For the exact channel/home page, parse every text field directly.
    if (trustedIndexPage(entry.url, sourceUrl, type, combined)) {
      for (const text of textVariants) {
        hints.push(...parseLeadingHints(text, type, sourceUrl, 'jina-search-json-content'));
        hints.push(...parseBeforePosterHints(text, type, sourceUrl, 'jina-search-json-content'));
        hints.push(...parsePosterHints(text, type, sourceUrl, 'jina-search-json-content'));
      }
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
    const snippets = [result?.snippet, result?.description]
      .map(value => clean(stripTags(value || ''))).filter(Boolean);

    for (const snippet of snippets) {
      hints.push(...parseTrustedSnippet({
        title, link: url, description: snippet, type, sourceUrl,
        evidence: 'serpapi-google-snippet'
      }));
    }

    const combined = clean(`${title} ${snippets.join(' ')}`);
    if (trustedIndexPage(url, sourceUrl, type, combined)) {
      for (const snippet of snippets) {
        hints.push(...parseLeadingHints(snippet, type, sourceUrl, 'serpapi-google-snippet'));
        hints.push(...parseBeforePosterHints(snippet, type, sourceUrl, 'serpapi-google-snippet'));
        hints.push(...parsePosterHints(snippet, type, sourceUrl, 'serpapi-google-snippet'));
      }
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
    const snippets = [
      result?.description,
      ...(Array.isArray(result?.extra_snippets) ? result.extra_snippets : [])
    ].map(value => clean(stripTags(value || ''))).filter(Boolean);

    // Brave returns search-index snippets directly. It does not need the addon
    // to open the Filmbaze result URL, so WEDOS on the origin cannot replace
    // these snippets with a security page. Only trust the exact channel/home
    // page to avoid promoting unrelated Filmbaze title pages.
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

    const combined = clean(`${title} ${snippets.join(' ')}`);
    if (trustedIndexPage(url, sourceUrl, type, combined)) {
      for (const snippet of snippets) {
        hints.push(...parseLeadingHints(snippet, type, sourceUrl, 'brave-search-snippet'));
        hints.push(...parseBeforePosterHints(snippet, type, sourceUrl, 'brave-search-snippet'));
        hints.push(...parsePosterHints(snippet, type, sourceUrl, 'brave-search-snippet'));
      }
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
    return [
      `site:${host} "Oblíbené seriály v češtině"`,
      `"${sourceUrl}"`,
      `site:${host} "Oblíbené seriály" "Poster for"`
    ];
  }

  return [
    `site:${host} "Novinky s českým dabingem"`,
    `"${sourceUrl}"`,
    `site:${host} "Novinky s českým dabingem" "Poster for"`
  ];
}

export function jinaQueries(type, sourceUrl) {
  let host = 'filmbaze.cz';
  try { host = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch {}

  if (type === 'series') {
    return [
      `"${sourceUrl}"`,
      `site:${host} "Oblíbené seriály v češtině"`,
      `site:${host} "Oblíbené seriály"`
    ];
  }

  return [
    `"${sourceUrl}"`,
    `site:${host} "Novinky s českým dabingem"`,
    `site:${host} "Nové filmy na internetu s českým dabingem"`
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


async function fetchSerpApiHints(type, sourceUrl) {
  if (!SERPAPI_KEY) return { items: [], errors: [], successfulQueries: 0, queries: [], responseBytes: 0, results: 0, resultSamples: [] };
  const items = []; const errors = []; const resultSamples = [];
  let successfulQueries = 0; let responseBytes = 0; let resultCount = 0;
  const queries = serpApiQueries(type, sourceUrl).slice(0, SERPAPI_SEARCH_MAX_QUERIES);

  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        engine: 'google', q: query, api_key: SERPAPI_KEY, hl: 'cs', gl: 'cz',
        google_domain: 'google.cz', num: '20', safe: 'active'
      });
      const text = await fetchText(`https://serpapi.com/search.json?${params.toString()}`, {
        Accept: 'application/json', 'Cache-Control': 'no-cache'
      }, SERPAPI_TIMEOUT_MS);
      successfulQueries += 1; responseBytes += Buffer.byteLength(text, 'utf8');
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
    }
  }
  return { items: dedupeHints(items), errors, successfulQueries, queries, responseBytes, results: resultCount, resultSamples };
}

async function fetchBraveHints(type, sourceUrl) {
  if (!BRAVE_SEARCH_API_KEY) return { items: [], errors: [], successfulQueries: 0, queries: [], responseBytes: 0, results: 0, resultSamples: [] };

  const items = [];
  const errors = [];
  let successfulQueries = 0;
  let responseBytes = 0;
  let resultCount = 0;
  const resultSamples = [];
  const queries = braveQueries(type, sourceUrl).slice(0, BRAVE_SEARCH_MAX_QUERIES);

  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        q: query,
        count: '20',
        country: 'CZ',
        search_lang: 'cs',
        safesearch: 'moderate',
        extra_snippets: 'true'
      });
      const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
      const text = await fetchText(url, {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_SEARCH_API_KEY,
        'Cache-Control': 'no-cache'
      }, BRAVE_TIMEOUT_MS);

      successfulQueries += 1;
      responseBytes += Buffer.byteLength(text, 'utf8');
      const parsed = JSON.parse(text);
      const results = Array.isArray(parsed?.web?.results) ? parsed.web.results : [];
      resultCount += results.length;

      for (const result of results.slice(0, 5)) {
        if (resultSamples.length >= 10) break;
        resultSamples.push({
          title: clean(stripTags(result?.title || '')).slice(0, 120),
          url: String(result?.url || '').slice(0, 240),
          hasDescription: Boolean(clean(stripTags(result?.description || ''))),
          extraSnippets: Array.isArray(result?.extra_snippets) ? result.extra_snippets.length : 0
        });
      }

      items.push(...parseBraveSearchJson(parsed, type, sourceUrl));
      if (dedupeHints(items).length > 0) break;
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
    }
  }

  return { items: dedupeHints(items), errors, successfulQueries, queries, responseBytes, results: resultCount, resultSamples };
}

async function fetchJinaHints(type, sourceUrl) {
  if (!JINA_API_KEY) return { items: [], errors: [], successfulQueries: 0, queries: [], responseBytes: 0, jsonResults: 0, resultSamples: [] };
  const items = [];
  const errors = [];
  let successfulQueries = 0;
  let responseBytes = 0;
  let jsonResults = 0;
  const resultSamples = [];
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
        for (const entry of entries.slice(0, 3)) {
          if (resultSamples.length >= 8) break;
          resultSamples.push({ title: clean(entry.title).slice(0, 120), url: String(entry.url || '').slice(0, 240), hasDescription: Boolean(clean(entry.description)), hasContent: Boolean(clean(entry.content)) });
        }
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

  return { items: dedupeHints(items), errors, successfulQueries, queries, responseBytes, jsonResults, resultSamples };
}

export async function fetchIndexedCatalogHints(type, sourceUrl) {
  if (!USE_INDEXED_FALLBACK) return {
    items: [], used: false, providers: [], attemptedProviders: [], errors: [], queries: [],
    serpApiConfigured: Boolean(SERPAPI_KEY), serpApiResponseBytes: 0, serpApiResults: 0,
    serpApiSuccessfulQueries: 0, serpApiResultSamples: []
  };

  const queries = indexedQueries(type, sourceUrl);
  const providers = []; const attemptedProviders = []; const errors = []; const items = [];
  let serpApiResponseBytes = 0; let serpApiResults = 0; let serpApiSuccessfulQueries = 0;
  const serpApiResultSamples = [];

  if (SERPAPI_KEY) {
    const serp = await fetchSerpApiHints(type, sourceUrl);
    attemptedProviders.push('serpapi-google');
    serpApiResponseBytes += Number(serp.responseBytes || 0);
    serpApiResults += Number(serp.results || 0);
    serpApiSuccessfulQueries += Number(serp.successfulQueries || 0);
    serpApiResultSamples.push(...(serp.resultSamples || []));
    errors.push(...serp.errors.map(error => `serpapi-google: ${error}`));
    if (serp.items.length) { providers.push('serpapi-google'); items.push(...serp.items); }
    if (serp.queries?.length) queries.push(...serp.queries);
  }

  if (dedupeHints(items).length < Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) {
    const bing = await fetchBingHints(type, sourceUrl, queries);
    attemptedProviders.push('bing-rss');
    errors.push(...bing.errors.map(error => `bing-rss: ${error}`));
    if (bing.items.length) { providers.push('bing-rss'); items.push(...bing.items); }
  }

  if (dedupeHints(items).length < Math.min(6, INDEXED_FALLBACK_MAX_ITEMS)) {
    const ddg = await fetchDuckDuckGoHints(type, sourceUrl, queries);
    attemptedProviders.push('duckduckgo-html');
    errors.push(...ddg.errors.map(error => `duckduckgo-html: ${error}`));
    if (ddg.items.length) { providers.push('duckduckgo-html'); items.push(...ddg.items); }
  }

  const finalItems = dedupeHints(items).slice(0, INDEXED_FALLBACK_MAX_ITEMS);
  return {
    items: finalItems, used: finalItems.length > 0, providers: [...new Set(providers)],
    attemptedProviders: [...new Set(attemptedProviders)], errors, queries: [...new Set(queries)],
    serpApiConfigured: Boolean(SERPAPI_KEY), serpApiResponseBytes, serpApiResults,
    serpApiSuccessfulQueries, serpApiResultSamples: serpApiResultSamples.slice(0, 10)
  };
}

