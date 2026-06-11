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

const CACHE_CANDIDATES = [
  path.join(__dirname, "data", "cache.json"),
  path.join(__dirname, "data", "filmbaze-cache.json"),
  path.join(__dirname, "cache.json"),
  path.join(__dirname, "filmbaze-cache.json"),
  path.join(__dirname, "data.json"),
  path.join(__dirname, "data", "items.json")
];

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error("[cache] failed to read", file, err.message);
    return null;
  }
}

function loadCache() {
  for (const file of CACHE_CANDIDATES) {
    const json = readJsonSafe(file);

    if (!json) continue;

    if (Array.isArray(json)) {
      console.log("[cache] loaded array from", file, "items:", json.length);
      return {
        file,
        at: null,
        sourceHash: null,
        items: json
      };
    }

    if (Array.isArray(json.items)) {
      console.log("[cache] loaded items from", file, "items:", json.items.length);
      return {
        file,
        at: json.at || null,
        sourceHash: json.sourceHash || null,
        items: json.items
      };
    }

    if (Array.isArray(json.metas)) {
      console.log("[cache] loaded metas from", file, "items:", json.metas.length);
      return {
        file,
        at: json.at || null,
        sourceHash: json.sourceHash || null,
        items: json.metas
      };
    }
  }

  console.warn("[cache] no cache file found");
  return {
    file: null,
    at: null,
    sourceHash: null,
    items: []
  };
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
  if (isValidImdbId(item.imdbId)) {
    return item.imdbId;
  }

  if (isValidImdbId(item.id)) {
    return item.id;
  }

  if (item.tmdbId) {
    return `tmdb:${item.tmdbId}`;
  }

  if (item.id !== undefined && item.id !== null) {
    return `filmbaze:${item.id}`;
  }

  const key = normalizeText(`${item.type || "movie"} ${item.name || item.title || ""} ${item.year || ""}`);
  return `filmbaze:${key}`;
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

function toMetaPreview(item) {
  const id = getStremioId(item);
  const type = getType(item);
  const year = getYear(item);

  return {
    id,
    type,
    name: getName(item),
    poster: item.poster || item.posterUrl || undefined,
    background: item.background || item.backdrop || item.backdropUrl || undefined,
    description: item.description || item.overview || undefined,
    releaseInfo: year || undefined,
    imdbId: isValidImdbId(item.imdbId) ? item.imdbId : undefined,
    genres: Array.isArray(item.genres) ? item.genres : undefined,
    runtime: item.runtime ? `${item.runtime} min` : undefined,
    behaviorHints: {
      defaultVideoId: id
    }
  };
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
    runtime: item.runtime ? `${item.runtime} min` : undefined,
    released: item.releaseDate || undefined,
    country: item.country || undefined,
    director: item.director || undefined,
    cast: Array.isArray(item.cast) ? item.cast : undefined,
    videos: [],
    behaviorHints: {
      defaultVideoId: id
    }
  };

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

function
