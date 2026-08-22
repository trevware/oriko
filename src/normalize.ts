import type { CacheEntry } from "./cache";
import type { MediaRef } from "./scan";

export interface CanonicalMedia {
  key: string;
  url: string;
  kind: "image" | "video";
  alt: string;
  widthHint?: number;
  heightHint?: number;
  /** Alternate URLs to try, in order, when `url` is unavailable. */
  fallbacks?: string[];
}

/**
 * Query parameters that select a rendition rather than an asset. Polygon
 * serves one screenshot at w=750, w=1920 and w=2560; stripping these makes
 * all three normalize to the same key.
 */
const SIZING_PARAMS = new Set([
  "w",
  "width",
  "h",
  "height",
  "dpr",
  "q",
  "quality",
  "fit",
  "resize",
  "s",
  "size",
  "fm",
]);

/**
 * Per-request signature and session noise on Meta and Twitter CDNs. The same
 * asset comes back with a fresh `oh`, `oe` and `_nc_gid` on every page load,
 * so without stripping these one image archives again on every attempt and
 * the copy named in a note never matches the copy on disk.
 *
 * Only the cache key is stripped. The URL actually fetched keeps its
 * signature, which those CDNs require.
 */
const SIGNATURE_PARAMS = new Set([
  "oh",
  "oe",
  "ccb",
  "efg",
  "stp",
  "vs",
  "_nc_cat",
  "_nc_gid",
  "_nc_ht",
  "_nc_oc",
  "_nc_ohc",
  "_nc_sid",
  "_nc_ss",
  "_nc_vs",
  "_nc_zt",
  "_nc_rid",
  "ig_cache_key",
  "tag",
]);

/** Amazon's image CDNs, where the size lives in the filename. */
export const AMAZON_IMAGE_HOST = /(^|\.)(media-amazon\.com|ssl-images-amazon\.com)$/i;
/** `/images/I/<id>.<modifiers>.jpg`: drop the modifiers, keep id and extension. */
export const AMAZON_IMAGE_MODIFIER = /^(\/images\/I\/[^/.]+)\.[^/]+(\.[A-Za-z0-9]+)$/;

export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  // Amazon sizes its product images in the path rather than the query:
  // 61f8IVzjEDL._SL1000_.jpg is a rendition of 61f8IVzjEDL.jpg. Every
  // rendition keys to the original, as the query-sized CDNs above do.
  if (AMAZON_IMAGE_HOST.test(parsed.hostname)) {
    parsed.pathname = parsed.pathname.replace(AMAZON_IMAGE_MODIFIER, "$1$2");
  }
  for (const name of [...parsed.searchParams.keys()]) {
    const lower = name.toLowerCase();
    if (SIZING_PARAMS.has(lower) || SIGNATURE_PARAMS.has(lower)) {
      parsed.searchParams.delete(name);
    }
  }
  let out = parsed.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

export function dedupeMedia(refs: MediaRef[]): CanonicalMedia[] {
  const order: string[] = [];
  const best = new Map<string, { ref: MediaRef; alt: string }>();

  for (const ref of refs) {
    const key = normalizeUrl(ref.url);
    const existing = best.get(key);
    if (!existing) {
      order.push(key);
      best.set(key, { ref, alt: ref.alt });
      continue;
    }
    // Keep the largest rendition's URL, but the alt text we saw first: the
    // first occurrence is the one written in prose, later ones are markup.
    if ((ref.widthHint ?? 0) > (existing.ref.widthHint ?? 0)) {
      best.set(key, { ref, alt: existing.alt });
    }
  }

  return order.map((key) => {
    const entry = best.get(key)!;
    return {
      key,
      url: entry.ref.url,
      kind: entry.ref.kind,
      alt: entry.alt,
      widthHint: entry.ref.widthHint,
      heightHint: entry.ref.heightHint,
    };
  });
}

/** Cache key for a video pulled from a page rather than from a media URL. */
export function sourceVideoKeyFor(source: string): string {
  return `ytdlp:${normalizeUrl(source)}`;
}

/**
 * Local file that stands in for a remote URL, or null when there is none.
 * Kept here beside the key logic so it stays free of Obsidian imports and
 * can be tested directly.
 */
export function localReplacement(
  src: string,
  cache: { get(key: string): CacheEntry | undefined }
): string | null {
  if (!src || !/^https?:\/\//i.test(src)) return null;
  const entry = cache.get(normalizeUrl(src));
  if (!entry || entry.failed || !entry.file) return null;
  return entry.file;
}
