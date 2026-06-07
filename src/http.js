import axios from 'axios';

const DEFAULT_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS || 60000);
const DEFAULT_RETRIES = Number(process.env.HTTP_RETRIES || 2);

export async function getWithRetry(url, options = {}, attempts = DEFAULT_RETRIES) {
  let last;
  const requestOptions = {
    timeout: DEFAULT_TIMEOUT,
    ...options,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; StremioFilmovenovinkyAddon/3.1; +https://www.stremio.com/)',
      ...(options.headers || {})
    }
  };

  for (let i = 0; i < attempts; i++) {
    try {
      return await axios.get(url, requestOptions);
    } catch (e) {
      last = e;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
      }
    }
  }
  throw last;
}
