# Filmbáze stream route fallback fix

Tento balík nerieši iba refresh cache. Rieši prípad, keď film má TMDB detail, ale v cache má:

```json
"primaryVideo": null
```

Vtedy refresh nepomôže, ak zdroj nedokáže `primaryVideo` doplniť.

Treba upraviť stream route tak, aby pri `primaryVideo: null` hľadala stream podľa:

- českého názvu
- originálneho názvu
- názvu bez diakritiky
- roku

Súbory:

- `scripts/filmbaze-title-fallback.cjs` - pomocné funkcie na názvy a varianty
- `PATCH-server-stream-route.txt` - presné miesto, ktoré treba upraviť v server.js/routes

Ak je projekt ES module (`"type":"module"`), `.cjs` súbor funguje aj tak.
