# v3.6.1 Hybrid Refresh Fix

- multi-query Bing RSS discovery
- DuckDuckGo HTML as an independent public-index fallback
- accepts current Filmbáze homepage snippets only when they explicitly identify the movie/series section
- does not guess a year for Poster entries when the snippet does not provide one
- persists current hybrid diagnostics even when the previous cache is preserved
- reports attempted providers, queries, accepted/rejected hints and failure reason
- public-index candidates are still promoted only after strict TMDB + IMDb verification

# v3.6.0 Hybrid Refresh

- Added public search-index fallback for WEDOS/401 outages.
- Search-index results are incremental only and can never replace the full cache.
- New indexed titles require strict TMDB + IMDb + year + title validation.
- Existing titles can be matched by title/year when the public index has no Filmbáze numeric ID.
- Added `indexedAccepted`, `indexedRejected`, `indexedKnownMatches`, providers and errors to refresh stats.
- Cache timestamp is not refreshed from an unverified index response.
- Added parser self-test to GitHub Actions.

# v3.4.9 – Volný hráč recovery

- Adds Filmbáze title 258618 “Volný hráč” (IMDb tt29942429, TMDB 1001374) to the last valid cache.
- Places it first in the movie catalog.
- Uses addon ID v349 to bypass stale Nuvio catalog cache.
- Keeps the WEDOS protection from v3.4.8.

# v3.4.8 – WEDOS data pollution fix

- Removed 37 fake WEDOS/401 reader entries from cache.
- Rejected challenge pages before title parsing.
- Added validator protection and disabled reader fallback in workflow.

# v3.4.7 – live new films fix

- Server and manifest version are now read from package.json.
- New addon ID v347 bypasses stale Nuvio catalog state.
- Catalog, manifest and meta responses use no-store headers.
- Partial refreshes place freshly fetched titles first and re-rank preserved items.
- /health shows the latest movie and series titles served by the deployed instance.
- /cache.json exposes the active cache for deployment verification.
- Workflow prints the latest titles before validation.

# Changelog

## 3.4.3

- Series with `videos: []` are retried immediately on every refresh, independent of the generic 72-hour metadata retry window.
- Added `EPISODE_REPAIR_RETRY_HOURS` (workflow default: `0`).
- TMDB episode loader now probes season endpoints when `number_of_seasons` exists but the embedded `seasons` array is temporarily empty.
- Preserves all v3.4.2 stability improvements.

## 3.5.0

- denný low-request refresh s jednou stránkou na kanál,
- sekvenčné načítanie filmov a seriálov,
- Filmbáze request rate-limit a request budget,
- circuit breaker pri WEDOS/401/403/429,
- okamžité zachovanie starej cache pri blokovaní,
- vypnuté detailné Filmbáze requesty a reader fallback v dennom workflowe,
- oddelený TMDB full rebuild od bezpečného source merge,
- nový addon ID `cz.filmbaze.json.filmy.serialy.v350`.
