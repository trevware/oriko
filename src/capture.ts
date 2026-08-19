import { App, Notice, TFile, normalizePath, requestUrl } from "obsidian";
import type { ArchiveService } from "./archive-service";
import { todayISO as today } from "./dates";
import { extensionForMime } from "./formats";
import type { ClippingIndex } from "./index-store";
import {
  ResolvedLink,
  buildNote,
  buildPastedImageNote,
  cleanUrl,
  directMediaKind,
  directMediaLink,
  fxApiUrl,
  isHttpUrl,
  noteNameFor,
  parseFxTweet,
  instagramPost,
  parsePageMeta,
  xStatus,
} from "./resolve";
import type { ProgressState } from "./progress";
import type { PowerGridSettings } from "./settings";

/**
 * Identifies the plugin honestly rather than impersonating a known crawler.
 * Enough for sites that gate Open Graph tags on a non-browser agent, such
 * as Threads; X withholds them from everything but named crawlers, which is
 * why X posts go through the resolver instead.
 */
const USER_AGENT = "Mozilla/5.0 (compatible; PowerGrid/0.1; Obsidian link preview)";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Filename-safe stamp, unique to the second so two pastes cannot collide. */
function todayStamp(): string {
  const now = new Date();
  return (
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}` +
    ` ${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  );
}

export class CaptureService {
  /** Set by the grid view so capture can drive its progress bar. */
  onProgress: ((state: ProgressState | null) => void) | null = null;
  /**
   * Carries the note's path as well as its label: the grid flies to what you
   * just clipped, and a title is not enough to find a tile by.
   */
  onFinished: ((label: string, path: string) => void) | null = null;

  constructor(
    private app: App,
    private settings: () => PowerGridSettings,
    private archiver: ArchiveService,
    private index: ClippingIndex
  ) {}

  async captureFromClipboard(): Promise<void> {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      new Notice("Power Grid: could not read the clipboard");
      return;
    }
    await this.capture(text);
  }

  /** Saves an image pasted straight from the clipboard as its own clipping. */
  async captureImage(blob: Blob): Promise<void> {
    if (!blob.type.startsWith("image/")) {
      new Notice("Power Grid: that clipboard item is not an image");
      return;
    }

    this.report(0.3, "Saving pasted image…");

    const folder = normalizePath(this.settings().attachmentFolder);
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }

    const stamp = todayStamp();
    const ext = extensionForMime(blob.type);
    let attachment = normalizePath(`${folder}/pasted-${stamp}.${ext}`);
    let n = 2;
    while (await this.app.vault.adapter.exists(attachment)) {
      attachment = normalizePath(`${folder}/pasted-${stamp}-${n}.${ext}`);
      n++;
    }

    try {
      await this.app.vault.createBinary(attachment, await blob.arrayBuffer());
    } catch (error) {
      this.onProgress?.(null);
      new Notice(`Power Grid: could not save the image (${String(error)})`);
      return;
    }

    this.report(0.7, "Creating clipping…");

    const title = `Pasted image ${stamp}`;
    const clippings = normalizePath(this.settings().clippingsFolder);
    if (!(await this.app.vault.adapter.exists(clippings))) {
      await this.app.vault.createFolder(clippings);
    }

    let notePath = normalizePath(`${clippings}/${title}.md`);
    let m = 2;
    while (await this.app.vault.adapter.exists(notePath)) {
      notePath = normalizePath(`${clippings}/${title} ${m}.md`);
      m++;
    }

    try {
      const file = await this.app.vault.create(
        notePath,
        buildPastedImageNote(title, attachment, today(), this.targetGrid())
      );
      // Same as the link path: ingest alone leaves the grid unaware.
      await this.index.handleModify(file);
    } catch (error) {
      this.onProgress?.(null);
      new Notice(`Power Grid: could not create the note (${String(error)})`);
      return;
    }

    this.onFinished?.(title, notePath);
  }

  /** The grid a new clipping should carry, or "" when that is home. */
  private targetGrid(): string {
    const settings = this.settings();
    return settings.activeGrid === settings.homeGridName ? "" : settings.activeGrid;
  }

  private report(fraction: number | null, label: string): void {
    this.onProgress?.({ fraction, label });
  }

  async capture(raw: string): Promise<void> {
    const url = cleanUrl(raw);
    if (!isHttpUrl(url)) {
      new Notice("Power Grid: that is not a link");
      return;
    }

    const existing = this.index.records().find((r) => cleanUrl(r.source) === url);
    if (existing) {
      this.onProgress?.(null);
      new Notice("Power Grid: already clipped");
      const file = this.app.vault.getAbstractFileByPath(existing.path);
      if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
      return;
    }

    this.report(0.1, "Reading link…");
    const link = await this.resolve(url);

    if (!link || link.media.length === 0) {
      this.onProgress?.(null);
      new Notice("Power Grid: no image or video found, nothing created");
      return;
    }

    // Archive before writing the note, so the note can embed the files
    // themselves. These CDN urls are signed and expire within days; a note
    // that points at one is a note that stops working.
    this.report(0.3, "Downloading media…");
    const archived = await this.archiver.archiveResolved(
      link.url,
      link.media,
      (done, total) =>
        this.report(0.3 + (done / Math.max(1, total)) * 0.5, `Downloading ${done}/${total}…`)
    );

    const media = link.media.map((item) => ({
      ...item,
      localPath: archived.byUrl.get(item.url),
    }));

    // A video pulled from the post itself leads, so it becomes the cover and
    // the first thing the note shows.
    if (archived.sourceVideo) {
      media.unshift({
        url: link.url,
        kind: "video" as const,
        localPath: archived.sourceVideo,
      });
    }

    this.report(0.85, "Creating clipping…");
    const file = await this.createNote({ ...link, media });
    if (!file) {
      this.onProgress?.(null);
      return;
    }

    // handleModify, not ingest: ingest updates the index silently, so the
    // grid was never told the clipping had landed.
    await this.index.handleModify(file);
    this.onFinished?.(link.title.slice(0, 40), file.path);
  }

  private async resolve(url: string): Promise<ResolvedLink | null> {
    // A URL that already points at an asset needs no resolving. This is the
    // route for sites like Threads that never publish their video URL: copy
    // the video address and paste that.
    const direct = directMediaKind(url);
    if (direct) return directMediaLink(url, direct);

    const status = xStatus(url);
    if (status && this.settings().useResolvers) {
      const viaResolver = await this.resolveX(status, url);
      if (viaResolver && viaResolver.media.length > 0) return viaResolver;
    }

    const insta = instagramPost(url);
    if (insta) return this.resolveInstagram(insta, url);

    return this.resolvePage(url);
  }

  /**
   * Instagram publishes a poster image to crawlers but never the video URL,
   * so the mirror is listed first and the poster kept behind it. No extra
   * request is spent probing: if the mirror fails, the archiver's existing
   * fallback chain lands on the poster.
   */
  private async resolveInstagram(
    post: { kind: string; code: string },
    url: string
  ): Promise<ResolvedLink | null> {
    const page = await this.resolvePage(url);
    const base: ResolvedLink = page ?? {
      url,
      title: `Instagram ${post.kind}`,
      description: "",
      author: "",
      published: "",
      media: [],
    };

    // The video is not in the page at all. It is fetched during archiving
    // by a local yt-dlp, keyed off the source URL, so nothing here needs a
    // third-party mirror.
    return base;
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
      return await this.app.vault.create(path, buildNote(link, today(), this.targetGrid()));
    } catch (error) {
      new Notice(`Power Grid: could not create the note (${String(error)})`);
      return null;
    }
  }
}
