#!/usr/bin/env node
/*
  Filmbaze refresh-cache wrapper.
  This script is intentionally called directly from GitHub Actions:

    node scripts/refresh-cache-with-repair.js

  So it does NOT require package.json scripts like:
    npm run refresh-cache-with-repair

  It tries to run the existing refresh script, then optional repair scripts.
*/

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')} exit=${result.status}`);
  }
}

function tryRunNodeScript(candidates, label, required = false) {
  const found = candidates.find(exists);
  if (!found) {
    const msg = `${label}: no candidate file found. Tried: ${candidates.join(', ')}`;
    if (required) throw new Error(msg);
    console.log(`Skipping. ${msg}`);
    return null;
  }
  run('node', [found]);
  return found;
}

function main() {
  console.log('Filmbaze refresh-cache with direct node repair');
  console.log('Root:', ROOT);

  // 1) Run the original refresh cache file. Add your real file name here if needed.
  tryRunNodeScript([
    'scripts/refresh-cache.js',
    'scripts/update-cache.js',
    'scripts/build-cache.js',
    'scripts/refresh.js',
    'refresh-cache.js',
    'update-cache.js',
    'build-cache.js',
  ], 'Original refresh-cache', true);

  // 2) Run Filmbaze stream repair if present.
  tryRunNodeScript([
    'scripts/filmbaze-stream-repair.js',
    'scripts/repair-filmbaze-streams.js',
    'scripts/repair-streams.js',
  ], 'Filmbaze stream repair', false);

  // 3) Run optional TMDB repair if present.
  tryRunNodeScript([
    'scripts/tmdb-repair.js',
    'scripts/repair-tmdb.js',
  ], 'TMDB repair', false);

  console.log('\nDone: refresh-cache with repair finished.');
}

try {
  main();
} catch (err) {
  console.error('\nFAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
}
