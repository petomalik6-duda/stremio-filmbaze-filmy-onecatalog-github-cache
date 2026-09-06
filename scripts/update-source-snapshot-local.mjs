import fs from 'fs/promises';
import path from 'path';

process.env.FILMBAZE_INCREMENTAL = 'true';
process.env.MAX_MOVIE_PAGES = '1';
process.env.MAX_SERIES_PAGES = '1';
process.env.MAX_ITEMS = '50';
process.env.MAX_SERIES_ITEMS = '50';
process.env.FILMBAZE_MAX_REQUESTS = '3';
process.env.FILMBAZE_MIN_REQUEST_INTERVAL_MS = '4000';
process.env.FILMBAZE_BETWEEN_CHANNELS_MS = '5000';
process.env.FILMBAZE_API_ONLY = 'true';
process.env.ENABLE_FILMBAZE_DETAIL = 'false';
process.env.FILMBAZE_DETAIL_LIMIT = '0';
process.env.USE_READER_FALLBACK = 'false';
process.env.USE_INDEXED_FALLBACK = 'false';
process.env.USE_SOURCE_SNAPSHOT = 'false';
process.env.HTTP_RETRIES = '1';

const { fetchFilmbazeItems } = await import(`../src/filmbaze.js?local-snapshot=${Date.now()}`);
const fetched = await fetchFilmbazeItems();
const items = Array.isArray(fetched?.items) ? fetched.items : [];
const movies = items.filter(item => item.type === 'movie').length;
const series = items.filter(item => item.type === 'series').length;

if (fetched?.blocked) {
  throw new Error(`Filmbáze blocked this network: ${fetched.blockReason || 'WEDOS/security response'}`);
}
if (movies < 1 || series < 1) {
  throw new Error(`Incomplete Filmbáze snapshot: ${movies} movies, ${series} series.`);
}

const output = process.env.FILMBAZE_SOURCE_SNAPSHOT_FILE || path.join(process.cwd(), 'data', 'filmbaze-source-snapshot.json');
await fs.mkdir(path.dirname(output), { recursive: true });
const snapshot = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceHash: fetched.sourceHash || '',
  movies,
  series,
  items
};
const tmp = `${output}.tmp`;
await fs.writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
await fs.rename(tmp, output);
console.log(`Filmbáze source snapshot saved: ${output}`);
console.log(`Generated: ${snapshot.generatedAt}`);
console.log(`Movies: ${movies}; series: ${series}; total: ${items.length}`);
