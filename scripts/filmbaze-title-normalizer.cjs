'use strict';

function stripDiacritics(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/ń/g, 'n')
    .replace(/Ń/g, 'N')
    .replace(/ż/g, 'z')
    .replace(/Ż/g, 'Z')
    .replace(/ź/g, 'z')
    .replace(/Ź/g, 'Z')
    .replace(/ć/g, 'c')
    .replace(/Ć/g, 'C')
    .replace(/ą/g, 'a')
    .replace(/Ą/g, 'A')
    .replace(/ę/g, 'e')
    .replace(/Ę/g, 'E')
    .replace(/ś/g, 's')
    .replace(/Ś/g, 'S');
}

function cleanSpaces(input) {
  return String(input || '')
    .replace(/[：:;,.!?()\[\]{}"'`´–—_\-\/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForSearch(input) {
  return cleanSpaces(stripDiacritics(input));
}

function addIf(set, value) {
  const v = String(value || '').trim();
  if (v) set.add(v);
}

function buildFilmbazeTitleVariants(movie = {}) {
  const variants = new Set();
  const year = movie.year ? String(movie.year) : '';

  const names = [
    movie.name,
    movie.title,
    movie.originalName,
    movie.originalTitle
  ].filter(Boolean);

  for (const name of names) {
    addIf(variants, name);
    addIf(variants, cleanSpaces(name));
    addIf(variants, normalizeForSearch(name));

    const noColon = String(name).replace(/:/g, ' ');
    addIf(variants, cleanSpaces(noColon));
    addIf(variants, normalizeForSearch(noColon));

    if (year) {
      addIf(variants, `${name} ${year}`);
      addIf(variants, `${cleanSpaces(name)} ${year}`);
      addIf(variants, `${normalizeForSearch(name)} ${year}`);
    }
  }

  // CZ/SK helpful alternative for this frequent title pattern.
  const joined = [...variants].join(' ').toLowerCase();
  if (joined.includes('barvy zla') || joined.includes('kolory zla') || joined.includes('kolory zła')) {
    ['Barvy zla Cerna', 'Barvy zla Cierna', 'Kolory zla Czern', 'Kolory zla Cern'].forEach(v => {
      addIf(variants, v);
      if (year) addIf(variants, `${v} ${year}`);
    });
  }

  return [...variants]
    .map(v => v.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

module.exports = {
  stripDiacritics,
  cleanSpaces,
  normalizeForSearch,
  buildFilmbazeTitleVariants
};
