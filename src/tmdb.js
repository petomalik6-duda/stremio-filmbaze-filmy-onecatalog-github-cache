import { getWithRetry } from './http.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'cs-CZ';
const ENABLE_TMDB = String(process.env.ENABLE_TMDB || 'false').toLowerCase() === 'true';

const TMDB_STRICT_MATCH = String(process.env.TMDB_STRICT_MATCH || 'true').toLowerCase() !== 'false';
const TMDB_YEAR_TOLERANCE = Number(process.env.TMDB_YEAR_TOLERANCE || 1);
const TMDB_RUNTIME_TOLERANCE = Number(process.env.TMDB_RUNTIME_TOLERANCE || 15);

function tmdbEnabled() {
  return ENABLE_TMDB && TMDB_API_KEY;
}

export async function tmdbSearch(name, year, type = 'movie', expectedRuntime = null) {
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
  const results = Array.isArray(search.results) ? search.results.slice(0, 8) : [];
  if (!results.length) return null;

  const candidates = [];

  for (const result of results) {
    try {
      const details = await fetchDetails(mediaType, result.id);
      const candidate = normalizeDetails(details, result, mediaType, name);
      candidate._score = matchScore({ queryName: name, expectedYear: year, expectedRuntime, candidate, mediaType });
      candidate._accepted = acceptMatch({ expectedYear: year, expectedRuntime, candidate, mediaType });
      candidates.push(candidate);
    } catch (error) {
      console.error('[tmdb] candidate details failed:', name, result.id, error.message);
    }
  }

  candidates.sort((a, b) => b._score - a._score);
  const best = candidates.find(c => c._accepted) || null;

  if (!best) {
    console.warn('[tmdb] no strict match:', name, year || '', expectedRuntime || '');
    return TMDB_STRICT_MATCH ? null : (candidates[0] || null);
  }

  delete best._score;
  delete best._accepted;
  return best;
}

async function fetchDetails(mediaType, id) {
  const detailsUrl = `https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${TMDB_API_KEY}&language=${TMDB_LANGUAGE}&append_to_response=external_ids,credits`;
  return (await getWithRetry(detailsUrl)).data;
}

function normalizeDetails(details, first, mediaType, fallbackName) {
  const posterPath = details.poster_path || first.poster_path;
  const backdropPath = details.backdrop_path || first.backdrop_path;

  return {
    tmdbId: details.id || first.id,
    imdbId: details.external_ids?.imdb_id || null,
    mediaType,
    type: mediaType === 'tv' ? 'series' : 'movie',
    name: details.title || details.name || first.title || first.name || fallbackName,
    originalName: details.original_title || details.original_name || first.original_title || first.original_name || '',
    year: getYear(details.release_date || details.first_air_date || first.release_date || first.first_air_date),
    releaseDate: details.release_date || details.first_air_date || first.release_date || first.first_air_date || '',
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

function acceptMatch({ expectedYear, expectedRuntime, candidate, mediaType }) {
  if (!TMDB_STRICT_MATCH) return true;

  const yearOk = !expectedYear || !candidate.year || Math.abs(Number(candidate.year) - Number(expectedYear)) <= TMDB_YEAR_TOLERANCE;

  let runtimeOk = true;
  if (mediaType === 'movie' && expectedRuntime && candidate.runtime) {
    runtimeOk = Math.abs(Number(candidate.runtime) - Number(expectedRuntime)) <= TMDB_RUNTIME_TOLERANCE;
  }

  if (expectedYear && expectedRuntime && candidate.year && candidate.runtime && mediaType === 'movie') return yearOk && runtimeOk;
  if (expectedYear && candidate.year) return yearOk;
  if (expectedRuntime && candidate.runtime && mediaType === 'movie') return runtimeOk;

  return String(candidate.name || '').length > 4;
}

function matchScore({ queryName, expectedYear, expectedRuntime, candidate, mediaType }) {
  let score = 0;

  const q = normalizeTitle(queryName);
  const cn = normalizeTitle(candidate.name);
  const co = normalizeTitle(candidate.originalName);

  if (cn === q) score += 60;
  else if (co === q) score += 45;
  else if (cn.includes(q) || q.includes(cn)) score += 20;

  if (expectedYear && candidate.year) {
    const diff = Math.abs(Number(candidate.year) - Number(expectedYear));
    if (diff === 0) score += 40;
    else if (diff <= TMDB_YEAR_TOLERANCE) score += 20;
    else score -= 60;
  }

  if (mediaType === 'movie' && expectedRuntime && candidate.runtime) {
    const diff = Math.abs(Number(candidate.runtime) - Number(expectedRuntime));
    if (diff <= 5) score += 30;
    else if (diff <= TMDB_RUNTIME_TOLERANCE) score += 15;
    else score -= 50;
  }

  if (candidate.imdbId) score += 10;
  if (candidate.poster) score += 3;
  return score;
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getYear(value) {
  const m = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}
