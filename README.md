# Folio — a self-hosted novel reading room

A Next.js reading app for light novels and serialized fiction. It reads from a
local `content/` directory, so you control exactly what is published.

> **Content policy.** Only add material you own the rights to: your own writing,
> your own licensed translations, or public-domain works. This app ships with two
> original demo stories written for it, and nothing else.

## Features

- **Reader** — theme (light/sepia/dark), serif/sans, font size, line height,
  measure and alignment; keyboard navigation; a filterable table of contents;
  automatic scroll-position restore per chapter.
- **Library** — save novels and track reading progress across sessions.
- **Browse** — home shelves (trending, latest updates), genre filtering, search.
- **Discover** — the home page streams live RanobeDB rails: most popular series,
  upcoming releases, recently released, and new English releases.
- **Fast** — pages are static shells that stream their live parts in; the reader
  ships almost no JavaScript beyond the interactive chrome.
- **Motion** — staggered entrances, scroll reveals, hover lifts and snapping
  rails, all CSS-driven and fully disabled under `prefers-reduced-motion`.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Adding content

Each novel is one folder:

```
content/<slug>/
  novel.json          # title, author, cover, synopsis, genres, status
  chapters/
    0001-chapter-title.md
    0002-another-chapter.md
```

`novel.json`:

```json
{
  "title": "My Novel",
  "author": "My Name",
  "cover": "/covers/my-novel.svg",
  "synopsis": "One paragraph.",
  "genres": ["Fantasy", "Adventure"],
  "status": "ongoing",
  "badges": ["Editor's Choice"]
}
```

Chapter files may start with an optional frontmatter title:

```markdown
---
title: The Beginning
---

First paragraph.

Second paragraph.
```

Paragraphs are separated by blank lines. The leading number sets the reading
order; the rest of the file name becomes the fallback chapter title.

Covers live in `public/covers/` and are referenced by public path.

### Importing existing files

Single file — EPUB, Markdown, or TXT:

```bash
npm run ingest -- path/to/book.epub --title "My Novel" --author "Me" \
  --genres "Fantasy,Adventure" --synopsis "..."

npm run ingest -- path/to/manuscript.txt --title "My Novel"
```

**Bulk — point it at a folder and ingest everything:**

```bash
npm run ingest -- ./books                      # every .txt/.md/.epub in the folder
npm run ingest -- ./books --recursive          # include subfolders
npm run ingest -- ./books --dry-run            # preview, write nothing
npm run ingest -- ./books --overwrite          # replace novels already present
npm run ingest -- ./books --author "Me" --status ongoing
```

Bulk behaviour:
- The **title defaults to the file name**; EPUB embedded `dc:title` / `dc:creator` are used when present.
- A **sibling image** with the same base name (`book.epub` + `book.jpg`) is copied to
  `public/covers/` and used as the cover.
- A **JSON sidecar** next to a book supplies per-book metadata — `book.epub.json`
  or `book.json`:
  ```json
  { "title": "My Novel", "author": "Me", "genres": ["Fantasy"], "synopsis": "..." }
  ```
- Existing novels are **skipped**, not clobbered, unless `--overwrite` is passed.
- Unsupported files (`.pdf`, images, etc.) are ignored. A bad file is reported and the
  run continues; the process exits non-zero if anything failed.

Supported inputs: `.epub` (spine order, chapter headings preserved), `.md`
(split on `#` headings), and `.txt` (split on `Chapter N` / Prologue / Epilogue
headings, falling back to a single chapter). Text before the first heading is
folded into chapter one.


## Catalogue (RanobeDB)

