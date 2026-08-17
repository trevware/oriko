import { Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { ClippingIndex } from "./index-store";
import { ClippingsGridSettings, DEFAULT_SETTINGS } from "./settings";
import { ClippingsGridView, VIEW_TYPE_GRID } from "./view";

export default class ClippingsGridPlugin extends Plugin {
  settings: ClippingsGridSettings = DEFAULT_SETTINGS;
  index!: ClippingIndex;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.index = new ClippingIndex(this.app, () => this.settings.clippingsFolder);

    this.registerView(
      VIEW_TYPE_GRID,
      (leaf: WorkspaceLeaf) => new ClippingsGridView(leaf, this)
    );

    this.addRibbonIcon("layout-grid", "Open clippings grid", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-clippings-grid",
      name: "Open clippings grid",
      callback: () => void this.activateView(),
    });

    this.app.workspace.onLayoutReady(() => void this.index.rebuild());

    this.registerEvent(
      this.app.vault.on("create", (f: TAbstractFile) => {
        if (f instanceof TFile) void this.index.handleModify(f);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (f: TAbstractFile) => {
        if (f instanceof TFile) void this.index.handleModify(f);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (f: TAbstractFile) => this.index.handleDelete(f.path))
    );
    this.registerEvent(
      this.app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
        if (f instanceof TFile) void this.index.handleRename(f, oldPath);
      })
    );

    // Frontmatter arrives through the metadata cache, which resolves after
    // the file write. Without this the first scan of a fresh clipping sees
    // no categories or status.
    this.registerEvent(
      this.app.metadataCache.on("changed", (f: TFile) => {
        void this.index.handleModify(f);
      })
    );
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
