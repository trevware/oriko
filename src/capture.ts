import { App, Notice, TFile, normalizePath, requestUrl } from "obsidian";
import type { ArchiveService } from "./archive-service";
import type { ClippingIndex } from "./index-store";
import {
  ResolvedLink,
  buildNote,
  cleanUrl,
  directMediaKind,
  directMediaLink,
  fxApiUrl,
  isHttpUrl,
  noteNameFor,
  parseFxTweet,
  parsePageMeta,
  xStatus,
} from "./resolve";
import type { ProgressState } from "./progress";
import type { ClippingsGridSettings } from "./settings";

/**
 * Identifies the plugin honestly rather than impersonating a known crawler.
 * Enough for sites that gate Open Graph tags on a non-browser agent, such
 * as Threads; X withholds them from everything but named crawlers, which is
 * why X posts go through the resolver instead.
 */
const USER_AGENT = "Mozilla/5.0 (compatible; ClippingsGrid/0.1; Obsidian link preview)";

export class CaptureService {
  /** Set by the grid view so capture can drive its progress bar. */
  onProgress: ((state: ProgressState | null) => void) | null = null;
  onFinished: ((label: string) => void) | null = null;

  constructor(
    private app: App,
    private settings: () => ClippingsGridSettings,
    private archiver: ArchiveService,
    private index: ClippingIndex
  ) {}

  async captureFromClipboard(): Promise<void> {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      new Notice("Clippings grid: could not read the clipboard");
      return;
    }
    await this.capture(text);
  }

  private report(fraction: number | null, label: string): void {
    this.onProgress?.({ fraction, label });
  }

  async capture(raw: string): Promise<void> {
    const url = cleanUrl(raw);
    if (!isHttpUrl(url)) {
      new Notice("Clippings grid: that is not a link");
      return;
    }

    const existing = this.index.records().find((r) => cleanUrl(r.source) === url);
    if (existing) {
      this.onProgress?.(null);
      new Notice("Clippings grid: already clipped");
      const file = this.app.vault.getAbstractFileByPath(existing.path);
      if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
      return;
    }

    this.report(0.1, "Reading link…");
    const link = await this.resolve(url);

    if (!link || link.media.length === 0) {
      this.onProgress?.(null);
      new Notice("Clippings grid: no image or video found, nothing created");
      return;
    }

    this.report(0.3, "Creating clipping…");
    const file = await this.createNote(link);
    if (!file) {
      this.onProgress?.(null);
      return;
    }

    // Archive straight away: resolved CDN urls are often signed and short-lived.
    this.report(0.4, `Downloading media…`);
    await this.index.ingest(file);
    const record = this.index.get(file.path);

    if (record) {
      this.archiver.onRecordProgress = (done, total) => {
        // Downloading owns the back 60% of the bar.
        this.report(0.4 + (done / Math.max(1, total)) * 0.6, `Downloading ${done}/${total}…`);
      };
      try {
        await this.archiver.archiveRecord(record, true);
      } finally {
        this.archiver.onRecordProgress = null;
      }
    }

    this.onFinished?.(link.title.slice(0, 40));
  }

  private async resolve(url: string): Promise<ResolvedLink | null> {
    // A URL that already points at an asset needs no resolving. This is the
    // route for sites like Threads that never publish their video URL: copy
    // the video address and paste that.
    const direct = directMediaKind(url);
    if (direct) return directMediaLink(url, direct);

    const status = xStatus(url);
    if (status) {
      const viaResolver = await this.resolveX(status, url);
      if (viaResolver && viaResolver.media.length > 0) return viaResolver;
    }
    return this.resolvePage(url);
  }

  private async resolveX(
    status: { user: string; id: string },
    url: string
  ): Promise<ResolvedLink | null> {
    try {
      const response = await requestUrl({
        url: fxApiUrl(status),
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return null;
      return parseFxTweet(response.json, url);
    } catch {
      return null;
    }
  }

  private async resolvePage(url: string): Promise<ResolvedLink | null> {
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return null;

      // Some CDN urls carry no file extension; trust what the server says.
      const type = (response.headers?.["content-type"] ?? "").toLowerCase();
      if (type.startsWith("image/")) return directMediaLink(url, "image");
      if (type.startsWith("video/")) return directMediaLink(url, "video");

      return parsePageMeta(response.text, url);
    } catch {
      return null;
    }
  }

  private async createNote(link: ResolvedLink): Promise<TFile | null> {
    const folder = normalizePath(this.settings().clippingsFolder);
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }

    const base = noteNameFor(link.title, link.url);
    let path = normalizePath(`${folder}/${base}.md`);
    let n = 2;
    while (await this.app.vault.adapter.exists(path)) {
      path = normalizePath(`${folder}/${base} ${n}.md`);
      n++;
    }

    try {
      return await this.app.vault.create(path, buildNote(link));
    } catch (error) {
      new Notice(`Clippings grid: could not create the note (${String(error)})`);
      return null;
    }
  }
}
