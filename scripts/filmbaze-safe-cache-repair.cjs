'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CACHE_CANDIDATES = [
  'data/cache.json',
  'data/filmbaze-cache.json',
  'cache.json',
  'data/catalog.json',
  'public/cache.json'
];

function findCacheFile() {
  return CACHE_CANDIDATES.map(p => path.join(ROOT, p)).find(fs.existsSync);
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function getItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.movies)) return data.movies;
  if (data.cache && Array.isArray(data.cache.items)) return data.cache.items;
  return [];
}

function main() {
  const file = findCacheFile();
  if (!file) {
    console.log('[filmbaze-safe-cache-repair] cache file not found, skipping');
    return;
  }

  const data = loadJson(file);
  const items = getItems(data);
  let touched = 0;

  for (const item of items) {
    if (!item || item.type !== 'movie') continue;

    // Like FilmoveNovinky safe repair: do not overwrite working values.
    // Only make broken/skipped states retryable when item was marked checked but still has no primaryVideo.
    if (item.detailChecked === true && !item.primaryVideo) {
      item.streamStatus = item.streamStatus || 'retry_primaryVideo_null';
      item.detailChecked = false;
      touched++;
    }
  }

  if (touched) {
    saveJson(file, data);
    console.log(`[filmbaze-safe-cache-repair] updated ${touched} retryable items in ${path.relative(ROOT, file)}`);
  } else {
    console.log('[filmbaze-safe-cache-repair] no changes');
  }
}

main();
