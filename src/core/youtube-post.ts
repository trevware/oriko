import { readMetaTags, youtubeVideoId } from "./page-cover";
import { decodeText, oneLine } from "./post-text";
import type { Post, PostDetails } from "./posts";
import type { ClippingRecord } from "./scan";

/**
 * YouTube's half of the post card (see posts.ts): the channel, the views and
 * the video's length over its title.
 *
 * The note has the title and, when the Web Clipper found it, the channel as
 * the author. The lookup reads the watch page for the views and length and
 * the channel, then the channel's page for its avatar. No verified badge: it
 * sits in page data that changes shape from one video to the next.
 */

/** The video a clipping is of, from the note alone, or null for anything else. */
export function youtubePostOf(record: ClippingRecord): Post | null {
  const id = youtubeVideoId(record.source);
  if (!id) return null;
  // The clipper writes the channel as a link: [[Prime Video JP]], or [[page|label]].
  const author = (record.properties.author ?? [])[0] ?? "";
  const name = author.replace(/^\[\[(?:[^\]|]*\|)?/, "").replace(/\]\]$/, "");
  return { site: "youtube", id, handle: "", name: oneLine(decodeText(name)), text: oneLine(decodeText(record.title)) };
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * The views, the length and the channel off a watch page, with the
 * channel's address for its avatar, or null for a page that is not one.
 */
export function parseYoutubeWatch(html: string): { details: PostDetails; channel: string } | null {
  const views = /"viewCount":"(\d+)"/.exec(html)?.[1];
  const length = /"lengthSeconds":"(\d+)"/.exec(html)?.[1];
  const author = /<span itemprop="author"[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1] ?? "";
  const url = /<link itemprop="url" href="([^"]+)"/.exec(author)?.[1] ?? "";
  const name = decodeText(/<link itemprop="name" content="([^"]*)"/.exec(author)?.[1] ?? "");
  if (!views && !url) return null;
  const channel = url.replace(/^http:\/\//, "https://");
  const handle = /\/(@[^/?#]+)/.exec(channel)?.[1] ?? "";
  return {
    details: {
      avatar: "",
      verified: false,
      count: Number(views ?? 0),
      ...(length ? { duration: Number(length) } : {}),
      ...(name ? { name } : {}),
      ...(handle ? { handle } : {}),
    },
    channel,
  };
}

/** A channel's avatar, which its page offers as the picture to share it by. */
export function parseYoutubeChannel(html: string): string {
  return readMetaTags(html).get("og:image") ?? "";
}
