# Filmbáze Missing refresh-cache script fix

Táto oprava rieši chybu:

```txt
npm error Missing script: "refresh-cache"
```

## Prečo chyba vznikla

Workflow alebo wrapper očakáva npm script:

```bash
npm run refresh-cache
```

ale v `package.json` vo Filmbáze projekte taký script nie je.

## Čo nahrať

Nahraj do projektu:

```txt
scripts/refresh-cache-with-repair.js
.github/workflows/refresh-cache.yml
```

A podľa `PATCH-package.json.txt` uprav `package.json`.

## Dôležité

Musíš mať v `package.json` aj základný refresh script. Napríklad:

```json
"refresh-cache": "node scripts/refresh-cache.js"
```

Ak sa tvoj pôvodný refresh súbor volá inak, napríklad `scripts/update-cache.js`, použi:

```json
"refresh-cache": "node scripts/update-cache.js"
```

## Potom workflow robí

```txt
refresh-cache
→ filmbaze-stream-repair
→ prípadne tmdb-repair
→ commit cache
```
