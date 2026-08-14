import assert from 'node:assert/strict';
import { parseBingRss, parseJinaSearch } from '../src/indexed.js';

const movieUrl = 'https://filmbaze.cz/novinky-s-ceskym-dabingem-na-netu';
const seriesUrl = 'https://filmbaze.cz/oblibene-serialy-v-cestine';

const movieRss = `<?xml version="1.0"?>
<rss><channel><item>
<title>Nové filmy na internetu s českým dabingem - Filmbáze</title>
<link>${movieUrl}</link>
<description><![CDATA[2026. Zvukař · Poster for Zvukař. 7.1 / 10 Poster for Další film. 6.4 / 10]]></description>
</item></channel></rss>`;

const movieHints = parseBingRss(movieRss, 'movie', movieUrl);
assert(movieHints.length >= 1);
assert(movieHints.some(x => x.name === 'Zvukař' && x.year === 2026));
assert(movieHints.every(x => x.type === 'movie' && x.indexedFallback));

const seriesText = `Result: ${seriesUrl}
2026. Testovací seriál · Poster for Testovací seriál. 8.0 / 10`;

const seriesHints = parseJinaSearch(seriesText, 'series', seriesUrl);
assert(seriesHints.length >= 1);
assert(seriesHints[0].type === 'series');
assert(seriesHints[0].indexedFallback === true);

console.log('indexed fallback parser tests: OK');
