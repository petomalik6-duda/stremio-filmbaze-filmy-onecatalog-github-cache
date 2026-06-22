import { getWithRetry } from './http.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'cs-CZ';
const ENABLE_TMDB = String(process.env.ENABLE_TMDB || 'false').toLowerCase() === 'true';
const TMDB_STRICT_MATCH = String(process.env.TMDB_STRICT_MATCH || 'true').toLowerCase() !== 'false';
const TMDB_YEAR_TOLERANCE = Number(process.env.TMDB_YEAR_TOLERANCE || 1);
const TMDB_RUNTIME_TOLERANCE = Number(process.env.TMDB_RUNTIME_TOLERANCE || 15);
const ENABLE_TMDB_EPISODES = String(process.env.ENABLE_TMDB_EPISODES || 'true').toLowerCase() !== 'false';
const MAX_EPISODE_SEASONS = Number(process.env.MAX_EPISODE_SEASONS || 30);
const MAX_EPISODES_PER_SERIES = Number(process.env.MAX_EPISODES_PER_SERIES || 1000);

function tmdbEnabled() {
  return Boolean(ENABLE_TMDB && TMDB_API_KEY);
}

function mediaTypeFor(type) {
  return type === 'series' ? 'tv' : 'movie';
}

function apiUrl(pathname, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', TMDB_LANGUAGE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function fetchDetails(mediaType, id) {
  const url = apiUrl(`/${mediaType}/${id}`, { append_to_response: 'external_ids,credits' });
  return (await getWithRetry(url)).data;
}

async function fetchSeriesEpisodes(tmdbTvId, seriesName) {
  if (!tmdbTvId || !ENABLE_TMDB_EPISODES) return [];

  const details = await fetchDetails('tv', tmdbTvId);
  const seasons = Array.isArray(details.seasons)
    ? details.seasons
        .filter(season => Number(season.season_number) > 0)
        .slice(0, MAX_EPISODE_SEASONS)
    : [];

  const videos = [];

  for (const season of seasons) {
    if (videos.length >= MAX_EPISODES_PER_SERIES) break;

    const seasonNumber = Number(season.season_number);
    const url = apiUrl(`/tv/${tmdbTvId}/season/${seasonNumber}`);
    const seasonData = (await getWithRetry(url)).data;
    const episodes = Array.isArray(seasonData.episodes) ? seasonData.episodes : [];

    for (const episode of episodes) {
      if (videos.length >= MAX_EPISODES_PER_SERIES) break;

      const episodeNumber = Number(episode.episode_number);
      if (!episodeNumber) continue;

      videos.push({
        id: `tmdb:tv:${tmdbTvId}:${seasonNumber}:${episodeNumber}`,
        title: episode.name || `${seriesName} S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`,
        season: seasonNumber,
        episode: episodeNumber,
        released: episode.air_date || undefined,
        overview: episode.overview || undefined,
        thumbnail: episode.still_path ? `https://image.tmdb.org/t/p/w500${episode.still_path}` : undefined
      });
    }
  }

  return videos;
}

function normalizeDetails(details, first, mediaType, fallbackName) {
  const posterPath = details.poster_path || first?.poster_path;
  const backdropPath = details.backdrop_path || first?.backdrop_path;

  return {
    tmdbId: details.id || first?.id,
    imdbId: details.external_ids?.imdb_id || details.imdb_id || null,
    mediaType,
    type: mediaType === 'tv' ? 'series' : 'movie',
    name: details.title || details.name || first?.title || first?.name || fallbackName,
    originalName: details.original_title || details.original_name || first?.original_title || first?.original_name || '',
    year: getYear(details.release_date || details.first_air_date || first?.release_date || first?.first_air_date),
    releaseDate: details.release_date || details.first_air_date || first?.release_date || first?.first_air_date || '',
    poster: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null,
    background: backdropPath ? `https://image.tmdb.org/t/p/w1280${backdropPath}` : null,
    description: details.overview || first?.overview || '',
    rating: details.vote_average ? Number(details.vote_average).toFixed(1) : undefined,
    runtime: details.runtime || (Array.isArray(details.episode_run_time) ? details.episode_run_time[0] : undefined),
    genres: Array.isArray(details.genres) ? details.genres.map(genre => genre.name) : [],
    cast: Array.isArray(details.credits?.cast) ? details.credits.cast.slice(0, 8).map(person => person.name) : [],
    director: Array.isArray(details.credits?.crew)
      ? details.credits.crew
          .filter(person => person.job === 'Director' || person.job === 'Creator')
          .map(person => person.name)
      : [],
    videos: []
  };
}

