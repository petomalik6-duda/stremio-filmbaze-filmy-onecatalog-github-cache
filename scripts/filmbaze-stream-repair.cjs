#!/usr/bin/env node
'use strict';

/**
 * Safe placeholder repair runner for Filmbaze.
 * Keep your existing filmbaze-stream-repair.js if you already have one.
 * This .cjs file exists so CommonJS projects and "type":"module" projects can call it safely.
 *
 * It does NOT delete or overwrite good cache data.
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const candidates = [
  'data/cache.json',
  'cache.json',
  'data/filmbaze-cache.json',
  'data/items.json',
  'data/catalog.json'
];

function findCacheFile() {
  for (const rel of candidates) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function walkItems(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.movies)) return obj.movies;
  if (Array.isArray(obj.metas)) return obj.metas;
  if (obj.cache && Array.isArray(obj.cache.items)) return obj.cache.items;
  return [];
}

function main() {
  const cacheFile = findCacheFile();
  if (!cacheFile) {
    console.log('No known cache file found. Skipping safe repair.');
    return;
  }

  const raw = fs.readFileSync(cacheFile, 'utf8');
  const json = JSON.parse(raw);
  const items = walkItems(json);

  let missingPrimaryVideo = 0;
  for (const item of items) {
    if (item && item.type === 'movie' && !item.primaryVideo) {
      missingPrimaryVideo++;
      // Non-destructive marker only. Do not break sourceUrl fallback.
      if (!item.streamRepairStatus) item.streamRepairStatus = 'missing_primaryVideo_pending';
    }
  }

  fs.writeFileSync(cacheFile, JSON.stringify(json, null, 2));
  console.log(`Safe Filmbaze repair finished. Items without primaryVideo: ${missingPrimaryVideo}`);
  console.log(`Updated cache: ${path.relative(root, cacheFile)}`);
}

main();
