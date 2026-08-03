# Chrome Web Store listing — Stream List

Everything needed to publish `dist/stream-list-<version>.zip`. Publishing is a
manual owner step (one-time $5 developer registration at
https://chrome.google.com/webstore/devconsole).

## Name

Stream List

## Summary (132 chars max)

Your movies & TV, owned across Google Play, Prime Video & Fandango at Home —
one searchable library that syncs itself.

## Description

You've bought movies in three different places. None of them will tell you
what you own in the other two.

Stream List scans the store libraries you're already signed in to — Google
Play, Prime Video, and Fandango at Home (Vudu) — and merges everything into
one searchable, filterable library. A title you own in two places is one
entry with two Watch buttons.

- One-click sync: opens each store's library page, reads what you own, done.
- Search, filter by store, movies vs TV, "owned in 2+ places".
- Watched / watch-next flags, stats, posters.
- Your data never leaves your browser: no account, no server, no analytics.
- Export/import so you can back up or move machines (works with any file-sync
  service like OneDrive or Google Drive).

## Category

Tools (alt: Entertainment)

## Permission justifications (asked during review)

- `tabs` + `scripting`: the sync opens each store's own library page in a tab
  and runs a small reader script on it to list the titles you own. That's the
  entire mechanism — no browsing history is read.
- `storage`: your merged library, sync status, and watched flags are stored
  locally in the extension.
- `play.google.com`, `www.amazon.com`, `athome.fandango.com`: the three
  stores being scanned. Scripts run only on their library pages, only during
  a sync you started.
- Poster lookups (iTunes Search, optionally TMDB with a user-supplied key)
  use plain CORS fetches — no host permissions needed or requested.

## Privacy disclosures

- Single purpose: catalog the user's own purchased movies/TV across stores.
- No user data is transmitted to the developer or any third party. Title
  lookups to iTunes/TMDB send only movie titles, never account data.
- No remote code: all scripts are packaged in the extension.

## Assets checklist

- [x] Icon 128×128 (`extension/icons/icon128.png`)
- [ ] Screenshots 1280×800 (take after install: library grid, sync strip,
      a detail dialog)
- [ ] Optional promo tile 440×280
