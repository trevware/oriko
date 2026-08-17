# Clippings Grid: Design

**Date:** 2026-08-17
**Status:** Approved, ready for implementation planning

## Problem

The Aegis vault's `Clippings/` folder holds web pages saved with the Obsidian Web Clipper. Every clipping is a markdown note whose visual content lives entirely on someone else's server: the images are remote hotlinks (`static0.polygonimages.com`, `raw.githubusercontent.com`) and at least one clipping is nothing but a `<video src="cdn.spottedinprod.com/...">` tag. There is no local attachment for any of it.

Two consequences follow. First, the pile is not browsable visually: `Clippings.base` renders it as four table views of filenames and dates, which is the wrong shape for material that is mostly pictures. Second, the pile is not durable: when a source site reorganizes or dies, the clipping becomes a wall of broken images and the reason it was saved is gone.

This plugin solves both with one mechanism. It archives every clipping's media locally, then renders the collection as a fast masonry grid, in the spirit of posts.design and the Spatial app.

## Goals

1. A grid view where one tile is one clipping, showing that clipping's best image or video, that opens the note on click.
2. Local, permanent copies of every image and video referenced by a clipping.
3. Notes that keep rendering correctly after their source sites die.
4. Filter by category, filter by status, and text search over the collection.
5. Video that plays automatically without costing scroll performance.
6. Speed as a feature, not a polish pass: first paint under 100ms at a few hundred clippings, and scrolling that holds the display refresh rate.

## Non-goals

- Any interaction with `Work/` or `Personal/`. Vault `CLAUDE.md` Golden Rule 1 makes these separate graphs, and this plugin stays inside `Clippings/`.
- Replacing `Clippings.base`. The Base remains the tabular and metadata surface; the grid is the visual one.
- Automatic categorization or any change to the parse routine in `CLAUDE.md` §9.
- Editing clipping content. See the constraint below.

## Hard constraint: notes are never written

`CLAUDE.md` §9 rule 4 states that parsing must "touch nothing else, never rewrite, trim, reformat, or summarize clipped content." The design honors this absolutely: **the plugin never modifies a note, neither body nor frontmatter.**

This is achievable because archived filenames are derived from the source URL, so the mapping from remote URL to local file needs no record anywhere. Nothing has to be written down. A `cover:` frontmatter key is honored if the user adds one by hand, but nothing in the plugin requires or creates it.

## Architecture

Seven units, each with one purpose and a testable boundary.

### 1. Scanner (pure)

**Input:** a note's frontmatter object and raw body string.
**Output:** a `ClippingRecord`.

```
ClippingRecord {
  path: string            // vault path
  title: string
  source: string          // origin URL from clipper frontmatter
  description: string
  categories: string[]
  status: string          // unread | read | archived
  created: string         // ISO date
  media: MediaRef[]       // document order
  haystack: string        // precomputed lowercase search text
}

MediaRef {
  url: string             // absolute source URL
  kind: 'image' | 'video'
  alt: string
  widthHint?: number      // parsed from URL query when present
}
```

Recognizes three reference forms found in real clippings: markdown `![alt](url)`, HTML `<img src>`, and HTML `<video src>`. Skips `data:` URIs and vault-relative links. No I/O, so it tests against fixture strings.

### 2. URL normalizer (pure)

Collapses the same asset requested at several sizes into one file. Polygon serves `...builder-7.jpg?q=49&fit=contain&w=750&h=422&dpr=2` and `...builder-7.jpg?q=49&fit=contain&w=1920&h=1080&dpr=2`, which are one image, not two. Normalization strips known sizing query parameters (`w`, `h`, `dpr`, `q`, `fit`, `resize`, `s`), groups refs by scheme plus host plus path, and keeps the variant with the largest declared width as the canonical URL.

For Combolands this reduces 12 refs to 6 files.

### 3. Archiver

