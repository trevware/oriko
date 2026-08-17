import type { MediaCache } from "./cache";
import { dedupeMedia, normalizeUrl } from "./normalize";
import type { CanonicalMedia } from "./normalize";
import { knownHostThumbnail } from "./page-cover";
import type { ClippingRecord } from "./scan";

export interface TileModel {
  id: string;
  record: ClippingRecord;
  /** What the tile paints. A vault path, or a remote URL when `remote`. */
  thumbPath: string;
  /** The full-resolution source, same addressing as `thumbPath`. */
  filePath: string;
  /** True while the tile is showing the origin server's copy. */
  remote: boolean;
  kind: "image" | "video";
  /** True when the cover moves on its own and playback should manage it. */
  animated: boolean;
  width: number;
  height: number;
  /** True when width and height are guesses, to be corrected on load. */
  provisional: boolean;
  /** Changes whenever the painted content must change. */
  signature: string;
}

/** Aspect ratio used when nothing is known about a cover's shape. */
const DEFAULT_RATIO = { width: 4, height: 3 };

/** Most video is landscape, so this is the least-wrong guess before load. */
const VIDEO_RATIO = { width: 16, height: 9 };

/**
 * Frame 0 of an animated GIF is often useless as a cover: a terminal
 * recording opens on an empty prompt. Showing the original instead of a
 * still lets it animate, which is both truer to the content and closer to
 * how posts.design previews clips.
 */
const ANIMATED_EXT = /\.gif$/i;

/** Above this, decoding every frame costs more than the motion is worth. */
const MAX_ANIMATED_BYTES = 8 * 1024 * 1024;

type Cover = Omit<TileModel, "id" | "record" | "signature">;

function signatureOf(cover: Cover): string {
  return `${cover.kind}|${cover.animated ? 1 : 0}|${cover.thumbPath}|${cover.filePath}`;
}

function localCover(
  entry: NonNullable<ReturnType<MediaCache["get"]>>
): Cover {
  const hasSize = entry.width > 0 && entry.height > 0;
  return {
    thumbPath: entry.thumb || entry.file,
    filePath: entry.file,
    remote: false,
    kind: entry.kind,
    animated:
      entry.kind === "image" &&
      Boolean(entry.thumb) &&
      ANIMATED_EXT.test(entry.file) &&
      entry.bytes <= MAX_ANIMATED_BYTES,
    width: hasSize ? entry.width : DEFAULT_RATIO.width,
    height: hasSize ? entry.height : DEFAULT_RATIO.height,
    provisional: !hasSize,
  };
}

function remoteCover(
  url: string,
  kind: "image" | "video",
  widthHint?: number,
  heightHint?: number
): Cover {
  const ratio = kind === "video" ? VIDEO_RATIO : DEFAULT_RATIO;
  const hinted = Boolean(widthHint && heightHint);
  return {
    thumbPath: url,
    filePath: url,
    remote: true,
    kind,
    // Nothing to swap back to yet, so playback has nothing to manage.
    animated: false,
    width: hinted ? widthHint! : ratio.width,
    height: hinted ? heightHint! : ratio.height,
    provisional: true,
  };
}

/**
 * Picks what a tile shows, preferring the cheapest source that exists:
 * a local thumbnail, then the local original, then the origin server. The
 * grid therefore never waits on archiving to show something.
 *
 * Returns null when the clipping has nothing to show, in which case it is
 * left out of the grid rather than represented by a placeholder.
 */
function pickCover(record: ClippingRecord, cache: MediaCache): Cover | null {
  if (record.cover) {
    return {
      ...remoteCover(record.cover, "image"),
      remote: /^https?:\/\//i.test(record.cover),
    };
  }

  const media: CanonicalMedia[] = dedupeMedia(record.media);

  for (const item of media) {
    const entry = cache.get(item.key);
    // A recorded failure means the ref is bad at the source too, so there is
    // no point falling back to its remote URL.
    if (entry?.failed) continue;
    if (entry?.file) return localCover(entry);
    return remoteCover(item.url, item.kind, item.widthHint, item.heightHint);
  }

  // Nothing usable inline. Fall back to whatever the source page itself
  // publishes as its preview image.
  if (!record.source) return null;

  const pageEntry = cache.get(normalizeUrl(record.source));
  if (pageEntry?.file) return localCover(pageEntry);
  if (pageEntry?.failed) return null;

  // Known video hosts resolve to a thumbnail with no page fetch, so those
  // tiles are correct on first paint rather than after a background pass.
  const known = knownHostThumbnail(record.source);
  return known ? remoteCover(known.url, "image") : null;
}

export function buildTiles(
  records: ClippingRecord[],
  cache: MediaCache,
  excluded?: ReadonlySet<string>
): TileModel[] {
  const tiles: TileModel[] = [];

  for (const record of records) {
    if (excluded?.has(record.path)) continue;
    const cover = pickCover(record, cache);
    if (!cover) continue;
    tiles.push({ id: record.path, record, signature: signatureOf(cover), ...cover });
  }

  return tiles;
}
