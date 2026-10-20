import { App, TFile, Vault, normalizePath } from "obsidian";
import { ColorStore } from "./core/color-store";
import { paletteOfBlob } from "./core/swatch-strip";
import type { Swatch } from "./core/swatches";

const STORE_FILE = "colors.json";

/** Between two reads, so a first pass over a big wall never takes a frame from it. */
const READ_GAP_MS = 24;

/**
 * How often a long pass tells the wall what it has learned. Each telling
 * can re-rank a wall that is filtered by colour, so it is kept to a few a
 * minute rather than one per picture.
 */
const EMIT_EVERY_MS = 1500;

/** And how often it saves, so a pass cut short by closing Obsidian keeps most of its work. */
const SAVE_EVERY = 50;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * The Obsidian half of colour search: reads the palette of every picture the
 * wall shows, a few at a time in the background, and keeps them in
 * colors.json on this device. What the palettes mean is core/colors.ts.
 *
 * Only pictures the wall has asked about are read, and only local ones: a
 * picture still on the origin server would taint the canvas, and it will be
 * asked about again once it has been archived.
 */
export class ColorService {
  store = new ColorStore();
  private queue = new Set<string>();
  private running = false;
  private stopped = false;
  private listeners: Array<() => void> = [];

  constructor(
    private app: App,
    private cacheDir: string
  ) {}

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  private path(): string {
    return normalizePath(`${this.cacheDir}/${STORE_FILE}`);
  }

  async load(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = this.path();
    if (!(await adapter.exists(path))) return;
    try {
      this.store = ColorStore.fromJSON(JSON.parse(await adapter.read(path)));
    } catch {
      this.store = new ColorStore();
    }
  }

  private async save(): Promise<void> {
    await this.app.vault.adapter.write(this.path(), JSON.stringify(this.store.toJSON()));
  }

  /** Stops the pass after the picture it is on, for unload. */
  stop(): void {
    this.stopped = true;
    this.queue.clear();
  }

  get(path: string): Swatch[] | undefined {
    return this.store.get(path);
  }

  /**
   * Asks for these pictures' palettes. Cheap enough to call on every repaint:
   * a picture already read, and not changed since, is skipped without being
   * opened.
   */
  want(paths: Iterable<string>): void {
    if (this.stopped) return;
    for (const path of paths) {
      if (this.queue.has(path)) continue;
      const file = this.app.vault.getFileByPath(path);
      if (file && this.store.isDue(path, file.stat.mtime)) this.queue.add(path);
    }
    if (this.queue.size > 0) void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let read = 0;
    let told = Date.now();
    try {
      while (this.queue.size > 0 && !this.stopped) {
        const [path] = this.queue;
        this.queue.delete(path);
        const file = this.app.vault.getFileByPath(path);
        if (!file || !this.store.isDue(path, file.stat.mtime)) continue;

        this.store.set(path, file.stat.mtime, await this.read(file));
        read++;
        if (read % SAVE_EVERY === 0) await this.save();
        if (Date.now() - told >= EMIT_EVERY_MS) {
          told = Date.now();
          this.emit();
        }
        await sleep(READ_GAP_MS);
      }
      if (read > 0) {
        this.prune();
        await this.save();
        this.emit();
      }
    } catch {
      // Background work never interrupts the user; the next want() retries.
    } finally {
      this.running = false;
    }
  }

  /** Forgets pictures that are gone from the vault, so the file stays the size of the wall. */
  private prune(): void {
    const keep = new Set<string>();
    for (const path of this.store.paths()) {
      if (this.app.vault.getFileByPath(path)) keep.add(path);
    }
    this.store.prune(keep);
  }

  private async read(file: TFile): Promise<Swatch[]> {
    return await paletteOfFile(this.app.vault, file);
  }
}

/**
 * A picture's palette, or an empty one when it cannot be read.
 *
 * From the bytes, never from an <img> on the file: an `app://` resource is
 * cross-origin to the page, so the canvas is tainted and the read comes back
 * empty. The detail view's palette row reads through here for that reason,
 * and so that it and the colour facet cannot disagree about a picture.
 */
export async function paletteOfFile(vault: Vault, file: TFile): Promise<Swatch[]> {
  try {
    const svg = file.extension.toLowerCase() === "svg";
    return await paletteOfBlob(
      new Blob([await vault.readBinary(file)], { type: svg ? "image/svg+xml" : "" })
    );
  } catch {
    return [];
  }
}
