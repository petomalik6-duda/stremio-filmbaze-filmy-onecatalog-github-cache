import axios from 'axios';

const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w500';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280';
const LANG = process.env.TMDB_LANGUAGE || 'cs-CZ';

function tmdbEnabled() { return String(process.env.ENABLE_TMDB || 'false').toLowerCase() === 'true'; }
function key() { return tmdbEnabled() ? (process.env.TMDB_API_KEY || '') : ''; }
async function tmdbGet(path, params = {}) {
  if (!key()) return null;
  const { data } = await axios.get(`${TMDB}${path}`, { params: { api_key: key(), language: LANG, ...params }, timeout: 15000 });
  return data;
}

export async function tmdbByImdb(imdbId, type='movie') {
  if (!imdbId || !key()) return null;
  const found = await tmdbGet(`/find/${imdbId}`, { external_source: 'imdb_id' });
  const res = type === 'series' ? found?.tv_results?.[0] : found?.movie_results?.[0];
  if (!res?.id) return null;
  return type === 'series' ? tmdbSeries(res.id) : tmdbMovie(res.id);
}

export async function tmdbSearch(title, year, type='movie') {
  if (!title || !key()) return null;
  const path = type === 'series' ? '/search/tv' : '/search/movie';
  const params = type === 'series' ? { query: title, first_air_date_year: year || undefined, include_adult: false } : { query: title, year: year || undefined, include_adult: false };
  const data = await tmdbGet(path, params);
  const item = data?.results?.[0];
  if (!item?.id) return null;
  return type === 'series' ? tmdbSeries(item.id) : tmdbMovie(item.id);
}

function common(data, type) {
  const title = type === 'series' ? (data.name || data.original_name) : (data.title || data.original_title);
  const original = type === 'series' ? data.original_name : data.original_title;
  const date = type === 'series' ? data.first_air_date : data.release_date;
  return {
    tmdbId: data.id,
    imdbId: data.external_ids?.imdb_id || null,
    name: title,
    originalName: original,
    description: data.overview || '',
    poster: data.poster_path ? `${IMG}${data.poster_path}` : null,
    background: data.backdrop_path ? `${BACKDROP}${data.backdrop_path}` : null,
    releaseInfo: (date || '').slice(0, 4),
    genres: (data.genres || []).map(g => g.name),
    imdbRating: data.vote_average ? String(Math.round(data.vote_average * 10) / 10) : undefined,
    cast: (data.credits?.cast || []).slice(0, 8).map(c => c.name),
    trailer: (data.videos?.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer')?.key || null
  };
}

export async function tmdbMovie(id) {
  const data = await tmdbGet(`/movie/${id}`, { append_to_response: 'external_ids,credits,videos' });
  if (!data) return null;
  return { ...common(data, 'movie'), type: 'movie', runtime: data.runtime ? `${data.runtime} min` : undefined, director: (data.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name).join(', ') };
}

export async function tmdbSeries(id) {
  const data = await tmdbGet(`/tv/${id}`, { append_to_response: 'external_ids,credits,videos' });
  if (!data) return null;
  return { ...common(data, 'series'), type: 'series', runtime: data.episode_run_time?.[0] ? `${data.episode_run_time[0]} min/ep` : undefined, director: (data.created_by || []).map(c => c.name).join(', ') };
}
