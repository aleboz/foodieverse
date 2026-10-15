# Authoring from a chat assistant without a shell

Use this when the assistant (for example ChatGPT, or a Claude chat with a
GitHub connector) can **read and write files in this GitHub repository** but
cannot run `npm` scripts. The workflow and rules are the same as in
`AGENTS.md`. Only the mechanics differ.

> The assistant needs **write** access to the repository. A read-only GitHub
> integration can draft the JSON but cannot publish it.

## Project instructions to paste into the assistant

Paste this as the project's custom instructions:

```text
You manage "Irina's Foodieverse", the GitHub repository quillis/foodieverse.
Read AGENTS.md in that repository and follow it: the workflow, inference
rules, editing policy and "request → preview → yes" confirmation. You cannot
run scripts, so instead:

- Resolve Google Maps links with web browsing/search. Coordinates come from
  the "!3d<lat>!4d<lng>" part of a full Google Maps URL when present;
  otherwise look the place up (OpenStreetMap/Nominatim or the official
  website). Never guess coordinates.
- Before tagging, read existing tags from the files in data/pois/.
- Write the POI file yourself, following data/poi.schema.json:
    path: data/pois/<city-slug>/<slug>.json
    id = "<slug>-<city-slug>", status "active", createdAt/updatedAt = today
    (YYYY-MM-DD), slug = lowercase kebab-case of the name, unique in the city.
- Photos: upload them as data/images/<city-slug>/<slug>/01.jpg, 02.jpg, …
  and list ["01.jpg", "02.jpg"] in "images".
- Commit everything for one place in one commit to main, with a message
  like "Add <name> (<city>)".
- GitHub Actions validates and deploys. Tell Irina it will be live at
  https://quillis.github.io/foodieverse/<city-slug>/<slug>/ in a few minutes.
  If the "Validate & publish" run fails, tell her and fix the reported error.
```

## Minimal POI example

```json
{
  "id": "bar-vivant-copenhagen",
  "slug": "bar-vivant",
  "name": "Bar Vivant",
  "city": "Copenhagen",
  "country": "Denmark",
  "location": { "latitude": 55.6761, "longitude": 12.5683 },
  "category": "drink",
  "tags": ["natural-wine", "late-afternoon", "expensive"],
  "recommendation": "Wonderful little wine bar. …",
  "rating": 2,
  "googleMapsUrl": "https://maps.app.goo.gl/…",
  "address": null,
  "images": [],
  "status": "active",
  "createdAt": "2026-10-10",
  "updatedAt": "2026-10-10"
}
```

## Notes

- Photos uploaded this way keep their original metadata in the repository.
  The published site strips it from the resized versions. The shell-based
  route (`npm run poi`) strips it from the stored originals too.
- HEIC photos aren't supported. Upload JPEG or PNG; most phones convert
  automatically when sharing.
