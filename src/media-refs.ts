import type { CacheEntry } from "./cache";
import { extensionOf, isRenderable } from "./formats";
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
/** A clipboard capture or a page scan, named for the day it was made. */
const PASTED = /^(pasted|scan)-\d{4}-\d{2}-\d{2}/;

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

/**
 * Whether a pulled video can actually be shown, which is the same question
 * tile.ts asks: the file itself if the browser will play that container,
 * otherwise the frame extracted from it, and nothing if there is neither.
 */
function videoCovers(entry: CacheEntry | undefined): boolean {
  if (!entry?.file) return false;
  return isRenderable(extensionOf(entry.file)) || Boolean(entry.thumb);
}

/**
 * Every cache key and vault path the given clippings still need.
 *
 * @param cache lets one redundancy be spotted: a post whose video was pulled
 * never shows the still the page publishes, because tile.ts prefers the
 * video, so that download is spare. Without a cache the page cover is always
 * counted live, which is the safe answer rather than the tidy one.
 */
export function liveRefs(
  records: readonly ClippingRecord[],
  cache: readonly CacheEntry[] = []
): LiveRefs {
  const keys = new Set<string>();
  const paths = new Set<string>();
  const byKey = new Map(cache.map((entry) => [entry.key, entry]));

  for (const record of records) {
    if (record.source) {
      const videoKey = sourceVideoKeyFor(record.source);
      keys.add(videoKey);
      // The page's own preview image, needed only while nothing better has
      // been archived for the same post.
      if (!videoCovers(byKey.get(videoKey))) keys.add(normalizeUrl(record.source));
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