Downloads each canonical `MediaRef` and writes it into the attachment folder.

- Fetch through Obsidian's `requestUrl`, which bypasses CORS and works on desktop and mobile.
- Filename: `<sha1(canonicalUrl) sliced to 8>-<sanitized original basename>.<ext>`, giving names like `a3f91c2e-combolands-indie-roguelike-city-builder-7.jpg`. Human-readable, collision-resistant, and derivable from the URL alone.
- Write with `vault.createBinary`. Skip when the file already exists, which makes the whole archiver idempotent and re-runnable.
- At most four downloads in flight.
- Refuse anything over the configured size cap (default 25MB).

After a successful write the archiver produces the derived assets described next, then records the result in the cache.

### 4. Derived assets and cache

**Intrinsic dimensions** are read from file headers without decoding: JPEG SOF0/SOF2 markers, PNG IHDR, GIF logical screen descriptor, WebP VP8X/VP8/VP8L. About 60 lines, no dependency. Knowing dimensions ahead of render is what allows the grid to lay out before any image loads.

**Thumbnails** are generated at archive time by drawing the image to a canvas at roughly 400px wide and encoding WebP at quality 0.8, saved beside the original with a `.thumb.webp` suffix. The grid renders thumbnails; the lightbox and the note render originals. This is the largest single performance win, since decoding a 1920x1080 JPEG to paint a 300px tile is most of the cost of a naive grid.

**Video posters** are captured by loading the archived file into a detached `<video>`, seeking to 0.1s, drawing one frame to canvas, and saving it beside the original with a `.poster.webp` suffix. This lets video tiles paint instantly while still holding `preload="none"`.

All of it lands in `.obsidian/plugins/clippings-grid/cache.json`:

```
CacheEntry {
  urlHash: string         // key
  file: string            // vault path to the archived original
  thumb: string           // vault path to thumbnail or poster
  kind: 'image' | 'video'
  width: number
  height: number
  bytes: number
  failed?: string         // reason, when the download gave up
}
```

The cache is **rebuildable, never authoritative**. Deleting it costs one folder rescan plus header reads. Nothing user-visible depends on it surviving.

### 5. In-memory index

Built on plugin load by scanning the clippings folder through the metadata cache. Kept fresh by subscribing to vault `create`, `modify`, `delete`, and `rename` events. No persistence: a few hundred notes rebuild fast enough that a stored index would be a liability rather than a saving.

### 6. Grid view

An `ItemView` registered as `clippings-grid`, opened from a ribbon icon and a command palette entry. Layout, virtualization, and interaction are specified under Performance below.

**Cover selection**, in order: an explicit `cover:` frontmatter value if the user set one by hand; otherwise the first successfully archived media ref in document order, whether image or video. This yields the snowy city for Combolands, `prompt.gif` for manga-downloader, and the clip itself for the video-only Nook clipping. If no ref archives, the tile falls back as described under Failure handling.

**Tile contents:** the cover fills the tile, with title, source domain, categories, and unread state shown on hover. Clicking a tile opens the note; modifier-click opens it in a new pane.

### 7. Render repair

A markdown post-processor scoped to files under the clippings folder. It attaches an `error` handler to each remote `<img>`; when one fails to load, it hashes the src through the same normalizer and swaps in `vault.getResourcePath(localFile)` if that file exists. Video elements get the same treatment.

The note body is never rewritten, yet the note renders correctly after its source dies. The tradeoff is that this repair only applies where the plugin is installed; a broken site plus no plugin still yields broken images.

## Performance

The organizing principle: **the grid never waits on an image to learn how big it is.**

**Layout is pure math.** `layout(tiles, containerWidth, columnCount) -> Position[]` performs no DOM measurement and triggers no reflow, running in well under a millisecond for hundreds of tiles. Tiles are absolutely positioned with `translate3d` inside a spacer element of the full computed height, keeping them on the compositor. Resize recomputes behind a `requestAnimationFrame` debounce.

