import { App, normalizePath, requestUrl } from "obsidian";
import { USER_AGENT } from "./capture";
import { hashUrl } from "./core/hash";
import { instagramEmbedUrl, parseInstagramEmbed } from "./core/instagram-post";
import { PostStore, personKey, postKey, postLook, postOf } from "./core/posts";
import type { Post, PostDetails, PostLook, PostSite } from "./core/posts";
import { fxApiUrl, xStatus } from "./core/resolve";
import type { ClippingRecord } from "./core/scan";
import { postCardMode } from "./core/settings";
import type { OrikoSettings } from "./core/settings";
import {
  parseThreadsEmbed,
  parseThreadsPostPage,
  threadsEmbedUrl,
  threadsPostLink,
} from "./core/threads-post";
import { parseFxDetails } from "./core/xpost";
import { parseYoutubeChannel, parseYoutubeWatch, youtubeWatchUrl } from "./core/youtube-post";

const STORE_FILE = "posts.json";
/** The X card's store, from before every post site shared one. Moved in once, then removed. */
const X_STORE_FILE = "x.json";
const AVATAR_DIR = "avatars";
/** Between two asks, of any site: fxtwitter is a community service, and the rest are worth being gentle with. */
const ASK_GAP_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/** What a lookup found: the details, and for a video the channel whose page holds its avatar. */
interface Found {
  details: PostDetails;
  channel?: string;
}

/**
 * The Obsidian half of the post card: asks each site about every post that
 * is due, saves each person's avatar on this device, and remembers the
 * answers. Everything about what a post says and how its card is sized is
 * in core/posts.ts and the site modules beside it.
 */
export class PostService {
  store = new PostStore();
  private running = false;
  private again = false;
  private listeners: Array<() => void> = [];
  /**
   * A saved avatar's address for the wall, made once per save. The adapter
   * can stamp each address it makes, and a card whose address changed would
   * be drawn again on every pass.
   */
  private sources = new Map<string, { savedAt: number; src: string }>();

  constructor(
    private app: App,
    private settings: () => OrikoSettings,
    private cacheDir: string,
    private records: () => readonly ClippingRecord[]
  ) {}

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  private path(name: string): string {
    return normalizePath(`${this.cacheDir}/${name}`);
  }

  async load(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = this.path(STORE_FILE);
    if (await adapter.exists(path)) {
      try {
        this.store = PostStore.fromJSON(JSON.parse(await adapter.read(path)));
      } catch {
        this.store = new PostStore();
      }
      return;
    }
    const old = this.path(X_STORE_FILE);
    if (!(await adapter.exists(old))) return;
    try {
      this.store = PostStore.fromXStore(JSON.parse(await adapter.read(old)));
      await this.save();
      await adapter.remove(old);
    } catch {
      this.store = new PostStore();
    }
  }

  private async save(): Promise<void> {
    await this.app.vault.adapter.write(this.path(STORE_FILE), JSON.stringify(this.store.toJSON()));
  }

  /** What a tile of this clipping is drawn with, or null for anything that is not a post. */
  lookFor(record: ClippingRecord): PostLook | null {
    const post = postOf(record);
    if (!post) return null;
    const entry = this.store.get(postKey(post));
    return postLook(post, entry, this.avatarSource(post, entry?.details));
  }

  private avatarSource(post: Post, details: PostDetails | undefined): string {
    const handle = details?.handle || post.handle;
    const saved = handle ? this.store.avatar(personKey(post.site, handle)) : undefined;
    if (!saved) return "";
    const known = this.sources.get(saved.file);
    if (known && known.savedAt === saved.savedAt) return known.src;
    const src = this.app.vault.adapter.getResourcePath(saved.file);
    this.sources.set(saved.file, { savedAt: saved.savedAt, src });
    return src;
  }

  /**
   * Takes what a clip already learned. Capture asks fxtwitter for an X
   * post's media anyway, so a fresh clip lands with its likes in place.
   */
  seed(site: PostSite, id: string, details: PostDetails): void {
    this.store.set(postKey({ site, id }), Date.now(), details);
    void this.save();
  }

