# v3.6.5 – Brave search-index fallback

Filmbáze is currently blocked by WEDOS HTTP 401 for automated origin requests. Jina Search also fetches result URLs, so it can receive the same WEDOS security page.

v3.6.5 adds Brave Search API as the preferred fallback. Brave returns raw search-index snippets (`description` and `extra_snippets`) without requiring this addon to open the protected Filmbáze result URL.

GitHub secret:

- `BRAVE_SEARCH_API_KEY`

The fallback remains conservative: only the exact Filmbáze movie/series channel page or the trusted homepage can produce hints, and new hints must still pass strict TMDB + IMDb + title/year validation before being added.
