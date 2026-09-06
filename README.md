## WEDOS-safe source snapshot (v3.6.7)

GitHub/Azure cloud IPs can be blocked by WEDOS before the first Filmbáze API response. v3.6.7 therefore supports a small source snapshot created from a network where Filmbáze permits normal access. No CAPTCHA or security challenge is bypassed.

On an allowed computer/network:

```bash
npm ci
npm run snapshot:local
git add data/filmbaze-source-snapshot.json
git commit -m "Update Filmbaze source snapshot"
git push
```

A fresh snapshot contains only the newest page of movies and series. The normal incremental refresh merges it with the validated historical cache. A snapshot is accepted only when it contains both movies and series and is at most 36 hours old. If the local network is WEDOS-blocked too, `snapshot:local` fails instead of attempting to bypass the challenge.

## Current WEDOS fallback (v3.6.6)

Configure GitHub Actions secret `SERPAPI_KEY`. The refresh reads Google organic `title`, `link` and `snippet` via SerpAPI without opening the protected Filmbáze page. Brave/Jina are not used by the main refresh path.

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


## GitHub secret for blocked Filmbáze refresh (v3.6.2)

If Filmbáze returns HTTP 401/WEDOS protection, configure repository secret `JINA_API_KEY`.
The workflow passes it only as an environment secret and never prints the key value.
With the key present, authenticated Jina Search is tried before Bing/DDG and is used only to discover the newest Filmbáze window; the historical cache is never replaced by search results.


### WEDOS-safe refresh

For the current WEDOS 401 protection, add GitHub Actions secret `BRAVE_SEARCH_API_KEY`. v3.6.5 prefers Brave raw search-index snippets, while Jina is kept only as a secondary fallback.
