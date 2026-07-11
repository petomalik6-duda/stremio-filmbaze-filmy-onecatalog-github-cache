# WEDOS data pollution fix (v3.4.8)

The previous refresh parsed a WEDOS.protection / HTTP 401 challenge page as movie and series titles.

This version:
- removes all poisoned `reader-*` records from the cache,
- rejects WEDOS/401/security challenge reader responses,
- disables reader fallback in the GitHub refresh workflow,
- makes cache validation fail if blocked-page text appears again,
- preserves the last valid cache when Filmbáze cannot be read.

Expected clean cache: 1145 items (1024 movies, 121 series).
