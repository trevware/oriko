import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { absolutePath } from "./convert";
import { dedupeMedia, sourceVideoKeyFor } from "./normalize";
import { copyToDownloads, revealInFinder, systemAvailable } from "./system";
import { ActionBar } from "./action-bar";
import { ConfirmDeleteModal } from "./confirm";
import { ContextMenu } from "./context-menu";
import { DetailView } from "./detail";
import type { MenuItem } from "./context-menu";
import { GridRenderer } from "./grid";
import type ClippingsGridPlugin from "./main";
import { PlaybackController } from "./playback";
import { ProgressBar } from "./progress";
import { buildTiles } from "./tile";

export const VIEW_TYPE_GRID = "clippings-grid";

export class ClippingsGridView extends ItemView {
  private grid: GridRenderer | null = null;
  private observer: ResizeObserver | null = null;
  private playback: PlaybackController | null = null;
  private progress: ProgressBar | null = null;
  private actionBar: ActionBar | null = null;
  private menu: ContextMenu | null = null;
  private detail: DetailView | null = null;
  /**
   * Covers that failed to load, keyed by note path and remembered by
   * signature. Recording the signature is what lets a clipping return once
   * archiving gives it a different, working cover.
   */
  private unloadable = new Map<string, string>();

  constructor(leaf: WorkspaceLeaf, private plugin: ClippingsGridPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GRID;
  }

  getDisplayText(): string {
    return "Clippings grid";
  }

  getIcon(): string {
    return "layout-grid";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("clippings-grid-view");

    this.progress = new ProgressBar(this.contentEl);
    this.plugin.capture.onProgress = (state) => this.progress?.set(state);
    this.plugin.capture.onFinished = (label) => this.progress?.finish(`Clipped ${label}`);

    this.grid = new GridRenderer(this.app, this.contentEl);
    this.playback = new PlaybackController(
      this.grid.viewportEl,
      this.plugin.settings.autoplayVideo
    );

    this.grid.onRendered = () => {
      this.playback?.prune();
      for (const media of this.grid?.mountedMedia() ?? []) {
        this.playback?.observe(media);
      }
    };

    this.grid.onDeleteRequested = (ids: string[]) => this.confirmDelete(ids);

    this.actionBar = new ActionBar(this.contentEl, {
      onDelete: () => this.confirmDelete(this.grid?.selectedIds() ?? []),
    });
    this.grid.onSelectionChanged = (ids: string[]) => this.actionBar?.setSelection(ids);

    this.menu = new ContextMenu(this.contentEl);
    this.grid.onContextRequested = (ids, x, y) =>
      this.menu?.open(this.menuItems(ids), x, y);
    this.grid.onExportRequested = (ids) => void this.exportToDownloads(ids);

    this.detail = new DetailView(this.app, this.contentEl, {
      onExport: (id) => void this.exportToDownloads([id]),
      onReveal: (id) => this.revealFirstFile(id),
      onDelete: (id) => this.confirmDelete([id]),
      onOpenNote: (id) => {
        const file = this.app.vault.getAbstractFileByPath(id);
        if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
      },
    });
    this.grid.onOpenDetail = (model, origin) => this.detail?.open(model, origin);

    this.grid.onSourceFailed = (id: string, signature: string) => {
      if (this.unloadable.get(id) === signature) return;
      this.unloadable.set(id, signature);
      this.refresh();
    };

    this.plugin.index.onChange(() => this.refresh());
    this.plugin.archiver.onChange(() => this.refresh());

    this.observer = new ResizeObserver(() => this.grid?.relayout());
    this.observer.observe(this.contentEl);

    // Paste a link anywhere in the grid to clip it, the way you would drop
    // a URL into a board app.
    this.registerDomEvent(document, "paste", (event: ClipboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(ClippingsGridView) !== this) return;
      const data = event.clipboardData;
      if (!data) return;

      // Image data first: copying an image from a browser also puts its URL
      // on the clipboard, and the bytes in hand beat a link to fetch.
      const file = Array.from(data.files).find((f) => f.type.startsWith("image/"));
      if (file) {
        event.preventDefault();
        void this.plugin.capture.captureImage(file);
        return;
      }

      const text = data.getData("text/plain")?.trim();
      if (!text) return;
      event.preventDefault();
      void this.plugin.capture.capture(text);
    });

