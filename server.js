import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7000;
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 100);
const CACHE_FILE_ENV = process.env.CACHE_FILE || "";

const ADDON_ID = "cz.filmbaze.json.filmy.serialy.v332";
const ADDON_VERSION = "3.3.2";

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

const DEFAULT_CACHE_CANDIDATES = [
  "data/cache.json",
  "data/filmbaze-cache.json",
  "data/filmbaze.json",
  "data/catalog.json",
  "data/items.json",
  "cache/cache.json",
  "cache/filmbaze-cache.json",
  "cache.json",
  "filmbaze-cache.json",
  "catalog.json",
  "items.json",
  "data.json"
];

const SKIP_DIRS = new Set(["node_modules", ".git", ".github", ".cache", "dist", "build", ".next", "coverage"]);
const SKIP_FILES = new Set(["package-lock.json", "package.json", "manifest.json"]);

let cacheState = {
  file: null,
  at: null,
  sourceHash: null,
  items: [],
  loadedAt: 0,
  error: null,
  checkedFiles: []
};

function readJsonSafe(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;
    if (stat.size > 50 * 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (err) {
    return null;
  }
}

function extractItems(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.metas)) return json.metas;

  const items = [];
  if (Array.isArray(json.movies)) items.push(...json.movies.map(x => ({ ...x, type: x.type || "movie" })));
  if (Array.isArray(json.series)) items.push(...json.series.map(x => ({ ...x, type: x.type || "series" })));
  return items;
}

function scanJsonFiles(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) scanJsonFiles(path.join(dir, ent.name), out, depth + 1);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith(".json")) continue;
    if (SKIP_FILES.has(ent.name)) continue;
    out.push(path.join(dir, ent.name));
  }
  return out;
}

function findBestCacheFile() {
  const checked = [];
  const candidates = [];

  if (CACHE_FILE_ENV) {
    candidates.push(path.isAbsolute(CACHE_FILE_ENV) ? CACHE_FILE_ENV : path.join(__dirname, CACHE_FILE_ENV));
  }

  for (const rel of DEFAULT_CACHE_CANDIDATES) {
    candidates.push(path.join(__dirname, rel));
  }

  const uniqueCandidates = [...new Set(candidates)];
  let best = { file: null, json: null, items: [] };

  for (const file of uniqueCandidates) {
    const json = readJsonSafe(file);
    const items = extractItems(json);
    checked.push({ file: path.relative(__dirname, file), items: items.length });
    if (items.length > best.items.length) best = { file, json, items };
  }

  if (best.items.length > 0) {
    best.checked = checked;
    return best;
  }

  const scanned = scanJsonFiles(__dirname);
  for (const file of scanned) {
    if (uniqueCandidates.includes(file)) continue;
    const json = readJsonSafe(file);
    const items = extractItems(json);
    checked.push({ file: path.relative(__dirname, file), items: items.length });
    if (items.length > best.items.length) best = { file, json, items };
  }

  best.checked = checked.sort((a, b) => b.items - a.items).slice(0, 30);
  return best;
}

function loadCache(force = false) {
  const now = Date.now();
  if (!force && cacheState.loadedAt && now - cacheState.loadedAt < 60_000) return cacheState;

  try {
    const best = findBestCacheFile();
    if (!best.file || !best.items.length) {
      cacheState = {
        file: null,
        at: null,
        sourceHash: null,
        items: [],
        loadedAt: now,
        error: "No cache JSON with items/metas/movies/series found",
        checkedFiles: best.checked || []
      };
      return cacheState;
    }

    cacheState = {
      file: path.relative(__dirname, best.file),
      at: best.json?.at || null,
      sourceHash: best.json?.sourceHash || null,
      items: best.items,
      loadedAt: now,
      error: null,
      checkedFiles: best.checked || []
    };
    return cacheState;
  } catch (err) {
    cacheState = {
      ...cacheState,
      loadedAt: now,
      error: err.message
    };
    return cacheState;
  }
}

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidImdbId(value) {
  return typeof value === "string" && /^tt\d{5,}$/.test(value);
}

function getType(item) {
  return item?.type === "series" ? "series" : "movie";
}

function getYear(item) {
  if (item?.year) return String(item.year);
  if (item?.releaseDate) {
    const y = String(item.releaseDate).slice(0, 4);
    if (/^\d{4}$/.test(y)) return y;
  }
  return "";
}

function getName(item) {
  return item?.name || item?.title || item?.originalName || item?.originalTitle || "Bez názvu";
}

function getStremioId(item) {
  if (isValidImdbId(item?.imdbId)) return item.imdbId;
  if (isValidImdbId(item?.id)) return item.id;
  if (item?.tmdbId) return `tmdb:${item.tmdbId}`;
  if (item?.id !== undefined && item?.id !== null) return `filmbaze:${item.id}`;
  const key = normalizeText(`${getType(item)} ${getName(item)} ${getYear(item)}`);
  return `filmbaze:${key || "unknown"}`;
}

function toMetaPreview(item) {
  const id = getStremioId(item);
  const year = getYear(item);
  return {
    id,
    type: getType(item),
    name: getName(item),
    poster: item.poster || item.posterUrl || undefined,
    background: item.background || item.backdrop || item.backdropUrl || undefined,
    description: item.description || item.overview || undefined,
    releaseInfo: year || undefined,
    imdbId: isValidImdbId(item.imdbId) ? item.imdbId : undefined,
    behaviorHints: { defaultVideoId: id }
  };
}

