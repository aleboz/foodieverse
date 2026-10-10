# Adding places with GitHub issues (no AI chat needed)

Works from the **GitHub mobile app** or github.com on any phone. You need a
GitHub account that is the owner or a collaborator of this repository.

## Add a place

1. In the repository, open **Issues → New issue → New place**.
2. Paste the **Google Maps link** and write **your recommendation**.
   Optionally pick hearts and category, add tags, and drag in your own photos.
   Leave anything you don't care about on "Let the AI suggest".
3. Submit. After about a minute a comment shows the preview.
4. Reply **yes** to publish, or reply with corrections in plain words:
   - "make it three hearts"
   - "remove expensive, add natural-wine"
   - "keep my original text"
   - "it's a wine bar, so Drink"

   Each correction produces a new preview.
5. After "yes", the bot publishes, waits for the website to update, posts the
   link and closes the issue (about 2–3 minutes).

## Change, close or add photos

Use **Issues → New issue → Update a place**: say which place (name and city,
or the link to its page) and what should change ("reduce to one heart",
"it has closed"), and/or drag in photos. Then reply **yes** the same way.

## Notes

- Only the owner and collaborators can use this. Issues and comments from
  anyone else are ignored.
- Editing the issue itself (e.g. fixing the link) produces a fresh preview.
- If a link isn't recognised, fill in **Place name and city** in the form.
- Use JPEG or PNG photos. When sharing from a phone they are normally converted
  automatically.

## One-time setup: AI suggestions

Without an API key everything still works, but category, hearts and tags come
only from the form, the text is published as written, and corrections must be
made by editing the issue.

To enable AI suggestions (category, hearts, tags, light spelling/grammar fixes
in your own voice, corrections in plain words):

1. Create an API key at <https://console.anthropic.com> (Settings → API keys)
   and add a little credit. Each place costs well under one cent.
2. In the repository: **Settings → Secrets and variables → Actions → New
   repository secret**, name `ANTHROPIC_API_KEY`, paste the key.

The model is `claude-opus-5-5`. To use another one, add a repository
**variable** named `FOODIEVERSE_MODEL`.
