const fs = require('fs');
const path = require('path');

const currentFile = process.env.CACHE_FILE || path.join(process.cwd(), 'data', 'catalog-cache.json');
const backupFile = process.env.PREVIOUS_CACHE_FILE || path.join(process.cwd(), 'data', 'catalog-cache.before-refresh.json');
const minItems = Number(process.env.MIN_SAFE_SOURCE_ITEMS || 500);
const minRatio = Number(process.env.MIN_SAFE_SOURCE_RATIO || 0.70);

if (!fs.existsSync(currentFile) || !fs.existsSync(backupFile)) {
  console.log('[safe-merge] No backup/current pair; nothing to merge.');
  process.exit(0);
}
const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
const previous = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
const nowItems = Array.isArray(current.items) ? current.items : [];
const oldItems = Array.isArray(previous.items) ? previous.items : [];
const ratio = oldItems.length ? nowItems.length / oldItems.length : 1;
const partial = oldItems.length >= minItems && (nowItems.length < minItems || ratio < minRatio);
if (!partial) {
  console.log(`[safe-merge] Full/safe source result (${nowItems.length} items); no merge needed.`);
  process.exit(0);
}
const sourceKey = x => `${x?.type || ''}:${x?.id || ''}`;
const metaKey = x => {
  const fb = x?._addon?.filmbazeId ?? x?._addon?.key;
  return fb != null ? `${x?.type || ''}:fb:${fb}` : `${x?.type || ''}:id:${x?.id || ''}`;
};
const mergedItems = new Map(oldItems.map(x => [sourceKey(x), x]));
for (const x of nowItems) mergedItems.set(sourceKey(x), x);
const oldMetas = Array.isArray(previous.metas) ? previous.metas : [];
const nowMetas = Array.isArray(current.metas) ? current.metas : [];
const mergedMetas = new Map(oldMetas.map(x => [metaKey(x), x]));
for (const x of nowMetas) mergedMetas.set(metaKey(x), x);
const crypto = require('crypto');
const items = [...mergedItems.values()];
const metas = [...mergedMetas.values()];
const sourceHash = crypto.createHash('sha1')
  .update(items.map(x => `${x.type}|${x.id}|${x.name}|${x.releaseDate || ''}`).join('|'))
  .digest('hex');
const output = {
  ...current,
  items,
  metas,
  sourceHash,
  refreshStats: {
    ...(current.refreshStats || {}),
    partialFetch: true,
    rawFetchedItems: nowItems.length,
    preservedSourceItems: Math.max(0, items.length - nowItems.length),
    preservedMetas: Math.max(0, metas.length - nowMetas.length)
  }
};
fs.writeFileSync(currentFile, JSON.stringify(output, null, 2));
console.log(`[safe-merge] Partial result ${nowItems.length}/${oldItems.length}; merged to ${items.length} source items and ${metas.length} metas.`);
