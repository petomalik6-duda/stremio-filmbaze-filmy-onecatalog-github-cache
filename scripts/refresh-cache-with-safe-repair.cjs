'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();

const refreshCandidates = [
  'scripts/refresh-cache.js',
  'scripts/update-cache.js',
  'scripts/build-cache.js',
  'scripts/refresh.js',
  'refresh-cache.js',
  'update-cache.js',
  'build-cache.js'
];

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function runNode(rel) {
  console.log(`[refresh-cache-with-safe-repair] running node ${rel}`);
  const result = spawnSync(process.execPath, [rel], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`${rel} failed with exit code ${result.status}`);
  }
}

function runIfExists(rel) {
  if (exists(rel)) {
    runNode(rel);
    return true;
  }
  return false;
}

function main() {
  console.log('[refresh-cache-with-safe-repair] start');

  const refreshFile = refreshCandidates.find(exists);
  if (!refreshFile) {
    console.log('[refresh-cache-with-safe-repair] WARNING: original refresh script was not found.');
    console.log('[refresh-cache-with-safe-repair] Checked:', refreshCandidates.join(', '));
    console.log('[refresh-cache-with-safe-repair] Continuing with safe repair only.');
  } else {
    runNode(refreshFile);
  }

  // Safe repair is optional. It must not break the refresh if it cannot repair anything.
  try {
    if (!runIfExists('scripts/filmbaze-safe-cache-repair.cjs')) {
      console.log('[refresh-cache-with-safe-repair] no cache repair script found, skipping');
    }
  } catch (err) {
    console.error('[refresh-cache-with-safe-repair] safe repair failed but refresh already ran:', err.message);
  }

  console.log('[refresh-cache-with-safe-repair] done');
}

main();
