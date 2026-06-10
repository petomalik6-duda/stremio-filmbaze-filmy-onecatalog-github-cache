# Filmbáze debug + hard fix balík

Tento balík je určený pre situáciu, keď:

- film je v katalógu,
- má TMDB detail,
- ale `primaryVideo` je `null`,
- stream endpoint vracia `streams: []`,
- refresh-cache repair ani route fallback nepomohol.

Cieľ je zistiť, či problém je:

1. fallback sa vôbec nezapojil do stream route,
2. addon používa inú cache ako workflow,
3. položka sa v stream route nenájde podľa ID,
4. stream route skončí priskoro pri `primaryVideo: null`,
5. cache repair preskakuje položku kvôli `detailChecked: true`.

## 1. Nahraj súbory

Nahraj do repozitára:

```txt
scripts/find-cache-item.cjs
scripts/force-repair-primaryvideo-null.cjs
PATCH-server-debug-route.txt
PATCH-refresh-repair-rule.txt
```

## 2. Spusti diagnostiku v GitHub Actions

Do workflow môžeš dočasne pridať krok:

```yaml
- name: Debug Barvy zla cache item
  run: node scripts/find-cache-item.cjs "Barvy zla"
```

Ak film nájde, vypíše jeho aktuálne hodnoty:

```txt
name
tmdbId
imdbId
primaryVideo
detailChecked
sourceUrl
```

## 3. Vynútená oprava položiek s primaryVideo:null

Do workflow po refreshi pridaj:

```yaml
- name: Force repair primaryVideo null items
  run: node scripts/force-repair-primaryvideo-null.cjs
```

Tento script nerobí zázračné scrapovanie streamov. Robí bezpečnú vec: pri položkách s `primaryVideo:null` nastaví:

```json
"detailChecked": false,
"streamStatus": "missing_primaryVideo_retry"
```

Tým zabráni tomu, aby ich ďalší inkrementálny refresh preskakoval ako hotové.

## 4. Najdôležitejšie pravidlo

V kóde nesmie byť logika:

```js
if (item.detailChecked) return item;
```

Musí byť:

```js
if (item.detailChecked && item.primaryVideo) return item;
```

Položka s týmto stavom sa nesmie považovať za hotovú:

```json
"detailChecked": true,
"primaryVideo": null
```

## 5. Stream route debug

Podľa `PATCH-server-debug-route.txt` pridaj do `server.js` debug endpoint:

```txt
/debug/movie/Barvy%20zla
```

Ten ukáže, či server v runtime cache vôbec vidí rovnakú položku ako GitHub cache.

