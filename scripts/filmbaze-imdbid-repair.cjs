#!/usr/bin/env node
/*
  Filmbaze IMDb repair
  - non-destructive cache repair
  - fills imdbId from TMDB external_ids when tmdbId exists
  - does NOT treat primaryVideo:null as an error
  - useful for items like Barvy zla: Černá where tmdbId exists but imdbId is null
*/
const fs = require('fs');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY || process.env.TMDB_TOKEN || '';
const DRY_RUN = process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.REPAIR_LIMIT || process.env.LIMIT || 300);

const candidates = [
  'data/cache.json',
  'data/catalog.json',
  'data/filmbaze-cache.json',
  'cache.json',
  'catalog.json',
  'filmbaze-cache.json'
];

function findCacheFile() {
  for (const p of candidates) {
    const abs = path.resolve(process.cwd(), p);
    if (fs.existsSync(abs)) return abs;
  }
  const dataDir = path.resolve(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    const jsons = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    for (const f of jsons) {
      const abs = path.join(dataDir, f);
      try {
        const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
        const items = Array.isArray(raw) ? raw : raw.items;
        if (Array.isArray(items) && items.some(x => x && (x.source === 'Filmbáze' || x.tmdbId || x.primaryVideo !== undefined))) {
          return abs;
        }
      } catch (_) {}
    }
  }
  throw new Error('Cache JSON not found. Set one of: data/cache.json, data/catalog.json, cache.json, catalog.json');
}

function getItems(root) {
  if (Array.isArray(root)) return root;
  if (Array.isArray(root.items)) return root.items;
  if (root.catalog && Array.isArray(root.catalog.items)) return root.catalog.items;
  throw new Error('Unsupported cache format: expected array or object.items');
}

async function tmdbGet(pathname) {
  if (!TMDB_API_KEY) throw new Error('Missing TMDB_API_KEY secret/env');
  const sep = pathname.includes('?') ? '&' : '?';
  const url = `https://api.themoviedb.org/3${pathname}${sep}api_key=${encodeURIComponent(TMDB_API_KEY)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${pathname}`);
  return res.json();
}

async function getImdbIdForMovie(tmdbId) {
  const data = await tmdbGet(`/movie/${tmdbId}/external_ids`);
  if (data && data.imdb_id && /^tt\d+$/i.test(data.imdb_id)) return data.imdb_id;
  return null;
}

async function main() {
  const file = findCacheFile();
  const root = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = getItems(root);

  const targets = items.filter(item =>
    item &&
    item.type === 'movie' &&
    item.tmdbId &&
    !item.imdbId
  ).slice(0, LIMIT);

  console.log(`[filmbaze-imdbid-repair] cache: ${path.relative(process.cwd(), file)}`);
  console.log(`[filmbaze-imdbid-repair] candidates: ${targets.length}`);

  let fixed = 0;
  let failed = 0;

  for (const item of targets) {
    try {
      const imdbId = await getImdbIdForMovie(item.tmdbId);
      if (imdbId) {
        console.log(`[filmbaze-imdbid-repair] ${item.name || item.title} tmdb:${item.tmdbId} -> ${imdbId}`);
        if (!DRY_RUN) {
          item.imdbId = imdbId;
          item.imdbRepairAt = new Date().toISOString();
        }
        fixed++;
      } else {
        console.log(`[filmbaze-imdbid-repair] ${item.name || item.title} tmdb:${item.tmdbId} has no imdb_id on TMDB`);
      }
    } catch (e) {
      failed++;
      console.log(`[filmbaze-imdbid-repair] failed ${item.name || item.title}: ${e.message}`);
    }
  }

  if (!DRY_RUN && fixed > 0) {
    fs.writeFileSync(file, JSON.stringify(root, null, 2) + '\n');
  }

  console.log(JSON.stringify({ ok: true, fixed, failed, dryRun: DRY_RUN, file: path.relative(process.cwd(), file) }, null, 2));
}

main().catch(err => {
  console.error('[filmbaze-imdbid-repair] fatal:', err);
  process.exit(1);
});
