'use strict';

/**
 * Filmbaze title fallback helper.
 * Purpose: improve stream lookup for titles with diacritics, punctuation and Polish/Czech characters.
 * Safe: this file does not modify cache by itself. It only generates search variants.
 */

function normalizeTitleForSearch(input = '') {
  return String(input)
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[:;,.!?()[\]{}'"“”„’`´]/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactTitle(input = '') {
  return normalizeTitleForSearch(input).replace(/\s+/g, ' ').trim();
}

function uniquePush(set, value) {
  const v = String(value || '').trim();
  if (v) set.add(v);
}

function buildFilmbazeSearchVariants(movie = {}) {
  const variants = new Set();

  const names = [
    movie.name,
    movie.title,
    movie.originalName,
    movie.originalTitle,
    movie.czTitle,
    movie.skTitle,
    movie.tmdbTitle
  ].filter(Boolean);

  for (const raw of names) {
    const noColon = String(raw).replace(/:/g, ' ');
    const normalized = normalizeTitleForSearch(raw);
    const normalizedNoColon = normalizeTitleForSearch(noColon);

    uniquePush(variants, raw);
    uniquePush(variants, noColon);
    uniquePush(variants, normalized);
    uniquePush(variants, normalizedNoColon);

    if (movie.year) {
      uniquePush(variants, `${raw} ${movie.year}`);
      uniquePush(variants, `${noColon} ${movie.year}`);
      uniquePush(variants, `${normalized} ${movie.year}`);
      uniquePush(variants, `${normalizedNoColon} ${movie.year}`);
    }
  }

  // Special loose variants for Czech/Slovak/Polish titles.
  // Example: Barvy zla: Černá / Kolory zła: Czerń
  for (const v of Array.from(variants)) {
    uniquePush(variants, v.replace(/\bczern\b/gi, 'cern'));
    uniquePush(variants, v.replace(/\bcerna\b/gi, 'cierna'));
    uniquePush(variants, v.replace(/\bcierna\b/gi, 'cerna'));
  }

  return Array.from(variants)
    .map(v => v.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((v, idx, arr) => arr.indexOf(v) === idx);
}

module.exports = {
  normalizeTitleForSearch,
  compactTitle,
  buildFilmbazeSearchVariants
};
