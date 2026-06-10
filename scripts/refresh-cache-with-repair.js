#!/usr/bin/env node
/*
  Filmbáze refresh-cache wrapper with repair.
  Safe version: tries to run the existing cache refresh first, then stream repair.
  It supports projects where the original refresh script has a different filename.
*/

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function runNode(file, args = []) {
  console.log(`\n▶ node ${file} ${args.join(' ')}`.trim());
  const result = spawnSync(process.execPath, [file, ...args], {
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    throw new Error(`${file} failed with exit code ${result.status}`);
  }
}

function runNpm(script) {
  console.log(`\n▶ npm run ${script}`);
  const result = spawnSync('npm', ['run', script], {
    stdio: 'inherit',
    env: { ...process.env, FILMBAZE_WRAPPER_RUNNING: '1' },
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    throw new Error(`npm run ${script} failed with exit code ${result.status}`);
  }
}

function exists(file) {
  return fs.existsSync(path.join(process.cwd(), file));
}

function readPackageScripts() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    return pkg.scripts || {};
  } catch {
    return {};
  }
}

function findRefreshCommand() {
  const scripts = readPackageScripts();

  // Avoid infinite loop if someone names this wrapper as refresh-cache.
  const candidateNpmScripts = [
    'refresh',
    'update-cache',
    'build-cache',
    'cache:refresh',
    'cache:update',
    'scrape',
    'sync-cache',
  ];

  for (const name of candidateNpmScripts) {
    if (scripts[name]) return { type: 'npm', name };
  }

  const candidateFiles = [
    'scripts/refresh-cache.js',
    'scripts/update-cache.js',
    'scripts/build-cache.js',
    'scripts/sync-cache.js',
    'refresh-cache.js',
    'update-cache.js',
    'build-cache.js',
    'server-refresh-cache.js',
  ];

  for (const file of candidateFiles) {
    if (exists(file)) return { type: 'node', file };
  }

  return null;
}

async function main() {
  console.log('=== Filmbáze refresh-cache with repair ===');

  if (process.env.FILMBAZE_WRAPPER_RUNNING === '1') {
    throw new Error('Refusing to call wrapper recursively. Check package.json scripts.');
  }

  const refresh = findRefreshCommand();
  if (!refresh) {
    console.error('\nCould not find original refresh script.');
    console.error('Add one of these to package.json, for example:');
    console.error('  "refresh-cache": "node scripts/refresh-cache.js"');
    console.error('\nOr rename your existing refresh command to one of: refresh, update-cache, build-cache, cache:refresh.');
    process.exit(1);
  }

  if (refresh.type === 'npm') runNpm(refresh.name);
  else runNode(refresh.file);

  const repairFile = 'scripts/filmbaze-stream-repair.js';
  if (exists(repairFile)) {
    runNode(repairFile);
  } else {
    console.log(`\n⚠ ${repairFile} not found, skipping stream repair.`);
    console.log('Upload scripts/filmbaze-stream-repair.js from the Filmbáze repair package.');
  }

  const tmdbRepairFile = 'scripts/tmdb-repair.js';
  if (exists(tmdbRepairFile)) {
    runNode(tmdbRepairFile);
  } else {
    console.log(`\nℹ ${tmdbRepairFile} not found, skipping TMDB repair.`);
  }

  console.log('\n✅ Refresh-cache with repair finished.');
}

main().catch(err => {
  console.error('\n❌ refresh-cache-with-repair failed:', err.message);
  process.exit(1);
});
