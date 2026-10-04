import { App, normalizePath, requestUrl } from "obsidian";
import type { MediaCache } from "./core/cache";
import { sourceVideoKeyFor } from "./core/normalize";
import type { ClippingRecord } from "./core/scan";
import type { OrikoSettings } from "./core/settings";
import {
  SteamStore,
  appDetailsUrl,
  parseAppDetails,
  pricingRegion,
  steamAppId,
  steamFiles,
  steamFolder,
  steamLook,
} from "./core/steam";
import type { SteamApp, SteamLook } from "./core/steam";

const STORE_FILE = "steam.json";
/**
 * Between two asks of the store API. Steam allows a couple of hundred a
 * five-minute window; a vault catching up on a long wishlist should stay
 * well inside that rather than find the edge.
 */
const ASK_GAP_MS = 1500;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * The Obsidian half of the Steam look: asks the store API about each game
 * clipped, remembers the answer on this device, and saves the art into the
 * vault. Everything about what to ask, what to save and how to draw it is in
 * core/steam.ts.
 */
export class SteamService {
  store = new SteamStore();
  private running = false;
  /** Asked for while a pass was running, so the pass goes round once more. */
  private again = false;
  private listeners: Array<() => void> = [];

  constructor(
    private app: App,
    private settings: () => OrikoSettings,
    private cacheDir: string,
    private media: () => MediaCache,
    /** Read fresh on every pass, so a pass asked for mid-run sees new clippings. */
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
      this.store = SteamStore.fromJSON(JSON.parse(await this.app.vault.adapter.read(path)));
    } catch {
      this.store = new SteamStore();
    }
  }

  private async save(): Promise<void> {
    await this.app.vault.adapter.write(this.storePath(), JSON.stringify(this.store.toJSON()));
  }

  /** The country to price in, from the time zone and then the locales. See pricingRegion. */
  private region(): string {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    return pricingRegion(resolved.timeZone ?? "", [...navigator.languages, resolved.locale]);
  }

  private folder(): string {
    return normalizePath(this.settings().attachmentFolder);
  }

  private exists(path: string): boolean {
    return this.app.vault.getFileByPath(normalizePath(path)) !== null;
  }

  /**
   * What a tile of this clipping is drawn with: a store card, "pending" while
   * this device has not yet heard from Steam about the game, or null for an
   * ordinary tile, which is also what a game Steam could not tell us about
   * falls back to.
   */
  lookFor(record: ClippingRecord): SteamLook | "pending" | null {
    const id = steamAppId(record.source);
    if (!id) return null;
    const entry = this.store.get(id);
    if (!entry) return "pending";
    if (!entry.app) return null;
    const trailer = this.media().get(sourceVideoKeyFor(record.source))?.file ?? "";
    return steamLook(entry.app, entry.fetchedAt, this.folder(), (p) => this.exists(p), trailer);
  }

  /**
   * Asks Steam about every game that is due, and saves any art not yet in the
   * vault. Each game redraws as it lands, so a long wishlist fills in card by
   * card rather than all at the end.
   *
   * @param saveArt off when the user has turned automatic downloads off: the
   * cards still appear, drawn from Steam's own copies.
   */
  async refresh(saveArt: boolean): Promise<void> {
    // Off means a plain tile and a plain detail view, so nothing to ask for.
    if (this.settings().steamCards === "never") return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.pass(this.records(), saveArt);
      } while (this.again);
    } catch {
      // Background work never interrupts the user; the next pass retries.
    } finally {
      this.running = false;
    }
  }

  private async pass(records: readonly ClippingRecord[], saveArt: boolean): Promise<void> {
    const ids = [...new Set(records.map((r) => steamAppId(r.source)).filter(Boolean))] as string[];
    const region = this.region();
    let asked = false;

    for (const id of ids) {
      let changed = false;
      if (this.store.isDue(id, Date.now(), region)) {
        if (asked) await sleep(ASK_GAP_MS);
        asked = true;
        await this.ask(id, region);
        await this.save();
        changed = true;
      }
      const app = this.store.app(id);
      if (app && saveArt && (await this.saveArt(app))) changed = true;
      if (changed) this.emit();
    }
  }

  private async ask(id: string, region: string): Promise<void> {
    try {
      const response = await requestUrl({
        url: appDetailsUrl(id, region),
        method: "GET",
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) {
        this.store.set(id, Date.now(), null, `HTTP ${response.status}`, region);
        return;
      }
      const app = parseAppDetails(response.json, id);
      this.store.set(id, Date.now(), app, app ? "" : "not on the store", region);
    } catch (error) {
      this.store.set(id, Date.now(), null, String(error), region);
    }
  }

  /** Saves whatever of this game's art is not in the vault yet. True if any landed. */
  private async saveArt(app: SteamApp): Promise<boolean> {
    const missing = steamFiles(app, this.folder()).filter((file) => !this.exists(file.path));
    if (missing.length === 0) return false;

    const folder = normalizePath(steamFolder(this.folder(), app.id));
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }

    let saved = false;
    for (const file of missing) {
      try {
        const response = await requestUrl({ url: file.url, method: "GET", throw: false });
        if (response.status < 200 || response.status >= 300) continue;
        const type = response.headers?.["content-type"] ?? "";
        if (type && !type.toLowerCase().startsWith("image/")) continue;
        const bytes = response.arrayBuffer;
        if (bytes.byteLength === 0 || bytes.byteLength > this.settings().maxBytes) continue;
        // Checked again: another device's copy can arrive by sync mid-pass.
        if (this.exists(file.path)) continue;
        await this.app.vault.createBinary(normalizePath(file.path), bytes);
        saved = true;
      } catch {
        // One picture failing is no reason to give up on the rest.
      }
    }
    return saved;
  }
}
