# Filmbaze IMDb ID repair from TMDB

This package fixes the case where an item has TMDB metadata but missing IMDb ID.

Example problem:

```json
{
  "name": "Barvy zla: Černá",
  "primaryVideo": null,
  "imdbId": null,
  "tmdbId": 1560681,
  "originalName": "Kolory zła: Czerń"
}
```

Mortal Kombat II works even with `primaryVideo:null` because it has `imdbId`.
So this repair does not treat `primaryVideo:null` as a bug. It fills missing `imdbId` via TMDB external_ids.

## Install

Upload these files to the Filmbaze repository:

```txt
.github/workflows/refresh-cache.yml
scripts/refresh-cache-with-safe-repair.cjs
scripts/filmbaze-imdbid-repair.cjs
```

Make sure GitHub secret exists:

```txt
TMDB_API_KEY
```

Run GitHub Action manually once.

## Expected result

After the run, Barvy zla should become something like:

```json
"tmdbId": 1560681,
"imdbId": "tt..."
```

Then the existing stream fallback may work the same way it works for Mortal Kombat II.
