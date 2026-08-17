import type { MediaCache } from "./cache";
import { hashUrl } from "./hash";
import { dedupeMedia } from "./normalize";
import type { ClippingRecord } from "./scan";

export interface TileModel {
  id: string;
  record: ClippingRecord;
  thumbPath: string;
  filePath: string;
  kind: "image" | "video" | "fallback";
  /** True when the cover moves on its own and should be played in view. */
  animated: boolean;
  width: number;
  height: number;
  gradient: string;
}

/** Aspect ratio used when nothing is known about a tile's contents. */
const FALLBACK_RATIO = { width: 4, height: 3 };

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

export function buildTiles(records: ClippingRecord[], cache: MediaCache): TileModel[] {
  return records.map((record) => {
    const base = {
      id: record.path,
      record,
      gradient: gradientFor(domainOf(record.source) || record.title),
    };

    if (record.cover) {
      return {
        ...base,
        thumbPath: record.cover,
        filePath: record.cover,
        kind: "image" as const,
        animated: false,
        ...FALLBACK_RATIO,
      };
    }

    for (const media of dedupeMedia(record.media)) {
      const entry = cache.get(media.key);
      // An entry without a thumbnail is archived but not yet derived; using
      // it would make the grid decode a full-resolution original.
      if (!entry || entry.failed || !entry.file || !entry.thumb) continue;

      const hasSize = entry.width > 0 && entry.height > 0;
      return {
        ...base,
        thumbPath: entry.thumb,
        filePath: entry.file,
        kind: entry.kind,
        animated:
          entry.kind === "image" &&
          ANIMATED_EXT.test(entry.file) &&
          entry.bytes <= MAX_ANIMATED_BYTES,
        width: hasSize ? entry.width : FALLBACK_RATIO.width,
        height: hasSize ? entry.height : FALLBACK_RATIO.height,
      };
    }

    return {
      ...base,
      thumbPath: "",
      filePath: "",
      kind: "fallback" as const,
      animated: false,
      ...FALLBACK_RATIO,
    };
  });
}
