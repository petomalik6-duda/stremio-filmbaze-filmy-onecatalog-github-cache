import axios from 'axios';

const DEFAULT_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEFAULT_ATTEMPTS = Math.max(1, Number(process.env.HTTP_RETRIES || 3));
const RETRY_BASE_MS = Math.max(100, Number(process.env.HTTP_RETRY_BASE_MS || 1000));
const RETRY_MAX_MS = Math.max(RETRY_BASE_MS, Number(process.env.HTTP_RETRY_MAX_MS || 30000));
const FILMBAZE_MIN_INTERVAL_MS = Math.max(0, Number(process.env.FILMBAZE_MIN_REQUEST_INTERVAL_MS || 3000));
const FILMBAZE_MAX_REQUESTS = Math.max(1, Number(process.env.FILMBAZE_MAX_REQUESTS || 6));

const BLOCKED_BODY_PATTERN = /WEDOS\.protection|Security verification|\b401\s*Unauthorized\b|\b403\s*Forbidden\b|Target URL returned error|ALTCHA|security challenge|unusual activity from your browser|Req-ID:|Node:\s*ac\d+|Markdown Content:/i;

const filmbazeState = {
  lastRequestAt: 0,
  requests: 0,
  circuitOpen: false,
  reason: null
};

export class FilmbazeBlockedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FilmbazeBlockedError';
    this.code = 'FILMBAZE_BLOCKED';
    this.details = details;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isFilmbazeUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('filmbaze.cz');
  } catch {
    return false;
  }
}

function markFilmbazeBlocked(reason, details = {}) {
  filmbazeState.circuitOpen = true;
  filmbazeState.reason = reason;
  return new FilmbazeBlockedError(reason, details);
}

async function beforeRequest(url) {
  if (!isFilmbazeUrl(url)) return;

  if (filmbazeState.circuitOpen) {
    throw new FilmbazeBlockedError(
      filmbazeState.reason || 'Filmbáze request circuit is open for this refresh run.'
    );
  }

  if (filmbazeState.requests >= FILMBAZE_MAX_REQUESTS) {
    throw markFilmbazeBlocked(
      `Filmbáze request budget reached (${FILMBAZE_MAX_REQUESTS}); stopping to avoid triggering WEDOS.`,
      { requestBudget: FILMBAZE_MAX_REQUESTS }
    );
  }

  const elapsed = Date.now() - filmbazeState.lastRequestAt;
  const waitMs = Math.max(0, FILMBAZE_MIN_INTERVAL_MS - elapsed);
  if (waitMs > 0) {
    console.log(`[http] waiting ${waitMs} ms before next Filmbáze request`);
    await sleep(waitMs);
  }

  filmbazeState.lastRequestAt = Date.now();
  filmbazeState.requests += 1;
  console.log(`[http] Filmbáze request ${filmbazeState.requests}/${FILMBAZE_MAX_REQUESTS}: ${url}`);
}

function bodyLooksBlocked(data) {
  if (data == null) return false;

  let value = '';
  if (typeof data === 'string') value = data;
  else {
    try { value = JSON.stringify(data); } catch { value = String(data); }
  }

  return BLOCKED_BODY_PATTERN.test(value.slice(0, 200000));
}

function parseRetryAfter(value) {
  if (value === undefined || value === null || value === '') return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(String(value));
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());

  return 0;
}

function isRetryable(error, url) {
  if (error?.code === 'FILMBAZE_BLOCKED') return false;
  if (!error?.response) return true;

  const status = Number(error.response.status || 0);

  // For Filmbáze, repeated 401/403/429 requests increase the chance of a longer WEDOS block.
  if (isFilmbazeUrl(url) && [401, 403, 429].includes(status)) return false;

  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelay(error, attemptIndex) {
  const retryAfterMs = parseRetryAfter(error?.response?.headers?.['retry-after']);
  if (retryAfterMs > 0) return Math.min(RETRY_MAX_MS, retryAfterMs);

  const exponential = RETRY_BASE_MS * Math.pow(2, attemptIndex);
  const jitter = Math.floor(Math.random() * Math.max(100, RETRY_BASE_MS / 2));
  return Math.min(RETRY_MAX_MS, exponential + jitter);
}

function handleFilmbazeResponse(url, response) {
  if (!isFilmbazeUrl(url)) return;

  const status = Number(response?.status || 0);
  if ([401, 403, 429].includes(status)) {
    throw markFilmbazeBlocked(
      `Filmbáze/WEDOS returned HTTP ${status}; stopping all further Filmbáze requests for this run.`,
      { status, url }
    );
  }

  if (bodyLooksBlocked(response?.data)) {
    throw markFilmbazeBlocked(
      'Filmbáze returned a WEDOS security page instead of catalog data; stopping this refresh safely.',
      { status, url }
    );
  }
}

function handleFilmbazeError(url, error) {
  if (!isFilmbazeUrl(url)) return error;
  if (error?.code === 'FILMBAZE_BLOCKED') return error;

  const status = Number(error?.response?.status || 0);
  if ([401, 403, 429].includes(status) || bodyLooksBlocked(error?.response?.data)) {
    return markFilmbazeBlocked(
      `Filmbáze/WEDOS blocked the refresh${status ? ` with HTTP ${status}` : ''}; no further source requests will be made.`,
      { status: status || null, url }
    );
  }

  return error;
}

export function isFilmbazeBlockedError(error) {
  return error?.code === 'FILMBAZE_BLOCKED' || error?.name === 'FilmbazeBlockedError';
}

export function getFilmbazeRequestState() {
  return { ...filmbazeState };
}

export async function getWithRetry(url, options = {}, attempts = DEFAULT_ATTEMPTS) {
  const totalAttempts = Math.max(1, Number(attempts) || DEFAULT_ATTEMPTS);
  let lastError = null;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      await beforeRequest(url);

      const response = await axios.get(url, {
        timeout: DEFAULT_TIMEOUT,
        validateStatus: status => status >= 200 && status < 400,
        ...options,
        headers: {
          'User-Agent': 'StremioFilmbazeJsonAddon/3.5.1 (low-request incremental refresh)',
          'Accept': 'application/json, text/html;q=0.9, */*;q=0.8',
          'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.7',
          ...(options.headers || {})
        }
      });

      handleFilmbazeResponse(url, response);
      return response;
    } catch (rawError) {
      const error = handleFilmbazeError(url, rawError);
      lastError = error;
      const finalAttempt = attempt >= totalAttempts - 1;

      if (finalAttempt || !isRetryable(error, url)) throw error;

      const delayMs = retryDelay(error, attempt);
      const status = error?.response?.status || error?.code || 'network-error';
      console.warn(`[http] retry ${attempt + 1}/${totalAttempts - 1} after ${delayMs} ms (${status})`, url);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
