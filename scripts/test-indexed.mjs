import assert from 'node:assert/strict';
import { parseBingRss, parseDuckDuckGoHtml, parseJinaSearch, parseJinaSearchJson, indexedQueries, jinaQueries } from '../src/indexed.js';

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

const seriesText = `Result: ${seriesUrl}\n2026. Testovací seriál · Poster for Testovací seriál. 8.0 / 10`;
const seriesHints = parseJinaSearch(seriesText, 'series', seriesUrl);
assert(seriesHints.some(x => x.name === 'Testovací seriál' && x.year === 2026));


const jinaJson = {
  code: 200,
  status: 20000,
  data: [
    {
      title: 'Nové filmy na internetu s českým dabingem',
      url: movieUrl,
      content: 'Novinky s českým dabingem ; Poster for Tenkrát v Gaze. 5.4 / 10. Tenkrát v Gaze ; Poster for Julian. 6.7 / 10. Julian ; Poster for Zvukař. 7 / 10. Zvukař'
    }
  ]
};
const jinaJsonHints = parseJinaSearchJson(jinaJson, 'movie', movieUrl);
assert(jinaJsonHints.some(x => x.name === 'Tenkrát v Gaze'));
assert(jinaJsonHints.some(x => x.name === 'Zvukař'));


// Regression for 3.6.3: Jina can keep fresh SERP snippets in `description`
// while `content` contains only the generic channel intro. Both must be parsed.
const jinaDescriptionJson = {
  code: 200,
  status: 20000,
  data: [
    {
      title: 'Nové filmy na internetu s českým dabingem',
      url: movieUrl,
      description: 'Novinky s českým dabingem ; Poster for Tenkrát v Gaze. 5.4 / 10. Tenkrát v Gaze ; Poster for Julian. 6.7 / 10. Julian ; Poster for Zvukař. 7 / 10. Zvukař',
      content: 'Seznam aktuálních filmů s českým a slovenským dabingem dostupných online.'
    }
  ]
};
const jinaDescriptionHints = parseJinaSearchJson(jinaDescriptionJson, 'movie', movieUrl);
assert(jinaDescriptionHints.some(x => x.name === 'Tenkrát v Gaze'));
assert(jinaDescriptionHints.some(x => x.name === 'Zvukař'));

const jq = jinaQueries('movie', movieUrl);
assert(jq[0].includes(movieUrl));
assert(jq[1].includes('Novinky s českým dabingem'));

const movieQueries = indexedQueries('movie', movieUrl);
assert(movieQueries.length >= 3);
assert(movieQueries.some(q => q.includes('Novinky s českým dabingem')));

console.log('indexed fallback parser tests: OK');
