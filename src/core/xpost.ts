import type { Post, PostDetails } from "./posts";
import { xStatus } from "./resolve";
import type { ClippingRecord } from "./scan";

/**
 * X's half of the post card (see posts.ts): the name, the words and the
 * date are read off the note, and fxtwitter adds the avatar, the verified
 * badge and the likes.
 */

/** The post a clipping is of, from the note alone, or null for anything else. */
export function xPostOf(record: ClippingRecord): Post | null {
  const status = xStatus(record.source);
  if (!status) return null;
  const author = (record.properties.author ?? [])[0]?.trim() ?? "";
  const name = author || status.user;
  return { site: "x", id: status.id, handle: status.user, name, text: postText(record, name) };
}

/**
 * What the post said. The description holds it for both the Web Clipper's
 * notes and Oriko's own. A note without one is titled "Name: words", so the
 * words are what follows the name.
 */
function postText(record: ClippingRecord, name: string): string {
  const said = record.description.replace(/\s+/g, " ").trim();
  if (said) return said;
  const prefix = `${name}: `;
  return record.title.startsWith(prefix) ? record.title.slice(prefix.length).trim() : "";
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

/** The parts of an fxtwitter status answer a card shows, or null for a post it could not find. */
export function parseFxDetails(json: unknown): PostDetails | null {
  const tweet = obj(obj(json)?.tweet);
  if (!tweet) return null;
  const author = obj(tweet.author);
  const verification = obj(author?.verification);
  const avatar = typeof author?.avatar_url === "string" ? author.avatar_url : "";
  const likes = typeof tweet.likes === "number" && Number.isFinite(tweet.likes) ? tweet.likes : 0;
  return { avatar, verified: verification?.verified === true, count: likes };
}