async function finishResolved(result) {
  if (!result) return null;
  if (result.type === 'series' && ENABLE_TMDB_EPISODES) {
    result.videos = await fetchSeriesEpisodes(result.tmdbId, result.name).catch(error => {
      console.error('[tmdb] episodes failed:', result.name, error.message);
      return [];
    });
  }
  return result;
}

export async function tmdbById(tmdbId, type = 'movie', fallbackName = '') {
  if (!tmdbEnabled() || !tmdbId) return null;
  const mediaType = mediaTypeFor(type);
  const details = await fetchDetails(mediaType, tmdbId);
  return finishResolved(normalizeDetails(details, details, mediaType, fallbackName));
}

export async function tmdbByImdbId(imdbId, type = 'movie', fallbackName = '') {
  if (!tmdbEnabled() || !/^tt\d{5,}$/.test(String(imdbId || ''))) return null;

  const mediaType = mediaTypeFor(type);
  const find = (await getWithRetry(apiUrl(`/find/${imdbId}`, { external_source: 'imdb_id' }))).data;
  const results = mediaType === 'tv' ? find.tv_results : find.movie_results;
  const match = Array.isArray(results) ? results[0] : null;
  if (!match?.id) return null;

  return tmdbById(match.id, type, fallbackName || match.title || match.name || '');
}

export async function tmdbResolve(item) {
  if (!tmdbEnabled() || !item) return null;
  const fallbackName = item.originalName || item.name || '';

  if (item.tmdbId) {
    try {
      return await tmdbById(item.tmdbId, item.type, fallbackName);
    } catch (error) {
      console.warn('[tmdb] direct TMDB lookup failed:', item.tmdbId, error.message);
    }
  }

  if (item.imdbId) {
    try {
      const byImdb = await tmdbByImdbId(item.imdbId, item.type, fallbackName);
      if (byImdb) return byImdb;
    } catch (error) {
      console.warn('[tmdb] IMDb lookup failed:', item.imdbId, error.message);
    }
  }

  return tmdbSearch(fallbackName || item.name, item.year, item.type, item.runtime);
}

export async function tmdbSearch(name, year, type = 'movie', expectedRuntime = null) {
  if (!tmdbEnabled() || !name) return null;

  const mediaType = mediaTypeFor(type);
  const params = {
    query: name,
    include_adult: 'false'
  };

  if (year) {
    if (mediaType === 'tv') params.first_air_date_year = year;
    else params.year = year;
  }

  const search = (await getWithRetry(apiUrl(`/search/${mediaType}`, params))).data;
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
  const best = candidates.find(candidate => candidate._accepted) || null;

  if (!best) {
    console.warn('[tmdb] no strict match:', name, year || '', expectedRuntime || '');
    if (TMDB_STRICT_MATCH) return null;
    return finishResolved(candidates[0] || null);
  }

  delete best._score;
  delete best._accepted;
  return finishResolved(best);
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
  const query = normalizeTitle(queryName);
  const candidateName = normalizeTitle(candidate.name);
  const originalName = normalizeTitle(candidate.originalName);

  if (candidateName === query) score += 60;
  else if (originalName === query) score += 45;
  else if (candidateName.includes(query) || query.includes(candidateName)) score += 20;

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
  const match = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}
