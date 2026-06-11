'use strict';

const fs = require('fs');
const path = require('path');
const { getStremioId } = require('./filmbaze-stremio-id.cjs');

const candidates = [
  'data/cache.json',
  'cache.json',
  'data/filmbaze-cache.json',
  'public/cache.json',
  'data/catalog.json',
];

function findCacheFile() {
  for (const rel of candidates) {
    const full = path.join(process.cwd(), rel);
    if (fs.existsSync(full)) return full;
  }
  throw new Error(`Cache file not found. Tried: ${candidates.join(', ')}`);
}

const cacheFile = process.argv[2] ? path.resolve(process.argv[2]) : findCacheFile();
const json = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
const items = Array.isArray(json) ? json : Array.isArray(json.items) ? json.items : [];

let imdb = 0;
let fallback = 0;
const examples = [];

for (const item of items) {
  const id = getStremioId(item);
  if (/^tt\d+/.test(id)) imdb += 1;
  else fallback += 1;

  if (examples.length < 20 && (String(item.name || '').toLowerCase().includes('barvy') || String(item.originalName || '').toLowerCase().includes('kolory'))) {
    examples.push({ name: item.name, originalName: item.originalName, imdbId: item.imdbId, tmdbId: item.tmdbId, oldId: `filmbaze:${item.id}`, newStremioId: id });
  }
}

console.log(JSON.stringify({ cacheFile, total: items.length, imdbIdBased: imdb, fallbackIdBased: fallback, examples }, null, 2));
