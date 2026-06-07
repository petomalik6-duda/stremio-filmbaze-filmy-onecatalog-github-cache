import axios from 'axios';

const DEFAULT_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEFAULT_RETRIES = Number(process.env.HTTP_RETRIES || 2);

export async function getWithRetry(url, options = {}, attempts = DEFAULT_RETRIES) {
  let lastError = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await axios.get(url, {
        timeout: DEFAULT_TIMEOUT,
        validateStatus: status => status >= 200 && status < 400,
        ...options,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StremioFilmbazeJsonAddon/2.0; +https://www.stremio.com/)',
          'Accept': 'application/json, text/html;q=0.9, */*;q=0.8',
          ...(options.headers || {})
        }
      });
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 600 * (i + 1)));
      }
    }
  }

  throw lastError;
}
