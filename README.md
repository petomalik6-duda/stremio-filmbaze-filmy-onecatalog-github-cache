# Filmbaze fix ako FilmovéNovinky addon

Tento balik je jednoduchsi a bez test workflow.
Pouziva `.cjs`, takze funguje aj ked `package.json` obsahuje `"type": "module"`.

## Co nahrat

Nahraj do Filmbaze repozitara:

- `.github/workflows/refresh-cache.yml`
- `scripts/refresh-cache-with-safe-repair.cjs`
- `scripts/filmbaze-safe-cache-repair.cjs`
- `scripts/filmbaze-title-normalizer.cjs`
- `PATCH-server-stream-route.txt` iba ako navod

## Co to robi

Workflow denne spusti:

```bash
node scripts/refresh-cache-with-safe-repair.cjs
```

Script najprv najde povodny refresh subor, napr.:

- `scripts/refresh-cache.js`
- `scripts/update-cache.js`
- `scripts/build-cache.js`
- `refresh-cache.js`

Potom spravi safe repair:

- neprepise funkcne udaje
- ak je `detailChecked:true` a `primaryVideo:null`, povoli opakovanu kontrolu
- nepovazuje `primaryVideo:null` automaticky za chybu

## Pre Barvy zla

Pre tento film je dolezity aj `PATCH-server-stream-route.txt`.
Ten pridava title fallback varianty:

- Barvy zla Cerna
- Barvy zla Cierna
- Kolory zla Czern
- Kolory zla Cern

Toto treba zapojit do `/stream` route servera.
