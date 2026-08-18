import { extensionOf, kindForExtension } from "./formats";
import { readMetaTags } from "./page-cover";

export interface ResolvedMedia {
  url: string;
  kind: "image" | "video";
}

export interface ResolvedLink {
  /** Canonical page URL, with tracking parameters stripped. */
  url: string;
  title: string;
  description: string;
  author: string;
  published: string;
  media: ResolvedMedia[];
}

/** Parameters that identify the sharer, not the content. */
const TRACKING_PARAMS = [
  "s",
  "t",
  "ref",
  "ref_src",
  "ref_url",
  "fbclid",
  "gclid",
  "igshid",
  "igsh",
  "si",
  "taid",
];

export function cleanUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.includes(name.toLowerCase()) || name.toLowerCase().startsWith("utm_")) {
      parsed.searchParams.delete(name);
    }
  }
  let out = parsed.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True when the pasted URL is the asset itself rather than a page about it.
 * Threads never exposes its video URL, so copying the video address and
 * pasting that is the only route to archiving it.
 */
export function directMediaKind(url: string): "image" | "video" | null {
  try {
    new URL(url);
  } catch {
    return null;
  }
  return kindForExtension(extensionOf(url));
}

/** Builds a link for a URL that points straight at an image or video. */
export function directMediaLink(url: string, kind: "image" | "video"): ResolvedLink {
  let name = "";
  let host = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, "");
    name = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
  } catch {
    host = "link";
  }
  const label = kind === "video" ? "Video" : "Image";
  return {
    url,
    title: name ? `${label}: ${name}` : `${label} from ${host}`,
    description: "",
    author: "",
    published: "",
    media: [{ url, kind }],
  };
}

const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com"]);
const X_STATUS = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/;

/** Identifies an X post, whose media is only reachable through a resolver. */
export function xStatus(url: string): { user: string; id: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!X_HOSTS.has(parsed.hostname.replace(/^www\./, "").toLowerCase())) return null;
  const match = X_STATUS.exec(parsed.pathname);
  return match ? { user: match[1], id: match[2] } : null;
}

const INSTAGRAM_HOSTS = new Set(["instagram.com", "m.instagram.com", "instagr.am"]);
const INSTAGRAM_PATH = /^\/(reels?|p|tv)\/([A-Za-z0-9_-]{5,32})/;

/**
 * Identifies an Instagram post. Like Threads, Instagram publishes only a
 * poster image to crawlers and never the video URL, so the media is only
 * reachable through a mirror.
 */
export function instagramPost(url: string): { kind: string; code: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!INSTAGRAM_HOSTS.has(parsed.hostname.replace(/^www\./, "").toLowerCase())) return null;
  const match = INSTAGRAM_PATH.exec(parsed.pathname);
  if (!match) return null;
  // "reels" and "reel" address the same thing; the mirror expects "reel".
  return { kind: match[1] === "reels" ? "reel" : match[1], code: match[2] };
}

/**
 * Hosts whose media a local yt-dlp can fetch directly. Checked before
 * spending a subprocess, so ordinary article clippings never pay for it.
 */
const DOWNLOADABLE_HOSTS = new Set([
  "instagram.com",
  "m.instagram.com",
  "instagr.am",
  "x.com",
  "twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
  "tiktok.com",
  "vm.tiktok.com",
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "reddit.com",
  "bsky.app",
]);

