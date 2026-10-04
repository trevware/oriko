import { xStatus } from "./resolve";
import type { ClippingRecord } from "./scan";

/**
 * The X look: a clipping of a post drawn as its picture with a band under
 * it naming who posted it, with the start of what they said.
 *
 * The words, the name and the date are read off the note, so every X
 * clipping already in the vault takes the card without a byte of it being
 * rewritten. The avatar, the verified badge and the likes come from a
 * lookup each device makes, kept per device like Steam's prices.
 */

export interface XPost {
  id: string;
  handle: string;
  name: string;
  text: string;
}

/** The post a clipping is of, from the note alone, or null for anything else. */
export function xPostOf(record: ClippingRecord): XPost | null {
  const status = xStatus(record.source);
  if (!status) return null;
  const author = (record.properties.author ?? [])[0]?.trim() ?? "";
  const name = author || status.user;
  return { id: status.id, handle: status.user, name, text: postText(record, name) };
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

export interface XDetails {
  avatar: string;
  verified: boolean;
  likes: number;
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

/** The parts of an fxtwitter status answer a card shows, or null for a post it could not find. */
export function parseFxDetails(json: unknown): XDetails | null {
  const tweet = obj(obj(json)?.tweet);
  if (!tweet) return null;
  const author = obj(tweet.author);
  const verification = obj(author?.verification);
  const avatar = typeof author?.avatar_url === "string" ? author.avatar_url : "";
  const likes = typeof tweet.likes === "number" && Number.isFinite(tweet.likes) ? tweet.likes : 0;
  return { avatar, verified: verification?.verified === true, likes };
}

/** A count the way X shortens it: 9472 is 9.4K, 286060 is 286K, 1.2M past a million. */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  if (n < 10000) return `${Math.floor(n / 100) / 10}K`.replace(".0K", "K");
  if (n < 1000000) return `${Math.floor(n / 1000)}K`;
  return `${Math.floor(n / 100000) / 10}M`.replace(".0M", "M");
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
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

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

export interface XEntry {
  fetchedAt: number;
  details?: XDetails;
  failed?: string;
}

export const X_FRESH_MS = 24 * 60 * 60 * 1000;
export const X_RETRY_MS = 6 * 60 * 60 * 1000;

/** What this device last heard about each post, by status id. Rebuildable. */
export class XStore {
  private entries = new Map<string, XEntry>();

  get(id: string): XEntry | undefined {
    return this.entries.get(id);
  }

  /** A failure keeps the details that were there: yesterday's likes beat none. */
  set(id: string, now: number, details: XDetails | null, failed = ""): void {
    const kept = details ?? this.entries.get(id)?.details;
    const entry: XEntry = { fetchedAt: now };
    if (kept) entry.details = kept;
    if (!details && failed) entry.failed = failed;
    this.entries.set(id, entry);
  }

  isDue(id: string, now: number): boolean {
    const entry = this.entries.get(id);
    if (!entry) return true;
    return now - entry.fetchedAt >= (entry.failed ? X_RETRY_MS : X_FRESH_MS);
  }

  toJSON(): { version: number; posts: Record<string, XEntry> } {
    return { version: 1, posts: Object.fromEntries(this.entries) };
  }

  static fromJSON(data: unknown): XStore {
    const store = new XStore();
    const posts = obj(obj(data)?.posts);
    if (!posts) return store;
    for (const [id, raw] of Object.entries(posts)) {
      const entry = obj(raw);
      if (!entry || typeof entry.fetchedAt !== "number" || !/^\d+$/.test(id)) continue;
      const details = obj(entry.details);
      store.entries.set(id, {
        fetchedAt: entry.fetchedAt,
        ...(details && typeof details.avatar === "string" && typeof details.likes === "number"
          ? { details: details as unknown as XDetails }
          : {}),
        ...(typeof entry.failed === "string" ? { failed: entry.failed } : {}),
      });
    }
    return store;
  }
}

/** What a card is drawn from: the post, and what the lookup added when it has landed. */
export interface XLook {
  post: XPost;
  details: XDetails | null;
  /** Changes whenever the card must be drawn again. */
  stamp: string;
}

export function xLook(post: XPost, entry: XEntry | undefined): XLook {
  const details = entry?.details ?? null;
  return {
    post,
    details,
    stamp: details ? `${entry?.fetchedAt ?? 0}|${details.likes}|${details.avatar}` : "bare",
  };
}
