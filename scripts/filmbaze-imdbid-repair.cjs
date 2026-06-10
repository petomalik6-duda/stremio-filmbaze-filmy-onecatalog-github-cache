#!/usr/bin/env node
/*
  Filmbaze IMDb ID repair
  - Finds JSON cache files in common locations.
  - Repairs items with tmdbId but missing imdbId using TMDB external_ids.
  - Does NOT run original refresh-cache, so it works even if the repo has no refresh-cache script.
*/

const fs = require('fs');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY || process.env.TMDB_TOKEN;
const DRY_RUN = process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.REPAIR_LIMIT || 300);

if (!TMDB_API_KEY) {
  console.error('Missing TMDB_API_KEY secret/env. Add TMDB_API_KEY to GitHub Secrets.');
  process.exit(1);
}

const ROOT = process.cwd();

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'build'].includes(ent.name)) walk(p, out);
    } else if (ent.isFile() && ent.name.endsWith('.json')) {
      out.push(p);
    }
  }
  return out;
}

function likelyCacheFile(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/').toLowerCase();
  if (rel.includes('package-lock') || rel.endsWith('package.json')) return false;
  return rel.startsWith('data/') || rel.startsWith('cache/') || rel.includes('cache') || rel.includes('catalog') || rel.includes('filmbaze');
}

function getItemsContainer(json) {
  if (Array.isArray(json)) return { items: json, set: null, desc: 'root array' };
  if (json && Array.isArray(json.items)) return { items: json.items, set: 'items', desc: 'items' };
  if (json && Array.isArray(json.metas)) return { items: json.metas, set: 'metas', desc: 'metas' };
  if (json && json.data && Array.isArray(json.data.items)) return { items: json.data.items, set: 'data.items', desc: 'data.items' };
  return null;
}

async function tmdbExternalIds(tmdbId) {
  const url = `https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}/external_ids?api_key=${encodeURIComponent(TMDB_API_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TMDB ${res.status} for ${tmdbId}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

function isRepairTarget(item) {
  return item &&
    (item.type === 'movie' || item.type === undefined) &&
    item.tmdbId &&
    !item.imdbId;
}

async function main() {
  const allFiles = walk(ROOT).filter(likelyCacheFile);
  console.log(`[imdb-repair] scanning ${allFiles.length} json files`);

  let changedFiles = 0;
  let repaired = 0;
  let checked = 0;
  const cache = new Map();

  for (const file of allFiles) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      continue;
    }

    const container = getItemsContainer(json);
    if (!container) continue;

    let fileChanged = false;
    const targets = container.items.filter(isRepairTarget);
    if (!targets.length) continue;

    console.log(`[imdb-repair] ${path.relative(ROOT, file)}: ${targets.length} candidates`);

    for (const item of targets) {
      if (repaired >= LIMIT) break;
      const tmdbId = String(item.tmdbId);
      checked++;

      try {
        let ext = cache.get(tmdbId);
        if (!ext) {
          ext = await tmdbExternalIds(tmdbId);
          cache.set(tmdbId, ext);
          await new Promise(r => setTimeout(r, 120));
        }
        if (ext && ext.imdb_id) {
          item.imdbId = ext.imdb_id;
          item.externalIds = item.externalIds || {};
          item.externalIds.imdb_id = ext.imdb_id;
          item.imdbRepairAt = new Date().toISOString();
          fileChanged = true;
          repaired++;
          console.log(`[imdb-repair] OK ${item.name || item.title || tmdbId} -> ${ext.imdb_id}`);
        } else {
          item.imdbRepairStatus = 'tmdb_external_ids_without_imdb';
          item.imdbRepairAt = new Date().toISOString();
          fileChanged = true;
          console.log(`[imdb-repair] no imdb_id for ${item.name || item.title || tmdbId}`);
        }
      } catch (err) {
        item.imdbRepairStatus = 'error';
        item.imdbRepairError = String(err.message || err).slice(0, 240);
        item.imdbRepairAt = new Date().toISOString();
        fileChanged = true;
        console.log(`[imdb-repair] ERROR ${item.name || item.title || tmdbId}: ${err.message}`);
      }
    }

    if (fileChanged) {
      changedFiles++;
      if (!DRY_RUN) fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
      console.log(`[imdb-repair] ${DRY_RUN ? 'would write' : 'wrote'} ${path.relative(ROOT, file)}`);
    }

    if (repaired >= LIMIT) break;
  }

  console.log(JSON.stringify({ ok: true, checked, repaired, changedFiles, dryRun: DRY_RUN }, null, 2));
}

main().catch(err => {
  console.error('[imdb-repair] failed:', err);
  process.exit(1);
});
