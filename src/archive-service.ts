import { App, Notice, TFile, normalizePath, requestUrl } from "obsidian";
import { ArchiveDeps, archiveAll } from "./archive";
import { MediaCache } from "./cache";
import { posterPath, renderPoster, renderThumbnail, thumbPath } from "./derive";
import { ClippingIndex } from "./index-store";
import { dedupeMedia, normalizeUrl } from "./normalize";
import type { CanonicalMedia } from "./normalize";
import { extractPageImage, knownHostThumbnail } from "./page-cover";
import type { ClippingRecord } from "./scan";
import type { ClippingsGridSettings } from "./settings";

const CACHE_FILE = "cache.json";

export interface ArchiveSummary {
  ok: number;
  failed: number;
}

export class ArchiveService {
  cache = new MediaCache();
  private running = false;
  private listeners: Array<() => void> = [];

  constructor(
    private app: App,
    private index: ClippingIndex,
    private settings: () => ClippingsGridSettings,
    private cacheDir: string
  ) {}

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  private cachePath(): string {
    return normalizePath(`${this.cacheDir}/${CACHE_FILE}`);
  }

  async loadCache(): Promise<void> {
    const path = this.cachePath();
    if (!(await this.app.vault.adapter.exists(path))) return;
    try {
      this.cache = MediaCache.fromJSON(JSON.parse(await this.app.vault.adapter.read(path)));
    } catch {
      this.cache = new MediaCache();
    }
  }

  async saveCache(): Promise<void> {
    await this.app.vault.adapter.write(this.cachePath(), JSON.stringify(this.cache.toJSON()));
  }