    this.refresh();
  }

  async onClose(): Promise<void> {
    this.observer?.disconnect();
    this.observer = null;
    this.playback?.destroy();
    this.playback = null;
    this.plugin.capture.onProgress = null;
    this.plugin.capture.onFinished = null;
    this.progress?.destroy();
    this.progress = null;
    this.actionBar?.destroy();
    this.actionBar = null;
    this.menu?.close();
    this.menu = null;
    this.detail?.close(true);
    this.detail = null;
    this.grid?.destroy();
    this.grid = null;
  }

  /** Every archived file belonging to a clipping, originals only. */
  private filesFor(id: string): string[] {
    const record = this.plugin.index.get(id);
    if (!record) return [];

    const cache = this.plugin.archiver.cache;
    const paths: string[] = [];

    if (record.source) {
      const video = cache.get(sourceVideoKeyFor(record.source));
      if (video?.file) paths.push(video.file);
    }
    // Looked up through the same dedupe the archiver used, so the keys
    // match; comparing a raw URL against a normalized key would not.
    for (const media of dedupeMedia(record.media)) {
      const entry = cache.get(media.key);
      if (entry?.file) paths.push(entry.file);
    }
    return [...new Set(paths)];
  }

  private menuItems(ids: string[]): MenuItem[] {
    const n = ids.length;
    const count = n === 1 ? "1 selected" : `${n} selected`;
    const items: MenuItem[] = [];

    if (n === 1) {
      items.push({
        icon: "file-text",
        label: "Open note",
        onSelect: () => {
          const file = this.app.vault.getAbstractFileByPath(ids[0]);
          if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
        },
      });
    }

    if (systemAvailable()) {
      items.push({
        icon: "download",
        label: "Export to Downloads",
        detail: "⌘E",
        onSelect: () => void this.exportToDownloads(ids),
      });

      if (n === 1) {
        items.push({
          icon: "folder",
          label: "Reveal in Finder",
          onSelect: () => this.revealFirstFile(ids[0]),
        });
      }
    }

    items.push({
      icon: "trash-2",
      label: "Delete",
      detail: count,
      destructive: true,
      onSelect: () => this.confirmDelete(ids),
    });

    return items;
  }

  private revealFirstFile(id: string): void {
    const file = this.filesFor(id)[0];
    if (!file) {
      new Notice("Clippings grid: nothing archived for this clipping yet");
      return;
    }
    const absolute = absolutePath(this.app.vault, normalizePath(file));
    if (!absolute || !revealInFinder(absolute)) {
      new Notice("Clippings grid: could not reveal the file");
    }
  }

  async exportToDownloads(ids: string[]): Promise<void> {
    let copied = 0;
    for (const id of ids) {
      for (const file of this.filesFor(id)) {
        const absolute = absolutePath(this.app.vault, normalizePath(file));
        if (!absolute) continue;
        const name = file.slice(file.lastIndexOf("/") + 1);
        if (copyToDownloads(absolute, name)) copied++;
      }
    }
    new Notice(
      copied === 0
        ? "Clippings grid: nothing archived to export yet"
        : `Clippings grid: exported ${copied} file${copied === 1 ? "" : "s"} to Downloads`
    );
  }

  private confirmDelete(ids: string[]): void {
    const titles = ids.map((id) => this.plugin.index.get(id)?.title ?? id);
    new ConfirmDeleteModal(this.app, titles, () => void this.deleteClippings(ids)).open();
  }

  private async deleteClippings(ids: string[]): Promise<void> {
    let removed = 0;
    for (const id of ids) {
      const file = this.app.vault.getAbstractFileByPath(id);
      if (!(file instanceof TFile)) continue;
      try {
        // Obsidian's trash, so this stays recoverable.
        await this.app.fileManager.trashFile(file);
        removed++;
      } catch (error) {
        new Notice(`Clippings grid: could not delete ${file.basename} (${String(error)})`);
      }
    }
    this.grid?.clearSelection();
    new Notice(
      removed === 1 ? "Clippings grid: 1 note moved to trash" : `Clippings grid: ${removed} notes moved to trash`
    );
  }

  refresh(): void {
    if (!this.grid) return;
    const tiles = buildTiles(
      this.plugin.index.records(),
      this.plugin.archiver.cache,
      this.unloadable
    );
    this.grid.setTiles(tiles);
  }
}
