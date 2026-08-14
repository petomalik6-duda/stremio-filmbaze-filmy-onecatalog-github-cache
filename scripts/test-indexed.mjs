import assert from 'node:assert/strict';
import { parseBingRss, parseDuckDuckGoHtml, parseSerpApiSearchJson, indexedQueries, serpApiQueries } from '../src/indexed.js';

const movieUrl = 'https://filmbaze.cz/novinky-s-ceskym-dabingem-na-netu';
const seriesUrl = 'https://filmbaze.cz/oblibene-serialy-v-cestine';

// Fixture mirrors the currently indexed shape: the first title is written as
// "YEAR. title · Poster for ..." and following items can omit the year.
const movieRss = `<?xml version="1.0"?>
<rss><channel><item>
<title>Nové filmy na internetu s českým dabingem</title>
<link>${movieUrl}</link>
<description><![CDATA[2026. Sintonia: Nando mezi dvěma světy · Poster for Voyeuři. 6.6 / 10. Voyeuři 2026. Tvoje vina: Londýn · Poster for Vitrival. 25. 11. 2025. Vitrival]]></description>
</item></channel></rss>`;

const movieHints = parseBingRss(movieRss, 'movie', movieUrl);
assert(movieHints.some(x => x.name === 'Sintonia: Nando mezi dvěma světy' && x.year === 2026));
assert(movieHints.some(x => x.name === 'Voyeuři'));
assert(movieHints.some(x => x.name === 'Vitrival' && x.year === 2025));
assert(movieHints.every(x => x.type === 'movie' && x.indexedFallback));

// Homepage is a trusted secondary indexed window when its snippet explicitly
// identifies the relevant Filmbáze section.
const homeRss = `<?xml version="1.0"?>
<rss><channel><item>
<title>Filmbáze - Česká filmová databáze</title>
<link>https://filmbaze.cz/</link>
<description><![CDATA[Novinky s českým dabingem ; Poster for Tenkrát v Gaze. 5.4 / 10. Tenkrát v Gaze ; Poster for Julian. 6.7 / 10. Julian ; Poster for Zvukař. 7 / 10. Zvukař]]></description>
</item></channel></rss>`;
const homeHints = parseBingRss(homeRss, 'movie', movieUrl);
assert(homeHints.some(x => x.name === 'Zvukař'));
assert(homeHints.some(x => x.name === 'Julian'));

const ddg = `
<div class="result">
  <a class="result__a" href="https://filmbaze.cz/oblibene-serialy-v-cestine">Oblíbené seriály v češtině</a>
  <div class="result__snippet">Oblíbené seriály v češtině · Poster for Jízda o život · Jízda o život · Poster for Montmartre · Montmartre</div>
</div>`;
const seriesDdgHints = parseDuckDuckGoHtml(ddg, 'series', seriesUrl);
assert(seriesDdgHints.some(x => x.name === 'Jízda o život'));
assert(seriesDdgHints.some(x => x.name === 'Montmartre'));

const serpApiJson = {
  search_metadata: { status: 'Success' },
  organic_results: [{
    position: 1, title: 'Nové filmy na internetu s českým dabingem', link: movieUrl,
    snippet: 'Novinky s českým dabingem ; Poster for Tenkrát v Gaze. 5.4 / 10. Tenkrát v Gaze ; Poster for Julian. 6.7 / 10. Julian ; Poster for Zvukař. 7 / 10. Zvukař'
  }]
};
const serpHints = parseSerpApiSearchJson(serpApiJson, 'movie', movieUrl);
assert(serpHints.some(x => x.name === 'Tenkrát v Gaze'));
assert(serpHints.some(x => x.name === 'Zvukař'));
assert(serpHints.every(x => x.indexedEvidence === 'serpapi-google-snippet'));

const unrelatedSerp = { organic_results: [{ title: 'Random title', link: 'https://filmbaze.cz/titles/123/random', snippet: 'Poster for Random title. 8 / 10' }] };
assert.equal(parseSerpApiSearchJson(unrelatedSerp, 'movie', movieUrl).length, 0);

const sq = serpApiQueries('movie', movieUrl);
assert(sq[0].includes(movieUrl));
assert(sq.some(q => q.includes('Novinky s českým dabingem')));
const movieQueries = indexedQueries('movie', movieUrl);
assert(movieQueries.length >= 3);
assert(movieQueries.some(q => q.includes('Novinky s českým dabingem')));
console.log('indexed fallback parser tests: OK');
