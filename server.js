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

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[cache] failed to read", file, err.message);
    return null;
  }
}

function collectJsonFiles(dir, depth = 0, out = []) {
  if (depth > 4) return out;
  if (!fs.existsSync(dir)) return out;

  const skipDirs = new Set([
    "node_modules",
    ".git",
    ".github",
    ".cache",
    "dist",
    "build"
  ]);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      collectJsonFiles(full, depth + 1, out);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      out.push(full);
    }
  }

  return out;
}

function extractItemsFromJson(json) {
  if (!json) return [];

  if (Array.isArray(json)) return json;

  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.metas)) return json.metas;
  if (Array.isArray(json.movies)) return json.movies;
  if (Array.isArray(json.series)) return json.series;

  if (json.data && Array.isArray(json.data.items)) return json.data.items;
  if (json.cache && Array.isArray(json.cache.items)) return json.cache.items;

  return [];
}

function loadCache() {
  const explicit = process.env.CACHE_FILE;

  if (explicit) {
    const file = path.isAbsolute(explicit)
      ? explicit
      : path.join(__dirname, explicit);

    const json = readJsonSafe(file);
    const items = extractItemsFromJson(json);

    return {
      file,
      items,
      at: json?.at || null,
      sourceHash: json?.sourceHash || null,
      explicit: true
    };
  }

  const candidates = [
    path.join(__dirname, "data", "cache.json"),
    path.join(__dirname, "data", "filmbaze-cache.json"),
    path.join(__dirname, "data", "filmbaze.json"),
    path.join(__dirname, "data", "catalog.json"),
    path.join(__dirname, "data", "items.json"),
    path.join(__dirname, "cache.json"),
    path.join(__dirname, "filmbaze-cache.json"),
    path.join(__dirname, "filmbaze.json"),
    path.join(__dirname, "catalog.json"),
    path.join(__dirname, "items.json")
  ];

  const allJsonFiles = [
    ...candidates,
    ...collectJsonFiles(__dirname)
  ];

  const uniqueFiles = [...new Set(allJsonFiles)];

  let best = {
    file: null,
    items: [],
    at: null,
    sourceHash: null,
    explicit: false
  };

  for (const file of uniqueFiles) {
    const json = readJsonSafe(file);
    const items = extractItemsFromJson(json);

    if (!Array.isArray(items) || items.length === 0) continue;

    const validLikeItems = items.filter((item) =>
      item &&
      typeof item === "object" &&
      (item.name || item.title || item.originalName || item.originalTitle) &&
      (item.type === "movie" || item.type === "series" || item.year || item.tmdbId || item.imdbId)
    );

    if (validLikeItems.length > best.items.length) {
      best = {
        file,
        items,
        at: json?.at || null,
        sourceHash: json?.sourceHash || null,
        explicit: false
      };
    }
  }

  if (!best.file) {
    console.warn("[cache] no usable cache JSON found");
  }

  return best;
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
    const year = String(item.releaseDate).slice(0, 4);
    if (/^\d{4}$/.test(year)) return year;
  }

  return "";
}

function getName(item) {
  return item?.name || item?.title || item?.originalName || item?.originalTitle || "Bez názvu";
}

function getStremioId(item) {
  if (isValidImdbId(item?.imdbId)) {
    return item.imdbId;
  }

  if (isValidImdbId(item?.id)) {
    return item.id;
  }

  if (item?.tmdbId) {
    return `tmdb:${item.tmdbId}`;
  }

  if (item?.id !== undefined && item?.id !== null) {
    return `filmbaze:${item.id}`;
  }

  const key = normalizeText(`${getType(item)} ${getName(item)} ${getYear(item)}`);
  return `filmbaze:${key || "unknown"}`;
}

function toMetaPreview(item) {
  const id = getStremioId(item);
  const type = getType(item);
  const year = getYear(item);

  const meta = {
    id,
    type,
    name: getName(item),
    poster: item.poster || item.posterUrl || undefined,
    background: item.background || item.backdrop || item.backdropUrl || undefined,
    description: item.description || item.overview || undefined,
    releaseInfo: year || undefined,
    imdbId: isValidImdbId(item.imdbId) ? item.imdbId : undefined,
    genres: Array.isArray(item.genres) ? item.genres : undefined,
    behaviorHints: {
      defaultVideoId: id
    }
  };

  if (item.runtime) {
    meta.runtime = `${item.runtime} min`;
  }

  return meta;
}

