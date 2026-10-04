import { knownHostThumbnail } from "./page-cover";

/**
 * How a card for a clip in progress looks, decided away from the DOM.
 *
 * The card shows the page's own picture as soon as the link has been read,
 * heavily blurred, and sharpens it as the clip completes; a pill in its
 * corner names the step with that step's icon, and only the check that lands
 * the clip moves.
 */

/** The icon for a step, by what the step says it is doing. Obsidian's own Lucide names. */
export function stepIcon(label: string): string {
  const text = label.toLowerCase();
  if (text.startsWith("clipped")) return "check";
  if (text.startsWith("reading link") || text.startsWith("starting")) return "link";
  if (text.startsWith("downloading") || text.startsWith("saving image")) return "arrow-down-to-line";
  if (text.startsWith("fetching video") || text.startsWith("saving video")) return "video";
  if (text.startsWith("rendering previews")) return "image";
  if (text.includes("store details")) return "gamepad-2";
  if (text.startsWith("loading") || text.includes("scan")) return "scan-line";
  if (text.startsWith("creating clipping")) return "file-plus";
  return "loader";
}

/** Blur at the very start of a clip, in pixels, and what is left just before it lands. */
const BLUR_START = 22;
const BLUR_END = 2;

/**
 * How blurred the preview is at this point in the clip: heavy at the start,
 * nearly sharp at the end, straight between. The landing itself is a
 * crossfade to the real picture, so the preview never has to reach zero.
 */
export function previewBlur(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.round((BLUR_START - (BLUR_START - BLUR_END) * p) * 10) / 10;
}

/**
 * Progress that only moves forward. A step of unknown length reports none,
 * and a later step can report less than an earlier one (a scan falling back
 * from a page with no pictures), and the blur must not come back either way.
 */
export function advance(previous: number, next: number | null): number {
  return next === null ? previous : Math.max(previous, Math.min(1, next));
}

/**
 * The picture to preview a resolved link with: its first image, else the
 * thumbnail a known video host publishes for the page. A video file is no
 * use here, since an image element cannot show one.
 */
export function previewFor(
  media: ReadonlyArray<{ url: string; kind: "image" | "video" }>,
  pageUrl: string
): string | null {
  const image = media.find((item) => item.kind === "image");
  if (image) return image.url;
  return knownHostThumbnail(pageUrl)?.url ?? null;
}
