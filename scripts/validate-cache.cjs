const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const cacheFile = process.env.CACHE_FILE || path.join(process.cwd(), 'data', 'catalog-cache.json');
const minItems = Number(process.env.MIN_CACHE_ITEMS || 500);
const minMovies = Number(process.env.MIN_CACHE_MOVIES || 400);
const minSeries = Number(process.env.MIN_CACHE_SERIES || 50);
const maxDropRatio = Number(process.env.MAX_CACHE_DROP_RATIO || 0.2);
const minEpisodeCoverage = Number(process.env.MIN_SERIES_EPISODE_COVERAGE || 0.8);

function fail(message) {
  console.error(`CACHE VALIDATION FAILED: ${message}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readPrevious() {
  try {
    const raw = execFileSync('git', ['show', 'HEAD:data/catalog-cache.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

if (!fs.existsSync(cacheFile)) fail(`Cache file does not exist: ${cacheFile}`);

const current = readJson(cacheFile);
const previous = readPrevious();
const items = Array.isArray(current.items) ? current.items : [];
const metas = Array.isArray(current.metas) ? current.metas : [];
const movies = metas.filter(meta => meta?.type === 'movie');
const series = metas.filter(meta => meta?.type === 'series');
const seriesWithEpisodes = series.filter(meta => Array.isArray(meta.videos) && meta.videos.length > 0);
const ids = metas.map(meta => meta?.id).filter(Boolean);
const duplicateIds = ids.length - new Set(ids).size;
const invalidMetas = metas.filter(meta => !meta?.id || !meta?.name || !['movie', 'series'].includes(meta?.type));

if (!current.sourceHash) fail('sourceHash is empty.');
if (items.length < minItems) fail(`Too few source items: ${items.length} < ${minItems}`);
if (metas.length < minItems) fail(`Too few metas: ${metas.length} < ${minItems}`);
if (movies.length < minMovies) fail(`Too few movies: ${movies.length} < ${minMovies}`);
if (series.length < minSeries) fail(`Too few series: ${series.length} < ${minSeries}`);
if (metas.length < Math.floor(items.length * 0.8)) fail(`Meta/source ratio too low: ${metas.length}/${items.length}`);
if (duplicateIds > 0) fail(`Duplicate Stremio IDs: ${duplicateIds}`);
if (invalidMetas.length > 0) fail(`Invalid metas: ${invalidMetas.length}`);

if (series.length > 0) {
  const coverage = seriesWithEpisodes.length / series.length;
  if (coverage < minEpisodeCoverage) {
    fail(`Series episode coverage too low: ${(coverage * 100).toFixed(1)}% < ${(minEpisodeCoverage * 100).toFixed(1)}%`);
  }
}

if (previous && Array.isArray(previous.metas) && previous.metas.length > 0) {
  const allowedMinimum = Math.floor(previous.metas.length * (1 - maxDropRatio));
  if (metas.length < allowedMinimum) {
    fail(`Cache shrank too much: ${previous.metas.length} -> ${metas.length}; minimum allowed ${allowedMinimum}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  cacheFile,
  sourceItems: items.length,
  metas: metas.length,
  movies: movies.length,
  series: series.length,
  seriesWithEpisodes: seriesWithEpisodes.length,
  episodeCoverage: series.length ? Number((seriesWithEpisodes.length / series.length).toFixed(4)) : 1,
  duplicateIds,
  generatedAt: current.at ? new Date(current.at).toISOString() : null,
  refreshStats: current.refreshStats || null
}, null, 2));
