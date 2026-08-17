import type { MediaCache } from "./cache";
import { hashUrl } from "./hash";
import { dedupeMedia } from "./normalize";
import type { CanonicalMedia } from "./normalize";
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
  kind: "image" | "video" | "fallback";
  /** True when the cover moves on its own and playback should manage it. */
  animated: boolean;
  width: number;
  height: number;
  /** True when width and height are guesses, to be corrected on load. */
  provisional: boolean;
  gradient: string;
  /** Changes whenever the painted content must change. */
  signature: string;
}

/** Aspect ratio used when nothing is known about a tile's contents. */
const FALLBACK_RATIO = { width: 4, height: 3 };

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

export function gradientFor(seed: string): string {
  const hash = hashUrl(seed);
  const hue = parseInt(hash.slice(0, 4), 16) % 360;
  const second = (hue + 40) % 360;
  return `linear-gradient(140deg, hsl(${hue} 45% 28%), hsl(${second} 50% 16%))`;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function signatureOf(parts: {
  kind: string;
  animated: boolean;
  thumbPath: string;
  filePath: string;
}): string {
  return `${parts.kind}|${parts.animated ? 1 : 0}|${parts.thumbPath}|${parts.filePath}`;
}

interface Cover {
  thumbPath: string;
  filePath: string;
  remote: boolean;
  kind: "image" | "video" | "fallback";
  animated: boolean;
  width: number;
  height: number;
  provisional: boolean;
}

const NO_COVER: Cover = {
  thumbPath: "",
  filePath: "",
  remote: false,
  kind: "fallback",
  animated: false,
  provisional: false,
  ...FALLBACK_RATIO,
};

/**
 * Picks what a tile shows, preferring the cheapest source that exists:
 * a local thumbnail, then the local original, then the origin server. The
 * grid therefore never waits on archiving to show something.
 */
function pickCover(media: CanonicalMedia[], cache: MediaCache): Cover {
  for (const item of media) {
    const entry = cache.get(item.key);

    // A recorded failure means this ref is bad at the source too, so there
    // is no point falling back to the remote URL for it.
    if (entry?.failed) continue;

    if (entry?.file) {
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
        width: hasSize ? entry.width : FALLBACK_RATIO.width,
        height: hasSize ? entry.height : FALLBACK_RATIO.height,
        provisional: !hasSize,
      };
    }

    const ratio = item.kind === "video" ? VIDEO_RATIO : FALLBACK_RATIO;
    const hinted = item.widthHint && item.heightHint;
    return {
      thumbPath: item.url,
      filePath: item.url,
      remote: true,
      kind: item.kind,
      // Nothing to swap back to yet, so playback has nothing to manage.
      animated: false,
      width: hinted ? item.widthHint! : ratio.width,
      height: hinted ? item.heightHint! : ratio.height,
      provisional: true,
    };
  }

  return NO_COVER;
}

export function buildTiles(records: ClippingRecord[], cache: MediaCache): TileModel[] {
  return records.map((record) => {
    const gradient = gradientFor(domainOf(record.source) || record.title);

    const cover: Cover = record.cover
      ? {
          thumbPath: record.cover,
          filePath: record.cover,
          remote: /^https?:\/\//i.test(record.cover),
          kind: "image",
          animated: false,
          provisional: true,
          ...FALLBACK_RATIO,
        }
      : pickCover(dedupeMedia(record.media), cache);

    return {
      id: record.path,
      record,
      gradient,
      signature: signatureOf(cover),
      ...cover,
    };
  });
}
