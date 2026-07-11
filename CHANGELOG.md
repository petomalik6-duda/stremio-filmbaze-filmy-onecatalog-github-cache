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
