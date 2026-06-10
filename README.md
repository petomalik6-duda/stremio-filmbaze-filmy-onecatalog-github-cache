# Filmbáze refresh-cache repair balík

Tento balík pridá opravu priamo do `refresh-cache` procesu.

Rieši hlavne stav:

```json
{
  "name": "Barvy zla: Černá",
  "tmdbId": 1560681,
  "imdbId": null,
  "primaryVideo": null,
  "detailChecked": true
}
```

Film má TMDB detail, ale nemá stream, lebo chýba `primaryVideo` alebo zdroj videa.

## Ako nahrať

1. Skopíruj do projektu priečinok `scripts`.
2. V `package.json` pridaj script podľa `PATCH-package.json.txt`.
3. Workflow môžeš nahradiť súborom `.github/workflows/refresh-cache.yml`, alebo si z neho skopíruj iba krok:

```yaml
- name: Refresh cache with stream repair
  env:
    TMDB_API_KEY: ${{ secrets.TMDB_API_KEY }}
    REPAIR_LIMIT: "300"
    REPAIR_PAGES: "3"
  run: npm run refresh-cache
```

## Dôležité

Najpravdepodobnejšie bude treba upraviť iba tento súbor:

```txt
scripts/repair-filmbaze-after-refresh.js
```

Tam napojíš existujúce funkcie z tvojho addonu:

- načítanie cache
- uloženie cache
- scraper Filmbáze filmov
- parser detailu Filmbáze

V súbore sú pripravené miesta a komentáre.

## Výsledok

Pri každom automatickom refresh-cache sa po načítaní nových filmov hneď spustí repair a pokúsi sa doplniť:

- `primaryVideo`
- `detailUrl`
- `imdbId`
- `csfdUrl`
- `sourceUrl`

Potom GitHub Actions commitne opravenú cache späť do repozitára.
