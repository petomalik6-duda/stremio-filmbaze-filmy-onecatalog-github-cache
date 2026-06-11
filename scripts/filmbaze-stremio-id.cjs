'use strict';

function isValidImdbId(value) {
  return typeof value === 'string' && /^tt\d{5,}$/.test(value.trim());
}

function getFilmbazeFallbackId(item) {
  const raw = item && (item.id ?? item.tmdbId ?? item.name ?? item.title);
  return `filmbaze:${String(raw || '').trim() || 'unknown'}`;
}

function getStremioId(item) {
  const imdbId = item && typeof item.imdbId === 'string' ? item.imdbId.trim() : '';
  if (isValidImdbId(imdbId)) return imdbId;
  return getFilmbazeFallbackId(item);
}

function patchMetaId(meta, item) {
  const id = getStremioId(item);
  const originalId = item && item.id != null ? `filmbaze:${item.id}` : undefined;

  return {
    ...meta,
    id,
    imdbId: isValidImdbId(item?.imdbId) ? item.imdbId.trim() : meta?.imdbId,
    behaviorHints: {
      ...(meta?.behaviorHints || {}),
      defaultVideoId: id,
    },
    // Debug / compatibility fields. Stremio ignores unknown fields.
    filmbazeId: item?.id,
    filmbazeOriginalId: originalId,
  };
}

function findItemByAnyId(items, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;

  return (items || []).find((item) => {
    const imdb = item?.imdbId ? String(item.imdbId).trim() : '';
    const fb = item?.id != null ? `filmbaze:${item.id}` : '';
    const tmdbPlain = item?.tmdbId != null ? String(item.tmdbId) : '';
    const tmdbPrefixed = item?.tmdbId != null ? `tmdb:${item.tmdbId}` : '';
    const currentStremio = getStremioId(item);

    return wanted === imdb || wanted === fb || wanted === tmdbPlain || wanted === tmdbPrefixed || wanted === currentStremio;
  }) || null;
}

module.exports = {
  isValidImdbId,
  getStremioId,
  patchMetaId,
  findItemByAnyId,
};
