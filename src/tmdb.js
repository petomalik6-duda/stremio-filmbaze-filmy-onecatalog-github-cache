import { getWithRetry } from './http.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'cs-CZ';
const ENABLE_TMDB = String(process.env.ENABLE_TMDB || 'false').toLowerCase() === 'true';

function tmdbEnabled() {
  return ENABLE_TMDB && TMDB_API_KEY;
}

export async function tmdbSearch(name, year, type = 'movie') {
  if (!tmdbEnabled() || !name) return null;

  const mediaType = type === 'series' ? 'tv' : 'movie';

  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    query: name,
    language: TMDB_LANGUAGE,
    include_adult: 'false'
  });

  if (year) {
    if (mediaType === 'tv') params.set('first_air_date_year', String(year));
    else params.set('year', String(year));
  }

  const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?${params.toString()}`;
  const search = (await getWithRetry(searchUrl)).data;
  const first = Array.isArray(search.results) ? search.results[0] : null;
  if (!first) return null;

  const detailsUrl = `https://api.themoviedb.org/3/${mediaType}/${first.id}?api_key=${TMDB_API_KEY}&language=${TMDB_LANGUAGE}&append_to_response=external_ids,credits`;
  const details = (await getWithRetry(detailsUrl)).data;

  const posterPath = details.poster_path || first.poster_path;
  const backdropPath = details.backdrop_path || first.backdrop_path;

  const imdbId = mediaType === 'tv'
    ? (details.external_ids?.imdb_id || null)
    : (details.external_ids?.imdb_id || null);

  return {
    tmdbId: details.id || first.id,
    imdbId,
    mediaType,
    type: mediaType === 'tv' ? 'series' : 'movie',
    name: details.title || details.name || first.title || first.name || name,
    year: getYear(details.release_date || details.first_air_date || first.release_date || first.first_air_date),
    poster: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null,
    background: backdropPath ? `https://image.tmdb.org/t/p/w1280${backdropPath}` : null,
    description: details.overview || first.overview || '',
    rating: details.vote_average ? Number(details.vote_average).toFixed(1) : undefined,
    runtime: details.runtime || (Array.isArray(details.episode_run_time) ? details.episode_run_time[0] : undefined),
    genres: Array.isArray(details.genres) ? details.genres.map(g => g.name) : [],
    cast: Array.isArray(details.credits?.cast) ? details.credits.cast.slice(0, 8).map(x => x.name) : [],
    director: Array.isArray(details.credits?.crew)
      ? details.credits.crew.filter(x => x.job === 'Director' || x.job === 'Creator').map(x => x.name)
      : []
  };
}

function getYear(value) {
  const m = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}
