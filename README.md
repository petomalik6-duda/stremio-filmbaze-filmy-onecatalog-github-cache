# Filmbáze Stremio/Nuvio addon v3.5.1

Táto verzia používa bezpečný inkrementálny refresh navrhnutý tak, aby výrazne znížil riziko blokovania cez WEDOS.

## Denný refresh

Bežný naplánovaný workflow:

- načíta iba prvú stránku najnovších filmov,
- počká 5 sekúnd,
- načíta iba prvú stránku seriálov,
- nové položky spojí s poslednou platnou cache,
- detailné Filmbáze stránky jednotlivých titulov nenačítava,
- metadata dopĺňa iba pre obmedzený počet nových položiek cez TMDB.

Za normálnych podmienok tak Filmbáze dostane iba dve požiadavky za jeden denný refresh.

## Ochrana pri WEDOS blokovaní

Pri HTTP 401, 403, 429 alebo pri WEDOS bezpečnostnej stránke sa aktivuje circuit breaker. Refresh okamžite zastaví všetky ďalšie požiadavky na Filmbáze a zachová predchádzajúcu cache bez poškodenia.

Externý firewall nemožno technicky obísť ani garantovať, že nikdy nezablokuje zdieľanú IP GitHub Actions. Táto verzia však odstránila opakované fallback requesty, ktoré blokovanie výrazne zhoršovali.

## Workflow

Nahraj obsah balíka priamo do koreňa repozitára a spusti **Refresh Filmbaze cache** s:

- `force_full: false`
- `deep_source_scan: false`

`deep_source_scan: true` používaj iba manuálne a výnimočne. Denný cron ho nikdy nepoužíva.

## Kontrolné endpointy

- `/manifest.json`
- `/health`
- `/cache.json`

Po nasadení musí `/health` uvádzať verziu `3.5.0`.


## v3.5.1 – oprava automatického refreshu

- Workflow sú uložené v povinnom priečinku `.github/workflows/`.
- Pri WEDOS blokovaní API sa skúsi jeden bezpečný reader fallback na každý kanál.
- Reader parser prijíma iba explicitné `Poster for ...` položky, aby nevkladal WEDOS/HTML text ako filmy.
- Pri reader fallback sa existujúce tituly párujú aj podľa normalizovaného názvu + roku, aby nevznikali duplicity.
- Workflow po refreshe kontroluje vek cache. Ak sa zdroj nepodarí aktualizovať a cache je staršia ako 48 hodín, run skončí chybou namiesto falošného zeleného úspechu.
