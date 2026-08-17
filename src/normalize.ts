import type { MediaRef } from "./scan";

export interface CanonicalMedia {
  key: string;
  url: string;
  kind: "image" | "video";
  alt: string;
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
    if (SIZING_PARAMS.has(name.toLowerCase())) parsed.searchParams.delete(name);
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
    return { key, url: entry.ref.url, kind: entry.ref.kind, alt: entry.alt };
  });
}
