# Volný hráč fix (v3.4.9)

The live Filmbáze page was protected by WEDOS, so v3.4.8 restored the last valid snapshot but could not discover titles added later.

This package manually restores:
- Filmbáze ID: 258618
- Name: Volný hráč
- Original name: Les Arènes
- IMDb: tt29942429
- TMDB: 1001374

Upload the ZIP contents to the repository root, deploy Render, remove the older Filmbáze addon from Nuvio and install `/manifest.json` again because the addon ID changed to v349.