Separate from `content/`, the app can browse a large light-novel catalogue built
from the [RanobeDB](https://ranobedb.org) public database.

```bash
# 1. download a dump from https://ranobedb.org/database-dumps
# 2. convert it into a local SQLite file
npm run catalogue:import -- ~/Downloads/rndb-db-public-latest.dump.gz
```
| `npm run catalogue:import -- <dump.gz>` | Build the SQLite catalogue from a RanobeDB dump |

Then open `/catalogue`: search across ~23,000 series by title, author and tag,
with status filters and sorting. Each series links to a record page with its
volume covers, staff credits, publishers and releases, and each volume has its own
page — `/catalogue/book/12040` is the same record as `ranobedb.org/book/12040`.

**This is metadata only.** RanobeDB records *that* a work exists — titles, credits,
publishers, imprints, release dates, page counts. It has no chapters and no prose,
and the importer downloads no covers (the dump stores image filenames, not images).
So the catalogue is a browsing aid, not a reading source; works you hold the rights
to still go in `content/`.

### What the import reads

All 18 tables of the dump are imported, not just the series table:

| Tables | Rows | What the app gets |
| --- | --- | --- |
| `series` | 22,966 | browse/search, rating, popularity, status |
| `book` | 55,427 | volumes, with covers and English synopses |
| `book_title` | 62,915 | every name a volume is known by, per language |
| `book_staff_alias` | 122,578 | credits — author, artist, translator, editor |
| `staff` / `staff_alias` | 15,756 / 16,186 | people, romanised and native names |
| `publisher` + relations | 808 | publishers and the imprints under them |
| `release` + links | 115,936 | dated editions, formats, page counts, ISBNs |
| `image` | 57,295 | cover filenames, served via `/api/cover/...` |
| `tag` | 175 | 16 genres, 4 demographics, and the free tags |

Two details worth knowing:

- **`c_average` is stored as thousandths** — `8049` means 8.049. The importer scales
  it, and stores `null` rather than `0` when a series has no scores, so the UI hides
  an absent rating instead of claiming the series scored zero. Only ~1,200 of 23,000
  series have a rating; popularity covers ~19,000, so popularity is the better
  ordering signal.
- **A few dump rows contain raw line breaks inside text fields**, which splits one
  COPY row across two lines. The reader reassembles such rows by field count, and
  *skips and reports* any it cannot decode unambiguously rather than writing a
  corrupted record. A full import currently reports exactly one skipped row.

Notes:

- Output is `data/catalogue.db` (~138 MB), gitignored. Delete it and re-run to
  rebuild; nothing else depends on it. Most of the size is Japanese-language
  synopses for all 55k volumes (~45 MB), which the English UI never displays.
- The converter streams the `.gz` directly and needs no PostgreSQL server. A full
  import takes about three seconds.
- Author names are shown romanised where RanobeDB provides one (~28% of names);
  otherwise the native form is used. Both spellings are searchable.
- **Restart the server after re-importing** — the SQLite file is replaced, and a
  running process keeps the old inode open.
- Licence: RanobeDB data is **ODbL-1.0** (database) and **DbCL-1.0** (contents).
  Attribution is required and appears in the UI. Distributing a derived database
  brings ODbL share-alike terms into play.

### Live API mode

The catalogue also works without the dump. If `data/catalogue.db` is missing, the
page falls back to the RanobeDB API (`https://ranobedb.org/api/v0`); if the API is
unreachable too, it shows setup instructions. `Browse` is unaffected either way.

The API is now a fallback rather than the main source: the full dump import
supplies volumes, credits, publishers and releases locally. The one thing it
still does better is an **English synopsis**, for the handful of series where
neither the series record nor its opening volume has one.

That lookup streams in behind a `<Suspense>` boundary, so local data renders
immediately and the page still works fully offline.

**Covers.** The API only returns an opaque image filename; images are served from
`https://images.ranobedb.org/<filename>`. The route `/api/cover/<filename>`
validates the filename against a strict allowlist, fetches from that fixed host,
and caches the bytes in `data/covers/`. So the browser never hotlinks RanobeDB,
repeat views are served locally (first fetch ~1 s, then ~4 ms), and a crafted
filename cannot redirect the request elsewhere — traversal attempts return 404.
Delete `data/covers/` to reclaim the cache.

**Etiquette.** The API client enforces its own cap of 50 requests/minute, below
RanobeDB's stated 60, and holds successful responses in a short-lived in-memory
cache (10 minutes). Failures are never cached, so an outage recovers on the next
request. Their API is **read-only and non-commercial use only**; respect that if
you deploy this.

### MangaBaka enrichment

MangaBaka runs a second metadata API at `https://api.mangabaka.org`, which needs
no key for its public endpoints. Series pages use it to fill the biggest hole in
the local catalogue: **RanobeDB carries a community score for only ~1,200 of
23,000 series**, while MangaBaka has one for most of them.

Where a match is found, the page shows MangaBaka's score on the app's own 0-10
scale (its raw value is out of 100), its volume and chapter totals, whether the
series is licensed in English, and a link to the record.

**Matching is deliberately exact.** Titles are folded to a comparison key — case,
punctuation and spacing removed — so `86--EIGHTY-SIX` matches `86―EIGHTY-SIX` and
`Re:ZERO -Starting Life in Another World-` matches `Re:Zero -Starting Life in
Another World-`. Anything short of a full match renders **nothing**.

That conservatism is the point. The two databases model some series differently:
MangaBaka splits *Ascendance of a Bookworm* into parts, and a fuzzy matcher would
have attached "Part 1"'s score to the entire series. A confidently wrong number is
worse than no number. Records marked `merged_with`, or no longer `active`, are
skipped for the same reason.

Requests default to `type=novel`. MangaBaka covers manga as well, and narrowing
the search removes a whole class of near-miss matches.

**Etiquette.** Two limits apply per IP, and MangaBaka only charges *uncached*
requests: **30/min** for search and **180/min** for everything else. The client
caps itself at 25 and 150, and caches successful responses for 10 minutes, so a
page that asks twice costs one upstream request. Failures are never cached.

**Licence.** MangaBaka's own data is **CC BY-NC-SA 4.0** — non-commercial, with
attribution required. It also republishes AniList, MyAnimeList, Kitsu,
MangaUpdates, Shikimori and Anime-Planet records, each under its own terms.
Attribution appears next to the data on every series page, which their
documentation lists as an accepted method.

#### Importing the MangaBaka database

The API path above costs a title search per page view. MangaBaka also publishes a
full database dump, which removes that entirely:

```bash
# 1. download series.full.json.tar.gz from https://mangabaka.org/data/database
npm run mangabaka:import -- ~/Downloads/series.full.json.tar.gz
npm run mangabaka:link
```

`mangabaka:import` streams the archive — a single JSON array 5.16 GB long, so it is
split element by element and never parsed whole — and keeps only the fields the app
shows. That projection is what makes a local copy viable at all:

| Dropped | Why |
| --- | --- |
| `source` | raw upstream blobs from six providers; most of the file |
| `tags_v2` | ~5 KB of tag objects per series; `tags` already has the names |
| `cover.x150/x250/x350` | nine base64 imgproxy URLs per series |
| `popularity.history` | a year of daily snapshots |

A ~20 KB record becomes about 2 KB. Keeping **novels only** and skipping **merged**
records (197,444 of them — duplicates folded into another entry) takes 482,174
records down to **26,059**, and 4.76 GB of JSON down to a **54 MB** database in
about 50 seconds.

`mangabaka:link` then matches those against the RanobeDB catalogue by title and
writes a `catalogue_match` table, so a series page is one indexed lookup with no
network call:

- **9,106 series linked (39.6%)** — 9,062 by a sole candidate, 44 by exact title
- **33 refused as ambiguous**, **13,827 unmatched**
- **3,168 series gain a rating they did not have**

That last number is the point: RanobeDB carries a score for only 1,263 series, so
this lifts rating coverage roughly **3.5×**.

**Matched, never guessed.** The linker tries the English title, then the
romanisation, then the native title. Within a round, a candidate whose own display
title matches wins; otherwise a round with exactly one candidate wins; otherwise it
refuses. Sibling works score differently — *High School DxD* against *DxD DX*,
*True High School DxD* and *Junior High School DxD* — and picking the most popular
would confidently show the wrong number.

One limitation is worth knowing. Matching is by title, so a **scope mismatch is
possible**: MangaBaka splits *Ascendance of a Bookworm* into parts, and RanobeDB's
single 33-volume series carries Part 1's English subtitle, so it links to
"Part 1" and shows that part's score. The panel therefore names the record each
score came from ("matched to …") and links to it, so the comparison is checkable
rather than merely asserted. Where RanobeDB already has a score both are shown,
labelled by source.

**Covers.** Raw cover URLs point at whichever provider supplied the record: across
the active novels that is anilist.co (9,020), myanimelist.net (3,870),
mangaupdates.com (856) and kitsu.app (399), alongside MangaBaka's own hosts. Those
belong to third parties with their own terms, so only MangaBaka-hosted URLs are
stored — its own storage first, then its image proxy, which serves a pre-sized
variant of the same artwork from a MangaBaka domain.

The import is a snapshot, so it goes stale; re-run both commands to refresh. The
app does **not** fall back to the live API while an imported database is present, so
an unmatched series stays unmatched rather than quietly making a request per page
view.

### Home page discovery rails

The home page shows four live rails — **Most popular series**, **Upcoming
releases**, **Recently released** and **New in English** — each streamed from the
API behind its own `<Suspense>` boundary. The page shell and your own library
paint immediately; the rails fill in as they arrive, showing skeleton cards first.

- **Most popular** uses RanobeDB's `sort=Relevance desc`, which is their own
  popularity ranking.
- **Upcoming / recently released** are driven by `minDate` / `maxDate` filters,
  with relative labels ("Today", "In 5 days", "3 days ago").
- Releases have no detail page on this site, so cards link out to the publisher
  page when RanobeDB provides one — never to a dead end.
- If the API is unreachable a rail renders **nothing** rather than an error, so the
  page degrades to your local library.

Because these rails read the clock, they call `await connection()` before `new
Date()`: Next refuses to prerender an unstable value, and a build-time clock must
never decide which releases are "upcoming". That keeps the shell static while the
rails stay genuinely current.

Attribution to RanobeDB (ODbL-1.0 / DbCL-1.0) is rendered under the rails, as the
licence requires.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Unit tests for the parsing helpers |
| `npm run ingest -- <file>` | Convert a file into `content/` |

## Architecture notes

- Content is read server-side in `src/lib/content/`, wrapped in the `use cache`
  directive so pages prerender into a static shell.
- Reading state lives in `src/lib/progress/` — a small framework-free store over
  `localStorage`, bound to React with `useSyncExternalStore`. Nothing is sent to
  a server; a future sync layer can replace the store without touching the UI.
- `next.config.ts` sets `images.unoptimized` because covers are local assets,
  often SVG. Switch it off if you serve raster covers and want optimisation.

