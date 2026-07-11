const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
const itemMetaKey = x => `${x?.type || ''}:fb:${x?.id ?? ''}`;

function mergeType(type) {
  const fresh = nowItems
    .filter(item => item?.type === type)
    .sort((a, b) => Number(a?.channelOrder ?? 999999) - Number(b?.channelOrder ?? 999999));
  const freshKeys = new Set(fresh.map(sourceKey));
  const preserved = oldItems
    .filter(item => item?.type === type && !freshKeys.has(sourceKey(item)))
    .sort((a, b) => {
      const order = Number(a?.channelOrder ?? 999999) - Number(b?.channelOrder ?? 999999);
      if (order) return order;
      return String(b?.dateAdded || '').localeCompare(String(a?.dateAdded || ''));
    });

  return [...fresh, ...preserved].map((item, index) => ({
    ...item,
    channelOrder: index,
    page: item?.page || Math.floor(index / 50) + 1
  }));
}

const items = [...mergeType('movie'), ...mergeType('series')];
const itemKeys = new Set(items.map(sourceKey));
for (const item of [...nowItems, ...oldItems]) {
  const key = sourceKey(item);
  if (!itemKeys.has(key)) {
    items.push(item);
    itemKeys.add(key);
  }
}

const oldMetas = Array.isArray(previous.metas) ? previous.metas : [];
const nowMetas = Array.isArray(current.metas) ? current.metas : [];
const mergedMetaMap = new Map(oldMetas.map(x => [metaKey(x), x]));
for (const x of nowMetas) mergedMetaMap.set(metaKey(x), x);

const metas = [];
const usedMetaKeys = new Set();
for (const item of items) {
  const key = itemMetaKey(item);
  const meta = mergedMetaMap.get(key);
  if (!meta) continue;
  metas.push({
    ...meta,
    _addon: {
      ...(meta._addon || {}),
      filmbazeId: item.id,
      key: String(item.id),
      channelOrder: item.channelOrder,
      page: item.page || null,
      dateAdded: item.dateAdded || meta?._addon?.dateAdded || ''
    }
  });
  usedMetaKeys.add(key);
}
for (const [key, meta] of mergedMetaMap) {
  if (!usedMetaKeys.has(key)) metas.push(meta);
}

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
    preservedMetas: Math.max(0, metas.length - nowMetas.length),
    freshTitlesRankedFirst: true
  }
};

fs.writeFileSync(currentFile, JSON.stringify(output, null, 2));
console.log(`[safe-merge] Partial result ${nowItems.length}/${oldItems.length}; merged and re-ranked to ${items.length} source items and ${metas.length} metas.`);
