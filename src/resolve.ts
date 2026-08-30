import { extensionOf, kindForExtension } from "./formats";
import { decodeEntities, readMetaTags } from "./page-cover";
import { AMAZON_IMAGE_HOST, AMAZON_IMAGE_MODIFIER } from "./normalize";

export interface ResolvedMedia {
  url: string;
  kind: "image" | "video";
  /** Vault path once archived, so the note can embed the file itself. */
  localPath?: string;
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
 * The first web URL in a piece of text, or null when there is none.
 *
 * Share sheets and copied captions wrap the link in prose — "Check this
 * out! https://…" — and a capture path that demands a bare URL refuses
 * exactly the text mobile apps hand over. Trailing sentence punctuation is
 * not part of a shared link in practice, so it is stripped.
 */
export function firstHttpUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/.exec(text);
  if (!match) return null;
  const url = match[0].replace(/[.,;:!?)\]}]+$/, "");
  return isHttpUrl(url) ? url : null;
}

/**
 * firstHttpUrl for text that travelled through a share pipeline.
 *
 * iOS Shortcuts' Open URL action can percent-encode an already-encoded
 * parameter, so what reaches the protocol handler is sometimes the encoding
 * of the link rather than the link. Decoding is tried a couple of times
 * before giving up, and a malformed escape (a bare % in ordinary prose)
 * merely ends the attempt rather than throwing.
 */
export function sharedHttpUrl(raw: string): string | null {
  let text = raw;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = firstHttpUrl(text);
    if (url) return url;
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) return null;
      text = decoded;
    } catch {
      return null;
    }
  }
  return null;
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

  // The document title is the fallback: a page that declares no og:title,
  // as shops and older sites do, still has a name at the top of the tab.
  const title = meta.get("og:title") ?? meta.get("twitter:title") ?? documentTitle(html);
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

const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i;

function documentTitle(html: string): string {
  const raw = TITLE_TAG.exec(html)?.[1] ?? "";
  return decodeEntities(raw).replace(/\s+/g, " ").trim();
}

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$/i;
const AMAZON_PRODUCT = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

/**
 * Identifies a product page on any Amazon storefront. Amazon publishes no
 * Open Graph tags at all, so the cover and the title have to be read off
 * the page itself; see parseAmazonPage.
 */
export function amazonProduct(url: string): { asin: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!AMAZON_HOST.test(parsed.hostname)) return null;
  const match = AMAZON_PRODUCT.exec(parsed.pathname);
  return match ? { asin: match[1].toUpperCase() } : null;
}

/**
 * The original behind an Amazon image rendition. The CDN sizes by a
 * modifier in the filename, 61f8IVzjEDL._SL1000_.jpg, and serves the
 * original when it is left off.
 */
export function amazonOriginal(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!AMAZON_IMAGE_HOST.test(parsed.hostname)) return url;
  parsed.pathname = parsed.pathname.replace(AMAZON_IMAGE_MODIFIER, "$1$2");
  return parsed.toString();
}

const AMAZON_HIRES_ATTR = /data-old-hires="([^"]+)"/;
const AMAZON_HIRES_JSON = /"hiRes"\s*:\s*"(https?:[^"]+)"/;
const AMAZON_DYNAMIC = /data-a-dynamic-image="([^"]+)"/;
const AMAZON_TITLE = /<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/;
/** The storefront's tail on the document title: ": Books - Amazon.ca". */
const AMAZON_TITLE_TAIL = /\s*[-:|]\s*Amazon(\.[a-z.]+)?\s*$/i;

/**
 * Reads a product page's cover and title. The cover is the landing image's
 * hi-res original, declared three ways on the page, tried in order of how
 * reliably they are there: the data-old-hires attribute, the hiRes entry in
 * the image block's data, and the largest rendition in the dynamic image
 * map. Whichever is found is reduced to the original. The title is the
 * product's own, or the document title with the storefront's tail removed.
 */
export function parseAmazonPage(html: string, sourceUrl: string): ResolvedLink {
  let cover = AMAZON_HIRES_ATTR.exec(html)?.[1] ?? AMAZON_HIRES_JSON.exec(html)?.[1] ?? "";
  if (!cover) {
    const dynamic = AMAZON_DYNAMIC.exec(html)?.[1];
    if (dynamic) {
      try {
        const map = JSON.parse(decodeEntities(dynamic)) as Record<string, [number, number]>;
        let best = 0;
        for (const [url, size] of Object.entries(map)) {
          const area = (size?.[0] ?? 0) * (size?.[1] ?? 0);
          if (area > best) {
            best = area;
            cover = url;
          }
        }
      } catch {
        cover = "";
      }
    }
  }

  const product = AMAZON_TITLE.exec(html)?.[1];
  const title = product
    ? decodeEntities(product).replace(/\s+/g, " ").trim()
    : documentTitle(html).replace(AMAZON_TITLE_TAIL, "").trim();

  return {
    url: sourceUrl,
    title,
    description: "",
    author: "",
    published: "",
    media: cover ? [{ url: amazonOriginal(decodeEntities(cover)), kind: "image" }] : [],
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
/**
 * `grid` is written only when the capture is going somewhere other than home.
 * Home is the absence of the key, so stamping it would put a redundant line
 * in every note the plugin creates.
 */
export function buildNote(link: ResolvedLink, created = today(), grid = ""): string {
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
  lines.push("tags:", '  - "clippings"');
  if (grid) lines.push(`grid: ${yamlString(grid)}`);
  lines.push("---", "");

  if (link.description) lines.push(link.description, "");

  for (const item of link.media) {
    // Prefer the archived file: an embed of a local path keeps playing after
    // the signed CDN url in the original post has expired.
    if (item.localPath) {
      lines.push(`![[${item.localPath}]]`, "");
    } else if (item.kind === "video") {
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
  created: string,
  grid = ""
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
    ...(grid ? [`grid: ${yamlString(grid)}`] : []),
    "---",
    "",
    `![[${attachmentPath}]]`,
    "",
  ].join("\n");
}
