# Filmbáze Stremio/Nuvio addon v3.4.2

Catalog/meta addon pre CZ/SK filmy a seriály z Filmbáze. Streamy poskytujú ostatné nainštalované stream addony cez IMDb/TMDB ID.

## Čo je nové vo v3.4.2

- manuálny `force_full=true` teraz skutočne spracuje celý katalóg bez denných limitov,
- full rebuild zachová predchádzajúce kvalitné metadata ako fallback, ak TMDB dočasne zlyhá,
- rozbehnutý refresh sa už nezruší, keď začne ďalší plánovaný alebo manuálny beh,
- TMDB/HTTP požiadavky rešpektujú `Retry-After` a používajú exponenciálny backoff pri `429`, `5xx` a sieťových chybách,
- zachované sú všetky funkcie v3.4: inkrementálny repair, Nuvio epizódy, stránkovanie po 100, IMDb ID ako hlavné Stremio ID, atomický zápis a validácia cache.

## Denný refresh

Naplánovaný workflow používa `force_full=false`, limity 120 filmov a 200 seriálov a spúšťa sa denne podľa cron nastavenia vo workflow.

## Skutočný full rebuild

V GitHub Actions zvoľ **Run workflow** a nastav `Force full TMDB rebuild` na `true`.

Pri full rebuilde sa denné limity nepoužijú. Spracovanie celého katalógu preto môže trvať výrazne dlhšie a môže urobiť veľa TMDB požiadaviek. Používaj ho len pri kompletnej obnove metadát.

## Nasadenie

1. Nahraj celý obsah balíka do rootu GitHub repozitára.
2. V GitHub Actions secrets ponechaj `TMDB_API_KEY`.
3. Na Renderi nastav:
   - `CACHE_FILE=data/catalog-cache.json`
   - `PAGE_SIZE=100`
4. Build command: `npm ci`
5. Start command: `npm start`
6. Spusti workflow s `force_full=false`.

## Kontrola

- `/health`
- `/manifest.json`
- `/catalog/movie/filmbaze-filmy.json`
- `/catalog/movie/filmbaze-filmy/skip=100.json`
- `/catalog/series/filmbaze-serialy.json`
- detail seriálu s viacerými epizódami
