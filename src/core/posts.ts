import { instagramPostOf } from "./instagram-post";
import type { ClippingRecord } from "./scan";
import { threadsPostOf } from "./threads-post";
import { xPostOf } from "./xpost";
import { youtubePostOf } from "./youtube-post";

export { decodeText, parseCount } from "./post-text";

/**
 * The post card: a clipping of something a person posted, drawn as its
 * picture with a band under it naming who posted it, with a count and the
 * start of what they said. X, Instagram, Threads and YouTube each read their
 * own notes and lookups (xpost.ts, instagram-post.ts, threads-post.ts,
 * youtube-post.ts); everything after that is shared and lives here.
 *
 * What a card says is read off the note, so every clipping already in the
 * vault takes the card without a byte of it being rewritten. The avatar, the
 * badge and the fresher counts come from a lookup each device makes, kept per
 * device like Steam's prices.
 */

export type PostSite = "x" | "instagram" | "threads" | "youtube";

export const POST_SITES: readonly PostSite[] = ["x", "instagram", "threads", "youtube"];

/** What a card is by when neither the note nor a lookup has named anyone. */
const SITE_NAMES: Record<PostSite, string> = { x: "X", instagram: "Instagram", threads: "Threads", youtube: "YouTube" };

export interface Post {
  site: PostSite;
  /** The site's own id for it: a status id, a shortcode, a share code, a video id. */
  id: string;
  /** "" where the note does not say, as for a YouTube channel. */
  handle: string;
  name: string;
  text: string;
  /** A count the note itself carries (Instagram's likes), shown until a lookup lands. */
  count?: number;
}

/** What a lookup adds. `count` is likes, or views for a video. */
export interface PostDetails {
  avatar: string;
  verified: boolean;
  count: number;
  /** A video's length, in seconds. */
  duration?: number;
  /** What the lookup knows that the note may not: a channel's name, a handle. */
  name?: string;
  handle?: string;
}

/** The first site that claims a clipping, or null for anything that is not a post. */
export function postOf(record: ClippingRecord): Post | null {
  return xPostOf(record) ?? instagramPostOf(record) ?? threadsPostOf(record) ?? youtubePostOf(record);
}

export const postKey = (post: Pick<Post, "site" | "id">): string => `${post.site}:${post.id}`;

/** Whose avatar it is. Handles are case-blind on every one of these sites. */
export const personKey = (site: PostSite, handle: string): string => `${site}:${handle.toLowerCase()}`;

/* ------------------------------------------------------------------ */
/* What a card is drawn from                                          */
/* ------------------------------------------------------------------ */

export interface PostLook {
  post: Post;
  details: PostDetails | null;
  /** Who it is by, preferring what the lookup learned, else the site's name. */
  name: string;
  /** The saved avatar to show, or "" for the name's initial. */
  avatar: string;
  /** Changes whenever the card must be drawn again. */
  stamp: string;
}

export function postLook(post: Post, entry: PostEntry | undefined, avatar = ""): PostLook {
  const details = entry?.details ?? null;
  return {
    post,
    details,
    name: details?.name || post.name || details?.handle || post.handle || SITE_NAMES[post.site],
    avatar,
    stamp: details
      ? `${entry?.fetchedAt ?? 0}|${details.count}|${details.verified ? 1 : 0}|${avatar}`
      : `bare|${avatar}`,
  };
}

/** What the band's corner says: likes with a heart, or a video's views and length. */
export function countLabel(look: PostLook): { kind: "likes" | "views"; text: string } | null {
  if (look.post.site === "youtube") {
    const details = look.details;
    if (!details || !(details.count > 0)) return null;
    const length = details.duration ? ` · ${formatDuration(details.duration)}` : "";
    return { kind: "views", text: `${compactCount(details.count)} views${length}` };
  }
  const likes = look.details?.count ?? look.post.count ?? 0;
  return likes > 0 ? { kind: "likes", text: compactCount(likes) } : null;
}

/** A count the way X shortens it: 9472 is 9.4K, 286060 is 286K, 1.2M past a million. */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  if (n < 10000) return `${Math.floor(n / 100) / 10}K`.replace(".0K", "K");
  if (n < 1000000) return `${Math.floor(n / 1000)}K`;
  return `${Math.floor(n / 100000) / 10}M`.replace(".0M", "M");
}

/** A video's length the way YouTube writes it: 0:05, 21:10, 1:08:22. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/* ------------------------------------------------------------------ */
/* The band's size                                                    */
/* ------------------------------------------------------------------ */

/** The band's fixed parts, in pixels: padding top and bottom, the author row, the gap under it. */
const BAND_PADDING = 21;
const BAND_ROW = 22;
const BAND_GAP = 6;
const BAND_LINE = 17;
const BAND_INSET = 22;

/** Wide characters (CJK, kana, hangul, full-width forms) take about twice a Latin letter's width. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

/**
 * How many lines of the post the band shows, one or two, at this column
 * width. Measured by counting, since the wall is laid out before anything is
 * drawn: a Latin letter is reckoned at 6.6px and a wide character at 12.5px
 * in the band's 12.5px text. A guess a little out is absorbed by the
 * picture above, which gives up or gains the difference.
 */
