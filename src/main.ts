import { Plugin, WorkspaceLeaf } from "obsidian";
import { ClippingsGridSettings, DEFAULT_SETTINGS } from "./settings";
import { ClippingsGridView, VIEW_TYPE_GRID } from "./view";

export default class ClippingsGridPlugin extends Plugin {
  settings: ClippingsGridSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_GRID,
      (leaf: WorkspaceLeaf) => new ClippingsGridView(leaf)
    );

    this.addRibbonIcon("layout-grid", "Open clippings grid", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-clippings-grid",
      name: "Open clippings grid",
      callback: () => void this.activateView(),
    });
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_GRID, active: true });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
