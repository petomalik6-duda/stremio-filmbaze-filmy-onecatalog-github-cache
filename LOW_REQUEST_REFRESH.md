# Low-request refresh v3.5.0

## Čo bolo zmenené

1. Denný refresh číta iba stranu 1 filmov a stranu 1 seriálov.
2. Kanály sa načítavajú sekvenčne, nie súčasne.
3. Medzi kanálmi je päťsekundová prestávka.
4. Denný režim používa iba priamy channel API endpoint.
5. HTML, Inertia a reader fallback sú v workflowe vypnuté.
6. Detailné requesty pre jednotlivé Filmbáze tituly sú vypnuté.
7. Na jeden beh je nastavený request budget.
8. HTTP 401/403/429 alebo WEDOS stránka okamžite otvoria circuit breaker.
9. Pri blokovaní sa predchádzajúca cache nemení.
10. Čiastočný výsledok sa bezpečne spojí so starou cache a nové tituly zostanú prvé.

## Očakávaný log

Normálny denný beh:

```text
Daily incremental source scan enabled: one page per channel.
[http] Filmbáze request 1/3: ...channel/48884...
[http] Filmbáze request 2/3: ...channel/50427...
[refresh] partial Filmbáze response detected: ...; preserving previous source items
```

Blokovaný beh:

```text
Filmbáze/WEDOS blocked the refresh with HTTP 403
[refresh] Keeping previous cache unchanged
No cache changes (source may have been unchanged or WEDOS-blocked).
```
