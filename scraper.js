import 'dotenv/config';
import { refreshCache } from './src/catalog.js';

const metas = await refreshCache();
console.log(JSON.stringify({ items: metas.length, sample: metas.slice(0, 5) }, null, 2));
