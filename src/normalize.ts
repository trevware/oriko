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

export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
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
