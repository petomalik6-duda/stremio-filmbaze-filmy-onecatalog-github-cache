import 'dotenv/config';
import { refreshCache, getCatalogStats } from '../src/catalog.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

const forceFull = process.env.FORCE_FULL_REFRESH === 'true';

try {
  console.log(`Starting Filmbáze refresh v${packageVersion}...`);
  console.log('FORCE_FULL_REFRESH:', forceFull);
  const metas = await refreshCache({ forceFull });
  console.log('Refresh done.');
  console.log('Items:', metas.length);
  console.log('Stats:', JSON.stringify(await getCatalogStats(), null, 2));
  process.exit(0);
} catch (error) {
  console.error('Refresh failed:', error);
  process.exit(1);
}
