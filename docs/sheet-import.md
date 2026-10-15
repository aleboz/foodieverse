# Importing places from the review sheet

Irina's Copenhagen guide (a Google Doc) was turned into a review sheet so she
can prepare places a few at a time. Agents publish the rows she has finished
when she, or someone working with her, asks: "publish what's ready".

- **Review sheet:** [Foodieverse import – Copenhagen guide](https://docs.google.com/spreadsheets/d/1eWiAOR_SU3dst5QD-G3aOLIMU-0euOtPxPXTVqfo994/edit)
  (spreadsheet ID `1eWiAOR_SU3dst5QD-G3aOLIMU-0euOtPxPXTVqfo994`)
- **Source:** [Copenhagen Food Guide](https://docs.google.com/document/d/1qOXoVJPYXDpxak2RmSbwOMoRHwGAkLtH8Ci89bzROfs/edit).
  **Never modify the Google Doc.** It is Irina's own guide; the sheet is the
  working copy.
- **Access:** you need the Google Sheets connector. If it isn't available,
  say so; don't try to reach the sheet another way.

Everything in `AGENTS.md` still applies: the editing policy, "preview → yes",
and publishing only `data/` changes.

## The sheet

Two tabs. Row 1 is the header. Columns are found by their header text, so
read the header row first instead of relying on letters.

### Tab "Places (71)": places with Irina's text

| Column | Meaning |
|---|---|
| Import? | `Yes` / `No`. Only `Yes` rows are published. |
| On the site (filled in by Claude) | Empty until published. Then: the date and the live link. **Only agents write this column.** |
| Status | `active`, `temporarily-closed` or `closed` → the POI's `status`. |
| Area | Neighbourhood: Center, Christianshavn, Vesterbro, Amager. |
| Name, Address | → `name`, `address`. |
| Check on map | OpenStreetMap link to the pin; for Irina only. |
| Google Maps link | → `googleMapsUrl`. A Google Maps search for the name and address, unless Irina replaced it with her own share link. |
| Vibe | `No-frills` / `Hipster` / `Casual` / `Fancy` → `vibe` (lowercase). |
| Breakfast / brunch … Beer / Wine | Checkboxes → `serves`: `breakfast-brunch`, `coffee`, `ice-cream`, `bakery`, `lunch`, `dinner`, `cocktails`, `beer-wine`. |
| Tags | Comma-separated → `tags`. Already includes the area tag. |
| Text for the site | → `recommendation`. Already lightly edited; publish it as it stands in the sheet. |
| Your original text… | Her text before the light edit, only where something changed. Not published. |
| Notes from Claude | Notes for Irina. Not published. |
| Website | → `website` (the link from her doc). Leave out if empty. |
| lat, lon (hidden) | → `location.latitude`, `location.longitude`. Already checked to be in Copenhagen. |
| ref (hidden) | Entry number in the original doc. Not published. |

### Tab "Name only (33)": Vesterbro places with only a name

Same idea, with fewer columns: Import?, On the site, Area, Name, Google Maps
link (a search by name only, so check it), Vibe, the eight when-to-go
checkboxes, **Your text (needed to import)**, Address (optional), Section in
your doc. When you find the address, also update the Google Maps link to
search for name and address. There are no coordinates: for a ready row, find the
address (her Address column, or a web search for the place), then look it up
on OpenStreetMap with the `geocode` helper in `scripts/lib/resolve.mjs`:

```bash
node -e "import('./scripts/lib/resolve.mjs').then(async (m) => console.log(await m.geocode('Flæsketorvet 100, København, Denmark')))"
```

The pin must be the place, not the city centre. Show the address in the
preview, and add tags from her text (plus `vesterbro`).

## When a row is ready

A row is ready to publish when **all** of these hold:

- Import? is `Yes` and "On the site" is empty;
- Vibe is set;
- at least one when-to-go box is ticked;
- the text is not empty (on the "Name only" tab: "Your text").

Rows marked `Yes` that miss something are not published. List them in the
preview with what's missing, so Irina knows what to finish.

A row that is **already on the site** counts as changed when its vibe,
when-to-go, tags, text, status, website or Google Maps link differs from the
POI file. Offer those as
updates (`poi update`).

## Publishing what's ready

1. Read both tabs with the Sheets connector.
2. For every ready row, write a draft to a temporary directory:
   - `city`: `Copenhagen` and `country`: `Denmark` for every row, including
     Frederiksberg addresses, so the site keeps one Copenhagen page;
   - the other fields as in the column table above.
3. Run `npm run poi -- find <name>` and `npm run poi -- add <draft> --dry-run`
   for each. Exit code 2 means a possible duplicate: ask instead of adding.
4. Show one short summary: the places to add (name, vibe, when to go), the
   updates, and the rows still missing something. Wait for "yes".
5. On "yes": `poi add` / `poi update` for each, then `npm run validate`.
   Commit only `data/` with a message like
   `Add 12 places from the Copenhagen guide`, and push to your `claude/**`
   branch. The publish workflow merges and deploys it.
6. Confirm the "Validate & publish" run on `main` succeeded. Then, for each
   published row, write `<YYYY-MM-DD> · <live link>` into "On the site".
   Write nothing there if publishing failed.
7. Tell Irina how many places went live, with the Copenhagen link
   `https://quillis.github.io/foodieverse/copenhagen/`.

Edit the sheet only in the "On the site" column (and, on the "Name only" tab,
the Google Maps link once you have found the address). Never change her text,
choices or notes there; corrections go through her.