**Virtualization with a recycled tile pool.** The DOM holds only the viewport plus one screen of overscan. Scrolling reuses tile elements rather than creating and destroying them, in the manner of a recycling table view. Because dimensions are known in advance, every tile reserves its exact box before any byte of image arrives, so cumulative layout shift is zero by construction.

**Image loading.** Thumbnails only, with explicit `width` and `height` attributes, `loading="lazy"`, and `decoding="async"`.

**Video playback.** The poster paints immediately at `preload="none"`. As a tile nears the viewport, preload rises to `metadata`. An IntersectionObserver plays only tiles at least 50% visible, caps concurrent playback at four with nearest-to-viewport-center winning, and pauses everything when the document hides or the view loses focus. `prefers-reduced-motion` disables autoplay entirely in favor of poster plus a play affordance.

**Filter and search touch neither disk nor network.** Both run over the in-memory records against the precomputed lowercase haystack, then recompute layout and reuse existing tiles. Search is debounced at 120ms. No search library is warranted at this scale.

**Startup never blocks on archiving.** The view opens from the cache immediately. Downloads run in the background and tiles swap in as files land.

**CSS discipline.** `contain: layout paint size` on tiles, no box-shadow or filter animation during scroll, and transform-only positioning.

Targets: first paint under 100ms at a few hundred clippings; scroll holding the display refresh rate.

## Failure handling

**Hotlink protection is the expected failure.** `requestUrl` sends no Referer, and CDNs commonly answer that with 403. A failed download therefore retries once with `Referer` set to the note's `source:` URL before giving up.

**Fallback chain for a tile:** first successfully archived image, then the next media ref in order, then a typographic tile showing the title and source domain over a gradient seeded from a hash of that domain. A dead link still produces something that looks deliberate rather than broken.

**Size cap** (default 25MB) prevents a stray large video from bloating vault sync.

**Offline** is a non-event, since archived media is local. Unarchived tiles show the typographic fallback with a retry affordance.

**Unparseable image header:** skip the dimension read and fall back to natural size on load, accepting one reflow for that tile.

**Deleted note:** the vault event drops its tile. Orphaned files are removed only by an explicit "clean unused media" command, never automatically. Silently deleting user files is out of bounds.

## Settings

Deliberately small.

| Setting | Default |
|---|---|
| Clippings folder | `Clippings` |
| Attachment folder | `Attachments/Clippings` |
| Archive automatically on new clipping | on |
| Autoplay video | on |
| Max file size | 25MB |
| Thumbnail width | 400px |

## Testing

**Unit tested,** because they are pure functions:

- Scanner, against fixtures taken from the three real clippings, covering markdown images, HTML `<img>`, and the video-only Nook case.
- URL normalizer, specifically the Polygon duplicate-at-two-sizes case collapsing 12 refs to 6.
- Header dimension parser, across JPEG, PNG, GIF, and WebP, including a truncated file.
- Layout math: stability (same input, same positions), no overlaps, no gaps, correct total height.

**Tested with mocks:**

- Archiver against a mocked `requestUrl`, explicitly covering the 403-then-retry-with-Referer path, the size cap, and idempotent re-runs.
- Render repair, covering hit, miss, and already-local cases.

**Tested manually with a generated fixture vault** of roughly 500 synthetic clippings, to verify the performance claims. A grid that is fast with three tiles proves nothing.

## Repository and build

Own repo at `/Users/trevor/Documents/obsidian-clippings-grid`, outside the vault so Obsidian never indexes `node_modules`. TypeScript plus esbuild from the standard Obsidian plugin scaffold, Vitest for tests.

The dev build writes `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/clippings-grid/` along with a `.hotreload` marker, so the already-installed hot-reload plugin reloads on save. Distribution is via BRAT, which is already installed, with the community plugin list left open as a later option requiring no rewrite.
