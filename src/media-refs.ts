import type { CacheEntry } from "./cache";
import { dedupeMedia, normalizeUrl, sourceVideoKeyFor } from "./normalize";
import type { ClippingRecord } from "./scan";

/**
 * Which archived files are still spoken for, and which are debris.
 *
 * Archived filenames come from a hash of the normalized source URL, so two
 * clippings that embed the same image share one file on disk. That is what
 * makes deleting media a question of reference counting rather than of
 * following one clipping's own list: take a clipping away and its files only
 * become rubbish if nothing that survives it points at them too.
 *
 * Pure, and told what is on disk rather than looking: the same computation
 * answers "what does deleting these three take with them" and "what is
 * lying around unreferenced", and neither needs a vault to be tested.
 */

export interface LiveRefs {
  /** Cache keys, which resolve through the cache to a file and a thumbnail. */
  keys: Set<string>;
  /** Vault paths referenced directly, as a pasted image's cover is. */
  paths: Set<string>;
}

/** Twelve hex characters and a dash: an archived file's name. */
const ARCHIVED = /^[0-9a-f]{12}-/;
/** A clipboard capture, named for the day it was pasted. */
const PASTED = /^pasted-\d{4}-\d{2}-\d{2}/;

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * True for a file this plugin created, by its naming alone.
 *
 * The sweep is limited to these because the attachment folder is a setting:
 * point it at a folder shared with the rest of the vault and "everything
 * nothing references" would mean somebody's holiday photos.
 */
export function isPluginOwned(name: string): boolean {
  return ARCHIVED.test(name) || PASTED.test(name);
}

/** Every cache key and vault path the given clippings still need. */
export function liveRefs(records: readonly ClippingRecord[]): LiveRefs {
  const keys = new Set<string>();
  const paths = new Set<string>();

  for (const record of records) {
    if (record.source) {
      // Both fallbacks a tile can reach for: the page's own preview image,
      // and a video pulled from the post rather than linked by it.
      keys.add(normalizeUrl(record.source));
      keys.add(sourceVideoKeyFor(record.source));
    }

    // Deduped through the same path the archiver used, so the keys match.
    for (const media of dedupeMedia(record.media)) keys.add(media.key);

    // A pasted image is a vault path from the start, so it never had a key.
    if (record.cover && !isRemote(record.cover)) paths.add(record.cover);
    for (const media of record.media) {
      if (!isRemote(media.url)) paths.add(media.url);
    }
  }

  return { keys, paths };
}

/**
 * The files a set of refs resolves to: archived originals, the thumbnails
 * generated from them, and any vault path referenced outright. Deduped, so
 * media two clippings share is named once.
 *
 * Distinct from the view's own filesFor, which is about exporting and so
 * deliberately lists originals only. Here a generated poster is as much a
 * file on disk as the video it came from.
 */
export function filesForRefs(live: LiveRefs, cache: readonly CacheEntry[]): string[] {
  const files = new Set<string>();

  for (const entry of cache) {
    if (!live.keys.has(entry.key)) continue;
    if (entry.file) files.add(entry.file);
    if (entry.thumb) files.add(entry.thumb);
  }
  for (const path of live.paths) files.add(path);

  return [...files];
}

export interface OrphanQuery {
  /** What the surviving clippings reference. */
  live: LiveRefs;
  cache: readonly CacheEntry[];
  /** Vault paths of everything in the attachment folder. */
  onDisk: readonly string[];
}

/**
 * Files on disk that nothing references any more, in the order given.
 *
 * A thumbnail is not referenced by anything on its own; it belongs to the
 * file it was generated from and lives and dies with it.
 */
export function orphanFiles({ live, cache, onDisk }: OrphanQuery): string[] {
  const spoken = new Set(filesForRefs(live, cache));
  return onDisk.filter((path) => !spoken.has(path) && isPluginOwned(basename(path)));
}

/**
 * Cache entries whose file has just been removed, so they can be dropped.
 *
 * Left in place they would tell the archiver a URL is already local, and the
 * tile would point at a file in the trash. Dropping them means clipping that
 * URL again downloads it again, which is the honest answer.
 */
export function deadKeys(cache: readonly CacheEntry[], removed: readonly string[]): string[] {
  const gone = new Set(removed);
  return cache
    .filter((entry) => Boolean(entry.file) && gone.has(entry.file))
    .map((entry) => entry.key);
}

/** A set of files considered together, with what they weigh. */
export interface Sweepable {
  paths: string[];
  bytes: number;
}

const UNITS = ["KB", "MB", "GB"];

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }

  // One decimal until the number is big enough to carry itself.
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${UNITS[unit]}`;
}

/**
 * How a set of files is described before anything is deleted. Size is the
 * number that decides whether this is worth doing, so it is never left out.
 */
export function describeFiles({ paths, bytes }: Sweepable): string {
  return `${paths.length} file${paths.length === 1 ? "" : "s"} (${humanBytes(bytes)})`;
}
