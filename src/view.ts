import { ItemView, WorkspaceLeaf } from "obsidian";
import type ClippingsGridPlugin from "./main";

export const VIEW_TYPE_GRID = "clippings-grid";

export class ClippingsGridView extends ItemView {
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
    this.plugin.index.onChange(() => this.render());
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass("clippings-grid-view");

    const records = this.plugin.index.records();
    const totalMedia = records.reduce((sum, r) => sum + r.media.length, 0);
    el.createEl("p", { text: `${records.length} clippings, ${totalMedia} media refs` });

    const list = el.createEl("ul");
    for (const r of records) {
      list.createEl("li", {
        text: `${r.title} — ${r.media.length} media — ${r.categories.join(", ") || "uncategorized"}`,
      });
    }
  }
}
