# v3.6.6 – SerpAPI Google index fallback

Required GitHub Actions secret: `SERPAPI_KEY`.

When Filmbáze is blocked by WEDOS, the refresh uses Google organic search snippets through SerpAPI. At most two searches are attempted per catalog type, and the second is skipped as soon as trusted catalog hints are found. Search snippets never replace the historical cache; new candidates still require strict TMDB/IMDb validation.

Brave Search and Jina Search are no longer part of the main refresh path. The GitHub workflow also disables the Jina Reader origin fallback.
