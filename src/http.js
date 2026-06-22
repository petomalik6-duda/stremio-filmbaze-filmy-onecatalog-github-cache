import axios from 'axios';

const DEFAULT_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEFAULT_ATTEMPTS = Math.max(1, Number(process.env.HTTP_RETRIES || 4));
const RETRY_BASE_MS = Math.max(100, Number(process.env.HTTP_RETRY_BASE_MS || 1000));
const RETRY_MAX_MS = Math.max(RETRY_BASE_MS, Number(process.env.HTTP_RETRY_MAX_MS || 30000));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfter(value) {
  if (value === undefined || value === null || value === '') return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(String(value));
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());

  return 0;
}

function isRetryable(error) {
  if (!error?.response) return true;

  const status = Number(error.response.status || 0);
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelay(error, attemptIndex) {
  const retryAfterMs = parseRetryAfter(error?.response?.headers?.['retry-after']);
  if (retryAfterMs > 0) return Math.min(RETRY_MAX_MS, retryAfterMs);

  const exponential = RETRY_BASE_MS * Math.pow(2, attemptIndex);
  const jitter = Math.floor(Math.random() * Math.max(100, RETRY_BASE_MS / 2));
  return Math.min(RETRY_MAX_MS, exponential + jitter);
}

export async function getWithRetry(url, options = {}, attempts = DEFAULT_ATTEMPTS) {
  const totalAttempts = Math.max(1, Number(attempts) || DEFAULT_ATTEMPTS);
  let lastError = null;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      return await axios.get(url, {
        timeout: DEFAULT_TIMEOUT,
        validateStatus: status => status >= 200 && status < 400,
        ...options,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StremioFilmbazeJsonAddon/3.4.2; +https://www.stremio.com/)',
          'Accept': 'application/json, text/html;q=0.9, */*;q=0.8',
          ...(options.headers || {})
        }
      });
    } catch (error) {
      lastError = error;
      const finalAttempt = attempt >= totalAttempts - 1;

      if (finalAttempt || !isRetryable(error)) throw error;

      const delayMs = retryDelay(error, attempt);
      const status = error?.response?.status || error?.code || 'network-error';
      console.warn(`[http] retry ${attempt + 1}/${totalAttempts - 1} after ${delayMs} ms (${status})`, url);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
