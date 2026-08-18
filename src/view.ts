import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { ConfirmDeleteModal } from "./confirm";
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
  /** Tiles whose cover failed to load, so they leave the grid. */
  private unloadable = new Set<string>();

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

    this.grid.onSourceFailed = (id: string) => {
      if (this.unloadable.has(id)) return;
      this.unloadable.add(id);
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
      const text = event.clipboardData?.getData("text/plain")?.trim();
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
    this.grid?.destroy();
    this.grid = null;
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
