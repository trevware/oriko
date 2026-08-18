# CLAUDE.md — Power Grid

An Obsidian plugin: a pannable, zoomable canvas over the vault's `Clippings/` folder, which archives every clipping's remote media locally so it survives the source going dark.

## Git

- **Commit as you go.** Every working change gets a commit, not a batch at the end. Push to `origin` too; the remote is the backup.
- **Never put Claude, or any AI assistant, in repository information.** No `Co-Authored-By` trailer, no "generated with" line, no mention in commit messages, PR bodies, issues, or code comments. The commit author is the repository owner.
- Write commit messages that say what changed and *why*, including what was wrong when it is a fix. A future reader should not have to reconstruct the reasoning.
- Never force-push or rewrite published history without being asked.

## Architecture

The load-bearing rule, learned the hard way:

- **A module that imports from `obsidian` cannot be unit-tested.** Vitest cannot resolve the `obsidian` package, so the whole file fails to load. Pure logic therefore lives in modules with **zero Obsidian imports**: `scan`, `normalize`, `layout`, `dimensions`, `hash`, `formats`, `selection`, `camera`, `page-cover`, `resolve`, `cache`, `archive`.
- Obsidian-facing code is a thin shell that injects what the pure code needs (`requestUrl`, vault I/O) as plain functions. `archive.ts` takes an `ArchiveDeps`; that is why it tests without mocking a single module.
- Decide where a function belongs **when writing it**, not when a test refuses to run. This was got wrong three times.

## Constraints that are not negotiable

- **The plugin never edits an existing note.** Vault `CLAUDE.md` §9 forbids rewriting clipped content. Notes the plugin *creates* on paste are written once, already complete; notes from the Web Clipper are repaired at render time instead.
- **Never delete a user's files without asking.** Deletion goes to Obsidian's trash behind a confirmation. Archived media is left behind when a clipping is deleted.
- **Archived filenames are derived from a hash of the normalized source URL.** That is what lets a remote URL map to a local file with no index. Do not change the scheme without a migration.
- Cache keys strip both sizing and per-request signature parameters; the URL actually fetched keeps its signature, which Meta and Twitter CDNs require.

## Verification

- `npm test` and `npx tsc --noEmit` before claiming anything works. Check the exit code: `... | head` masks a non-zero status.
- **A green suite is not evidence a feature runs inside Obsidian.** Subprocess support was shipped broken because `globalThis.require` does not exist in Obsidian's renderer; the tests never touched that path. Check the built bundle when the behaviour depends on the host.
- Prefer checking a real clipping in the vault over trusting a fixture. Every significant bug in this project was found that way: the `<video><source>` form, the three-tier CDN variants, the YouTube page URL served as an image.

## Build

```bash
npm run dev     # watch, builds into the vault plugin folder with a .hotreload marker
npm run build   # tsc --noEmit, then a production bundle into dist/
npm test
```

Source lives outside the vault so Obsidian never indexes `node_modules`. A CSS-only change does not trigger the watcher, which only follows the JS graph; run a build explicitly.
