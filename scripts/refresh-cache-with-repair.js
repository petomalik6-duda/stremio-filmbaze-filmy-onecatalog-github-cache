'use strict';

/**
 * Filmbáze refresh-cache wrapper
 *
 * Purpose:
 * 1. run your normal cache refresh
 * 2. repair movies that have TMDB metadata but no stream source / primaryVideo
 * 3. save the repaired cache so GitHub Actions can commit it
 *
 * This wrapper is intentionally safe: if your existing refresh-cache.js only works
 * as a CLI script and does not export refreshCache(), this file will run it as a
 * child process first, then continue with repair if the adapter can load cache.
 */

const path = require('path');
const { spawnSync } = require('child_process');

function tryRequire(modPath) {
  try {
    return require(modPath);
  } catch (err) {
    return null;
  }
}

async function runExistingRefresh() {
  const refreshPath = path.join(__dirname, 'refresh-cache.js');
  const refreshMod = tryRequire(refreshPath);

  if (refreshMod && typeof refreshMod.refreshCache === 'function') {
    console.log('[refresh-cache-with-repair] Running exported refreshCache()...');
    return await refreshMod.refreshCache();
  }

  if (refreshMod && typeof refreshMod.main === 'function') {
    console.log('[refresh-cache-with-repair] Running exported main()...');
    return await refreshMod.main();
  }

  console.log('[refresh-cache-with-repair] Running scripts/refresh-cache.js as CLI...');
  const result = spawnSync(process.execPath, [refreshPath], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(`Existing refresh-cache.js failed with exit code ${result.status}`);
  }
}

async function runRepair() {
  const adapter = require('./repair-filmbaze-after-refresh');
  if (typeof adapter.repairAfterRefresh !== 'function') {
    throw new Error('repair-filmbaze-after-refresh.js must export repairAfterRefresh()');
  }

  const limit = Number(process.env.REPAIR_LIMIT || process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || 300);
  console.log(`[refresh-cache-with-repair] Repairing Filmbáze stream sources, limit=${limit}...`);
  return await adapter.repairAfterRefresh({ limit });
}

async function main() {
  await runExistingRefresh();

  if (process.env.REPAIR_STREAMS === '0') {
    console.log('[refresh-cache-with-repair] REPAIR_STREAMS=0, skipping repair.');
    return;
  }

  const result = await runRepair();
  console.log('[refresh-cache-with-repair] Repair result:', JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error('[refresh-cache-with-repair] failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
