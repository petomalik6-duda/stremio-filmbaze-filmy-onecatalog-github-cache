# Filmbaze direct node refresh fix

Tento balík rieši chybu:

```txt
npm error Missing script: "refresh-cache-with-repair"
```

Workflow už nepoužíva:

```yaml
run: npm run refresh-cache-with-repair
```

ale priamo:

```yaml
run: node scripts/refresh-cache-with-repair.js
```

Tým pádom nezáleží na tom, či máš v `package.json` script `refresh-cache-with-repair`.

## Použitie

1. Nahraj `.github/workflows/refresh-cache.yml` do repozitára Filmbáze addonu.
2. Nahraj priečinok `scripts` do rootu projektu.
3. Skontroluj, že existuje pôvodný refresh súbor. Wrapper skúša tieto názvy:

```txt
scripts/refresh-cache.js
scripts/update-cache.js
scripts/build-cache.js
scripts/refresh.js
refresh-cache.js
update-cache.js
build-cache.js
```

Ak máš pôvodný refresh súbor pod iným názvom, otvor:

```txt
scripts/refresh-cache-with-repair.js
```

a doplň jeho názov do zoznamu kandidátov.

## Denné spúšťanie

Workflow je nastavený denne:

```yaml
schedule:
  - cron: "20 3 * * *"
```

To je 03:20 UTC, teda približne 05:20 na Slovensku počas letného času.
