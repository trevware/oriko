import { decodeText, oneLine, parseCount } from "./post-text";
import type { Post, PostDetails } from "./posts";
import { instagramPost } from "./resolve";
import type { ClippingRecord } from "./scan";

/**
 * Instagram's half of the post card (see posts.ts).
 *
 * The Web Clipper's note already says nearly everything: the title is
 * `Name on Instagram: "caption"` and the description
 * `1,075 likes, 6 comments - handle on September 4, 2026: "caption"`, or
 * without the counts when the poster hides their likes.
 * The lookup adds the avatar, the badge and today's likes from the post's
 * embed page, the one Instagram serves to other websites without a login.
 */

const SUMMARY = /^(?:([\d.,]+[KkMm]?) likes?, [\d.,]+[KkMm]? comments? - )?([A-Za-z0-9._]+) on [^:]*?: "([\s\S]*)$/;

/** The post a clipping is of, from the note alone, or null for anything else. */
export function instagramPostOf(record: ClippingRecord): Post | null {
  const found = instagramPost(record.source);
  if (!found) return null;
  const title = decodeText(record.title);
  const summary = SUMMARY.exec(decodeText(record.description).trim());
  const handle = summary?.[2] ?? "";
  const named = / on Instagram(?::|$)/.exec(title);
  const name = named ? oneLine(title.slice(0, named.index)) : "";
  const said = summary?.[3] ?? afterQuote(title);
  return {
    site: "instagram",
    id: found.code,
    handle,
    name: name || handle,
    text: oneLine(said.replace(/"\.?\s*$/, "")),
    ...(summary?.[1] ? { count: parseCount(summary[1]) } : {}),
  };
}

/** What follows `: "` in a title, the quoted words. */
function afterQuote(title: string): string {
  const at = title.indexOf(': "');
  return at >= 0 ? title.slice(at + 3) : "";
}

/** Any post's embed page: `/p/` serves reels and videos as well as photos. */
export function instagramEmbedUrl(code: string): string {
  return `https://www.instagram.com/p/${code}/embed/captioned/`;
}

/**
 * The avatar, the badge and the likes off a post's embed page, or null for
 * a page that is not one (a login wall, a deleted post). Asked with Oriko's
 * own user agent: a browser's gets an empty page that builds itself in
 * script.
 */
export function parseInstagramEmbed(html: string): PostDetails | null {
  const start = html.indexOf('class="Header"');
  if (start < 0) return null;
  const end = html.indexOf('class="HeaderCta"', start);
  const header = html.slice(start, end > start ? end : start + 4000);
  const handle = /class="UsernameText">([^<]+)</.exec(header)?.[1];
  if (!handle) return null;
  // "Avatar InsideRing" while the person has a story up, and "CollabAvatar"
  // on a post made with others, where the poster's comes first.
  const avatar = /class="(?:Collab)?Avatar(?: [^"]*)?"[^>]*>\s*<img[^>]*\ssrc="([^"]+)"/.exec(header)?.[1] ?? "";
  const likes = /class="SocialProof"[\s\S]*?>([\d.,]+[KkMm]?) likes?</.exec(html)?.[1] ?? "";
  return {
    avatar: decodeText(avatar),
    verified: header.includes("VerifiedSprite"),
    count: parseCount(likes),
    handle: decodeText(handle),
  };
}
