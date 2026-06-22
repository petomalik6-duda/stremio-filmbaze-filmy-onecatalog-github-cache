# Prechod na verziu 3.4.2

1. Zálohuj aktuálny repozitár alebo vytvor nový branch.
2. Nahraj celý obsah balíka do rootu repozitára a nahraď existujúce súbory.
3. Ponechaj iba workflow `.github/workflows/refresh-cache.yml`.
4. Priečinok `data/` nemaž; zachovaj `data/catalog-cache.json`.
5. V GitHub Secrets ponechaj `TMDB_API_KEY`.
6. Na Renderi ponechaj `CACHE_FILE=data/catalog-cache.json` a `PAGE_SIZE=100`.
7. Prvý workflow spusti s `Force full TMDB rebuild = false`.
8. Po úspešnom commite cache redeployni Render alebo počkaj na automatický deploy.
9. Over `/health`, stránkovanie, poradie a seriál s viacerými epizódami.

## Kedy použiť full rebuild

`Force full TMDB rebuild = true` používaj iba pri potrebe kompletne obnoviť všetky TMDB metadata. Vo v3.4.2 už naozaj obíde denné limity a môže trvať dlho.
