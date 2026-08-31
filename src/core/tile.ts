import type { MediaCache } from "./cache";
import { extensionOf, isRenderable } from "./formats";
import { dedupeMedia, normalizeUrl, sourceVideoKeyFor } from "./normalize";
import type { CanonicalMedia } from "./normalize";
import { knownHostThumbnail } from "./page-cover";
import type { ClippingRecord } from "./scan";

export interface TileModel {
  id: string;
  record: ClippingRecord;
  /**
   * A still frame, used only to post a video and to freeze a paused GIF.
   * Empty for static images, which always paint at full resolution.
   */
  posterPath: string;
  /** What the tile paints: the full-resolution source. */
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
  return `${cover.kind}|${cover.animated ? 1 : 0}|${cover.posterPath}|${cover.filePath}`;
}

/**
 * Returns null when the file is archived but cannot be shown: a format
 * Chromium will not decode, whose preview has not been generated yet. The
 * caller moves on to the next ref rather than painting a broken tile.
 */
function localCover(
  entry: NonNullable<ReturnType<MediaCache["get"]>>
): Cover | null {
  const hasSize = entry.width > 0 && entry.height > 0;
  const size = {
    width: hasSize ? entry.width : DEFAULT_RATIO.width,
    height: hasSize ? entry.height : DEFAULT_RATIO.height,
    provisional: !hasSize,
  };
  const renderable = isRenderable(extensionOf(entry.file));

  if (entry.kind === "video") {
    if (renderable) {
      return {
        posterPath: entry.thumb,
        filePath: entry.file,
        remote: false,
        kind: "video",
        animated: false,
        ...size,
      };
    }
    // A container Chromium cannot play, such as AVI. The extracted frame is
    // the honest thing to show; the original stays archived.
    if (!entry.thumb) return null;
    return {
      posterPath: "",
      filePath: entry.thumb,
      remote: false,
      kind: "image",
      animated: false,
      ...size,
    };
  }

  if (!renderable) {
    // HEIC, TIFF, RAW and friends: paint the generated preview instead.
    if (!entry.thumb) return null;
    return {
      posterPath: "",
      filePath: entry.thumb,
      remote: false,
      kind: "image",
      animated: false,
      ...size,
    };
  }

  const animatable = ANIMATED_EXT.test(entry.file);
  return {
    // Only an animated GIF has any use for a still, to freeze on when paused.
    posterPath: animatable ? entry.thumb : "",
    filePath: entry.file,
    remote: false,
    kind: "image",
    animated: animatable && Boolean(entry.thumb) && entry.bytes <= MAX_ANIMATED_BYTES,
    ...size,
  };
}

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
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
    posterPath: "",
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
 * Picks what a tile shows: the archived original when it exists, otherwise
 * the origin server's copy. Always the full-resolution asset, so a tile
 * stays sharp at any zoom. The grid never waits on archiving to show
 * something.
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

  // A video pulled from the post itself outranks the poster image that page
  // published, which is only a still of the same thing.
  if (record.source) {
    const fromSource = cache.get(sourceVideoKeyFor(record.source));
    if (fromSource?.file) {
      const cover = localCover(fromSource);
      if (cover) return cover;
    }
  }

  const media: CanonicalMedia[] = dedupeMedia(record.media);

  // A known video host's page URL (a YouTube /embed/, say) is a document,
  // not a stream: a <video> pointed at it can only error, and the wall then
  // drops the tile. The cache records that failure once archiving has tried,
  // but the cache is per-device, so a cover must never lean on it being
  // there. The page's thumbnail is remembered instead, to stand in only
  // when no real media follows.
  let pageThumbnail: string | null = null;

  for (const item of media) {
    // A file in the vault, embedded as a wikilink. The archive knows its
    // size if it made it; otherwise the tile measures it once it loads.
    if (!isRemote(item.url)) {
      const archived = cache.byFile(item.url);
      if (archived) {
        const cover = localCover(archived);
        if (cover) return cover;
        continue;
      }
      // A video needs a poster to stand in for it, and there is none.
      if (item.kind === "video") continue;
      return {
        posterPath: "",
        filePath: item.url,
        remote: false,
        kind: "image",
        animated: false,
        width: DEFAULT_RATIO.width,
        height: DEFAULT_RATIO.height,
        provisional: true,
      };
    }

    const entry = cache.get(item.key);
    // A recorded failure means the ref is bad at the source too, so there is
    // no point falling back to its remote URL.
    if (entry?.failed) continue;
    if (entry?.file) {
      const cover = localCover(entry);
      if (cover) return cover;
      continue;
    }
    if (item.kind === "video") {
      const known = knownHostThumbnail(item.url);
      if (known) {
        pageThumbnail ??= known.url;
        continue;
      }
    }
    return remoteCover(item.url, item.kind, item.widthHint, item.heightHint);
  }

  // Nothing usable inline. Fall back to whatever the source page itself
  // publishes as its preview image.
  if (record.source) {
    const pageEntry = cache.get(normalizeUrl(record.source));
    if (pageEntry?.file) {
      const cover = localCover(pageEntry);
      if (cover) return cover;
    }
    if (!pageEntry?.failed) {
      // Known video hosts resolve to a thumbnail with no page fetch, so those
      // tiles are correct on first paint rather than after a background pass.
      const known = knownHostThumbnail(record.source);
      if (known) return remoteCover(known.url, "image");
    }
  }

  return pageThumbnail ? remoteCover(pageThumbnail, "image") : null;
}

/**
 * @param failedSignatures covers that could not be loaded, keyed by note
 * path. Matched on signature rather than path, so a clipping whose cover
 * later changes (archiving replaces a dead remote URL with a local file)
 * comes back instead of staying hidden for the rest of the session.
 */
export function buildTiles(
  records: ClippingRecord[],
  cache: MediaCache,
  failedSignatures?: ReadonlyMap<string, string>
): TileModel[] {
  const tiles: TileModel[] = [];

  for (const record of records) {
    const cover = pickCover(record, cache);
    if (!cover) continue;
    const signature = signatureOf(cover);
    if (failedSignatures?.get(record.path) === signature) continue;
    tiles.push({ id: record.path, record, signature, ...cover });
  }

  return tiles;
}

export interface Preview {
  path: string;
  /** True when the path is a url rather than a file in the vault. */
  remote: boolean;
}

/**
 * A still worth putting in a list row, or null when there is none.
 *
 * Rows are small, so the generated still wins wherever one exists: it is a
 * few kilobytes against an original that can be megabytes, and it does not
 * animate, which a forty-pixel row has no business doing. A video has only
 * its poster, since an img cannot hold one.
 */
export function previewOf(tile: TileModel): Preview | null {
  if (tile.posterPath) return { path: tile.posterPath, remote: false };
  if (tile.kind === "video") return null;
  return tile.filePath ? { path: tile.filePath, remote: tile.remote } : null;
}
