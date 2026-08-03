# Stream List

A Chrome extension that answers one question fast: **"Do I already own this movie, and where can I watch it?"**

You've bought movies in three different places — **Google Play (Movies & TV)**, **Prime Video**, and **Fandango at Home (Vudu)** — and none of them will tell you what you own in the other two. Stream List scans the store libraries you're already signed in to and merges everything into one searchable library. A title you own in two places (thanks, Movies Anywhere) is **one entry** with a Watch button for every store.

## Install

Until it's on the Chrome Web Store, install it unpacked (2 minutes, no build step):

1. [Download this repo as a zip](https://github.com/franciszver/stream-list/archive/refs/heads/main.zip) and unzip it (or `git clone`).
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select the repo's **`extension/`** folder.
5. Pin **Stream List** via the puzzle-piece menu so the icon is always visible.

## Use

1. Click the Stream List icon → **📚 Open my library**.
2. Click **⇄ Sync stores** (it asks once before taking over — sync opens each store's library page in tabs and auto-scrolls while it scans). The toolbar icon shows **↻** while syncing, then **✓**.
3. If a store shows **login needed**, sign in on the tab it left open, then sync again.
4. That's it — titles merge into your library automatically as each store finishes. Nothing is ever deleted by a sync.

Then browse: search (`/`), filter by store / movies / TV / "owned 2+ places", flag things watched or watch-next, toggle stats, grid or list. Posters load automatically (iTunes artwork; paste a free [TMDB API key](https://www.themoviedb.org/settings/api) in ⟳ Update for better matches). Dark mode follows your system.

**Your data never leaves your browser.** No account, no server, no analytics. The extension reads the store library pages you can already see — it never touches credentials.

## Backup & moving between machines

**⟳ Update → Export backup** writes `stream-list-backup.json` (library, flags, poster cache — never your TMDB key). Keep it in OneDrive/Google Drive/Dropbox, then **Import** it on the other machine.

## Project layout

```
extension/              ← the product (Manifest V3). Load this folder unpacked.
  manifest.json
  app/                  ← the library app page (BUILT — don't edit; edit the template)
  background.js         ← sync orchestrator: opens tabs, injects harvesters, badge
  harvest/              ← per-store page readers (google, amazon, fandango)
  popup.html/js         ← Open my library · sync status · export escape hatches
  lib/merge.js          ← shared title-normalization + merge logic
  lib/collect.js        ← shared per-store DOM collectors
  icons/
index.template.html     ← single source for the app UI (both builds)
index.html              ← standalone single-file build of the same app (legacy path)
library.sample.json     ← demo data for the standalone build
tools/
  build.py              ← template → index.html AND extension/app/ (CSP-safe split)
  package.py            ← extension/ → dist/stream-list-<version>.zip (Web Store)
  make_icons.py         ← regenerates extension/icons/
  merge.py              ← data/* scans → library.json (power-user pipeline)
  test_build.py         ← asserts the extension build stays CSP-safe
  test_merge.js         ← node tests for merge logic
  test_collect.js       ← node tests for the DOM collectors
  test_fandango.js      ← runs the Fandango harvester against a stubbed page
docs/store-listing.md   ← Chrome Web Store listing copy + permission justifications
```

## Development

The app UI lives in `index.template.html` — **never edit `index.html` or `extension/app/` directly**. Rebuild after changes:

```
python tools/build.py            # → index.html + extension/app/ (sample data)
python tools/test_build.py       # CSP/extraction regression checks
node tools/test_merge.js && node tools/test_collect.js && node tools/test_fandango.js
python tools/package.py          # → dist/stream-list-<version>.zip
```

`build.py` always builds from `library.sample.json` unless you explicitly pass
another file — a private `library.json` is never picked up implicitly, so you
can't accidentally commit personal data into `index.html`.

Then hit ⟳ reload on the extension card in `chrome://extensions`.

## Known limits

- Bundles (e.g. *The Dark Knight Trilogy*) appear as one entry, as sold.
- Store markup changes can break the harvesters — PRs welcome.
- Chrome/Chromium only (Manifest V3).

## License

MIT — see [LICENSE](LICENSE).
