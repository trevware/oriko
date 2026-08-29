import { App, Notice, TFile, normalizePath, requestUrl } from "obsidian";
import { ArchiveDeps, archiveAll, sourceVideoCandidates } from "./archive";
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
import { posterPath, previewPath, renderPoster, renderThumbnail, thumbPath } from "./derive";
import { extensionOf, needsPreview } from "./formats";
import { ClippingIndex } from "./index-store";
import { hashUrl } from "./hash";
import { dedupeMedia, normalizeUrl, sourceVideoKeyFor } from "./normalize";
import { supportsSourceDownload } from "./resolve";
import type { CanonicalMedia } from "./normalize";
import { extractPageImage, knownHostThumbnail, needsPageCover } from "./page-cover";
import type { ClippingRecord } from "./scan";
import type { PowerGridSettings } from "./settings";

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
    private settings: () => PowerGridSettings,
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
   *
   * `keys` scopes the pass to just-archived entries, so capture is never
   * blocked behind the whole vault's backlog; the background pass runs
   * unscoped and works through everything.
   */
  async deriveAssets(keys?: ReadonlySet<string>): Promise<void> {
    const width = this.settings().thumbnailWidth;
    let derived = 0;

    for (const entry of this.cache.entries()) {
      if (keys && !keys.has(entry.key)) continue;
      if (!entry.file || entry.thumb) continue;

      // A format Chromium cannot decode is unusable until it has a preview,
      // so that takes priority over the ordinary still. Tiles paint plain
      // images as originals, so a still is only worth generating for the two
      // things that need one: posting a video and freezing a GIF.
      const wantsPreview = needsPreview(extensionOf(entry.file));
      const target = wantsPreview
        ? previewPath(entry.file)
        : entry.kind === "video"
          ? posterPath(entry.file)
          : /\.gif$/i.test(entry.file)
            ? thumbPath(entry.file)
            : null;
      if (!target) continue;

      // The cache is per-device but derived files sync, so another device
      // may already have rendered this. Adopting the file skips the render
      // and outranks a recorded failure, which was about this device only.
      if (await this.adoptDerived(entry.key, target)) {
        derived++;
        continue;
      }

      if (entry.failed || entry.thumbFailed) continue;

      if (wantsPreview) {
        const preview = await this.renderPreview(entry.file, entry.kind);
        if (preview) {
          this.cache.setThumb(entry.key, preview.path, preview.width, preview.height);
          derived++;
        } else if (conversionAvailable()) {
          // A missing tool is not a property of the file; a failed
          // conversion is, and retrying it every pass buys nothing.
          this.cache.setThumbFailed(entry.key, "conversion failed");
        }
        continue;
      }

      const source = await this.blobUrl(entry.file);
      if (!source) continue;

      try {
        const rendered =
          entry.kind === "video"
            ? await renderPoster(source.url, width)
            : await renderThumbnail(source.url, width);
        if (!rendered) {
          // Recorded so a video this device cannot decode is not repaid its
          // full timeout on every pass. The explicit archive-everything
          // command clears these marks, and adoption above outranks them.
          this.cache.setThumbFailed(entry.key, "render failed");
          continue;
        }

        if (!(await this.app.vault.adapter.exists(normalizePath(target)))) {
          await this.app.vault.createBinary(normalizePath(target), rendered.data);
        }
        this.cache.setThumb(entry.key, target, rendered.width, rendered.height);
        derived++;
      } catch {
        this.cache.setThumbFailed(entry.key, "render failed");
        continue;
      } finally {
        source.revoke();
      }
    }

    if (derived > 0) this.emit();
  }

  /**
   * Records an already-derived file that synced in from another device. The
   * derived file's dimensions are the scaled render, not the intrinsic size,
   * but they carry the same aspect ratio, which is all layout needs.
   */
  private async adoptDerived(key: string, target: string): Promise<boolean> {
    const path = normalizePath(target);
    if (!(await this.app.vault.adapter.exists(path))) return false;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const dimensions = readDimensions(await this.app.vault.readBinary(file));
    this.cache.setThumb(key, path, dimensions?.width ?? 0, dimensions?.height ?? 0);
    return true;
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
      // An embedded file in the vault is already archived by definition.
      if (!/^https?:\/\//i.test(m.url)) return false;
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
    await this.downloadSourceVideoFor(record.source, retryFailed);
  }

  /**
   * Fetches a post's own video and returns its vault path. Takes a bare URL
   * rather than a record, so capture can archive before writing the note and
   * embed the local file instead of pointing at a URL that will expire.
   */
  async downloadSourceVideoFor(
    source: string,
    retryFailed: boolean
  ): Promise<string | null> {
    if (!source || !supportsSourceDownload(source)) return null;

    const key = sourceVideoKeyFor(source);
    const existing = this.cache.get(key);
    if (existing?.file) return existing.file;

    // The attachment folder syncs but the cache does not: a device that
    // cannot run yt-dlp still adopts the video another device downloaded.
    // Checked before any recorded failure is believed, because "yt-dlp not
    // available" was a fact about this device, not about the post.
    const folder = normalizePath(this.settings().attachmentFolder);
    for (const candidate of sourceVideoCandidates(key, folder)) {
      const path = normalizePath(candidate);
      if (await this.app.vault.adapter.exists(path)) {
        this.cache.mergeOutcome({ key, kind: "video", file: path });
        return path;
      }
    }

    if (existing?.failed && !retryFailed) return null;

    if (!conversionAvailable() || !ytdlpPath()) {
      // Recorded rather than skipped silently, so a missing tool is
      // diagnosable from the cache instead of looking like nothing happened.
      this.cache.mergeOutcome({ key, kind: "video", failed: "yt-dlp not available" });
      return null;
    }

    const result = await downloadSourceVideo(source);
    if (!result) {
      this.cache.mergeOutcome({ key, kind: "video", failed: "yt-dlp found no video" });
      return null;
    }

    if (result.data.byteLength > this.settings().maxBytes) {
      this.cache.mergeOutcome({
        key,
        kind: "video",
        failed: `too large (${result.data.byteLength} bytes)`,
      });
      return null;
    }

    await this.ensureFolder();
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
    return path;
  }

  /**
   * Archives a resolved link's media before any note exists, so the note can
   * be written with local embeds rather than URLs. Returns the vault path for
   * each URL that landed; anything missing simply stays remote in the note.
   */
  async archiveResolved(
    source: string,
    media: Array<{ url: string; kind: "image" | "video" }>,
    onProgress?: (done: number, total: number) => void,
    onStage?: (label: string) => void
  ): Promise<{ byUrl: Map<string, string>; sourceVideo: string | null }> {
    const byUrl = new Map<string, string>();
    const canonical: CanonicalMedia[] = media.map((m) => ({
      key: normalizeUrl(m.url),
      url: m.url,
      kind: m.kind,
      alt: "",
    }));

    let haveVideo = false;

    if (canonical.length > 0) {
      await this.ensureFolder();
      const outcomes = await archiveAll(canonical, source, this.deps(), 4, onProgress);
      outcomes.forEach((outcome, index) => {
        this.cache.mergeOutcome(outcome);
        if (!outcome.file) return;
        byUrl.set(media[index].url, outcome.file);
        if (outcome.kind === "video") haveVideo = true;
      });
    }

    // Only reach for yt-dlp when the resolver did not already produce the
    // video. fxtwitter hands back X's mp4 directly, and fetching it twice
    // would archive the same clip under two names.
    let sourceVideo: string | null = null;
    if (!haveVideo && supportsSourceDownload(source)) {
      onStage?.("Fetching video…");
      sourceVideo = await this.downloadSourceVideoFor(source, true);
    }

    // Scoped to what was just archived: capture must never wait behind the
    // whole vault's derive backlog, which the background pass owns.
    onStage?.("Rendering previews…");
    const derivable = new Set(canonical.map((m) => m.key));
    if (source) derivable.add(sourceVideoKeyFor(source));
    await this.deriveAssets(derivable);
    await this.saveCache();
    this.emit();

    return { byUrl, sourceVideo };
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

    const normalizedTarget = normalizePath(previewPath(file));

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

    if (!needsPageCover(record, (k) => this.cache.get(k)?.file || undefined)) return;

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
      new Notice("Power Grid: already archiving");
      return this.summary();
    }
    this.running = true;
    try {
      // The explicit command retries everything, hopeless renders included.
      this.cache.clearThumbFailures();
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
      `Power Grid: ${result.ok} media archived, ${result.failed} failed`
    );
  }
}
