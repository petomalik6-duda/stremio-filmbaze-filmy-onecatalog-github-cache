#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();

const candidates = [
  'scripts/refresh-cache.js',
  'scripts/update-cache.js',
  'scripts/build-cache.js',
  'scripts/refresh.js',
  'refresh-cache.js',
  'update-cache.js',
  'build-cache.js'
];

function exists(p) {
  return fs.existsSync(path.join(root, p));
}

function runNode(file) {
  console.log(`[refresh-cache-with-repair] Running: node ${file}`);
  const result = spawnSync(process.execPath, [file], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`${file} failed with exit code ${result.status}`);
  }
}

function main() {
  const refreshFile = candidates.find(exists);
  if (!refreshFile) {
    console.error('[refresh-cache-with-repair] Could not find original refresh script.');
    console.error('[refresh-cache-with-repair] Looked for:');
    for (const c of candidates) console.error(`- ${c}`);
    process.exit(1);
  }

  runNode(refreshFile);

  const repairFile = 'scripts/filmbaze-stream-repair.cjs';
  if (exists(repairFile)) {
    runNode(repairFile);
  } else {
    console.log(`[refresh-cache-with-repair] ${repairFile} not found, skipping stream repair.`);
  }

  console.log('[refresh-cache-with-repair] Done.');
}

main();
