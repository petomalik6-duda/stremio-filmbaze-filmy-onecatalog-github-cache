import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CACHE_FILE = process.env.CACHE_FILE || path.join(DATA_DIR, 'catalog-cache.json');

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readStore() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      at: parsed.at || 0,
      sourceHash: parsed.sourceHash || '',
      items: Array.isArray(parsed.items) ? parsed.items : [],
      metas: Array.isArray(parsed.metas) ? parsed.metas : [],
      lastError: parsed.lastError || null
    };
  } catch {
    return {
      at: 0,
      sourceHash: '',
      items: [],
      metas: [],
      lastError: null
    };
  }
}

export async function writeStore(payload) {
  await ensureDataDir();
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2));
}

export function storePath() {
  return CACHE_FILE;
}
