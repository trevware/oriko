import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf, parseYaml } from "obsidian";
import { ArchiveService } from "./archive-service";
import { CaptureService } from "./capture";
import { ClippingIndex } from "./index-store";
import { PowerGridSettings, DEFAULT_SETTINGS } from "./settings";
import { describeFiles } from "./media-refs";
import { installRepair } from "./repair";
import { ConfirmSweepModal } from "./confirm";
import { findOrphans, removeMedia, staleKeys } from "./sweep";
import { PowerGridSettingTab } from "./settings-tab";
import { PowerGridView, VIEW_TYPE_GRID } from "./view";

export default class PowerGridPlugin extends Plugin {
  settings: PowerGridSettings = DEFAULT_SETTINGS;
  index!: ClippingIndex;
  archiver!: ArchiveService;
  capture!: CaptureService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.index = new ClippingIndex(
      this.app,
      () => this.settings.clippingsFolder,
      parseYaml
    );
    this.archiver = new ArchiveService(
      this.app,
      this.index,
      () => this.settings,
      this.manifest.dir ?? ".obsidian/plugins/power-grid"
    );
    await this.archiver.loadCache();
    this.capture = new CaptureService(
      this.app,
      () => this.settings,
      this.archiver,
      this.index
    );

    this.registerView(
      VIEW_TYPE_GRID,
      (leaf: WorkspaceLeaf) => new PowerGridView(leaf, this)
    );

    this.addSettingTab(new PowerGridSettingTab(this.app, this));
    installRepair(this);

    this.addRibbonIcon("layout-grid", "Open Power Grid", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-power-grid",
      name: "Open Power Grid",
      callback: () => void this.activateView(),
    });

    // Registered as a command rather than left to the view's own key
    // listener: ⌘K is a core default (Insert Markdown link), so Obsidian's
    // dispatcher claims the chord before a DOM listener ever sees it. Going
    // through the command system is what puts the wall's search on the key,
    // and it makes the binding reassignable in Settings → Hotkeys like
    // everything else.
    this.addCommand({
      id: "open-search",
      name: "Search this grid",
      hotkeys: [{ modifiers: ["Mod"], key: "K" }],
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(PowerGridView);
        if (!view) return false;
        if (!checking) view.togglePalette();
        return true;
      },
    });

    this.addCommand({
      id: "clip-url-from-clipboard",
      name: "Clip link from clipboard",
      callback: () => void this.capture.captureFromClipboard(),
    });

    this.addCommand({
      id: "clip-image-from-clipboard",
      name: "Clip image from clipboard",
      callback: () => void this.clipImageFromClipboard(),
    });

    this.addCommand({
      id: "toggle-layer-panel",
      name: "Show or hide the list",
      hotkeys: [{ modifiers: ["Mod"], key: "L" }],
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(PowerGridView);
        if (!view) return false;
        if (!checking) view.togglePanel();
        return true;
      },
    });

    this.addCommand({
      id: "sweep-orphan-media",
      name: "Remove orphaned media",
      callback: () => this.sweepOrphanMedia(),
    });

    this.addCommand({
      id: "archive-clipping-media",
      name: "Archive all clipping media",
      callback: () => this.archiveAllMedia(),
    });

    this.app.workspace.onLayoutReady(() => {
      void this.index.rebuild().then(() => {
        // Archiving runs behind the grid, which is already showing remote
        // covers, and tiles swap to local files as they arrive.
        if (this.settings.archiveOnCreate) {
          window.setTimeout(() => void this.archiver.archiveMissing(), 1500);
        }
      });
    });

    this.registerEvent(
      this.app.vault.on("create", (f: TAbstractFile) => {
        if (!(f instanceof TFile)) return;
        void this.index.handleModify(f).then(() => {
          // The Web Clipper writes the body and frontmatter in stages, so
          // give it a moment before scanning for media to download.
          if (this.settings.archiveOnCreate) {
            window.setTimeout(() => void this.archiver.archiveMissing(), 2000);
          }
        });
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

  /**
   * Offers up everything in the attachment folder that no clipping points
   * at any more: media left behind by deletions that predate reference
   * counting, and captures whose note was removed before it was written.
   *
   * Asks first, always, and moves to Obsidian's trash rather than deleting,
   * because the plugin is guessing about files it did not just create.
   */
  sweepOrphanMedia(): void {
    const orphans = findOrphans(
      this.app,
      this.index.records(),
      this.archiver.cache,
      this.settings.attachmentFolder
    );

    // Rows pointing at files that are already gone cost nothing to keep but
    // make the archiver skip a re-download it should do, so they go either
    // way, sweep or no sweep.
    const stale = staleKeys(this.app, this.archiver.cache);

    if (orphans.paths.length === 0) {
      if (stale.length > 0) {
        for (const key of stale) this.archiver.cache.delete(key);
        void this.archiver.saveCache();
      }
      new Notice("Power Grid: no orphaned media to remove");
      return;
    }

    new ConfirmSweepModal(this.app, orphans, describeFiles(orphans), () => {
      void (async () => {
        const removed = await removeMedia(this.app, this.archiver.cache, orphans.paths);
        for (const key of stale) this.archiver.cache.delete(key);
        await this.archiver.saveCache();
        new Notice(
          `Power Grid: ${removed} media file${removed === 1 ? "" : "s"} moved to trash`
        );
      })();
    }).open();
  }

  /** Lifted out of its command so the grid's palette can call it too. */
  archiveAllMedia(): void {
    new Notice("Power Grid: archiving…");
    void this.archiver.archiveEverything().then((r) => this.archiver.notifyResult(r));
  }

  /** Lifted out of its command so the grid's create menu can call it too. */
  async clipImageFromClipboard(): Promise<void> {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        await this.capture.captureMedia(await item.getType(type));
        return;
      }
      new Notice("Power Grid: no image on the clipboard");
    } catch {
      new Notice("Power Grid: could not read the clipboard");
    }
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
    // Object.assign copies the reference, not the array. Without this, a vault
    // with no saved grids yet would push straight into DEFAULT_SETTINGS, and
    // the module-level default would start carrying real user data.
    this.settings.grids = [...(this.settings.grids ?? [])];
    this.settings.filterProperties = [
      ...(this.settings.filterProperties ?? DEFAULT_SETTINGS.filterProperties),
    ];
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    // Saving is also how an open wall hears about it. Every caller of this
    // already means "the settings have changed", so there is no second thing
    // for the settings tab to remember to call, and no way for a new toggle
    // to be added that silently does not take effect.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof PowerGridView) leaf.view.applyLiveSettings();
    }
  }
}
