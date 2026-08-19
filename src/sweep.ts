import { App, Notice, TFile, normalizePath } from "obsidian";
import type { MediaCache } from "./cache";
import { deadKeys, filesForRefs, liveRefs, orphanFiles } from "./media-refs";
import type { Sweepable } from "./media-refs";
import type { ClippingRecord } from "./scan";

/**
 * Removing archived media, both as a clipping goes and as a sweep of what
 * earlier deletions left behind.
 *
 * The thin Obsidian half: everything about *which* files is decided in
 * media-refs, which is pure and tested. This part reads the folder, moves
 * files to trash and forgets their cache entries.
 */

/** Everything sitting in the attachment folder right now. */
function folderFiles(app: App, folder: string): TFile[] {
  const prefix = `${normalizePath(folder)}/`;
  return app.vault.getFiles().filter((file) => file.path.startsWith(prefix));
}

function weigh(files: TFile[]): Sweepable {
  return {
    paths: files.map((file) => file.path),
    bytes: files.reduce((total, file) => total + file.stat.size, 0),
  };
}

/**
 * Media the given clippings would leave behind, were they deleted now.
 *
 * Reference counted against everything that survives them, so a file two
 * clippings share is not offered up when only one of them goes.
 */
export function orphansAfterDeleting(
  app: App,
  records: readonly ClippingRecord[],
  doomedPaths: readonly string[],
  cache: MediaCache,
  folder: string
): Sweepable {
  const doomed = new Set(doomedPaths);
  const going = records.filter((record) => doomed.has(record.path));
  const surviving = records.filter((record) => !doomed.has(record.path));

  const theirs = new Set(filesForRefs(liveRefs(going, cache.entries()), cache.entries()));
  const orphans = orphanFiles({
    live: liveRefs(surviving, cache.entries()),
    cache: cache.entries(),
    // Only their own media is in question here. Debris from earlier
    // deletions is the sweep's business, not this deletion's.
    onDisk: [...theirs],
  });

  const set = new Set(orphans);
  return weigh(folderFiles(app, folder).filter((file) => set.has(file.path)));
}

/** Everything in the attachment folder that no clipping references at all. */
export function findOrphans(
  app: App,
  records: readonly ClippingRecord[],
  cache: MediaCache,
  folder: string
): Sweepable {
  const files = folderFiles(app, folder);
  const orphans = new Set(
    orphanFiles({
      live: liveRefs(records, cache.entries()),
      cache: cache.entries(),
      onDisk: files.map((file) => file.path),
    })
  );
  return weigh(files.filter((file) => orphans.has(file.path)));
}

/**
 * Moves the files to Obsidian's trash and forgets the cache entries that
 * described them, so a URL clipped again is downloaded again rather than
 * resolving to something that is no longer there.
 */
export async function removeMedia(
  app: App,
  cache: MediaCache,
  paths: readonly string[]
): Promise<number> {
  let removed = 0;

  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    try {
      await app.fileManager.trashFile(file);
      removed++;
    } catch (error) {
      new Notice(`Power Grid: could not remove ${file.name} (${String(error)})`);
    }
  }

  for (const key of deadKeys(cache.entries(), paths)) cache.delete(key);
  return removed;
}

/** Cache rows whose file has vanished behind the plugin's back. */
export function staleKeys(app: App, cache: MediaCache): string[] {
  return cache
    .entries()
    .filter((entry) => entry.file && !(app.vault.getAbstractFileByPath(entry.file) instanceof TFile))
    .map((entry) => entry.key);
}