  private async ensureFolder(): Promise<void> {
    const folder = normalizePath(this.settings().attachmentFolder);
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }
  }

  private deps(): ArchiveDeps {
    return {
      fetch: async (url, headers) => {
        const response = await requestUrl({ url, method: "GET", headers, throw: false });
        return {
          status: response.status,
          arrayBuffer: response.arrayBuffer,
          contentType: response.headers?.["content-type"],
        };
      },
      exists: (path) => this.app.vault.adapter.exists(normalizePath(path)),
      write: async (path, data) => {
        await this.app.vault.createBinary(normalizePath(path), data);
      },
      folder: normalizePath(this.settings().attachmentFolder),
      maxBytes: this.settings().maxBytes,
    };
  }

  private static mimeFor(path: string): string {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const map: Record<string, string> = {
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      svg: "image/svg+xml",
    };
    return map[ext] ?? "application/octet-stream";
  }

  /**
   * Loads an archived file as a blob: URL rather than an app:// resource
   * URL. app:// is cross-origin to the page, which taints the canvas and
   * makes toBlob throw; blob: is same-origin and does not.
   */
  private async blobUrl(path: string): Promise<{ url: string; revoke: () => void } | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return null;
    const data = await this.app.vault.readBinary(file);
    const url = URL.createObjectURL(new Blob([data], { type: ArchiveService.mimeFor(path) }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }

  /**
   * Generates thumbnails and video posters for anything archived but not yet
   * derived. Separate from downloading so a failed render never loses the
   * original, and so it can be re-run cheaply.
   */
  async deriveAssets(): Promise<void> {
    const width = this.settings().thumbnailWidth;
    let derived = 0;

    for (const entry of this.cache.entries()) {
      if (!entry.file || entry.thumb || entry.failed) continue;
      // Tiles paint originals, so a still is only worth generating for the
      // two things that need one: posting a video and freezing a GIF.
      if (entry.kind !== "video" && !/\.gif$/i.test(entry.file)) continue;

      const source = await this.blobUrl(entry.file);
      if (!source) continue;

      const target = entry.kind === "video" ? posterPath(entry.file) : thumbPath(entry.file);
      try {
        const rendered =
          entry.kind === "video"
            ? await renderPoster(source.url, width)
            : await renderThumbnail(source.url, width);
        if (!rendered) continue;

        if (!(await this.app.vault.adapter.exists(normalizePath(target)))) {
          await this.app.vault.createBinary(normalizePath(target), rendered.data);
        }
        this.cache.setThumb(entry.key, target, rendered.width, rendered.height);
        derived++;
      } catch {
        // A failed render is recoverable: the original is already archived
        // and deriveAssets re-runs on the next pass.
        continue;
      } finally {
        source.revoke();
      }
    }

    if (derived > 0) this.emit();
  }

  /**
   * @param retryFailed re-attempt refs that failed before. Off for the
   * background pass, so a page that returns HTML is not re-downloaded on
   * every launch; on for the explicit command, so a transient outage or a
   * network change can be recovered from.
   */
  async archiveRecord(record: ClippingRecord, retryFailed = false): Promise<void> {
    const canonical = dedupeMedia(record.media).filter((m) => {
      const entry = this.cache.get(m.key);
      if (entry?.file) return false;
      return retryFailed || !entry?.failed;
    });
    if (canonical.length === 0) {
      await this.resolvePageCover(record, retryFailed);
      return;
    }

    await this.ensureFolder();
    const outcomes = await archiveAll(canonical, record.source, this.deps(), 4);
    for (const outcome of outcomes) this.cache.mergeOutcome(outcome);

    // Everything inline failed, so the page's own preview image is the only
    // thing left that could cover this tile.
    if (!outcomes.some((o) => o.file)) {
      await this.resolvePageCover(record, retryFailed);
    }

    await this.deriveAssets();
    await this.saveCache();
    this.emit();
  }

  /**
   * Finds a cover for a clipping whose body has no usable image: a known
   * video host's thumbnail, resolved without a request, or the page's
   * declared og:image. Cached under the source URL so it is fetched once.
   */
  private async resolvePageCover(record: ClippingRecord, retryFailed: boolean): Promise<void> {
    if (!record.source) return;

    const key = normalizeUrl(record.source);
    const existing = this.cache.get(key);
    if (existing?.file) return;
    if (existing?.failed && !retryFailed) return;

    // Only clippings with nothing else to show reach here, so an inline hit
    // means the page cover is unnecessary.
    const hasInline = dedupeMedia(record.media).some((m) => this.cache.get(m.key)?.file);
    if (hasInline) return;

    const known = knownHostThumbnail(record.source);
    let candidate: CanonicalMedia | null = known
      ? { key, url: known.url, kind: "image", alt: record.title, fallbacks: known.fallbacks }
      : null;

    if (!candidate) {
      const imageUrl = await this.fetchPageImage(record.source);
      if (imageUrl) {
        candidate = { key, url: imageUrl, kind: "image", alt: record.title };
      }
    }

    if (!candidate) {
      this.cache.mergeOutcome({ key, kind: "image", failed: "no preview image" });
      return;
    }

    await this.ensureFolder();
    const [outcome] = await archiveAll([candidate], record.source, this.deps(), 1);
    if (outcome) this.cache.mergeOutcome(outcome);
  }

  private async fetchPageImage(pageUrl: string): Promise<string | null> {
    try {
      const response = await requestUrl({ url: pageUrl, method: "GET", throw: false });
      if (response.status < 200 || response.status >= 300) return null;
      const type = response.headers?.["content-type"] ?? "";
      if (type && !type.toLowerCase().includes("html")) return null;
      return extractPageImage(response.text, pageUrl);
    } catch {
      return null;
    }
  }

  /**
   * Background pass: fills in whatever is missing without blocking or
   * announcing itself. The grid shows remote covers meanwhile and swaps to
   * local ones as they land.
   */
  async archiveMissing(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const record of this.index.records()) {
        await this.archiveRecord(record, false);
      }
      await this.deriveAssets();
      await this.saveCache();
    } catch {
      // Background work never interrupts the user; the next pass retries.
    } finally {
      this.running = false;
    }
  }

  async archiveEverything(): Promise<ArchiveSummary> {
    if (this.running) {
      new Notice("Clippings grid: already archiving");
      return this.summary();
    }
    this.running = true;
    try {
      for (const record of this.index.records()) {
        await this.archiveRecord(record, true);
      }
      // Catches anything downloaded on an earlier run that never got a
      // thumbnail, for instance because the view was closed at the time.
      await this.deriveAssets();
      await this.saveCache();
    } finally {
      this.running = false;
    }
    return this.summary();
  }

  summary(): ArchiveSummary {
    let ok = 0;
    let failed = 0;
    for (const entry of this.cache.entries()) {
      if (entry.failed) failed++;
      else if (entry.file) ok++;
    }
    return { ok, failed };
  }

  notifyResult(result: ArchiveSummary): void {
    new Notice(
      `Clippings grid: ${result.ok} media archived, ${result.failed} failed`
    );
  }
}
