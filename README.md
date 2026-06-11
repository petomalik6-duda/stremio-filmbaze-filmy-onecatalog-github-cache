# Filmbáze IMDb Stremio ID fix

Tento balík nerobí z Filmbáze stream addon. Filmbáze ostáva správne iba catalog/meta addon.

Oprava zabezpečí, že keď položka má `imdbId`, Stremio ID v katalógu a meta bude IMDb ID (`tt...`).
Potom Fusion alebo iné stream addony dostanú správne ID a môžu nájsť stream.

## Prečo je to potrebné

Barvy zla: Černá už má v cache:

```json
"imdbId": "tt38681832",
"tmdbId": 1560681
```

Ak však catalog/meta stále vracia:

```json
"id": "filmbaze:809608"
```

iné stream addony to nemusia nájsť. Správne má vracať:

```json
"id": "tt38681832"
```

## Súbory

Nahraj do repozitára:

```txt
scripts/filmbaze-stremio-id.cjs
scripts/check-stremio-ids.cjs
.github/workflows/check-stremio-ids.yml
patches/PATCH-server-js-esm.txt
patches/PATCH-server-js-commonjs.txt
```

## Postup

1. Nahraj súbory zo ZIPu.
2. Otvor `patches/PATCH-server-js-esm.txt`, ak máš v package.json `"type":"module"`.
3. Uprav `server.js` podľa patchu.
4. Commit + push.
5. Render: Manual Deploy → Deploy latest commit.
6. Skontroluj manifest. Má zostať `resources:["catalog","meta"]`.
7. Skontroluj catalog JSON a nájdi Barvy zla. Musí mať `id:"tt38681832"`.
8. V Stremio odinštaluj a znovu nainštaluj addon, aby nepoužívalo staré `filmbaze:` ID.

## Test v GitHub Actions

Spusti workflow:

```txt
Check Filmbaze Stremio IDs
```

V logu uvidíš, či Barvy zla mapuje na `tt38681832`.