function toMetaDetail(item) {
  const id = getStremioId(item);
  const type = getType(item);
  const meta = {
    ...toMetaPreview(item),
    id,
    type,
    released: item.releaseDate || undefined,
    runtime: item.runtime ? `${item.runtime} min` : undefined,
    genres: Array.isArray(item.genres) ? item.genres : undefined,
    cast: Array.isArray(item.cast) ? item.cast : undefined,
    director: item.director || undefined,
    videos: [],
    behaviorHints: { defaultVideoId: id }
  };

  if (type === "movie") {
    meta.videos = [{
      id,
      title: getName(item),
      released: item.releaseDate || undefined,
      thumbnail: item.poster || item.background || undefined,
      overview: item.description || undefined
    }];
  } else if (Array.isArray(item.videos)) {
    meta.videos = item.videos;
  }

  return meta;
}

function matchSearch(item, search) {
  if (!search) return true;
  const q = normalizeText(search);
  const haystack = normalizeText([
    item.name, item.title, item.originalName, item.originalTitle, item.year, item.imdbId, item.tmdbId
  ].filter(Boolean).join(" "));
  return haystack.includes(q);
}

function findItemById(type, id, items) {
  const wantedType = type === "series" ? "series" : "movie";
  return items.find(item => {
    if (getType(item) !== wantedType) return false;
    if (getStremioId(item) === id) return true;
    if (item.imdbId === id) return true;
    if (String(item.tmdbId || "") === id) return true;
    if (`tmdb:${item.tmdbId}` === id) return true;
    if (`filmbaze:${item.id}` === id) return true;
    return false;
  });
}

const manifest = {
  id: ADDON_ID,
  version: ADDON_VERSION,
  name: "Filmbáze CZ/SK filmy a seriály",
  description: "Jeden katalóg filmov s CZ/SK dabingom z Filmbáze JSON dát.",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "filmbaze-filmy",
      name: "Filmbáze – CZ/SK filmy",
      extra: [
        { name: "skip", isRequired: false },
        { name: "search", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "filmbaze-serialy",
      name: "Filmbáze – seriály v češtině",
      extra: [
        { name: "skip", isRequired: false },
        { name: "search", isRequired: false }
      ]
    }
  ],
  idPrefixes: ["tt", "filmbaze:", "tmdb:"],
  behaviorHints: { configurable: false, configurationRequired: false }
};

app.get("/", (req, res) => {
  res.type("html").send(`<h1>Filmbáze Stremio addon</h1><p><a href="/manifest.json">manifest.json</a></p><p><a href="/health">health</a></p>`);
});

app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/health", (req, res) => {
  const cache = loadCache();
  res.json({
    ok: !cache.error,
    addon: ADDON_ID,
    version: ADDON_VERSION,
    cacheFile: cache.file,
    items: cache.items.length,
    movies: cache.items.filter(i => getType(i) === "movie").length,
    series: cache.items.filter(i => getType(i) === "series").length,
    withImdb: cache.items.filter(i => isValidImdbId(i.imdbId)).length,
    error: cache.error,
    checkedFiles: cache.checkedFiles
  });
});

app.get("/catalog/:type/:id.json", (req, res) => {
  try {
    const { type, id } = req.params;
    if (type === "movie" && id !== "filmbaze-filmy") return res.json({ metas: [] });
    if (type === "series" && id !== "filmbaze-serialy") return res.json({ metas: [] });

    const skip = Math.max(0, Number(req.query.skip || 0));
    const search = req.query.search ? String(req.query.search) : "";
    const cache = loadCache();

    const metas = cache.items
      .filter(item => getType(item) === type)
      .filter(item => matchSearch(item, search))
      .sort((a, b) => {
        const ao = Number(a.channelOrder ?? a.order ?? 999999);
        const bo = Number(b.channelOrder ?? b.order ?? 999999);
        if (ao !== bo) return ao - bo;
        const ad = new Date(a.dateAdded || a.releaseDate || 0).getTime();
        const bd = new Date(b.dateAdded || b.releaseDate || 0).getTime();
        return bd - ad;
      })
      .slice(skip, skip + PAGE_SIZE)
      .map(toMetaPreview);

    res.json({ metas });
  } catch (err) {
    console.error("[catalog] error", err);
    res.status(500).json({ metas: [], error: err.message });
  }
});

app.get("/meta/:type/:id.json", (req, res) => {
  try {
    const { type, id } = req.params;
    const cache = loadCache();
    const item = findItemById(type, id, cache.items);
    if (!item) return res.json({ meta: null });
    res.json({ meta: toMetaDetail(item) });
  } catch (err) {
    console.error("[meta] error", err);
    res.status(500).json({ meta: null, error: err.message });
  }
});

app.get("/debug/cache", (req, res) => {
  const cache = loadCache(true);
  res.json({
    ok: !cache.error,
    cacheFile: cache.file,
    items: cache.items.length,
    error: cache.error,
    checkedFiles: cache.checkedFiles
  });
});

app.get("/debug/item/:type/:id", (req, res) => {
  const { type, id } = req.params;
  const cache = loadCache();
  const item = findItemById(type, id, cache.items);
  if (!item) return res.status(404).json({ ok: false, error: "item not found", type, id, cacheFile: cache.file, items: cache.items.length });
  res.json({ ok: true, stremioId: getStremioId(item), imdbId: item.imdbId || null, tmdbId: item.tmdbId || null, name: getName(item), item });
});

app.listen(PORT, () => {
  loadCache(true);
  console.log(`Filmbáze addon running on port ${PORT}`);
});
