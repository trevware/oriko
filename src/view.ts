import { ItemView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_GRID = "clippings-grid";

export class ClippingsGridView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
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
    this.contentEl.createEl("p", { text: "Clippings grid is alive." });
  }
}
