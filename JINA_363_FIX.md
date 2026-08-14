# Filmbáze v3.6.3 – Jina JSON fallback

Keep the existing GitHub secrets `TMDB_API_KEY` and `JINA_API_KEY`.

Run the normal workflow with:
- `force_full: false`
- `deep_source_scan: false`

Useful log fields after the run:
- `indexedJinaSuccessfulQueries`
- `indexedJinaJsonResults`
- `indexedJinaResponseBytes`
- `indexedItems`
- `indexedAccepted`
- `indexedKnownMatches`

A healthy Jina call should have `indexedJinaSuccessfulQueries > 0` and normally
`indexedJinaJsonResults > 0`. The cache timestamp is updated only after a trusted
known title or a strictly verified new title is found.