  /**
   * Asks about every post that is due. Skipped outright while community
   * resolvers are off, since asking sends the post's link out; the cards
   * then show what the notes hold, with the author's initial. A site set to
   * Never show is not asked about.
   */
  async refresh(): Promise<void> {
    if (!this.settings().useResolvers) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    } catch {
      // Background work never interrupts the user; the next pass retries.
    } finally {
      this.running = false;
    }
  }

  private async pass(): Promise<void> {
    const seen = new Set<string>();
    let asked = false;
    const gap = async (): Promise<void> => {
      if (asked) await sleep(ASK_GAP_MS);
      asked = true;
    };
    for (const record of this.records()) {
      const post = postOf(record);
      if (!post || postCardMode(this.settings(), post.site) === "never") continue;
      const key = postKey(post);
      if (seen.has(key)) continue;
      seen.add(key);
      const now = Date.now();
      const details = this.store.get(key)?.details;
      if (this.store.isDue(key, now)) {
        await gap();
        const found = await this.ask(post, record.source);
        if (found) await this.saveAvatar(post, found, gap);
      } else if (details && this.avatarDue(post, details, now)) {
        // An answer still fresh, kept from before avatars were saved.
        await this.saveAvatar(post, { details, channel: youtubeChannelOf(details) }, gap);
      } else {
        continue;
      }
      await this.save();
      this.emit();
    }
  }

  private async ask(post: Post, source: string): Promise<Found | null> {
    const key = postKey(post);
    try {
      const found = await this.lookup(post, source);
      if (typeof found === "string") {
        this.store.set(key, Date.now(), null, found);
        return null;
      }
      this.store.set(key, Date.now(), found.details);
      return found;
    } catch (error) {
      this.store.set(key, Date.now(), null, String(error));
      return null;
    }
  }

  /** Each site's way of asking. A string is why it found nothing. */
  private async lookup(post: Post, source: string): Promise<Found | string> {
    switch (post.site) {
      case "x": {
        const status = xStatus(source);
        if (!status) return "not a post";
        const response = await requestUrl({ url: fxApiUrl(status), method: "GET", throw: false });
        if (response.status < 200 || response.status >= 300) return `HTTP ${response.status}`;
        const details = parseFxDetails(response.json);
        return details ? { details } : "not found";
      }
      case "instagram": {
        const details = parseInstagramEmbed(await this.page(instagramEmbedUrl(post.id)));
        return details ? { details } : "not found";
      }
      case "threads": {
        // A share link names neither the person nor the post until followed.
        const target = threadsPostLink(source) ?? parseThreadsPostPage(await this.page(source));
        if (!target) return "not found";
        await sleep(ASK_GAP_MS);
        const details = parseThreadsEmbed(await this.page(threadsEmbedUrl(target)));
        return details ? { details } : "not found";
      }
      case "youtube": {
        const watched = parseYoutubeWatch(await this.page(youtubeWatchUrl(post.id)));
        return watched ? { details: watched.details, channel: watched.channel } : "not found";
      }
    }
  }

  /** A page's text, asked as Oriko: Instagram and Threads serve their embeds to anything but a browser. */
  private async page(url: string): Promise<string> {
    const response = await requestUrl({
      url,
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    return response.text;
  }

  private avatarDue(post: Post, details: PostDetails, now: number): boolean {
    const handle = details.handle || post.handle;
    return Boolean(handle) && this.store.avatarDue(personKey(post.site, handle), now);
  }

  /**
   * Saves the person's avatar on this device, once a week at most. Instagram
   * and Threads hand out addresses that stop working within days; a saved
   * copy keeps the card whole, offline too. A failure leaves the initial.
   */
  private async saveAvatar(post: Post, found: Found, gap: () => Promise<void>): Promise<void> {
    if (!this.avatarDue(post, found.details, Date.now())) return;
    const person = personKey(post.site, found.details.handle || post.handle);
    try {
      let url = found.details.avatar;
      if (post.site === "youtube") {
        if (!found.channel) return;
        await gap();
        url = parseYoutubeChannel(await this.page(found.channel));
      }
      if (!url) return;
      await gap();
      const response = await requestUrl({
        url,
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return;
      const adapter = this.app.vault.adapter;
      const dir = this.path(AVATAR_DIR);
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      const file = normalizePath(`${dir}/${post.site}-${hashUrl(person)}.${extensionFor(response.headers)}`);
      const previous = this.store.avatar(person);
      await adapter.writeBinary(file, response.arrayBuffer);
      if (previous && previous.file !== file && (await adapter.exists(previous.file))) {
        await adapter.remove(previous.file);
      }
      this.store.setAvatar(person, { file, url, savedAt: Date.now() });
    } catch {
      // The initial stands in; the next week's pass tries again.
    }
  }
}

/** A channel's page, from the handle the watch page gave. */
function youtubeChannelOf(details: PostDetails): string | undefined {
  return details.handle?.startsWith("@") ? `https://www.youtube.com/${details.handle}` : undefined;
}

function extensionFor(headers: Record<string, string>): string {
  const type = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
}
