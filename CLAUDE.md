# Irina's Foodieverse

@AGENTS.md

## Developing the site (not authoring)

- Stack: Astro (static output) + vanilla TypeScript, Leaflet loaded lazily; base maps: Esri gray canvas (default), OpenStreetMap, Esri satellite (no API keys).
- `npm run dev` / `npm run build` (build = validate → images → astro build). Site base path is `/foodieverse/`; build internal links with `src/lib/url.ts`.
- Data loading: `src/lib/data.ts`. Shared rules for scripts and site: `scripts/lib/`.
- Code changes go through a pull request. Only `data/`-only branches auto-publish.
