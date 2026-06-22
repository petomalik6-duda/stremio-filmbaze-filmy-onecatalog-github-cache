# Prechod na verziu 3.4

1. Zálohuj aktuálny repozitár alebo vytvor nový branch.
2. Nahraj celý obsah balíka do rootu repozitára a nahraď existujúce súbory.
3. Staré testovacie workflow a repair workflow zmaž. V balíku má zostať iba:
   `.github/workflows/refresh-cache.yml`.
4. V GitHub Secrets ponechaj `TMDB_API_KEY`.
5. Na Renderi nastav:
   - `CACHE_FILE=data/catalog-cache.json`
   - `PAGE_SIZE=100`
6. Build command: `npm ci`.
7. Start command: `npm start`.
8. Spusti GitHub Actions workflow `Refresh Filmbaze cache` manuálne.
9. Po úspešnom commite cache spusti Render `Deploy latest commit`.
10. Over `/health`, stránkovanie a detail seriálu s viacerými epizódami.

## Bezpečný návrat

Ak by sa refresh nepodaril, workflow cache necommitne. Na návrat stačí v GitHube revertovať commit s verziou 3.4 a redeploynúť Render.
