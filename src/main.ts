import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { ArchiveService } from "./archive-service";
import { CaptureService } from "./capture";
import { ClippingIndex } from "./index-store";
import { ClippingsGridSettings, DEFAULT_SETTINGS } from "./settings";
import { ClippingsGridView, VIEW_TYPE_GRID } from "./view";

export default class ClippingsGridPlugin extends Plugin {
  settings: ClippingsGridSettings = DEFAULT_SETTINGS;
  index!: ClippingIndex;
  archiver!: ArchiveService;
  capture!: CaptureService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.index = new ClippingIndex(this.app, () => this.settings.clippingsFolder);
    this.archiver = new ArchiveService(
      this.app,
      this.index,
      () => this.settings,
      this.manifest.dir ?? ".obsidian/plugins/clippings-grid"
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

    this.addCommand({
      id: "clip-url-from-clipboard",
      name: "Clip link from clipboard",
      callback: () => void this.capture.captureFromClipboard(),
    });

    this.addCommand({
      id: "clip-image-from-clipboard",
      name: "Clip image from clipboard",
      callback: () => {
        void navigator.clipboard
          .read()
          .then(async (items) => {
            for (const item of items) {
              const type = item.types.find((t) => t.startsWith("image/"));
              if (!type) continue;
              await this.capture.captureImage(await item.getType(type));
              return;
            }
            new Notice("Clippings grid: no image on the clipboard");
          })
          .catch(() => new Notice("Clippings grid: could not read the clipboard"));
      },
    });

    this.addCommand({
      id: "archive-clipping-media",
      name: "Archive all clipping media",
      callback: () => {
        new Notice("Clippings grid: archiving…");
        void this.archiver
          .archiveEverything()
          .then((r) => this.archiver.notifyResult(r));
      },
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
