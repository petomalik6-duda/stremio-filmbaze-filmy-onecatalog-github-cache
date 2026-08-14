# v3.6.4 – Jina description/content parser fix

- Fixes the 3.6.3 failure mode where Jina returned JSON results but `indexedItems` stayed at 0.
- Parses both Jina `description` (SERP snippet) and `content` instead of discarding the description when content exists.
- Uses the exact Filmbáze channel URL as the first Jina query, followed by the semantic channel query.
- Adds safe result samples to refresh diagnostics (title, URL, and booleans only; no API key or full page text).
- Keeps strict TMDB/IMDb promotion and historical-cache preservation unchanged.
