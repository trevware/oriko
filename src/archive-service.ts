import { App, Notice, TFile, normalizePath, requestUrl } from "obsidian";
import { ArchiveDeps, archiveAll } from "./archive";
import { MediaCache } from "./cache";
import { readDimensions } from "./dimensions";
import {
  absolutePath,
  conversionAvailable,
  convertImageToPng,
  downloadSourceVideo,
  extractVideoFrame,
  ytdlpPath,
} from "./convert";
import { posterPath, renderPoster, renderThumbnail, thumbPath } from "./derive";
import { extensionOf, needsPreview } from "./formats";
import { ClippingIndex } from "./index-store";
import { hashUrl } from "./hash";
import { dedupeMedia, normalizeUrl, sourceVideoKeyFor } from "./normalize";
import { supportsSourceDownload } from "./resolve";
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

      // A format Chromium cannot decode is unusable until it has a preview,
      // so that takes priority over the ordinary still.
      if (needsPreview(extensionOf(entry.file))) {
        const preview = await this.renderPreview(entry.file, entry.kind);
        if (preview) {
          this.cache.setThumb(entry.key, preview.path, preview.width, preview.height);
          derived++;
        }
        continue;
      }

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

  /** Reports archive progress for a single record, for the capture bar. */
  onRecordProgress: ((completed: number, total: number) => void) | null = null;

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
    // Runs regardless of whether anything inline is outstanding: on a
    // re-archive every ref is already on disk, and the post's own video
    // would otherwise never be fetched.
    await this.archiveSourceVideo(record, retryFailed);

    if (canonical.length === 0) {
      await this.resolvePageCover(record, retryFailed);
      await this.deriveAssets();
      await this.saveCache();
      this.emit();
      return;
    }

    await this.ensureFolder();
    const outcomes = await archiveAll(canonical, record.source, this.deps(), 4, (done, total) =>
      this.onRecordProgress?.(done, total)
    );
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
   * Pulls the video out of a post whose page never publishes it, using a
   * local yt-dlp. Instagram and X hide their media behind client-side
   * requests, so this is the only route that does not involve a third-party
   * mirror. Without yt-dlp installed the clipping simply keeps its poster.
   */
  private async archiveSourceVideo(
    record: ClippingRecord,
    retryFailed: boolean
  ): Promise<void> {
    if (!record.source || !supportsSourceDownload(record.source)) return;

    const key = sourceVideoKeyFor(record.source);
    const existing = this.cache.get(key);
    if (existing?.file) return;
    if (existing?.failed && !retryFailed) return;

    if (!conversionAvailable() || !ytdlpPath()) {
      // Recorded rather than skipped silently, so a missing tool is
      // diagnosable from the cache instead of looking like nothing happened.
      this.cache.mergeOutcome({ key, kind: "video", failed: "yt-dlp not available" });
      return;
    }

    const result = await downloadSourceVideo(record.source);
    if (!result) {
      this.cache.mergeOutcome({ key, kind: "video", failed: "yt-dlp found no video" });
      return;
    }

    if (result.data.byteLength > this.settings().maxBytes) {
      this.cache.mergeOutcome({
        key,
        kind: "video",
        failed: `too large (${result.data.byteLength} bytes)`,
      });
      return;
    }

    await this.ensureFolder();
    const folder = normalizePath(this.settings().attachmentFolder);
    const path = normalizePath(`${folder}/${hashUrl(key)}-video.${result.extension}`);

    if (!(await this.app.vault.adapter.exists(path))) {
      await this.app.vault.createBinary(path, result.data);
    }

    this.cache.mergeOutcome({
      key,
      kind: "video",
      file: path,
      bytes: result.data.byteLength,
    });
  }

  /**
   * Produces a PNG the grid can actually paint for a format Chromium will
   * not decode. Images go through sips, which reads HEIC, TIFF, EXR and
   * every major RAW; unplayable video containers give up one frame to
   * ffmpeg. Missing tools are not an error: the original stays archived and
   * the clipping simply has no tile.
   */
  private async renderPreview(
    file: string,
    kind: "image" | "video"
  ): Promise<{ path: string; width: number; height: number } | null> {
    if (!conversionAvailable()) return null;

    const target = `${file.replace(/\.[^./]+$/, "")}.preview.png`;
    const normalizedTarget = normalizePath(target);

    if (!(await this.app.vault.adapter.exists(normalizedTarget))) {
      const from = absolutePath(this.app.vault, normalizePath(file));
      const to = absolutePath(this.app.vault, normalizedTarget);
      if (!from || !to) return null;

      const ok =
        kind === "video"
          ? await extractVideoFrame(from, to)
          : await convertImageToPng(from, to);
      if (!ok) return null;
    }

    // Read the dimensions back off the PNG the tool just wrote.
    const written = this.app.vault.getAbstractFileByPath(normalizedTarget);
    if (!(written instanceof TFile)) return null;
    const dimensions = readDimensions(await this.app.vault.readBinary(written));

    return {
      path: normalizedTarget,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
    };
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
