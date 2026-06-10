#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const needle = (process.argv.slice(2).join(' ') || '').toLowerCase();
if (!needle) {
  console.error('Usage: node scripts/find-cache-item.cjs "Barvy zla"');
  process.exit(1);
}

const candidates = [
  'data/cache.json',
  'data/catalog.json',
  'data/filmbaze-cache.json',
  'cache/cache.json',
  'cache/catalog.json',
  'cache/filmbaze-cache.json',
  'cache.json',
  'catalog.json'
];

function getItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.metas)) return data.metas;
  if (data.cache && Array.isArray(data.cache.items)) return data.cache.items;
  return null;
}

let found = 0;
for (const rel of candidates) {
  const file = path.join(process.cwd(), rel);
  if (!fs.existsSync(file)) continue;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`[find-cache-item] ${rel}: invalid json`);
    continue;
  }
  const items = getItems(data);
  if (!items) continue;
  for (const item of items) {
    const hay = [item.name, item.title, item.originalName, item.originalTitle, item.id, item.tmdbId, item.imdbId]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (hay.includes(needle)) {
      found++;
      console.log(`\n[find-cache-item] FOUND in ${rel}`);
      console.log(JSON.stringify(item, null, 2));
    }
  }
}

if (!found) {
  console.log(`[find-cache-item] No item found for: ${needle}`);
}
