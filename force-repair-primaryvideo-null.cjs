#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function getItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.metas)) return data.metas;
  if (data.cache && Array.isArray(data.cache.items)) return data.cache.items;
  return null;
}

let changedTotal = 0;
let checkedFiles = 0;

for (const rel of candidates) {
  const file = path.join(process.cwd(), rel);
  if (!fs.existsSync(file)) continue;
  checkedFiles++;

  const data = readJson(file);
  const items = getItems(data);
  if (!items) {
    console.log(`[force-repair] ${rel}: no items array found`);
    continue;
  }

  let changed = 0;
  for (const item of items) {
    if (item && item.type === 'movie' && item.detailChecked === true && !item.primaryVideo) {
      item.detailChecked = false;
      item.streamStatus = 'missing_primaryVideo_retry';
      item.repairRetryAt = new Date().toISOString();
      changed++;
    }
  }

  if (changed) {
    writeJson(file, data);
    changedTotal += changed;
    console.log(`[force-repair] ${rel}: marked ${changed} items for retry`);
  } else {
    console.log(`[force-repair] ${rel}: no changes`);
  }
}

console.log(`[force-repair] checkedFiles=${checkedFiles} changedTotal=${changedTotal}`);
