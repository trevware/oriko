import { App, normalizePath, requestUrl } from "obsidian";
import { fxApiUrl } from "./core/resolve";
import type { ClippingRecord } from "./core/scan";
import type { OrikoSettings } from "./core/settings";
import { XStore, parseFxDetails, xLook, xPostOf } from "./core/xpost";
import type { XDetails, XLook } from "./core/xpost";

const STORE_FILE = "x.json";
/** Between two asks of fxtwitter, a community service worth being gentle with. */
const ASK_GAP_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * The Obsidian half of the X look: asks fxtwitter for each post's avatar,
 * badge and likes, and remembers the answers on this device. Everything
 * about what a post says and how its card is sized is in core/xpost.ts.
 */
export class XService {
  store = new XStore();
  private running = false;
  private again = false;
  private listeners: Array<() => void> = [];

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

  private storePath(): string {
    return normalizePath(`${this.cacheDir}/${STORE_FILE}`);
  }

  async load(): Promise<void> {
    const path = this.storePath();
    if (!(await this.app.vault.adapter.exists(path))) return;
    try {
      this.store = XStore.fromJSON(JSON.parse(await this.app.vault.adapter.read(path)));
    } catch {
      this.store = new XStore();
    }
  }

  private async save(): Promise<void> {
    await this.app.vault.adapter.write(this.storePath(), JSON.stringify(this.store.toJSON()));
  }

  /** What a tile of this clipping is drawn with, or null for anything that is not a post. */
  lookFor(record: ClippingRecord): XLook | null {
    const post = xPostOf(record);
    return post ? xLook(post, this.store.get(post.id)) : null;
  }

  /**
   * Takes what a clip already learned. Capture asks fxtwitter for the post's
   * media anyway, so a fresh clip lands with its avatar and likes in place
   * and never shows a bare card first.
   */
  seed(id: string, details: XDetails): void {
    this.store.set(id, Date.now(), details);
    void this.save();
  }

  /**
   * Asks about every post that is due. Skipped outright while community
   * resolvers are off, since asking is sending the post's link to fxtwitter;
   * the cards then show what the notes hold, with the author's initial.
   */
  async refresh(): Promise<void> {
    if (!this.settings().useResolvers || this.settings().xCards === "never") return;
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
    for (const record of this.records()) {
      const post = xPostOf(record);
      if (!post || seen.has(post.id)) continue;
      seen.add(post.id);
      if (!this.store.isDue(post.id, Date.now())) continue;
      if (asked) await sleep(ASK_GAP_MS);
      asked = true;
      await this.ask(post.handle, post.id);
      await this.save();
      this.emit();
    }
  }

  private async ask(user: string, id: string): Promise<void> {
    try {
      const response = await requestUrl({ url: fxApiUrl({ user, id }), method: "GET", throw: false });
      if (response.status < 200 || response.status >= 300) {
        this.store.set(id, Date.now(), null, `HTTP ${response.status}`);
        return;
      }
      const details = parseFxDetails(response.json);
      this.store.set(id, Date.now(), details, details ? "" : "not found");
    } catch (error) {
      this.store.set(id, Date.now(), null, String(error));
    }
  }
}
