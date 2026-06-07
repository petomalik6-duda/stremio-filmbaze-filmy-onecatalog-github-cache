import 'dotenv/config';
import { refreshCache, getCatalogStats } from '../src/catalog.js';

const forceFull = process.env.FORCE_FULL_REFRESH === 'true';

try {
  console.log('Starting catalog refresh...');
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
