'use strict';

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, m => (m === 'ł' ? 'l' : 'L'));
}

function cleanTitle(s) {
  return stripDiacritics(String(s || ''))
    .toLowerCase()
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[:;,.!?'"`´]/g, ' ')
    .replace(/\b(cz|sk|czsk|dabing|1080p|720p|4k|webrip|web-dl|bluray|x264|x265|hevc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleVariants(movie) {
  const out = [];
  const add = (v) => {
    v = String(v || '').trim();
    if (v && !out.includes(v)) out.push(v);
  };

  add(movie.name);
  add(movie.originalName);
  add(movie.title);
  add(movie.originalTitle);

  for (const v of [...out]) {
    add(cleanTitle(v));
    if (movie.year) add(`${cleanTitle(v)} ${movie.year}`);
  }

  return out.filter(Boolean);
}

function findMovieInCache(items, id) {
  return (items || []).find(m =>
    String(m.imdbId || '') === String(id) ||
    String(m.tmdbId || '') === String(id).replace(/^tmdb:/, '') ||
    String(m.id || '') === String(id) ||
    String(m.stremioId || '') === String(id)
  );
}

async function fallbackSearchStreams(movie, adapters = {}) {
  const variants = titleVariants(movie);
  const streams = [];

  // 1) If your addon already has a search function, pass it as adapters.searchStreamsByQuery.
  if (typeof adapters.searchStreamsByQuery === 'function') {
    for (const q of variants) {
      const found = await adapters.searchStreamsByQuery(q, movie);
      if (Array.isArray(found) && found.length) {
        streams.push(...found);
        break;
      }
    }
  }

  // 2) If your addon has a source/list parser, pass it as adapters.searchFilmbazeSource.
  if (!streams.length && typeof adapters.searchFilmbazeSource === 'function') {
    for (const q of variants) {
      const found = await adapters.searchFilmbazeSource(q, movie);
      if (Array.isArray(found) && found.length) {
        streams.push(...found);
        break;
      }
    }
  }

  return streams;
}

module.exports = {
  stripDiacritics,
  cleanTitle,
  titleVariants,
  findMovieInCache,
  fallbackSearchStreams,
};
