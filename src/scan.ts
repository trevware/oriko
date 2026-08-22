import { extensionOf, kindForExtension } from "./formats";

export interface MediaRef {
  url: string;
  kind: "image" | "video";
  alt: string;
  /** Sizes declared in the URL query. Used to lay out before archiving. */
  widthHint?: number;
  heightHint?: number;
}

export interface ClippingRecord {
  path: string;
  title: string;
  source: string;
  description: string;
  categories: string[];
  status: string;
  created: string;
  /** Optional hand-set override for the grid tile's cover image. */
  cover: string;
  /**
   * Which grid this clipping belongs to. Empty means it carries no key, which
   * is how every clipping that predates grids reads. Left raw here: turning
   * it into an effective grid needs the registry, which scanning has no
   * business knowing about. See spaces.ts.
   */
  grid: string;
  media: MediaRef[];
  haystack: string;
  /**
   * Every frontmatter value, normalized to strings, so any key can back a
   * filter facet. Kept whole rather than curated: the settings list has to be
   * able to offer keys the suggester rejects.
   */
  properties: Record<string, string[]>;
}

const MD_IMAGE = /!\[([^\]]*)\]\(\s*(<?)([^)\s>]+)\2(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const HTML_VIDEO = /<video\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
/**
 * Clippers emit both `<video src>` and `<video><source src></video>`. The
 * second form is matched as a whole element so a `<source>` inside a
 * `<picture>` is never mistaken for video.
 */
const HTML_VIDEO_BLOCK = /<video\b([^>]*)>([\s\S]*?)<\/video>/gi;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;
const SOURCE_SRC = /<source\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i;
const HTML_ALT = /\balt\s*=\s*["']([^"']*)["']/i;
const ARIA_LABEL = /\baria-label\s*=\s*["']([^"']*)["']/i;
/** `![[path]]`, `![[path|label]]`, `![[path#heading]]`: an embed of a file in the vault. */
const WIKI_EMBED = /!\[\[([^\]|#]+)(?:[#|]([^\]]*))?\]\]/g;
const FENCED_CODE = /(^|\n)(```|~~~)[\s\S]*?\n\2[ \t]*(?=\n|$)/g;

/**
 * Blanks out fenced code blocks while preserving newlines, so character
 * offsets stay aligned and document order survives.
 */
function stripCode(body: string): string {
  return body.replace(FENCED_CODE, (m) => m.replace(/[^\n]/g, " "));
}

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function widthHint(url: string): number | undefined {
  const match = /[?&](?:w|width)=(\d+)/i.exec(url);
  return match ? Number(match[1]) : undefined;
}

function heightHint(url: string): number | undefined {
  const match = /[?&](?:h|height)=(\d+)/i.exec(url);
  return match ? Number(match[1]) : undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

/** One frontmatter value as facet values. Anything with no sensible string
    form, an object or an empty value, contributes nothing. */
function toValues(value: unknown): string[] {
  const one = (v: unknown): string | null => {
    if (typeof v === "string") return v.trim() || null;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  };
  if (Array.isArray(value)) {
    return value.map(one).filter((v): v is string => v !== null);
  }
  const single = one(value);
  return single === null ? [] : [single];
}

function toProperties(frontmatter: Record<string, unknown>): Record<string, string[]> {
  const properties: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    const values = toValues(value);
    if (values.length > 0) properties[key] = values;
  }
  return properties;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Sites that render media client-side (Threads, X) expose no video URL in
 * their HTML, so neither the clipper nor this plugin can find it. A `media:`
 * frontmatter list is the escape hatch: paste the direct URL and it is
 * archived like anything else. Worth doing promptly, since those CDN URLs
 * are signed and expire.
 */
function frontmatterMedia(value: unknown): MediaRef[] {
  const refs: MediaRef[] = [];
  for (const url of asStringArray(value).filter(isRemote)) {
    const kind = kindForExtension(extensionOf(url));
    refs.push({
      // No extension means we cannot tell; assume an image, which is the
      // common case and the cheaper mistake.
      kind: kind ?? "image",
      url,
      alt: "",
      widthHint: widthHint(url),
      heightHint: heightHint(url),
    });
  }
  return refs;
}

function basename(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}

/**
 * Splits a note's own frontmatter block off the front of its body.
 *
 * Obsidian's metadata cache is the normal source of frontmatter, but it
 * resolves after the file write, so a note the plugin just authored has none
 * yet. This is the fallback for that window, working line by line rather than
 * by regex so that a value containing --- cannot close the block early and a
 * horizontal rule further down the body cannot be mistaken for the closer.
 */
export function splitFrontmatter(body: string): { yaml: string; rest: string } {
  const none = { yaml: "", rest: body };
  const lines = body.split("\n");
  const bare = (line: string): string => line.replace(/\r$/, "");
  if (bare(lines[0] ?? "") !== "---") return none;

  for (let i = 1; i < lines.length; i++) {
    if (bare(lines[i]) !== "---") continue;
    return {
      yaml: lines.slice(1, i).map(bare).join("\n"),
      rest: lines.slice(i + 1).join("\n"),
    };
  }

  // Unterminated: it is not frontmatter, it is a body that starts with a rule.
  return none;
}

export function scanClipping(
  path: string,
  frontmatter: Record<string, unknown>,
  body: string
): ClippingRecord {
  const clean = stripCode(body);
  const found: Array<{ index: number; ref: MediaRef }> = [];
  const seen = new Set<string>();

  const push = (index: number, url: string, kind: MediaRef["kind"], alt: string): void => {
    if (!isRemote(url) || seen.has(url + kind)) return;
    seen.add(url + kind);
    found.push({
      index,
      ref: { url, kind, alt, widthHint: widthHint(url), heightHint: heightHint(url) },
    });
  };

  for (const m of clean.matchAll(MD_IMAGE)) {
    push(m.index ?? 0, m[3], "image", m[1] ?? "");
  }
  for (const m of clean.matchAll(HTML_IMAGE)) {
    push(m.index ?? 0, m[1], "image", HTML_ALT.exec(m[0])?.[1] ?? "");
  }
  for (const m of clean.matchAll(HTML_VIDEO_BLOCK)) {
    const attrs = m[1] ?? "";
    const url = SRC_ATTR.exec(attrs)?.[1] ?? SOURCE_SRC.exec(m[2] ?? "")?.[1];
    if (!url) continue;
    const alt = HTML_ALT.exec(attrs)?.[1] ?? ARIA_LABEL.exec(attrs)?.[1] ?? "";
    push(m.index ?? 0, url, "video", alt);
  }

  // Self-closing or unclosed <video src>. The seen-set makes the overlap
  // with the block form harmless.
  for (const m of clean.matchAll(HTML_VIDEO)) {
    const alt = HTML_ALT.exec(m[0])?.[1] ?? ARIA_LABEL.exec(m[0])?.[1] ?? "";
    push(m.index ?? 0, m[1], "video", alt);
  }

  // The plugin's own notes embed their archived media as wikilinks, paths in
  // the vault rather than URLs, so they get a pass of their own: the kind is
  // read off the extension and the label, if any, is the alt. Without this
  // a link clipping's own picture never reached the tile, and it rendered
  // only through a second copy fetched as the page's cover.
  for (const m of clean.matchAll(WIKI_EMBED)) {
    const target = m[1].trim();
    const kind = kindForExtension(extensionOf(target));
    if (!kind || seen.has(target + kind)) continue;
    seen.add(target + kind);
    found.push({ index: m.index ?? 0, ref: { url: target, kind, alt: (m[2] ?? "").trim() } });
  }

  found.sort((a, b) => a.index - b.index);

  // Hand-listed media leads, so it wins the cover over anything in the body.
  const media = [...frontmatterMedia(frontmatter.media), ...found.map((f) => f.ref)];

  const title = str(frontmatter.title) || basename(path);
  const source = str(frontmatter.source);
  const description = str(frontmatter.description);
  const categories = asStringArray(frontmatter.categories);
  const status = str(frontmatter.status, "unread") || "unread";
  const created = str(frontmatter.created);

  const haystack = [title, description, domainOf(source), ...categories, status]
    .join(" ")
    .toLowerCase();

  const cover = str(frontmatter.cover);
  const grid = str(frontmatter.grid);

  const properties = toProperties(frontmatter);
  // The two facets that ship enabled take the fields computed above rather
  // than the raw frontmatter, so status keeps its "unread" default and
  // categories keeps asStringArray. A purely generic pass would drop every
  // clipping with no status line out of the Status facet.
  properties.status = [status];
  if (categories.length > 0) properties.categories = categories;
  else delete properties.categories;

  return {
    path,
    title,
    source,
    description,
    categories,
    status,
    created,
    cover,
    grid,
    media,
    haystack,
    properties,
  };
}
