# Prechod na v3.5.0

1. Rozbaľ ZIP.
2. Nahraj obsah rozbaleného priečinka priamo do koreňa GitHub repozitára.
3. Skontroluj, že `package.json` má verziu `3.5.0`.
4. Spusti workflow s `force_full=false` a `deep_source_scan=false`.
5. V logu musí byť `Running addon version 3.5.0`.
6. Po nasadení skontroluj `/health`.
7. V Nuvio odstráň starú inštaláciu a znovu pridaj `/manifest.json`, pretože addon ID je nové `v350`.

Denný refresh nepoužíva full source crawl. Celá stará cache sa zachováva a aktualizuje sa iba najnovšia časť katalógu.
