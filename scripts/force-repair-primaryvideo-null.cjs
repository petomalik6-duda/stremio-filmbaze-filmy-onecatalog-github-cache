const fs = require('fs');

const candidates = [
  'data/cache.json',
  'data/filmbaze-cache.json',
  'data/catalog.json',
  'cache.json',
  'catalog.json',
  'data/movies.json',
  'movies.json'
];

function getItemsRef(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.metas)) return obj.metas;
  if (Array.isArray(obj.movies)) return obj.movies;
  if (obj.cache && Array.isArray(obj.cache.items)) return obj.cache.items;
  return null;
}

let totalChanged = 0;
let touchedFiles = 0;

for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, 'utf8');
  let json;
  try { json = JSON.parse(raw); } catch { continue; }
  const items = getItemsRef(json);
  if (!items) continue;

  let changed = 0;
  for (const item of items) {
    if (item && item.type === 'movie' && (item.primaryVideo === null || item.primaryVideo === undefined || item.primaryVideo === '')) {
      // Important: do not mark it as checked/done when stream source is missing.
      if (item.detailChecked === true) {
        item.detailChecked = false;
        changed++;
      }
      if (!item.streamStatus || item.streamStatus === 'ok') {
        item.streamStatus = 'missing_primaryVideo_retry';
        changed++;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(file, JSON.stringify(json, null, 2));
    console.log(`Updated ${file}: ${changed} field changes`);
    totalChanged += changed;
    touchedFiles++;
  }
}

console.log(JSON.stringify({ ok: true, touchedFiles, totalChanged }, null, 2));
