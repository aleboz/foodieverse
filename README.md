# Irina's Foodieverse

Places I think are worth your time. This is a personal, mobile-first guide to
places recommended to friends, at **https://aleboz.github.io/foodieverse/**.

**Git is the database. The AI conversation is the CMS. The website is the guide.**

## How it works

```
Irina ──chat──► AI agent ──commit──► GitHub ──Actions: validate + build──► GitHub Pages
```

- `data/pois/<city>/<slug>.json`: one file per place ([schema](data/poi.schema.json), [taxonomy](data/taxonomy.json))
- `data/images/<city>/<slug>/`: original photos; resized WebP is generated at build time
- `src/`: Astro static site (a pre-rendered page per city and per place, Leaflet + OpenStreetMap map, client-side search and filters)
- `scripts/`: validation, image optimisation and authoring helpers for the AI agent
- [`AGENTS.md`](AGENTS.md): the authoring playbook every AI agent follows
- [`docs/chat-authoring.md`](docs/chat-authoring.md): instructions for chat assistants that can't run scripts
- [`docs/issue-authoring.md`](docs/issue-authoring.md): adding places through GitHub issues, no AI chat needed

## Adding a recommendation

Open a Claude Code session on this repository (from the Claude app or
claude.ai/code) and write something like:

> Add this to Foodieverse: https://maps.app.goo.gl/… Wonderful little wine bar,
> amazing natural wines… *(+ photos)*

Claude shows a preview. Reply **yes** and it publishes. Edits ("make it three
hearts", "Bar Vivant has closed") work the same way.

### From the GitHub app, without an AI chat

Open an issue in this repository (GitHub mobile app or website) with the
Google Maps link and your text, and reply **yes** to the preview comment.
See [docs/issue-authoring.md](docs/issue-authoring.md). AI suggestions there
need an `ANTHROPIC_API_KEY` repository secret.

## One-time GitHub setup

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Actions → General → Workflow permissions:** keep the default
   (the workflow requests the permissions it needs). Under *Fork pull request
   workflows*, keep approval required.
3. Don't add a branch protection rule on `main` that requires pull requests.
   If you add one, let GitHub Actions bypass it, or `data/`-only authoring
   branches can't auto-publish.
4. Push or merge to `main`. The **Validate & publish** workflow builds and
   deploys.

## Development

```bash
npm ci
npm run dev        # http://localhost:4321/foodieverse/
npm run build      # validate → images → static site in dist/
npm run validate   # check all POI files
```

Requires Node 22.12+. Map data © OpenStreetMap contributors.

The six places currently in the collection are **sample entries** (tagged
`sample`) so the interface can be tried out. Ask the agent to "remove all the
sample entries" once real recommendations are in.
