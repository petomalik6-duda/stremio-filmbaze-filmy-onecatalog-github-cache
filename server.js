import 'dotenv/config';
import express from 'express';
import {
  filterCatalog,
  getCatalog,
  getCatalogStats,
  getMetaById,
  refreshCache,
  refreshCacheBackground,
  searchCatalog,
  isRefreshRunning
} from './src/catalog.js';

const PORT = Number(process.env.PORT || 10000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const AUTO_REFRESH = String(process.env.AUTO_REFRESH || 'false').toLowerCase() === 'true';
const REFRESH_ON_START = String(process.env.REFRESH_ON_START || 'false').toLowerCase() === 'true';
const AUTO_REFRESH_MINUTES = Math.max(15, Number(process.env.AUTO_REFRESH_MINUTES || 360));

const catalogs = [
  {
    type: 'movie',
    id: 'filmbaze-filmy',
    name: 'Filmbáze – CZ/SK filmy',
    extra: [
      { name: 'skip', isRequired: false },
      { name: 'search', isRequired: false }
    ]
  }
];

const manifest = {
  id: 'cz.filmbaze.filmy.only.v100',
  version: '1.0.0',
  name: 'Filmbáze CZ/SK filmy',
  description: 'Jeden katalóg CZ/SK dabovaných filmov z Filmbáze.sk. Cache sa ukladá do GitHub repozitára.',
  logo: `${PUBLIC_URL}/logo.png`,
  resources: ['catalog', 'meta'],
  types: ['movie'],
  catalogs,
  idPrefixes: ['tt', 'filmovenovinky:'],
  behaviorHints: { configurable: false }
};

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});
app.use(express.json());
app.use('/logo.png', express.static('logo.png'));

function cleanMeta(meta) {
  if (!meta) return null;
  const { _addon, ...safeMeta } = meta;
  return safeMeta;
}

function parseExtra(extraRaw = '') {
  const extra = {};
  if (!extraRaw) return extra;

  for (const part of String(extraRaw).split('&')) {
    const [key, value = ''] = part.split('=');
    if (key) extra[decodeURIComponent(key)] = decodeURIComponent(value);
  }

  return extra;
}

function typeOk(type) {
  return type === 'movie';
}

function catalogOk(type, id) {
  return catalogs.some(c => c.type === type && c.id === id);
}

async function catalogResponse(type, id, extra = {}) {
  if (!typeOk(type) || !catalogOk(type, id)) return { metas: [] };

  const skip = Math.max(0, Number(extra.skip || 0));
  let metas = filterCatalog(await getCatalog(), id, type);
  metas = searchCatalog(metas, extra.search || '');

  return { metas: metas.slice(skip, skip + 100).map(cleanMeta) };
}

app.get('/', (_req, res) => {
  res.type('html').send(`
    <html>
      <head><title>Filmbáze Addon Fixed</title></head>
      <body>
        <h1>Filmbáze CZ/SK filmy</h1>
        <p>Manifest: <a href="/manifest.json">/manifest.json</a></p>
        <p>Health: <a href="/health">/health</a></p>
        <p>Stats: <a href="/stats">/stats</a></p>
        <p>Refresh async: <a href="/refresh">/refresh</a></p>
      </body>
    </html>
  `);
});

app.get('/manifest.json', (_req, res) => res.json(manifest));

app.get('/catalog/:type/:id.json', async (req, res, next) => {
  try {
    res.json(await catalogResponse(req.params.type, req.params.id, req.query));
  } catch (e) {
    next(e);
  }
});

app.get('/catalog/:type/:id/:extra.json', async (req, res, next) => {
  try {
    res.json(await catalogResponse(req.params.type, req.params.id, parseExtra(req.params.extra)));
  } catch (e) {
    next(e);
  }
});

app.get('/meta/:type/:id.json', async (req, res, next) => {
  try {
    if (!typeOk(req.params.type)) return res.json({ meta: null });
    const meta = await getMetaById(req.params.id);
    res.json({ meta: meta?.type === req.params.type ? cleanMeta(meta) : null });
  } catch (e) {
    next(e);
  }
});

app.get('/search/:type/:query.json', async (req, res, next) => {
  try {
    const metas = searchCatalog(filterCatalog(await getCatalog(), 'filmbaze-filmy', req.params.type), req.params.query);
    res.json({ metas: metas.slice(0, 100).map(cleanMeta) });
  } catch (e) {
    next(e);
  }
});

app.get('/health', async (_req, res) => {
  const stats = await getCatalogStats().catch(e => ({ error: e.message }));
  res.json({
    ok: true,
    version: manifest.version,
    autoRefresh: AUTO_REFRESH,
    refreshOnStart: REFRESH_ON_START,
    refreshMinutes: AUTO_REFRESH_MINUTES,
    ...stats
  });
});

app.get('/stats', async (_req, res, next) => {
  try {
    res.json(await getCatalogStats());
  } catch (e) {
    next(e);
  }
});

// Rýchly refresh endpoint: odpovie hneď a refresh beží na pozadí.
app.get('/refresh', async (req, res) => {
  const forceFull = req.query.full === '1' || req.query.full === 'true';

  if (!isRefreshRunning()) {
    refreshCacheBackground({ forceFull });
  }

  res.json({
    ok: true,
    started: true,
    running: true,
    full: forceFull,
    message: 'Refresh beží na pozadí. Skontroluj /stats o chvíľu.'
  });
});

// Blokujúci endpoint len na manuálne testovanie mimo Stremia.
app.get('/refresh-now', async (req, res, next) => {
  try {
    const forceFull = req.query.full === '1' || req.query.full === 'true';
    const metas = await refreshCache({ forceFull });
    res.json({ ok: true, full: forceFull, items: metas.length, stats: await getCatalogStats() });
  } catch (e) {
    next(e);
  }
});


app.get('/reset-refresh', async (_req, res) => {
  res.json({
    ok: true,
    message: 'Ak refresh visel, reštartuj Render službu. V3.2 má lock timeout a už by nemal visieť donekonečna.'
  });
});

app.get('/cache.json', async (_req, res, next) => {
  try {
    const metas = await getCatalog();
    res.json({ items: metas.length, metas });
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`Addon running on port ${PORT}`);
  console.log(`Manifest: ${PUBLIC_URL}/manifest.json`);

  if (REFRESH_ON_START) {
    setTimeout(() => refreshCacheBackground().catch(e => console.error('Initial refresh failed:', e.message)), 2000);
  }

  if (AUTO_REFRESH) {
    setInterval(() => refreshCacheBackground().catch(e => console.error('Auto refresh failed:', e.message)), AUTO_REFRESH_MINUTES * 60 * 1000);
  }
});
