# Stream List

A single-file web app that answers one question fast: **"Do I already own this movie, and where can I watch it?"**

Open **`index.html`** in any browser — no server, no install, no accounts. It works straight from `file://`.

## What it does

- Unified, searchable / sortable / filterable catalog of every movie & TV season you own on
  **Google Play (Movies & TV)**, **Prime Video**, and **Fandango at Home (Vudu)**.
- Titles owned on multiple services (thanks, Movies Anywhere) are **merged into one entry**
  showing every place you can stream it — one click opens the right store page in a new tab.
- **Duplicate view** ("Owned 2+ places") shows your cross-service overlap.
- **Watched / Watch-next flags** with one tap on any card.
- **Stats dashboard**: totals, per-service counts, movies vs TV, overlap.
- **Posters & metadata** load automatically from the iTunes Search API (cached locally);
  add a free TMDB API key in ⟳ Update for higher-quality matches.
- Grid and list views, keyboard shortcut `/` to search, dark mode follows your system.

Your library lives entirely in your browser's `localStorage` — nothing is ever sent to a
server. The repo ships with a small sample library so the app has something to show out of
the box; a banner lets you clear it and load your own whenever you're ready.

## Quick start

Just open `index.html`. You'll see a demo library and a banner offering to clear the sample
data — dismiss it or clear it, your call.

## Loading your real library

Three ways, all reachable from the **⟳ Update** dialog in the app:

1. **Chrome extension (recommended)** — open `chrome://extensions`, turn on **Developer
   mode**, click **Load unpacked**, and select this repo's `extension/` folder. Click the
   extension icon, then **⟳ Sync all libraries**: it opens each store's library page in a
   tab and harvests your owned titles. If a service says **login needed**, sign in on that
   tab and sync it again. Then either:
   - **⬇ library.json** — download the merged library and **Import** it via the app's
     ⟳ Update dialog, or
   - **Copy** (per service) — copy that service's JSON and paste it into the ⟳ Update →
     Merge box.
2. **Bookmarklets** — drag the bookmarklets from the ⟳ Update dialog to your bookmarks bar.
   On each store's library page (signed in, scrolled to the bottom so everything loads),
   click the matching bookmarklet — it copies your titles as JSON. Paste into the Merge box.
3. **Command line, if you'd rather script it** — drop raw scans into `data/` (gitignored;
   formats are documented in `tools/merge.py`'s docstring), then run
   `python tools/merge.py && python tools/build.py` to bake your library straight into a
   fresh `index.html`. `library.json` is also gitignored, so nothing personal gets committed.

The extension only ever reads the store library pages you already own — it never sees or
stores your credentials.

## Syncing between machines

**⟳ Update → Export backup** writes `stream-list-backup.json` (your library, watched/
watch-next flags, and poster cache — never your TMDB key). Drop it in OneDrive, Google
Drive, Dropbox, or wherever you sync files, then **Import** it from the same dialog on
another machine.

## Project layout

```
index.html            ← the app (self-contained, sample data baked in). Open this.
index.template.html   ← app source with __LIBRARY_DATA__ placeholder
library.sample.json   ← demo data baked into the committed index.html
library.json          ← your real merged library (generated, gitignored)
data/                 ← your raw per-service scans (gitignored)
tools/
  merge.py            ← data/* → library.json (normalizes titles, merges services)
  build.py            ← library.json (or library.sample.json) + template + extension/lib/merge.js → index.html
  test_merge.js       ← headless tests for the shared merge logic (node)
extension/            ← Chrome extension (Manifest V3) that auto-syncs libraries
  manifest.json
  background.js       ← orchestrates: opens tabs, injects harvesters, stores results
  harvest/             ← per-store content scripts (google, amazon, fandango)
  popup.html/js        ← Sync all · per-service status · download / copy JSON
  lib/merge.js         ← SHARED normalization+merge logic (also inlined into index.html)
```

## Development

Rebuild `index.html` after editing the template, shared merge logic, or your library:

```
python tools/merge.py && python tools/build.py
```

Test the shared title-matching/merge logic:

```
node tools/test_merge.js
```

## Known limits

- Bundles (e.g. *The Dark Knight Trilogy*) appear as one entry, as sold.
- Store markup changes can break the harvesters or bookmarklets — PRs welcome.
- The extension is Chrome/Chromium only.
