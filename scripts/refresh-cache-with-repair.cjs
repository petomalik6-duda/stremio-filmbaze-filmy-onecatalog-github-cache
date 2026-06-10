#!/usr/bin/env node
'use strict';

/**
 * Filmbaze refresh-cache wrapper for projects with "type": "module".
 * This file is CommonJS because it uses .cjs extension.
 * It runs the existing cache refresh script first, then optional repair script.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function runNode(rel, args = []) {
  const full = path.join(root, rel);
  console.log(`\n▶ node ${rel} ${args.join(' ')}`.trim());
  const r = spawnSync(process.execPath, [full, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (r.status !== 0) {
    throw new Error(`${rel} failed with exit code ${r.status}`);
  }
}

function runNpmScript(scriptName) {
  console.log(`\n▶ npm run ${scriptName}`);
  const r = spawnSync('npm', ['run', scriptName], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32'
  });
  if (r.status !== 0) {
    throw new Error(`npm run ${scriptName} failed with exit code ${r.status}`);
  }
}

function readPackageScripts() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return pkg.scripts || {};
  } catch (_) {
    return {};
  }
}

function findRefreshTarget() {
  const scripts = readPackageScripts();

  // If the repo already has a normal refresh script, use it.
  // Avoid recursively calling this wrapper.
  if (scripts['refresh-cache'] && !String(scripts['refresh-cache']).includes('refresh-cache-with-repair')) {
    return { type: 'npm', value: 'refresh-cache' };
  }

  const candidates = [
    'scripts/refresh-cache.js',
    'scripts/refresh-cache.mjs',
    'scripts/update-cache.js',
    'scripts/update-cache.mjs',
    'scripts/build-cache.js',
    'scripts/build-cache.mjs',
    'scripts/refresh.js',
    'scripts/refresh.mjs',
    'refresh-cache.js',
    'refresh-cache.mjs',
    'update-cache.js',
    'update-cache.mjs',
    'build-cache.js',
    'build-cache.mjs'
  ];

  for (const rel of candidates) {
    if (exists(rel)) return { type: 'node', value: rel };
  }

  return null;
}

function findRepairTarget() {
  const candidates = [
    'scripts/filmbaze-stream-repair.cjs',
    'scripts/filmbaze-stream-repair.js',
    'scripts/repair-filmbaze-streams.cjs',
    'scripts/repair-filmbaze-streams.js'
  ];
  for (const rel of candidates) {
    if (exists(rel)) return rel;
  }
  return null;
}

async function main() {
  console.log('Filmbaze refresh-cache with repair wrapper');
  console.log('Project root:', root);

  const refresh = findRefreshTarget();
  if (!refresh) {
    console.error('\nCould not find original refresh script.');
    console.error('Expected one of:');
    console.error('  scripts/refresh-cache.js');
    console.error('  scripts/update-cache.js');
    console.error('  scripts/build-cache.js');
    console.error('  refresh-cache.js');
    console.error('Or add package.json script: "refresh-cache"');
    process.exit(1);
  }

  if (refresh.type === 'npm') runNpmScript(refresh.value);
  else runNode(refresh.value);

  const repair = findRepairTarget();
  if (!repair) {
    console.log('\nNo Filmbaze repair script found. Refresh finished without repair.');
    return;
  }

  // Repair is best-effort. If it fails, the workflow should fail so you see the real problem.
  runNode(repair);

  console.log('\nDone: refresh-cache + repair finished.');
}

main().catch(err => {
  console.error('\nrefresh-cache-with-repair failed:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
