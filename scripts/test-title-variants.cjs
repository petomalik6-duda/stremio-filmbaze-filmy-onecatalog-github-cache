'use strict';

const { buildFilmbazeSearchVariants } = require('./filmbaze-title-normalizer.cjs');

const movie = {
  name: process.argv[2] || 'Barvy zla: Černá',
  originalName: process.argv[3] || 'Kolory zła: Czerń',
  year: process.argv[4] || 2026
};

console.log(JSON.stringify({ movie, variants: buildFilmbazeSearchVariants(movie) }, null, 2));
