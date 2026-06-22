# Filmbáze Stremio/Nuvio addon v3.4

Catalog/meta addon pre CZ/SK filmy a seriály z Filmbáze. Streamy poskytujú ostatné nainštalované stream addony cez IMDb/TMDB ID.

## Čo je nové vo v3.4

- inteligentný inkrementálny repair neúplných starších položiek,
- repair prebehne aj keď sa `sourceHash` nezmenil,
- pri známom `tmdbId` sa používa priamy TMDB detail namiesto nepresného title search,
- pri známom `imdbId` sa používa TMDB `/find`,
- seriály v Nuvio dostanú všetky reálne epizódy,
- cache sa zapisuje atomicky cez dočasný súbor,
- server drží cache v pamäti a znovu ju načíta iba po zmene súboru,
- workflow pred commitom kontroluje veľkosť, duplicity a pokles cache,
- `/health` ukazuje kvalitu cache a štatistiky posledného refreshu,
- zachované stránkovanie `?skip=100` aj `/skip=100.json`.

## Nasadenie

1. Nahraj celý obsah tohto priečinka do rootu GitHub repozitára.
2. V GitHub Actions secrets nastav `TMDB_API_KEY`.
3. Na Renderi nastav:
   - `CACHE_FILE=data/catalog-cache.json`
   - `PAGE_SIZE=100`
4. Build command: `npm ci`
5. Start command: `npm start`
6. Spusti workflow **Refresh Filmbaze cache** manuálne alebo počkaj na denný cron.

## Kontrola

- `/health`
- `/manifest.json`
- `/catalog/movie/filmbaze-filmy.json`
- `/catalog/movie/filmbaze-filmy/skip=100.json`
- `/catalog/series/filmbaze-serialy.json`
- `/debug/cache`
- `/debug/item/series/tt...`

## Full refresh

V GitHub Actions zvoľ **Run workflow** a nastav `force_full` na `true`. Full refresh používaj iba pri potrebe kompletnej obnovy TMDB metadát, pretože je výrazne pomalší.
