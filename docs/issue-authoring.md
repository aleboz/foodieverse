# Adding places with GitHub issues (no AI chat needed)

Works from the **GitHub mobile app** or github.com on any phone. You need a
GitHub account that is the owner or a collaborator of this repository.

## Add a place

Open a new issue in the repository and write:

```
https://maps.app.goo.gl/abc123
Wonderful little wine bar. Amazing natural wines, go late afternoon.
♥♥ drink #natural-wine #date-night
```

and attach your own photos if you like.

- **The Google Maps link** (from the **Share** button in Google Maps) can be
  anywhere, in the title or the text.
- **Everything else is your recommendation.**
- **Optional:** a line with only hearts (`♥♥` or `2 hearts`), a category word
  (Eat, Drink, Coffee, Shop, Stay, See, Explore, Other) and `#tags`. With AI
  suggestions on, anything you leave out is suggested for you.
- **Title:** in the GitHub app the title can be anything, e.g. the place name.
  If the link isn't recognised, the bot uses the title as the place name, so
  "Bar Vivant, Copenhagen" helps.

After about a minute a comment shows the preview. Reply **yes** to publish, or
reply with corrections:

- "3 hearts", "Drink", "#terrace", "remove #expensive" (always understood)
- "keep my original text", "call it a wine bar" (need AI suggestions)

Each correction produces a new preview. After "yes", the bot publishes, waits
for the website to update, posts the link and closes the issue (2–5 minutes).

## Change, close or add photos

Open an issue starting with **Update**:

```
Update Bar Vivant, Copenhagen: one heart
```

```
Update Bar Vivant, Copenhagen: it has closed
```

You can also attach photos to add to the place. Without AI, hearts, category,
`#tags` and "closed" / "reopened" are understood. With AI, anything in plain
words works ("say it's mainly worth it for the wine").

## On the website

On github.com the **New place** and **Update a place** forms offer the same
options as fields. The GitHub mobile app doesn't show these forms; use a plain
issue there.

## Notes

- Only the owner and collaborators can use this. Issues and comments from
  anyone else are ignored.
- Editing the issue produces a fresh preview.
- Use JPEG or PNG photos. When sharing from a phone they are normally converted
  automatically.

## One-time setup: AI suggestions

Without an API key everything still works: category, hearts and tags come
from what you wrote, and the text is published as written.

With the key, the bot also **double-checks every new place on the web**: it
searches for the place, uses its proper name and address, and moves the pin if
OpenStreetMap matched the wrong place. The preview says what was confirmed or
corrected, with a source link.

To enable AI suggestions (place check, category, hearts, tags, light spelling
and grammar fixes in your own voice, corrections in plain words):

1. Create an API key at <https://console.anthropic.com> (Settings → API keys)
   and add a little credit. Each new place costs roughly 2–5 cents (mostly the
   web check); updates cost well under one cent.
2. In the repository: **Settings → Secrets and variables → Actions → New
   repository secret**, name `ANTHROPIC_API_KEY`, paste the key.

The model is `claude-opus-5-5`. To use another one, add a repository
**variable** named `FOODIEVERSE_MODEL`.