export function supportsSourceDownload(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return DOWNLOADABLE_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function fxApiUrl(status: { user: string; id: string }): string {
  return `https://api.fxtwitter.com/${status.user}/status/${status.id}`;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Turns an fxtwitter payload into a resolved link. Pure. */
export function parseFxTweet(payload: unknown, sourceUrl: string): ResolvedLink | null {
  if (!payload || typeof payload !== "object") return null;
  const tweet = (payload as { tweet?: unknown }).tweet;
  if (!tweet || typeof tweet !== "object") return null;

  const t = tweet as Record<string, unknown>;
  const author = (t.author ?? {}) as Record<string, unknown>;
  const mediaBlock = (t.media ?? {}) as Record<string, unknown>;

  const media: ResolvedMedia[] = [];
  const seen = new Set<string>();
  for (const key of ["videos", "photos", "all"]) {
    const list = mediaBlock[key];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const url = asText(item.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      media.push({ url, kind: asText(item.type) === "video" ? "video" : "image" });
    }
  }

  const text = asText(t.text);
  const name = asText(author.name);

  return {
    url: asText(t.url) || sourceUrl,
    title: text ? `${name || "Post"}: ${text.split("\n")[0]}`.slice(0, 120) : name || "Post",
    description: text,
    author: name,
    published: asText(t.created_at),
    media,
  };
}

/** Builds a resolved link from a page's own Open Graph metadata. Pure. */
export function parsePageMeta(html: string, sourceUrl: string): ResolvedLink {
  const meta = readMetaTags(html);
  const media: ResolvedMedia[] = [];
  const seen = new Set<string>();

  const add = (raw: string | undefined, kind: ResolvedMedia["kind"]): void => {
    if (!raw) return;
    let absolute: string;
    try {
      absolute = new URL(raw, sourceUrl).toString();
    } catch {
      return;
    }
    if (seen.has(absolute)) return;
    seen.add(absolute);
    media.push({ url: absolute, kind });
  };

  // Video first: a page that has one wants it shown over its poster.
  add(meta.get("og:video:secure_url") ?? meta.get("og:video:url") ?? meta.get("og:video"), "video");
  add(meta.get("og:image:secure_url") ?? meta.get("og:image:url") ?? meta.get("og:image"), "image");
  add(meta.get("twitter:image"), "image");

  const title = meta.get("og:title") ?? meta.get("twitter:title") ?? "";
  const description = meta.get("og:description") ?? meta.get("twitter:description") ?? "";

  return {
    url: sourceUrl,
    title: title.trim(),
    description: description.trim(),
    author: (meta.get("article:author") ?? meta.get("twitter:creator") ?? "").trim(),
    published: (meta.get("article:published_time") ?? "").trim(),
    media,
  };
}

/** Vault-safe note name derived from a title, never empty. */
export function noteNameFor(title: string, url: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned) return cleaned.slice(0, 100).trim();

  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
  } catch {
    return "Untitled clipping";
  }
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Matches the Web Clipper's frontmatter contract, per vault CLAUDE.md §9. */
export function buildNote(link: ResolvedLink, created = today()): string {
  const lines = [
    "---",
    `title: ${yamlString(link.title)}`,
    `source: ${yamlString(link.url)}`,
    "author:",
  ];
  if (link.author) lines.push(`  - ${yamlString(link.author)}`);
  // No trailing space on an empty value; the Linter would strip it anyway.
  lines.push(link.published ? `published: ${yamlString(link.published)}` : "published:");
  lines.push(`created: ${created}`);
  lines.push(`description: ${yamlString(link.description)}`);
  lines.push("tags:", '  - "clippings"', "---", "");

  if (link.description) lines.push(link.description, "");

  for (const item of link.media) {
    if (item.kind === "video") {
      lines.push(`<video src="${item.url}" controls=""></video>`, "");
    } else {
      lines.push(`![](${item.url})`, "");
    }
  }

  lines.push(`[${link.url}](${link.url})`, "");
  return lines.join("\n");
}

/**
 * Note body for an image pasted straight from the clipboard, which has no
 * source page to describe it. `media:` carries the vault path so the
 * scanner and the grid treat it like any other clipping.
 */
export function buildPastedImageNote(
  title: string,
  attachmentPath: string,
  created: string
): string {
  return [
    "---",
    `title: ${yamlString(title)}`,
    "source:",
    "author:",
    "published:",
    `created: ${created}`,
    "description:",
    "tags:",
    '  - "clippings"',
    // A plain string: the scanner reads cover with str(), so a list here
    // would parse as empty and the clipping would have no tile at all.
    `cover: ${yamlString(attachmentPath)}`,
    "---",
    "",
    `![[${attachmentPath}]]`,
    "",
  ].join("\n");
}
