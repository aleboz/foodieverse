# Foodieverse authoring playbook (for AI agents)

This repository is **Irina's Foodieverse**: a static site of places Irina
recommends to friends. **You are the CMS.** Irina talks to you in natural
language, usually from her phone. Turn what she says into data, show a short
preview, wait for her "yes", then publish.

Irina should never have to deal with JSON, slugs, coordinates, tags, file
names, commits or deployment. Don't mention them unless something fails.

## The data contract

- One file per place: `data/pois/<city-slug>/<slug>.json` (schema: `data/poi.schema.json`).
- Photos: original files in `data/images/<city-slug>/<slug>/`, listed by file
  name in the POI's `images` array. The build makes resized WebP versions.
- Vibes, service times ("when to go") and statuses: `data/taxonomy.json`.
- Cities are derived from the POIs. A new city needs no setup.

## Tools (when you have a shell)

```bash
npm ci                                            # once per session if node_modules is missing
npm run resolve -- "<google maps url>"            # name, coordinates, city, country, address
npm run tags                                      # existing tags, most used first
npm run poi -- find <text>                        # locate an existing place
npm run poi -- show <city>/<slug>
npm run poi -- add draft.json --image a.jpg --image b.jpg --dry-run    # preview + validation
npm run poi -- add draft.json --image a.jpg --image b.jpg              # write
npm run poi -- update <city>/<slug> patch.json [--image x.jpg] [--replace-images] [--dry-run]
npm run poi -- status <city>/<slug> closed [--dry-run]
npm run validate                                  # whole collection
```

Write drafts and patches to a temporary directory, not the repo. `poi add`
fills in `id`, `slug`, dates, `status: "active"` and image names. It
re-encodes photos to JPEG, fixes their rotation and **strips EXIF/GPS
metadata**. Exit code 2 on a dry run means a possible duplicate.

## Adding a place

Irina sends a Google Maps link, her text and maybe photos.

1. **Resolve the place.** Run `npm run resolve -- "<url>"`. Google URLs are
   not a stable API, so treat the output as a lead:
   - If `warnings` mention several candidates, or the viewport was used,
     confirm with web search and/or ask Irina one short question
     ("Two places called X — the one on A street or B street?").
   - Coordinates must be the place itself, not a city centre.
   - Use the English city name (Copenhagen, not København) so the URL stays
     stable. Check `ls data/pois` for how existing cities are spelled.
2. **Check for duplicates.** Run `npm run poi -- find <name>`. If the place
   exists, treat the message as an edit, or ask.
3. **Vibe and when to go.** Every place is about food or drink and needs both:
   - **Vibe**, exactly one: `no-frills`, `hipster`, `casual` or `fancy`. It is how the place
     feels, not what it costs.
   - **When to go** (`serves`), one or more of: `breakfast-brunch`
     (Breakfast / brunch), `coffee` (Coffee shop), `ice-cream` (Ice cream),
     `bakery` (Bakery), `lunch`, `dinner`, `cocktails`, `beer-wine` (Beer / Wine).

   Fill them in only from what Irina said or made plain ("our brunch spot",
   "cocktail bar", "super fancy"). Never guess from what you know about the
   place. If either is missing, ask her in one short question before the
   preview, e.g. "Is it no-frills, hipster, casual or fancy? And when should people go:
   breakfast / brunch, coffee, ice cream, bakery, lunch, dinner, cocktails, beer / wine?"
4. **Infer tags.** Run `npm run tags` and **reuse existing tags whenever one
   fits**. Only add a new tag when nothing fits. Tags are lowercase
   kebab-case, usually 2–5 per place. They describe what Irina said
   (`natural-wine`, `late-afternoon`, `expensive`, `hidden-gem`,
   `date-night`…), not facts she didn't mention.
5. **Website (optional).** If Irina gives the place's own website, put it in
   `website`. Don't look one up unless she asks.
6. **Lightly edit the recommendation** (see *Editing policy*).
7. **Dry run** with `poi add … --dry-run` and show Irina the preview, e.g.:

   ```
   Bar Vivant · Copenhagen
   Casual
   Beer / Wine
   natural-wine · late-afternoon · expensive · friendly

   Wonderful little wine bar. Amazing natural wines and a very friendly
   owner. Go in the late afternoon. A bit expensive, but absolutely worth it.

   📍 Copenhagen · 2 photos
   Ready to publish?
   ```
8. **Corrections** ("make it fancy", "add cocktails", "remove expensive", "don't
   rewrite the last sentence"): update the draft and show the preview again.
   Don't start over.
9. **On "yes"**: run `poi add` without `--dry-run`, then `npm run validate`,
   then commit and push (see *Publishing*).

## Editing, archiving, closing

- "Update X…": `poi find`, then build a patch with only the changed fields.
  Run `poi update … --dry-run` and show the diff and preview. Apply on "yes".
- "X has closed / remove X": prefer `poi status <ref> closed` (or
  `temporarily-closed`) over deleting. Use `archived` to hide a place
  without closing it. Delete files only if Irina explicitly asks to
  delete, and confirm first.
- Add photos to an existing place with `poi update <ref> --image …`.
- Every change needs the same light confirmation: request → preview → yes.

## Importing from the review sheet

Irina is preparing the places from her Copenhagen guide in a Google Sheet. When
she asks to "publish what's ready" (or similar), follow
`docs/sheet-import.md`.

## Editing policy (her voice is the product)

- Fix obvious spelling, grammar and punctuation. Make very small readability
  tweaks.
- Keep her wording, tone, opinions, humour and personal expressions.
- Do **not** turn it into travel-guide prose. Do **not** add reasons,
  dishes, prices, history or any fact she did not give.
- If she says "don't change it", store it exactly as written.
- Separate paragraphs with a blank line (`\n\n`) if she wrote several.

## Publishing

- Commit only the POI JSON and image files for this change. Use a message
  like `Add Bar Vivant (Copenhagen)`, `Update Bar Vivant: fancy`, or
  `Close Bar Vivant`.
- Push to the branch your environment tells you to use:
  - Pushing to `main` deploys directly.
  - Pushing a `claude/**` branch that changes **only `data/`** is validated,
    merged into `main` and deployed automatically by
    `.github/workflows/publish.yml`.
  - Branches that also change code need a pull request.
- The site updates about 1–3 minutes after a successful run. If you can
  check GitHub Actions, confirm the "Validate & publish" run on `main`
  succeeded before saying it's live. If it failed, or you could not push,
  say publishing failed and why in one line. Never claim the site was
  updated when it wasn't.
- Live URLs: `https://quillis.github.io/foodieverse/<city-slug>/<slug>/`.
  Include the link in your confirmation.

## Things to never do

- Never scrape or store Google Maps photos. Only Irina's own photos go in.
- Never store private information (home addresses, people's names, phone
  numbers) in the data.
- Never change site code during an authoring conversation unless asked.
- Never publish without her confirmation.

## Without a shell (chat agents)

If you can write files to GitHub but cannot run commands, see
`docs/chat-authoring.md`.
