# Filmbáze title fallback normalizer fix

Tento balík nerieši `primaryVideo: null` ako chybu, pretože si zistil, že napríklad Mortal Kombat 2 má tiež `primaryVideo: null`, ale stream funguje.

Problém pri `Barvy zla: Černá / Kolory zła: Czerń` je pravdepodobne v názvovom fallbacku:

- dvojbodka `:`
- česká diakritika `Černá`
- poľské znaky `zła`, `Czerń`
- rozdiely `Czern`, `Cern`, `Cierna`, `Cerna`

## Súbory

- `scripts/filmbaze-title-normalizer.cjs` — helper na generovanie názvových variantov
- `scripts/test-title-variants.cjs` — test výpisu variantov
- `PATCH-server-stream-route.txt` — návod kam vložiť fallback do stream route

## Test

```bash
node scripts/test-title-variants.cjs "Barvy zla: Černá" "Kolory zła: Czerń" 2026
```

## Dôležité

Toto treba zapojiť do `/stream` route, nie do GitHub Actions refreshu. Refresh môže zostať tak ako je.

V patchi je miesto:

```js
const found = await searchStreamsByTitle(q, movie.year);
```

Tento názov musíš nahradiť reálnou funkciou z tvojho addonu, ktorá už dnes hľadá stream pre filmy ako Mortal Kombat 2.
