import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 7000;
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 100);

const ADDON_ID = "cz.filmbaze.json.filmy.serialy.v331";
const ADDON_VERSION = "3.3.1";

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".github",
  ".cache",
  "coverage",
  "dist",
  "build"
]);

const PREFERRED_CACHE_PATHS = [
  "data/cache.json",
  "data/filmbaze-cache.json",
  "data/filmbaze.json",
  "data/catalog.json",
  "data/items.json",
  "cache/filmbaze-cache.json",
  "cache/cache.json",
  "public/cache.json",
  "public/filmbaze-cache.json",
  "cache.json",
  "filmbaze-cache.json",
  "filmbaze.json",
  "data.json",
  "items.json"
];

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function extractItems(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.metas)) return json.metas;
  if (Array.isArray(json.movies) || Array.isArray(json.series)) {
    return [
      ...(Array.isArray(json.movies) ? json.movies.map((x) => ({ ...x, type: x.type || "movie" })) : []),
      ...(Array.isArray(json.series) ? json.series.map((x) => ({ ...x, type: x.type || "series" })) : [])
    ];
  }
  if (json.cache && Array.isArray(json.cache.items)) return json.cache.items;
  if (json.data && Array.isArray(json.data.items)) return json.data.items;
  return [];
}

function looksLikeFilmbazeItems(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  const sample = items.slice(0, 20);
  return sample.some((item) => {
    if (!item || typeof item !== "object") return false;
    return Boolean(
      item.source === "Filmbáze" ||
      item.name ||
      item.title ||
      item.tmdbId ||
      item.imdbId ||
      item.poster ||
      item.releaseDate
    );
  });
}

function walkJsonFiles(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkJsonFiles(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

function loadCache() {
  const tried = [];

  for (const rel of PREFERRED_CACHE_PATHS) {
    const file = path.join(__dirname, rel);
    tried.push(rel);
    const json = readJsonSafe(file);
    const items = extractItems(json);
    if (looksLikeFilmbazeItems(items)) {
      console.log("[cache] loaded preferred", rel, "items:", items.length);
      return { file, relFile: rel, at: json?.at || null, sourceHash: json?.sourceHash || null, items, tried };
    }
  }

  const allJson = walkJsonFiles(__dirname);
  const candidates = [];

  for (const file of allJson) {
    const rel = path.relative(__dirname, file);
    if (tried.includes(rel)) continue;
    const json = readJsonSafe(file);
    const items = extractItems(json);
    if (looksLikeFilmbazeItems(items)) {
      candidates.push({ file, rel, json, items, count: items.length });
    }
  }

  candidates.sort((a, b) => b.count - a.count);

  if (candidates.length) {
    const best = candidates[0];
    console.log("[cache] auto-detected", best.rel, "items:", best.items.length);
    return {
      file: best.file,
      relFile: best.rel,
      at: best.json?.at || null,
      sourceHash: best.json?.sourceHash || null,
      items: best.items,
      tried,
      candidates: candidates.slice(0, 10).map((c) => ({ file: c.rel, items: c.count }))
    };
  }

  console.warn("[cache] no cache found. Tried:", tried.join(", "));
  return { file: null, relFile: null, at: null, sourceHash: null, items: [], tried, candidates: [] };
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

function getStremioId(item) {
  if (isValidImdbId(item.imdbId)) return item.imdbId;
  if (isValidImdbId(item.id)) return item.id;
  if (item.tmdbId) return `tmdb:${item.tmdbId}`;
  if (item.id !== undefined && item.id !== null) return `filmbaze:${item.id}`;
  const key = normalizeText(`${item.type || "movie"} ${item.name || item.title || ""} ${item.year || ""}`);
  return `filmbaze:${key || "unknown"}`;
}

function getYear(item) {
  if (item.year) return String(item.year);
  if (item.releaseDate) {
    const year = String(item.releaseDate).slice(0, 4);
    if (/^\d{4}$/.test(year)) return year;
  }
  return "";
}

function getType(item) {
  return item.type === "series" ? "series" : "movie";
}

function getName(item) {
  return item.name || item.title || item.originalName || item.originalTitle || "Bez názvu";
}

function cleanUndefined(obj) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined || obj[key] === null) delete obj[key];
  }
  return obj;
}

function toMetaPreview(item) {
  const id = getStremioId(item);
  const year = getYear(item);

  return cleanUndefined({
    id,
    type: getType(item),
    name: getName(item),
    poster: item.poster || item.posterUrl,
    background: item.background || item.backdrop || item.backdropUrl,
    description: item.description || item.overview,
    releaseInfo: year || undefined,
    imdbId: isValidImdbId(item.imdbId) ? item.imdbId : undefined,
    genres: Array.isArray(item.genres) ? item.genres : undefined,
    runtime: item.runtime ? `${item.runtime} min` : undefined,
    behaviorHints: { defaultVideoId: id }
  });
}

