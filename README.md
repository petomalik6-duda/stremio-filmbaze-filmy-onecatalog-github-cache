# Filmbaze IMDb ID only repair

Tento balík nerobí pôvodný refresh-cache. Opravuje iba existujúcu cache:

- nájde položky s `tmdbId`, ale bez `imdbId`
- cez TMDB external_ids doplní `imdbId`
- neberie `primaryVideo: null` ako chybu

## Prečo tento balík

Predošlý wrapper zlyhal, lebo v repozitári sa nenašiel pôvodný refresh súbor:

`Original refresh cache script not found`

Preto je tento balík oddelený a bezpečný. Môže bežať po tvojom existujúcom refresh workflow alebo samostatne denne.

## Nahraj do repo

Nahraj:

```txt
scripts/filmbaze-imdbid-repair.cjs
.github/workflows/repair-imdbid.yml
```

## Secret

V GitHub repo musí byť:

```txt
TMDB_API_KEY
```

## Spustenie

GitHub Actions → `Repair Filmbaze IMDb IDs` → Run workflow.

Denný beh je nastavený na 03:45 UTC, teda približne po refresh-cache.
