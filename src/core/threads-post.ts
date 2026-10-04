import { readMetaTags } from "./page-cover";
import { decodeText, oneLine, parseCount } from "./post-text";
import type { Post, PostDetails } from "./posts";
import { isThreadsUrl } from "./resolve";
import type { ClippingRecord } from "./scan";

/**
 * Threads' half of the post card (see posts.ts).
 *
 * The Web Clipper titles a post `Name (@handle) on Threads` and keeps its
 * words as the description. Most clippings are share links
 * (`/share/BAVLaykohQ/`), which name neither the person nor the post, so the
 * lookup first asks where the link lands, then reads the post's embed page,
 * the one Threads serves to other websites without a login.
 */

const SHARE = /^\/share\/([A-Za-z0-9_-]+)/;
const POST = /^\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)/;

export interface ThreadsTarget {
  handle: string;
  code: string;
}

/** The person and post a post link names, or null for a share link or anything else. */
export function threadsPostLink(url: string): ThreadsTarget | null {
  if (!isThreadsUrl(url)) return null;
  try {
    const match = POST.exec(new URL(url).pathname);
    return match ? { handle: match[1], code: match[2] } : null;
  } catch {
    return null;
  }
}

/** The post a clipping is of, from the note alone, or null for anything else. */
export function threadsPostOf(record: ClippingRecord): Post | null {
  if (!isThreadsUrl(record.source)) return null;
  let path: string;
  try {
    path = new URL(record.source).pathname;
  } catch {
    return null;
  }
  const post = POST.exec(path);
  const id = post?.[2] ?? SHARE.exec(path)?.[1];
  if (!id) return null;
  const named = /^(.*) \(@([A-Za-z0-9._]+)\) on Threads$/.exec(oneLine(decodeText(record.title)));
  const handle = named?.[2] ?? post?.[1] ?? "";
  return {
    site: "threads",
    id,
    handle,
    name: named?.[1]?.trim() || handle,
    text: oneLine(decodeText(record.description)),
  };
}

/** Where a share link landed, read off the post page's own address for itself. */
export function parseThreadsPostPage(html: string): ThreadsTarget | null {
  const meta = readMetaTags(html);
  const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(html)?.[1];
  for (const candidate of [meta.get("og:url"), canonical]) {
    if (!candidate) continue;
    const found = threadsPostLink(decodeText(candidate));
    if (found) return found;
  }
  return null;
}

export function threadsEmbedUrl(target: ThreadsTarget): string {
  return `https://www.threads.com/@${target.handle}/post/${target.code}/embed`;
}

/** The avatar, the badge and the likes off a post's embed page, or null for a page that is not one. */
export function parseThreadsEmbed(html: string): PostDetails | null {
  const handle = /class="HeaderLink"[^>]*>\s*<span>([^<]+)</.exec(html)?.[1];
  if (!handle) return null;
  const avatar = /class="AvatarContainer">\s*<img[^>]*\ssrc="([^"]+)"/.exec(html)?.[1] ?? "";
  const start = html.indexOf('class="NameContainer"');
  const end = html.indexOf('class="BodyContainer', start);
  const name = start >= 0 ? html.slice(start, end > start ? end : start + 2000) : "";
  // The first count on the action bar is the likes; then replies, reposts, shares.
  const likes = /class="ActionBarCount">([^<]*)</.exec(html)?.[1] ?? "";
  return {
    avatar: decodeText(avatar),
    verified: /verified/i.test(name),
    count: parseCount(likes),
    handle: decodeText(handle),
  };
}
