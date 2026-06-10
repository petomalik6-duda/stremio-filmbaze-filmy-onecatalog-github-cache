'use strict';

/**
 * Filmbáze stream repair helper
 *
 * Purpose:
 * - find catalogue items that have TMDB metadata but no playable source
 * - especially items with primaryVideo: null, missing imdbId, or not detailChecked
 * - revisit Filmbáze source/detail pages and try to attach a usable video/detail source
 *
 * This file is intentionally dependency-light. It expects your existing addon to already have
 * cache loading/saving and Filmbáze parsing functions. Wire those functions in server.js.
 */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function needsFilmbazeStreamRepair(item) {
  if (!item || item.type !== 'movie') return false;
  return (
    !item.primaryVideo ||
    !item.detailUrl ||
    !item.imdbId ||
    item.streamStatus === 'not_found' ||
    item.streamStatus === 'missing_source'
  );
}

function sameMovie(a, b) {
  if (!a || !b) return false;
  if (a.tmdbId && b.tmdbId && String(a.tmdbId) === String(b.tmdbId)) return true;
  if (a.imdbId && b.imdbId && String(a.imdbId) === String(b.imdbId)) return true;

  const ay = String(a.year || '').slice(0, 4);
  const by = String(b.year || '').slice(0, 4);
  const sameYear = !ay || !by || ay === by;

  const namesA = [a.name, a.originalName, a.title, a.originalTitle].map(norm).filter(Boolean);
  const namesB = [b.name, b.originalName, b.title, b.originalTitle].map(norm).filter(Boolean);

  return sameYear && namesA.some(x => namesB.includes(x));
}

async function repairFilmbazeStreams(options) {
  const {
    items,
    limit = 100,
    save,
    logger = console,
    findFreshFilmbazeItems,
    getFilmbazeDetail,
    enrichImdbFromTmdb
  } = options || {};

  if (!Array.isArray(items)) throw new Error('repairFilmbazeStreams: options.items must be an array');
  if (typeof save !== 'function') throw new Error('repairFilmbazeStreams: options.save must be a function');
  if (typeof findFreshFilmbazeItems !== 'function') throw new Error('repairFilmbazeStreams: provide findFreshFilmbazeItems() from your addon');

  const targets = items.filter(needsFilmbazeStreamRepair).slice(0, Number(limit) || 100);
  const fresh = await findFreshFilmbazeItems();

  let checked = 0;
  let repaired = 0;
  let missing = 0;

  for (const item of targets) {
    checked++;
    logger.log('[filmbaze-repair] checking:', item.name || item.title, item.year || '');

    const match = fresh.find(x => sameMovie(item, x));

    if (match) {
      if (match.primaryVideo && !item.primaryVideo) item.primaryVideo = match.primaryVideo;
      if (match.detailUrl && !item.detailUrl) item.detailUrl = match.detailUrl;
      if (match.imdbId && !item.imdbId) item.imdbId = match.imdbId;
      if (match.csfdUrl && !item.csfdUrl) item.csfdUrl = match.csfdUrl;
      if (match.sourceUrl && !item.sourceUrl) item.sourceUrl = match.sourceUrl;
      item.detailChecked = true;
    }

    if (!item.imdbId && typeof enrichImdbFromTmdb === 'function' && item.tmdbId) {
      try {
        const imdbId = await enrichImdbFromTmdb(item.tmdbId);
        if (imdbId) item.imdbId = imdbId;
      } catch (err) {
        logger.warn('[filmbaze-repair] imdb enrich failed:', err.message);
      }
    }

    if (!item.primaryVideo && item.detailUrl && typeof getFilmbazeDetail === 'function') {
      try {
        const detail = await getFilmbazeDetail(item.detailUrl);
        if (detail?.primaryVideo) item.primaryVideo = detail.primaryVideo;
        if (detail?.imdbId && !item.imdbId) item.imdbId = detail.imdbId;
        if (detail?.csfdUrl && !item.csfdUrl) item.csfdUrl = detail.csfdUrl;
        item.detailChecked = true;
      } catch (err) {
        logger.warn('[filmbaze-repair] detail parse failed:', err.message);
      }
    }

    if (item.primaryVideo) {
      item.streamStatus = 'source_found';
      repaired++;
    } else {
      item.streamStatus = 'missing_source';
      missing++;
    }
  }

  await save();
  return { ok: true, checked, repaired, missing };
}

module.exports = {
  needsFilmbazeStreamRepair,
  repairFilmbazeStreams,
  sameMovie
};
