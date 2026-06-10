#!/usr/bin/env node
/*
  Wrapper for Filmbaze refresh cache.
  Runs the original refresh script first, then fills missing imdbId from TMDB.
  Uses .cjs so it works in package.json projects with "type":"module".
*/
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) process.exit(r.status || 1);
}

function exists(p) { return fs.existsSync(path.resolve(process.cwd(), p)); }

const refreshCandidates = [
  'scripts/refresh-cache.js',
  'scripts/refresh-cache.cjs',
  'scripts/update-cache.js',
  'scripts/update-cache.cjs',
  'scripts/build-cache.js',
  'scripts/build-cache.cjs',
  'refresh-cache.js',
  'update-cache.js',
  'build-cache.js'
];

const refresh = refreshCandidates.find(exists);

if (!refresh) {
  console.error('Original refresh cache script not found. Edit scripts/refresh-cache-with-safe-repair.cjs and set refresh path manually.');
  console.error('Tried:', refreshCandidates.join(', '));
  process.exit(1);
}

console.log(`[wrapper] original refresh: ${refresh}`);
run('node', [refresh]);

if (exists('scripts/filmbaze-imdbid-repair.cjs')) {
  run('node', ['scripts/filmbaze-imdbid-repair.cjs']);
} else {
  console.log('[wrapper] scripts/filmbaze-imdbid-repair.cjs not found, skipping');
}
