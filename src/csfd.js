import { getWithRetry } from './http.js';
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (compatible; StremioFilmovenovinkyAddon/2.0)';

function absAttr(url) {
  if (!url) return null;
  try { return new URL(url, 'https://www.csfd.cz').toString(); } catch { return null; }
}

function clean(text = '') { return text.replace(/\s+/g, ' ').trim(); }

export async function searchCsfd(title, year) {
  if (!title) return null;
  const q = encodeURIComponent(`${title} ${year || ''}`.trim());
  const url = `https://www.csfd.cz/hledat/?q=${q}`;
  try {
    const { data } = await getWithRetry(url, { headers: { 'User-Agent': UA }, timeout: 20000 });
    const $ = cheerio.load(data);
    const link = $('a[href*="/film/"]').filter((_i, a) => {
      const t = clean($(a).text()).toLowerCase();
      return t && (!year || $(a).parent().text().includes(year));
    }).first().attr('href') || $('a[href*="/film/"]').first().attr('href');
    return absAttr(link);
  } catch {
    return null;
  }
}

export async function fetchCsfdMeta(csfdUrl) {
  if (!csfdUrl) return {};
  try {
    const { data } = await getWithRetry(csfdUrl, { headers: { 'User-Agent': UA }, timeout: 25000 });
    const $ = cheerio.load(data);
    const html = $.html();
    const imdbId = html.match(/tt\d{7,9}/)?.[0] || null;
    const rating = clean($('.film-rating-average, .rating-average, .film-rating .average').first().text()) || null;
    const poster = absAttr($('meta[property="og:image"]').attr('content')) || null;
    const description = clean($('meta[property="og:description"]').attr('content') || $('.plot-full, .plot').first().text()) || '';
    const title = clean($('meta[property="og:title"]').attr('content') || $('h1').first().text()) || '';
    const genres = [];
    $('.genres a, .genre a, a[href*="/zanr/"]').each((_i, a) => genres.push(clean($(a).text())));
    return { imdbId, csfdRating: rating, poster, description, csfdTitle: title, genres: [...new Set(genres.filter(Boolean))] };
  } catch (e) {
    return { csfdError: e.message };
  }
}
