import { dedupeMedia, normalizeUrl, sourceVideoKeyFor } from "./normalize";
import type { ClippingRecord } from "./scan";

/**
 * Reading the words inside the pictures.
 *
 * Most of a wall like this is screenshots: interfaces, terminal recordings,
 * pages of manga. The thing you remember about one is almost always text
 * that lives in the image, and nothing in a clipping's frontmatter can see
 * it. Half of them do not even have a title worth searching, since a pasted
 * image is called `Pasted image 2026-08-18 190337`.
 *
 * The text belongs to the media, not to the note, so it lives in the media
 * cache. That also keeps the plugin's rule that it never edits a clipping.
 *
 * Pure: which engine to use and what to keep of its output are decisions
 * that can be reasoned about without a subprocess anywhere near them.
 */

export type OcrEngine = "vision" | "tesseract";

export interface OcrAvailability {
  /** macOS Vision, reached through osascript. No install, best on screenshots. */
  vision: boolean;
  /** Anywhere it is on PATH, which is one package install on Linux and Windows. */
  tesseract: boolean;
}

/** The best engine present, or null when the machine has neither. */
export function chooseEngine(available: OcrAvailability): OcrEngine | null {
  if (available.vision) return "vision";
  if (available.tesseract) return "tesseract";
  return null;
}

/**
 * Enough to answer a search, and no more. A dense page of documentation can
 * run to tens of thousands of characters, and cache.json is read on every
 * launch.
 */
export const MAX_TEXT = 4000;

/** A line with no letter or digit is a border, a divider or an icon. */
function isWords(line: string): boolean {
  return /[\p{L}\p{N}]/u.test(line);
}

/**
 * One flat run of words, which is what a search wants. Line breaks in OCR
 * output describe the picture's layout rather than the sentence, so keeping
 * them would only make phrases unfindable across a wrap.
 */
export function cleanText(raw: string): string {
  const words = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(isWords)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (words.length <= MAX_TEXT) return words;

  // Cut at a word boundary: half a word is neither findable nor readable.
  const cut = words.slice(0, MAX_TEXT);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Everything read out of one clipping's media, in the order the tile would
 * have reached for it. Looked up through the same keys the archiver used, so
 * a clipping's own pictures are the only ones that can answer for it.
 */
export function textForRecord(
  record: ClippingRecord,
  textFor: (key: string) => string | undefined
): string {
  const keys: string[] = [];
  if (record.source) {
    keys.push(sourceVideoKeyFor(record.source), normalizeUrl(record.source));
  }
  for (const media of dedupeMedia(record.media)) keys.push(media.key);

  const seen = new Set<string>();
  const parts: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const text = textFor(key);
    if (text) parts.push(text);
  }

  return parts.join(" ");
}

/**
 * What a text pass actually did, rather than one number that cannot tell
 * "nothing left to do" apart from "everything failed" or "no engine here".
 */
export interface OcrSummary {
  engine: OcrEngine | null;
  /** Entries wanting text. */
  pending: number;
  /** Of those, the ones whose file resolved to a real path on disk. */
  attempted: number;
  read: number;
  failed: number;
}

const pictures = (n: number): string => `${n} picture${n === 1 ? "" : "s"}`;

/** One line saying which of the ways this can go quiet actually happened. */
export function describeOcr({ engine, pending, attempted, read, failed }: OcrSummary): string {
  if (!engine) {
    return "no OCR engine found. macOS reads with Vision automatically; elsewhere, install tesseract";
  }
  if (pending === 0) return "every picture has already been read";
  if (attempted === 0) return `${pictures(pending)} could not be found on disk`;
  if (read === 0) return `${engine} failed on all ${pictures(attempted)}`;
  if (failed > 0) return `read text from ${pictures(read)}, ${failed} could not be read`;
  return `read text from ${pictures(read)}`;
}