function toMetaDetail(item) {
  const id = getStremioId(item);
  const type = getType(item);
  const year = getYear(item);

  const meta = {
    id,
    type,
    name: getName(item),
    poster: item.poster || item.posterUrl || undefined,
    background: item.background || item.backdrop || item.backdropUrl || undefined,
    description: item.description || item.overview || undefined,
    releaseInfo: year || undefined,
    imdbId: isValidImdbId(item.imdbId) ? item.imdbId : undefined,
    genres: Array.isArray(item.genres) ? item.genres : undefined,
    released: item.releaseDate || undefined,
    country: item.country || undefined,
    director: item.director || undefined,
    cast: Array.isArray(item.cast) ? item.cast : undefined,
    videos: [],
    behaviorHints: {
      defaultVideoId: id
    }
  };

  if (item.runtime) {
    meta.runtime = `${item.runtime} min`;
  }

  if (type === "movie") {
    meta.videos = [
      {
        id,
        title: getName(item),
        released: item.releaseDate || undefined,
        overview: item.description || undefined,
        thumbnail: item.poster || item.background || undefined
      }
    ];
  }

  if (type === "series" && Array.isArray(item.videos)) {
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

    const stremioId = getStremioId(item);

    if (stremioId === id) return true;
    if (item.imdbId === id) return true;
    if (String(item.tmdbId || "") === id) return true;
    if (`tmdb:${item.tmdbId}` === id) return true;
    if (`filmbaze:${item.id}` === id) return true;
    if (String(item.id || "") === id) return true;

    return false;
  });
}

function parseStremioExtra(extra = "") {
  const out = {};

  let clean = String(extra || "");

  if (clean.endsWith(".json")) {
    clean = clean.slice(0, -5);
  }

  for (const part of clean.split("&")) {
    const [rawKey, ...rest] = part.split("=");

    if (!rawKey) continue;

    const key = decodeURIComponent(rawKey);
    const value = decodeURIComponent(rest.join("=") || "");

    if (key) {
      out[key] = value;
    }
  }

  return out;
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
        {
          name: "skip",
          isRequired: false
        },
        {
          name: "search",
          isRequired: false
        }
      ]
    },
    {
      type: "series",
      id: "filmbaze-serialy",
      name: "Filmbáze – seriály v češtině",
      extra: [
        {
          name: "skip",
          isRequired: false
        },
        {
          name: "search",
          isRequired: false
        }
      ]
    }
  ],
  idPrefixes: ["tt", "filmbaze:", "tmdb:"],
  behaviorHints: {
    configurable: false,
    configurationRequired: false
  }
};

function handleCatalog(req, res) {
  try {
    const { type, id } = req.params;

    if (!["movie", "series"].includes(type)) {
      return res.json({ metas: [] });
    }

    if (type === "movie" && id !== "filmbaze-filmy") {
      return res.json({ metas: [] });
    }

    if (type === "series" && id !== "filmbaze-serialy") {
      return res.json({ metas: [] });
    }

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

    const metas = filtered
      .slice(skip, skip + PAGE_SIZE)
      .map(toMetaPreview);

    return res.json({ metas });
  } catch (err) {
    console.error("[catalog] error", err);
    return res.status(500).json({ metas: [], error: err.message });
  }
}

app.get("/", (req, res) => {
  res.type("html").send(`
    <html>
      <head>
        <title>Filmbáze Stremio addon</title>
      </head>
      <body>
        <h1>Filmbáze Stremio addon</h1>
        <p><a href="/manifest.json">manifest.json</a></p>
        <p><a href="/health">health</a></p>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  const cache = loadCache();

  const movieCount = cache.items.filter((item) => getType(item) === "movie").length;
  const seriesCount = cache.items.filter((item) => getType(item) === "series").length;
  const withImdb = cache.items.filter((item) => isValidImdbId(item.imdbId)).length;

  res.json({
    ok: true,
    addon: ADDON_ID,
    version: ADDON_VERSION,
    cacheFile: cache.file,
    explicitCacheFile: cache.explicit,
    items: cache.items.length,
    movies: movieCount,
    series: seriesCount,
    withImdb,
    pageSize: PAGE_SIZE
  });
});

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

app.get("/catalog/:type/:id.json", handleCatalog);

app.get("/catalog/:type/:id/:extra.json", (req, res) => {
  req.query = {
    ...req.query,
    ...parseStremioExtra(req.params.extra)
  };

  return handleCatalog(req, res);
});

app.get("/meta/:type/:id.json", (req, res) => {
  try {
    const { type, id } = req.params;
    const cache = loadCache();

    const item = findItemById(type, id, cache.items);

    if (!item) {
      console.warn("[meta] item not found", type, id);
      return res.json({ meta: null });
    }

    const meta = toMetaDetail(item);

    return res.json({ meta });
  } catch (err) {
    console.error("[meta] error", err);
    return res.status(500).json({ meta: null, error: err.message });
  }
});

app.get("/debug/cache", (req, res) => {
  const cache = loadCache();

  res.json({
    ok: true,
    cacheFile: cache.file,
    explicitCacheFile: cache.explicit,
    items: cache.items.length,
    sample: cache.items.slice(0, 5).map((item) => ({
      id: item.id,
      stremioId: getStremioId(item),
      name: getName(item),
      type: getType(item),
      year: getYear(item),
      imdbId: item.imdbId || null,
      tmdbId: item.tmdbId || null
    }))
  });
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
      cacheFile: cache.file,
      items: cache.items.length
    });
  }

  return res.json({
    ok: true,
    type,
    id,
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
