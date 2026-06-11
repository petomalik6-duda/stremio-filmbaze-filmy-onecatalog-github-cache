# Filmbáze auto cache detect fix

Tento balík opravuje stav, keď `/health` ukazuje samé nuly, lebo `server.js` nenašiel cache súbor.

## Použitie

1. Nahraď aktuálny `server.js` týmto súborom.
2. Commit + push.
3. Render → Manual Deploy → Deploy latest commit.
4. Otvor:
   - `/health`
   - `/debug/cache`
   - `/catalog/movie/filmbaze-filmy.json`

Server automaticky prehľadá JSON súbory v projekte a vyberie najväčší súbor, ktorý vyzerá ako Filmbáze cache.

Dôležité: addon zostáva catalog/meta only. Nepridáva stream resource.
