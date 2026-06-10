const fs = require('fs');
const path = require('path');

const q = (process.argv.slice(2).join(' ') || '').toLowerCase();
if (!q) {
  console.error('Usage: node scripts/find-cache-item.cjs "Barvy zla"');
  process.exit(1);
}

const candidates = [
  'data/cache.json',
  'data/filmbaze-cache.json',
  'data/catalog.json',
  'cache.json',
  'catalog.json',
  'data/movies.json',
  'movies.json'
];

function collectItems(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.metas)) return obj.metas;
  if (Array.isArray(obj.movies)) return obj.movies;
  if (obj.cache && Array.isArray(obj.cache.items)) return obj.cache.items;
  return [];
}

let foundAny = false;
for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    const items = collectItems(json);
    const matches = items.filter(it => {
      const hay = [it.name, it.title, it.originalName, it.originalTitle, it.id, it.tmdbId, it.imdbId]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (matches.length) {
      foundAny = true;
      console.log('\nFOUND IN:', file);
      for (const it of matches.slice(0, 20)) {
        console.log(JSON.stringify({
          id: it.id,
          name: it.name || it.title,
          originalName: it.originalName || it.originalTitle,
          type: it.type,
          year: it.year,
          tmdbId: it.tmdbId,
          imdbId: it.imdbId,
          primaryVideo: it.primaryVideo,
          detailUrl: it.detailUrl,
          sourceUrl: it.sourceUrl,
          detailChecked: it.detailChecked,
          streamStatus: it.streamStatus
        }, null, 2));
      }
    }
  } catch (e) {
    console.warn('Could not read', file, e.message);
  }
}

if (!foundAny) {
  console.error('No matching item found for query:', q);
  console.error('Checked files:', candidates.join(', '));
  process.exit(2);
}
