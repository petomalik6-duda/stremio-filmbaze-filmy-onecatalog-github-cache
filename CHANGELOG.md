# Changelog

## 3.4.3

- Series with `videos: []` are retried immediately on every refresh, independent of the generic 72-hour metadata retry window.
- Added `EPISODE_REPAIR_RETRY_HOURS` (workflow default: `0`).
- TMDB episode loader now probes season endpoints when `number_of_seasons` exists but the embedded `seasons` array is temporarily empty.
- Preserves all v3.4.2 stability improvements.
