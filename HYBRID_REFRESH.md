# Hybrid refresh v3.6.0

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