export function bandLines(text: string, columnWidth: number): 0 | 1 | 2 {
  if (!text) return 0;
  const room = Math.max(40, columnWidth - BAND_INSET);
  let width = 0;
  for (const ch of text) width += WIDE.test(ch) ? 12.5 : 6.6;
  return width <= room ? 1 : 2;
}

/** The band's height for a post at this column width, for the layout to reserve. */
export function bandHeight(text: string, columnWidth: number): number {
  const lines = bandLines(text, columnWidth);
  return BAND_PADDING + BAND_ROW + (lines > 0 ? BAND_GAP + lines * BAND_LINE : 0);
}

/* ------------------------------------------------------------------ */
/* The per-device store                                               */
/* ------------------------------------------------------------------ */

export interface PostEntry {
  fetchedAt: number;
  details?: PostDetails;
  failed?: string;
}

/** A person's avatar as saved on this device. */
export interface SavedAvatar {
  /** Path of the saved file, under the plugin's folder. */
  file: string;
  /** Where it was downloaded from. */
  url: string;
  savedAt: number;
}

export const POST_FRESH_MS = 24 * 60 * 60 * 1000;
export const POST_RETRY_MS = 6 * 60 * 60 * 1000;
export const AVATAR_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function readDetails(raw: unknown): PostDetails | undefined {
  const d = obj(raw);
  if (!d || typeof d.avatar !== "string" || typeof d.count !== "number") return undefined;
  return {
    avatar: d.avatar,
    verified: d.verified === true,
    count: d.count,
    ...(typeof d.duration === "number" ? { duration: d.duration } : {}),
    ...(typeof d.name === "string" ? { name: d.name } : {}),
    ...(typeof d.handle === "string" ? { handle: d.handle } : {}),
  };
}

/** What this device last heard about each post, by `site:id`, and the avatars it saved. Rebuildable. */
export class PostStore {
  private entries = new Map<string, PostEntry>();
  private avatars = new Map<string, SavedAvatar>();

  get(key: string): PostEntry | undefined {
    return this.entries.get(key);
  }

  /** A failure keeps the details that were there: yesterday's likes beat none. */
  set(key: string, now: number, details: PostDetails | null, failed = ""): void {
    const kept = details ?? this.entries.get(key)?.details;
    const entry: PostEntry = { fetchedAt: now };
    if (kept) entry.details = kept;
    if (!details && failed) entry.failed = failed;
    this.entries.set(key, entry);
  }

  isDue(key: string, now: number): boolean {
    const entry = this.entries.get(key);
    if (!entry) return true;
    return now - entry.fetchedAt >= (entry.failed ? POST_RETRY_MS : POST_FRESH_MS);
  }

  avatar(person: string): SavedAvatar | undefined {
    return this.avatars.get(person);
  }

  setAvatar(person: string, saved: SavedAvatar): void {
    this.avatars.set(person, saved);
  }

  avatarDue(person: string, now: number): boolean {
    const saved = this.avatars.get(person);
    return !saved || now - saved.savedAt >= AVATAR_FRESH_MS;
  }

  toJSON(): { version: number; posts: Record<string, PostEntry>; avatars: Record<string, SavedAvatar> } {
    return {
      version: 2,
      posts: Object.fromEntries(this.entries),
      avatars: Object.fromEntries(this.avatars),
    };
  }

  static fromJSON(data: unknown): PostStore {
    const store = new PostStore();
    const root = obj(data);
    for (const [key, raw] of Object.entries(obj(root?.posts) ?? {})) {
      const entry = obj(raw);
      if (!entry || typeof entry.fetchedAt !== "number" || !key.includes(":")) continue;
      const details = readDetails(entry.details);
      store.entries.set(key, {
        fetchedAt: entry.fetchedAt,
        ...(details ? { details } : {}),
        ...(typeof entry.failed === "string" ? { failed: entry.failed } : {}),
      });
    }
    for (const [person, raw] of Object.entries(obj(root?.avatars) ?? {})) {
      const saved = obj(raw);
      if (!saved || typeof saved.file !== "string" || typeof saved.url !== "string") continue;
      if (typeof saved.savedAt !== "number") continue;
      store.avatars.set(person, { file: saved.file, url: saved.url, savedAt: saved.savedAt });
    }
    return store;
  }

  /** The X card's own store, from before every site shared one: `{ posts: { id: { details: { likes } } } }`. */
  static fromXStore(data: unknown): PostStore {
    const store = new PostStore();
    for (const [id, raw] of Object.entries(obj(obj(data)?.posts) ?? {})) {
      const entry = obj(raw);
      if (!entry || typeof entry.fetchedAt !== "number" || !/^\d+$/.test(id)) continue;
      const d = obj(entry.details);
      const details =
        d && typeof d.avatar === "string" && typeof d.likes === "number"
          ? { avatar: d.avatar, verified: d.verified === true, count: d.likes }
          : undefined;
      store.entries.set(`x:${id}`, {
        fetchedAt: entry.fetchedAt,
        ...(details ? { details } : {}),
        ...(typeof entry.failed === "string" ? { failed: entry.failed } : {}),
      });
    }
    return store;
  }
}
