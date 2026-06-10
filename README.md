# Filmbaze debug hardfix with workflow

Tento balík obsahuje aj `.github/workflows/refresh-cache.yml`.

## Nahraj do repozitára

- `.github/workflows/refresh-cache.yml`
- `scripts/refresh-cache-with-repair.cjs`
- `scripts/force-repair-primaryvideo-null.cjs`
- `scripts/find-cache-item.cjs`
- `scripts/filmbaze-stream-repair.cjs`

## Čo workflow robí

1. Spustí pôvodný refresh cache súbor, ak ho nájde.
2. Označí položky s `detailChecked: true` a `primaryVideo: null` na opätovnú kontrolu.
3. Vypíše položku `Barvy zla` z cache do logu.
4. Commitne zmenenú cache späť do GitHubu.

## Dôležité

Toto ešte neopravuje samotnú `/stream` route. Je to hardfix pre cache stav, aby inkrementálny refresh nepreskakoval filmy bez `primaryVideo`.
