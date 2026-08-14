# Hybrid refresh v3.6.1

The daily refresh now uses this order:

1. Filmbáze channel API with the existing low-request budget.
2. Jina Reader for the public Filmbáze catalogue page.
3. Public search-index discovery when WEDOS blocks the Filmbáze origin.

The search-index result is only a small newest-title window. It never replaces the complete cached catalogue. Old cache items are preserved.

A title found only by the public index is added only after TMDB resolution confirms:
- TMDB ID,
- valid IMDb ID,
- year within ±1 year,
- compatible title.

Unverified candidates are discarded for that run.

`JINA_API_KEY` is optional. Without it, the refresh still tries the Bing RSS search-index fallback. If you later add a Jina key as a GitHub secret, Jina Search becomes an additional discovery provider.


## v3.6.1 public-index fix

When Filmbáze/WEDOS blocks the origin, the refresh now tries multiple Bing RSS queries and a DuckDuckGo HTML fallback. It accepts snippets only from the dedicated Filmbáze channel page or from the Filmbáze homepage when the snippet explicitly identifies the matching section. Indexed candidates never replace the historical cache and are promoted only after strict TMDB + IMDb verification. Current-attempt diagnostics are persisted even when the old cache is preserved.


## v3.6.2: authenticated Jina Search fallback

When Filmbáze/WEDOS returns HTTP 401, the reliable public-index fallback is `s.jina.ai`.
Create a Jina API key and add it to GitHub repository secrets as `JINA_API_KEY`.
The daily workflow uses one Jina search query for movies and one for series, then strictly verifies any new candidate through TMDB/IMDb before adding it.
Bing RSS and DuckDuckGo remain best-effort only.

Expected workflow diagnostics:

```text
JINA_API_KEY configured: true (Jina Search will be preferred)
[filmbaze] indexed fallback attempted providers: jina-search, ...
[filmbaze] Jina Search configured: true
```
