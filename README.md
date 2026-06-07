# Filmbáze JSON Stremio addon

Tento addon nepoužíva HTML scraper. Načítava priamo JSON dáta Filmbáze kanála `Novinky s českým dabingem`.

## Katalóg

```text
Filmbáze – CZ/SK filmy
Filmbáze – seriály v češtině
```

Endpoint:

```text
/catalog/movie/filmbaze-filmy.json
```

## Render Environment

```env
PORT=10000
PUBLIC_URL=https://tvoja-filmbaze-sluzba.onrender.com

FILMBAZE_MOVIES_URL=https://filmbaze.cz/novinky-s-ceskym-dabingem-na-netu
FILMBAZE_SERIES_URL=https://filmbaze.cz/oblibene-serialy-v-cestine
MAX_PAGES=30
MAX_ITEMS=1200
MAX_SERIES_ITEMS=1200

AUTO_REFRESH=false
REFRESH_ON_START=false
AUTO_REFRESH_MINUTES=1440
CACHE_TTL_HOURS=24

REQUEST_TIMEOUT_MS=20000
HTTP_RETRIES=2

ENABLE_TMDB=false
TMDB_API_KEY=
TMDB_LANGUAGE=cs-CZ
ENRICH_LIMIT=0

STRICT_MOVIE_FILTER=true
```

## Prvý refresh

```text
https://tvoja-filmbaze-sluzba.onrender.com/refresh
```

Potom:

```text
https://tvoja-filmbaze-sluzba.onrender.com/stats
```

## Stremio

```text
https://tvoja-filmbaze-sluzba.onrender.com/manifest.json
```

## TMDB obohatenie

Nie je nutné pre poster/popisy, lebo Filmbáze ich už dáva v JSON dátach.

Na doplnenie IMDb ID nastav:

```env
ENABLE_TMDB=true
TMDB_API_KEY=tvoj_tmdb_kluc
ENRICH_LIMIT=50
```

Potom spusti:

```text
/refresh?full=1
```

## GitHub cache

Workflow:

```text
.github/workflows/refresh-cache.yml
```

sa spúšťa denne a commitne `data/catalog-cache.json`.

Aktuálnu cache z Renderu uložíš cez:

```text
Actions → Import cache from running Filmbáze addon URL
```

a zadáš:

```text
https://tvoja-filmbaze-sluzba.onrender.com/cache.json
```


## Seriály

Pridaný katalóg:

```text
Filmbáze – seriály v češtině
```

Endpoint:

```text
/catalog/series/filmbaze-serialy.json
```


## v2.2 fallback

Ak Filmbáze nevráti `content.data`, addon skúsi:
1. čisté HTML s Inertia `data-page`,
2. Inertia JSON,
3. textový reader fallback.

Tým sa nemá stať, že refresh skončí s `0 items`, pokiaľ stránka obsahuje aspoň čitateľný zoznam titulov.


## v2.3 oprava seriálov

Seriálový kanál Filmbáze používa `content.data[]` s `is_series: true`. Táto verzia to ukladá ako:

```text
type: series
```

Katalóg:

```text
/catalog/series/filmbaze-serialy.json
```
