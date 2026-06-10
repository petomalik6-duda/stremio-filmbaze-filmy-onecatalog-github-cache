#!/usr/bin/env node
/*
  Safe Filmbaze stream repair placeholder.

  Purpose:
  - Find cache items with primaryVideo: null.
  - Try to fill missing source fields only when safely found.
  - Never overwrite existing working values.

  This generic version is intentionally conservative because Filmbaze projects may
  store cache in different files. It searches common JSON cache files and annotates
  items with repairStatus only when no safe source is found. Existing values are
  preserved.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIMIT = Number(process.env.REPAIR_LIMIT || 300);
const DRY_RUN = process.env.DRY_RUN === '1';

const CANDIDATE_FILES = [
  'data/cache.json',
  'data/filmbaze-cache.json',
  'cache.json',
  'filmbaze-cache.json',
  'data/catalog.json',
  'catalog.json',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function getItems(root) {
  if (Array.isArray(root)) return root;
  if (Array.isArray(root.items)) return root.items;
  if (Array.isArray(root.metas)) return root.metas;
  if (root.cache && Array.isArray(root.cache.items)) return root.cache.items;
  if (root.data && Array.isArray(root.data.items)) return root.data.items;
  return null;
}

function needsRepair(item) {
  return item && item.type === 'movie' && !item.primaryVideo;
}

function safeRepairItem(item) {
  // Non-destructive: do not invent primaryVideo.
  // Keep item playable through any existing stream-route fallback.
  if (!item.repairStatus) item.repairStatus = 'missing_primaryVideo_checked';
  if (!item.repairCheckedAt) item.repairCheckedAt = new Date().toISOString();
  return true;
}

function main() {
  let changedTotal = 0;

  for (const rel of CANDIDATE_FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;

    console.log('Checking cache file:', rel);
    const json = readJson(file);
    const items = getItems(json);
    if (!items) {
      console.log('No items array found in', rel);
      continue;
    }

    let checked = 0;
    let changed = 0;
    for (const item of items) {
      if (checked >= LIMIT) break;
      if (!needsRepair(item)) continue;
      checked++;
      if (safeRepairItem(item)) changed++;
    }

    console.log(`File ${rel}: checked=${checked}, changed=${changed}`);
    if (changed && !DRY_RUN) writeJson(file, json);
    changedTotal += changed;
  }

  console.log(`Filmbaze safe stream repair done. changedTotal=${changedTotal}, dryRun=${DRY_RUN}`);
}

main();
