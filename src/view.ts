import { ItemView, WorkspaceLeaf } from "obsidian";
import { GridRenderer } from "./grid";
import type ClippingsGridPlugin from "./main";
import { PlaybackController } from "./playback";
import { buildTiles } from "./tile";

export const VIEW_TYPE_GRID = "clippings-grid";

export class ClippingsGridView extends ItemView {
  private grid: GridRenderer | null = null;
  private observer: ResizeObserver | null = null;
  private playback: PlaybackController | null = null;

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

    this.grid = new GridRenderer(this.app, this.contentEl);
    this.playback = new PlaybackController(
      this.grid.scrollerEl,
      this.plugin.settings.autoplayVideo
    );

    this.grid.onRendered = () => {
      this.playback?.prune();
      for (const media of this.grid?.mountedMedia() ?? []) {
        this.playback?.observe(media);
      }
    };

    this.plugin.index.onChange(() => this.refresh());
    this.plugin.archiver.onChange(() => this.refresh());

    this.observer = new ResizeObserver(() => this.grid?.relayout());
    this.observer.observe(this.contentEl);

    this.refresh();
  }

  async onClose(): Promise<void> {
    this.observer?.disconnect();
    this.observer = null;
    this.playback?.destroy();
    this.playback = null;
    this.grid?.destroy();
    this.grid = null;
  }

  refresh(): void {
    if (!this.grid) return;
    const tiles = buildTiles(this.plugin.index.records(), this.plugin.archiver.cache);
    this.grid.setTiles(tiles);
  }
}
