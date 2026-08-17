export interface MediaRef {
  url: string;
  kind: "image" | "video";
  alt: string;
  widthHint?: number;
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
  media: MediaRef[];
  haystack: string;
}

const MD_IMAGE = /!\[([^\]]*)\]\(\s*(<?)([^)\s>]+)\2(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const HTML_VIDEO = /<video\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const HTML_ALT = /\balt\s*=\s*["']([^"']*)["']/i;
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

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function basename(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
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
    found.push({ index, ref: { url, kind, alt, widthHint: widthHint(url) } });
  };

  for (const m of clean.matchAll(MD_IMAGE)) {
    push(m.index ?? 0, m[3], "image", m[1] ?? "");
  }
  for (const m of clean.matchAll(HTML_IMAGE)) {
    push(m.index ?? 0, m[1], "image", HTML_ALT.exec(m[0])?.[1] ?? "");
  }
  for (const m of clean.matchAll(HTML_VIDEO)) {
    push(m.index ?? 0, m[1], "video", HTML_ALT.exec(m[0])?.[1] ?? "");
  }

  found.sort((a, b) => a.index - b.index);
  const media = found.map((f) => f.ref);

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

  return {
    path,
    title,
    source,
    description,
    categories,
    status,
    created,
    cover,
    media,
    haystack,
  };
}