function toMetaDetail(item) {
  const id = getStremioId(item);
  const type = getType(item);
  const year = getYear(item);

  const meta = cleanUndefined({
    id,
    type,
    name: getName(item),
    poster: item.poster || item.posterUrl,
    background: item.background || item.backdrop || item.backdropUrl,
    description: item.description || item.overview,
    releaseInfo: year || undefined,
    imdbId: isValidImdbId(item.imdbId) ? item.imdbId : undefined,
    genres: Array.isArray(item.genres) ? item.genres : undefined,
    runtime: item.runtime ? `${item.runtime} min` : undefined,
    released: item.releaseDate || undefined,
    country: item.country || undefined,
    director: item.director || undefined,
    cast: Array.isArray(item.cast) ? item.cast : undefined,
    videos: [],
    behaviorHints: { defaultVideoId: id }
  });

  if (type === "movie") {
    meta.videos = [cleanUndefined({
      id,
      title: getName(item),
      released: item.releaseDate || undefined,
      overview: item.description || undefined,
      thumbnail: item.poster || item.background || undefined
    })];
  } else if (type === "series" && Array.isArray(item.videos)) {
    meta.videos = item.videos;
  }

  return meta;
}

function matchSearch(item, search) {
  if (!search) return true;
  const q = normalizeText(search);
  const haystack = normalizeText([
    item.name,
    item.title,
    item.originalName,
    item.originalTitle,
    item.year,
    item.imdbId,
    item.tmdbId
  ].filter(Boolean).join(" "));
  return haystack.includes(q);
}

function findItemById(type, id, items) {
  const wantedType = type === "series" ? "series" : "movie";
  return items.find((item) => {
    if (getType(item) !== wantedType) return false;
    if (getStremioId(item) === id) return true;
    if (item.imdbId === id) return true;
    if (String(item.tmdbId || "") === id) return true;
    if (item.tmdbId && `tmdb:${item.tmdbId}` === id) return true;
    if (item.id !== undefined && `filmbaze:${item.id}` === id) return true;
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
  res.type("html").send(`
    <html><body>
      <h1>Filmbáze Stremio addon</h1>
      <p><a href="/manifest.json">/manifest.json</a></p>
      <p><a href="/health">/health</a></p>
      <p><a href="/debug/cache">/debug/cache</a></p>
    </body></html>
  `);
});

app.get("/health", (req, res) => {
  const cache = loadCache();
  res.json({
    ok: true,
    addon: ADDON_ID,
    version: ADDON_VERSION,
    cacheFile: cache.relFile,
    items: cache.items.length,
    movies: cache.items.filter((item) => getType(item) === "movie").length,
    series: cache.items.filter((item) => getType(item) === "series").length,
    withImdb: cache.items.filter((item) => isValidImdbId(item.imdbId)).length,
    sample: cache.items.slice(0, 3).map((item) => ({
      id: item.id,
      stremioId: getStremioId(item),
      name: getName(item),
      imdbId: item.imdbId || null,
      tmdbId: item.tmdbId || null,
      type: getType(item)
    }))
  });
});

app.get("/debug/cache", (req, res) => {
  const cache = loadCache();
  res.json({
    ok: true,
    cacheFile: cache.relFile,
    fullPath: cache.file,
    items: cache.items.length,
    tried: cache.tried,
    candidates: cache.candidates || [],
    sample: cache.items.slice(0, 10).map((item) => ({
      id: item.id,
      stremioId: getStremioId(item),
      type: getType(item),
      name: getName(item),
      imdbId: item.imdbId || null,
      tmdbId: item.tmdbId || null
    }))
  });
});

app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/catalog/:type/:id.json", (req, res) => {
  try {
    const { type, id } = req.params;
    if (!["movie", "series"].includes(type)) return res.json({ metas: [] });
    if (type === "movie" && id !== "filmbaze-filmy") return res.json({ metas: [] });
    if (type === "series" && id !== "filmbaze-serialy") return res.json({ metas: [] });

    const skip = Math.max(0, Number(req.query.skip || 0));
    const search = req.query.search ? String(req.query.search) : "";
    const cache = loadCache();

    const filtered = cache.items
      .filter((item) => getType(item) === type)
      .filter((item) => matchSearch(item, search))
      .sort((a, b) => {
        const ao = Number(a.channelOrder ?? a.order ?? 999999);
        const bo = Number(b.channelOrder ?? b.order ?? 999999);
        if (ao !== bo) return ao - bo;
        const ad = new Date(a.dateAdded || a.releaseDate || 0).getTime();
        const bd = new Date(b.dateAdded || b.releaseDate || 0).getTime();
        return bd - ad;
      });

    res.json({ metas: filtered.slice(skip, skip + PAGE_SIZE).map(toMetaPreview) });
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

app.get("/debug/item/:type/:id", (req, res) => {
  const { type, id } = req.params;
  const cache = loadCache();
  const item = findItemById(type, id, cache.items);
  if (!item) {
    return res.status(404).json({
      ok: false,
      error: "item not found",
      type,
      id,
      cacheFile: cache.relFile,
      items: cache.items.length,
      candidates: cache.candidates || []
    });
  }
  res.json({
    ok: true,
    type,
    id,
    cacheFile: cache.relFile,
    stremioId: getStremioId(item),
    imdbId: item.imdbId || null,
    tmdbId: item.tmdbId || null,
    filmbazeId: item.id || null,
    name: getName(item),
    originalName: item.originalName || null,
    item
  });
});

app.listen(PORT, () => {
  console.log(`Filmbáze addon running on port ${PORT}`);
});
