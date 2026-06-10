# Fix: Missing script refresh-cache-with-repair

Táto chyba znamená, že GitHub Actions workflow volá:

```bash
npm run refresh-cache-with-repair
```

ale v `package.json` nie je script s názvom `refresh-cache-with-repair`.

## Oprava

V `package.json` nájdi sekciu `scripts` a doplň do nej tieto riadky:

```json
"repair-filmbaze-streams": "node scripts/filmbaze-stream-repair.js",
"refresh-cache-with-repair": "node scripts/refresh-cache-with-repair.js"
```

Ak tam chýba aj pôvodný refresh-cache script, doplň aj tento riadok:

```json
"refresh-cache": "node scripts/refresh-cache.js"
```

ALE iba vtedy, ak súbor `scripts/refresh-cache.js` v projekte naozaj existuje.

Ak sa pôvodný refresh súbor volá inak, napríklad `update-cache.js`, použi:

```json
"refresh-cache": "node scripts/update-cache.js"
```

Workflow môže zostať:

```yaml
run: npm run refresh-cache-with-repair
```
