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


## v2.4 stránkovanie

Doplnené robustnejšie stránkovanie:

```text
?page=2
?p=2
fallback podľa per_page
```

Addon načíta ďalšie stránky, keď `content.next_page` existuje alebo keď stránka vráti plný počet položiek.


## v2.5 debug stránkovania

Pridaný endpoint:

```text
/debug-pages
```

Po `/refresh?full=1` ukáže, ktoré stránky sa načítali, aký mód sa použil a koľko položiek vrátila každá stránka.


## v2.6 pagination.data fix

Filmbáze na ďalších stránkach môže vracať:

```json
{
  "pagination": {
    "current_page": 5,
    "next_page": 6,
    "data": [...]
  }
}
```

Táto verzia podporuje `content.data` aj `pagination.data`.


## v2.7 Channel ID pagination

Pridané channel ID z Filmbáze JSON:

```env
FILMBAZE_MOVIES_CHANNEL_ID=48884
FILMBAZE_SERIES_CHANNEL_ID=50427
```

Addon skúša aj interné API/channel URL varianty, pretože ďalšie stránky v prehliadači vracajú `pagination.data`.


## v2.8 skutočné Filmbáze API

Použitý endpoint:

```text
https://filmbaze.cz/api/v1/channel/48884?returnContentOnly=true&restriction=&order=channelables.created_at:desc&perPage=50&query=&page=2
```

Filmy používajú channel `48884`, seriály `50427`.


## v3.0 seriály so sezónami a epizódami

Seriály sa po TMDB spárovaní obohatia o epizódy cez TMDB TV API.

Pridaj do Render Environment:

```env
ENABLE_TMDB=true
TMDB_API_KEY=tvoj_kluc
ENABLE_TMDB_EPISODES=true
MAX_EPISODE_SEASONS=20
MAX_EPISODES_PER_SERIES=500
```

Potom spusti:

```text
/refresh?full=1
```

V `/stats` stále uvidíš počet seriálov, ale v `/meta/series/...` už bude `videos` so sezónami a epizódami.


## v3.1 seriály prednostne s epizódami

Ak sa seriály stále správajú ako filmy, príčina býva `ENRICH_LIMIT`: obohatia sa len prvé filmy a seriály už nedostanú TMDB epizódy.

Nové env:

```env
ENRICH_MOVIE_LIMIT=50
ENRICH_SERIES_LIMIT=150
ENABLE_TMDB_EPISODES=true
```

Po refreshe sleduj `/stats`:

```text
seriesWithEpisodes
totalEpisodes
```

Ak `seriesWithEpisodes` je 0, seriály ešte neboli TMDB obohatené.


## v3.2 Stremio-compatible episode IDs

Epizódy už majú ID odvodené od ID seriálu:

```text
tt34809853:1:1
tt34809853:1:2
```

namiesto:

```text
tmdb:tv:276161:1:1
```

Toto pomáha Stremiu správne zobraziť sezóny a epizódy.
