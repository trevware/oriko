import { extensionOf, kindForExtension } from "./formats";
import { isHttpUrl } from "./resolve";

/**
 * What a drag has brought in, and what should be done about it.
 *
 * Pure, no DOM and no Obsidian. A DataTransfer cannot be built in a test and
 * its files cannot even be read until the drop event fires, so the decision is
 * taken over the plain facts read off one and the view is left holding nothing
 * but the event.
 */

export interface DroppedFile {
  name: string;
  /**
   * The MIME the source reported. Often empty: Finder fills it in, but a drag
   * from an archive tool or a Windows share may not, which is why the
   * extension is consulted as well rather than instead.
   */
  type: string;
}

export type DropPlan =
  | { kind: "media"; files: DroppedFile[]; skipped: string[] }
  | { kind: "url"; url: string }
  | { kind: "unsupported"; skipped: string[] }
  | { kind: "ignore" };

function isMedia(file: DroppedFile): boolean {
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) return true;
  // No usable MIME, so fall back to what the name claims. kindForExtension is
  // the same test the wall uses to decide it can paint something, so a file
  // accepted here is one that will have a tile rather than a blank card.
  return kindForExtension(extensionOf(file.name)) !== null;
}

/**
 * Whether a drag is worth lighting the wall up for.
 *
 * Read on dragenter, where the files themselves are still sealed: only the
 * list of types is legible before the drop, so this is as much as can be known
 * while there is still time to show a target.
 */
export function wantsDrop(types: readonly string[]): boolean {
  return types.includes("Files") || types.includes("text/uri-list");
}

/**
 * Files win over text. A drag from Finder carries both, the text being the
 * path of what is already in the files list, so reading the text first would
 * turn every file drop into a failed link capture.
 *
 * A drag carrying no files and no web link is ignored in silence rather than
 * refused. That case is mostly Obsidian's own drags, a note leaving the file
 * explorer, and answering those with a complaint would mean picking a fight
 * with the app over every stray gesture that crossed the wall.
 */
export function classifyDrop(files: readonly DroppedFile[], text: string): DropPlan {
  if (files.length > 0) {
    const media = files.filter(isMedia);
    const skipped = files.filter((file) => !isMedia(file)).map((file) => file.name);
    return media.length > 0
      ? { kind: "media", files: media, skipped }
      : { kind: "unsupported", skipped };
  }

  const trimmed = text.trim();
  // uri-list allows several lines and permits # comments. One clipping per
  // drop, so the first real line is the one taken.
  const first = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  if (first && isHttpUrl(first)) return { kind: "url", url: first };
  return { kind: "ignore" };
}

/**
 * The title a dropped file should carry, which is its own name without the
 * extension.
 *
 * Worth the trouble because the alternative is the timestamp a paste gets, and
 * a wall of "Pasted image 2026-08-20 204512" is exactly the machine-generated
 * title the vault's own notes call out as unsearchable. A file arriving with a
 * name already on it should keep it.
 */
export function titleForDropped(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Names what a drop could not take.
 *
 * One file is named, because knowing which one is the useful part. Several are
 * counted instead: a notice listing forty filenames is a notice nobody reads,
 * and the answer is the same for all of them.
 */
export function describeSkipped(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is not a picture or a video`;
  return `${names.length} files were not pictures or videos`;
}
