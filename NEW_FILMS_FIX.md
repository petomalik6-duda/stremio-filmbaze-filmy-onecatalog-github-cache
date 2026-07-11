# New films delivery fix (v3.4.7)

After deployment, open these endpoints on the deployed Render URL:

- `/health` — must show `version: 3.4.7`, a current `cacheGeneratedAt`, and `latestMovies`.
- `/catalog/movie/filmbaze-filmy.json` — the first entries must match `latestMovies` from `/health`.
- `/cache.json` — raw cache used by the running server.

The manifest addon ID changed to `cz.filmbaze.json.filmy.serialy.v347` to bypass stale Nuvio catalog state. Remove the old Filmbáze addon from Nuvio and install the manifest again after Render deploys v3.4.7.
