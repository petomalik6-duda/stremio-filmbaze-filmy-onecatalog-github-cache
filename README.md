# Filmbáze CZ/SK filmy – jeden katalóg + GitHub cache

Rovnaký typ addonu ako FilmovéNovinky verzia, ale zdroj je:

```text
https://www.filmbaze.cz/novinky-s-ceskym-dabingem-na-netu
```

## V Stremiu bude iba jeden katalóg

```text
Filmbáze – CZ/SK filmy
```

Katalóg endpoint:

```text
/catalog/movie/filmbaze-filmy.json
```

Manifest:

```text
/manifest.json
```

## Render Environment

```env
PORT=10000
PUBLIC_URL=https://tvoja-filmbaze-sluzba.onrender.com
AUTO_REFRESH=false
REFRESH_ON_START=false
CACHE_TTL_HOURS=24

MAX_ITEMS=1000
MAX_SERIES=0
DISABLE_SERIES=true

ENRICH_LIMIT=0
ENABLE_TMDB=false
CSFD_SEARCH_FALLBACK=false

REQUEST_TIMEOUT_MS=15000
HTTP_RETRIES=1
REFRESH_LOCK_TIMEOUT_MS=180000
USE_READER_FALLBACK=true

STRICT_MOVIE_FILTER=true
REQUIRE_YEAR_FOR_LOCAL_ITEMS=true
HIDE_UNMATCHED_ITEMS=true

MOVIES_SOURCE_URL=https://www.filmbaze.cz/novinky-s-ceskym-dabingem-na-netu
SERIES_SOURCE_URL=
```

## TMDB obohatenie

Najprv nechaj:

```env
ENABLE_TMDB=false
ENRICH_LIMIT=0
```

Keď katalóg načíta položky, zapni postupne:

```env
ENABLE_TMDB=true
TMDB_API_KEY=tvoj_tmdb_kluc
ENRICH_LIMIT=25
```

potom:

```text
/refresh?full=1
```

Neskôr zvýš `ENRICH_LIMIT=50` alebo `100`.

## GitHub cache

Workflow je pripravený:

```text
.github/workflows/refresh-cache.yml
.github/workflows/import-cache-from-url.yml
```

Po hotovom obohatení spusti:

```text
Actions → Import cache from running addon URL
```

a zadaj:

```text
https://tvoja-filmbaze-sluzba.onrender.com/cache.json
```

Tým uložíš cache do GitHubu.

## Dôležité

Tento ZIP neobsahuje `data/`, aby neprepísal existujúcu databázu/cache.
