/**
 * One source of truth for what the plugin accepts and what it can paint.
 *
 * Two different questions matter and they have different answers. Archiving
 * only needs to recognise a format. Painting needs Chromium to decode it,
 * and Chromium handles far less than macOS does, so anything outside its
 * set is archived as-is and given a rendered preview alongside.
 */

/** Chromium decodes these in an <img>, so they paint with no help. */
const RENDERABLE_IMAGE = new Set(["png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "ico", "avif"]);

/** Archived, but need a generated preview before the grid can show them. */
const OPAQUE_IMAGE = new Set([
  "tif",
  "tiff",
  "heic",
  "heif",
  "heics",
  "avci",
  "icns",
  "exr",
  "hdr",
  "pic",
  "jp2",
  "jxl",
  "psd",
  "tga",
  "dds",
  "sgi",
  "pbm",
  // RAW, one extension per vendor that macOS can read.
  "raw",
  "dng",
  "cr2",
  "cr3",
  "crw",
  "nef",
  "nrw",
  "arw",
  "srf",
  "sr2",
  "raf",
  "orf",
  "rw2",
  "pef",
  "srw",
  "dcr",
  "mrw",
  "erf",
  "3fr",
  "fff",
  "iiq",
  "mos",
  "rwl",
]);

/** Chromium plays these in a <video>. */
const RENDERABLE_VIDEO = new Set(["mp4", "m4v", "webm", "ogv", "ogg", "mov"]);

/** Archived and posterable, but not playable inline. */
const OPAQUE_VIDEO = new Set(["avi", "mkv", "wmv", "flv", "mpg", "mpeg", "m2ts", "mts", "3gp"]);

/**
 * Deliberately excluded. SVG is script-capable markup, and rendering
 * arbitrary clipped SVG inside the vault is not a risk worth taking for a
 * format that is rare in clippings.
 */
const EXCLUDED = new Set(["svg", "svgz"]);

export type MediaKind = "image" | "video";

/** Lowercased extension without the dot, ignoring query and fragment. */
export function extensionOf(urlOrPath: string): string {
  let path = urlOrPath;
  try {
    const parsed = new URL(urlOrPath);
    path = parsed.pathname;
  } catch {
    path = urlOrPath.split(/[?#]/)[0];
  }
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isExcluded(ext: string): boolean {
  return EXCLUDED.has(ext.toLowerCase());
}

export function kindForExtension(ext: string): MediaKind | null {
  const e = ext.toLowerCase();
  if (EXCLUDED.has(e)) return null;
  if (RENDERABLE_VIDEO.has(e) || OPAQUE_VIDEO.has(e)) return "video";
  if (RENDERABLE_IMAGE.has(e) || OPAQUE_IMAGE.has(e)) return "image";
  return null;
}

/** True when the grid can paint the file directly, with no conversion. */
export function isRenderable(ext: string): boolean {
  const e = ext.toLowerCase();
  return RENDERABLE_IMAGE.has(e) || RENDERABLE_VIDEO.has(e);
}

/** True when the file is supported but needs a generated preview to show. */
export function needsPreview(ext: string): boolean {
  const e = ext.toLowerCase();
  return OPAQUE_IMAGE.has(e) || OPAQUE_VIDEO.has(e);
}

export function isSupported(ext: string): boolean {
  return kindForExtension(ext) !== null;
}

/** Extension to use when a URL carries none, by kind. */
export function defaultExtension(kind: MediaKind): string {
  return kind === "video" ? "mp4" : "jpg";
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/tiff": "tiff",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/x-adobe-dng": "dng",
  "image/x-canon-cr2": "cr2",
  "image/x-nikon-nef": "nef",
  "image/x-sony-arw": "arw",
  "image/x-exr": "exr",
  "image/vnd.radiance": "hdr",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
};

/** Extension for a clipboard or response MIME type. */
export function extensionForMime(mime: string): string {
  const key = mime.split(";")[0].trim().toLowerCase();
  const mapped = MIME_TO_EXT[key];
  if (mapped) return mapped;
  return key.startsWith("video/") ? "mp4" : "png";
}
