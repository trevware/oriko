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
  width: number;
  height: number;
  gradient: string;
}

/** Aspect ratio used when nothing is known about a tile's contents. */
const FALLBACK_RATIO = { width: 4, height: 3 };

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
        width: hasSize ? entry.width : FALLBACK_RATIO.width,
        height: hasSize ? entry.height : FALLBACK_RATIO.height,
      };
    }

    return {
      ...base,
      thumbPath: "",
      filePath: "",
      kind: "fallback" as const,
      ...FALLBACK_RATIO,
    };
  });
}
