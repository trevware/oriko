import {
  Notice,
  ObsidianProtocolData,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  parseYaml,
} from "obsidian";
import { ArchiveService } from "./archive-service";
import { CaptureService } from "./capture";
import { ClippingIndex } from "./index-store";
import { PowerGridSettings, DEFAULT_SETTINGS } from "./core/settings";
import { isStage } from "./core/density";
import {
  LEGACY_SHARED_FILE,
  SHARED_FILE,
  extractShared,
  isDefaultShared,
  parseShared,
  serializeShared,
  sharedOf,
  withShared,
} from "./core/shared-config";
import { describeFiles } from "./core/media-refs";
import { installRepair } from "./repair";
import { sharedHttpUrl } from "./core/resolve";
import { ConfirmSweepModal } from "./confirm";
import { findOrphans, removeMedia, staleKeys } from "./sweep";
import { PowerGridSettingTab } from "./settings-tab";
import { PowerGridView, VIEW_TYPE_GRID } from "./view";

export default class PowerGridPlugin extends Plugin {
  settings: PowerGridSettings = DEFAULT_SETTINGS;
  index!: ClippingIndex;
  archiver!: ArchiveService;
  capture!: CaptureService;
  /** The last shared file this device wrote, to recognise its own echo. */
  private wroteShared = "";
  private archiveTimer = 0;

  /**
   * Schedules the background archive pass, debounced: a sync storm of
   * created files coalesces into one pass instead of stacking timers, and
   * the pending timer is cleared on unload so nothing fires afterwards.
   */
  private scheduleArchive(delayMs: number): void {
    window.clearTimeout(this.archiveTimer);
    this.archiveTimer = window.setTimeout(() => void this.archiver.archiveMissing(), delayMs);
  }

  async onload(): Promise<void> {
    this.register(() => window.clearTimeout(this.archiveTimer));
    await this.loadSettings();
    // After the settings, because it needs the clippings folder to know where
    // to look, and before anything reads a grid.
    await this.syncShared();
    this.watchShared();

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

    // obsidian://power-grid?url=… — the share-sheet route in. An iOS
    // Shortcut hands the shared link straight here, so clipping from
    // another app never touches the clipboard. Prose around the link is
    // tolerated because share sheets send captions, not bare URLs.
    // Registered under both names: power-grid predates the rename and is
    // what existing Shortcuts open; oriko is the name going forward.
    const handleClipUri = (params: ObsidianProtocolData): void => {
      const raw = params.url ?? params.text ?? "";
      const url = sharedHttpUrl(raw);
      if (!url) {
        // The received text is shown so a broken Shortcut diagnoses itself:
        // empty means nothing arrived, %3A soup means over-encoding.
        new Notice(
          raw
            ? `Oriko: no link in the shared text (got "${raw.slice(0, 80)}")`
            : "Oriko: the share arrived empty"
        );
        return;
      }
      // The view first, so the capture's progress bar has a wall to sit on
      // and the clipped tile has somewhere to fly in.
      void this.activateView().then(() => this.capture.capture(url));
    };
    this.registerObsidianProtocolHandler("power-grid", handleClipUri);
    this.registerObsidianProtocolHandler("oriko", handleClipUri);

    this.addSettingTab(new PowerGridSettingTab(this.app, this));
    installRepair(this);

    this.addRibbonIcon("layout-grid", "Open Oriko", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-power-grid",
      name: "Open Oriko",
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
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(PowerGridView);
        if (!view) return false;
        if (!checking) view.togglePalette();
        return true;
      },
    });

    // One command for whatever is on the clipboard, as paste is: a picture
    // or a video is saved as itself, text is taken as a link. Scoped to the
    // wall like the search, since ⌘N is new note everywhere else.
    this.addCommand({
      id: "clip-from-clipboard",
      name: "Clip from clipboard",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(PowerGridView);
        if (!view) return false;
        if (!checking) void this.clipFromClipboard();
        return true;
      },
    });

    this.addCommand({
      id: "rescan-clippings",
      name: "Rescan clippings folder",
      callback: () => {
        void this.index.rebuild().then(() => {
          new Notice("Oriko: clippings rescanned");
        });
      },
    });

    this.addCommand({
      id: "sweep-orphan-media",
      name: "Remove orphaned media",
      callback: () => this.sweepOrphanMedia(),
    });

    this.addCommand({
      id: "archive-clipping-media",
      name: "Download all clipping media",
      callback: () => this.archiveAllMedia(),
    });

    this.app.workspace.onLayoutReady(() => {
      void this.index.rebuild().then(() => {
        // Archiving runs behind the grid, which is already showing remote
        // covers, and tiles swap to local files as they arrive.
        if (this.settings.archiveOnCreate) {
          this.scheduleArchive(1500);
        }
      });
    });

    // When the folder is not being watched, only files already on the wall
    // keep tracking their edits; a new arrival waits for a rescan or the
    // next launch. Explicit clips are unaffected: capture feeds the index
    // directly rather than through these events.
    const admits = (path: string): boolean =>
      this.settings.watchClippings || this.index.get(path) !== undefined;

    this.registerEvent(
      this.app.vault.on("create", (f: TAbstractFile) => {
        if (!(f instanceof TFile) || !admits(f.path)) return;
        void this.index.handleModify(f).then(() => {
          // The Web Clipper writes the body and frontmatter in stages, so
          // give it a moment before scanning for media to download.
          if (this.settings.archiveOnCreate) {
            this.scheduleArchive(2000);
          }
        });
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (f: TAbstractFile) => {
        if (f instanceof TFile && admits(f.path)) void this.index.handleModify(f);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (f: TAbstractFile) => this.index.handleDelete(f.path))
    );
    this.registerEvent(
      this.app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
        if (f instanceof TFile && admits(oldPath)) void this.index.handleRename(f, oldPath);
      })
    );

    // Frontmatter arrives through the metadata cache, which resolves after
    // the file write. Without this the first scan of a fresh clipping sees
    // no categories or status.
    this.registerEvent(
      this.app.metadataCache.on("changed", (f: TFile) => {
        if (admits(f.path)) void this.index.handleModify(f);
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
      new Notice("Oriko: no orphaned media to remove");
      return;
    }

    new ConfirmSweepModal(this.app, orphans, describeFiles(orphans), () => {
      void (async () => {
        const removed = await removeMedia(this.app, this.archiver.cache, orphans.paths);
        for (const key of stale) this.archiver.cache.delete(key);
        await this.archiver.saveCache();
        new Notice(
          `Oriko: ${removed} media file${removed === 1 ? "" : "s"} moved to trash`
        );
      })();
    }).open();
  }

  /** Lifted out of its command so the grid's palette can call it too. */
  archiveAllMedia(): void {
    new Notice("Oriko: downloading media…");
    void this.archiver.archiveEverything().then((r) => this.archiver.notifyResult(r));
  }

  /** Lifted out of its command so the grid's create menu can call it too. */
  /**
   * Clips whatever the clipboard holds, deciding as the paste handler does:
   * a picture or a video is saved as itself, anything else is read as text
   * and taken as a link.
   */
  async clipFromClipboard(): Promise<void> {
    let items: ClipboardItems;
    try {
      items = await navigator.clipboard.read();
    } catch {
      new Notice("Oriko: could not read the clipboard");
      return;
    }
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/") || t.startsWith("video/"));
      if (!type) continue;
      await this.capture.captureMedia(await item.getType(type));
      return;
    }
    await this.capture.captureFromClipboard();
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

  /** Where the vault's half of the settings lives. */
  private sharedPath(): string {
    return normalizePath(`${this.settings.clippingsFolder}/${SHARED_FILE}`);
  }

  /** Where it lived before it was markdown. */
  private legacySharedPath(): string {
    return normalizePath(`${this.settings.clippingsFolder}/${LEGACY_SHARED_FILE}`);
  }

  /**
   * Reads the shared half out of the vault, and writes it there the first
   * time if it is missing.
   *
   * The write is the migration: a vault that predates this has its grids in
   * data.json and nowhere else, and the first device to open it publishes
   * them. Devices that already had none, a phone that only ever received the
   * plugin through BRAT, then read that file rather than starting empty.
   */
  private async syncShared(): Promise<void> {
    const path = this.sharedPath();

    const shared = this.app.vault.getFileByPath(path);
    if (shared) {
      try {
        const body = await this.app.vault.cachedRead(shared);
        this.wroteShared = body;
        const raw = extractShared(body);
        if (raw !== null) {
          this.settings = withShared(this.settings, parseShared(raw, sharedOf(this.settings)));
          return;
        }
      } catch {
        // Fall through to the notice below.
      }
      // Unreadable, or half-written by a sync still in flight. What this
      // device already has beats nothing, and the next save republishes it.
      new Notice("Oriko: could not read the shared grid configuration.");
      return;
    }

    // The .json this replaced. Read once, so a vault that already published
    // one carries over instead of starting again, and then retired: leaving
    // both would be two files claiming to define the same grids.
    const legacy = this.app.vault.getFileByPath(this.legacySharedPath());
    if (legacy) {
      try {
        const raw = extractShared(await this.app.vault.cachedRead(legacy));
        if (raw !== null) {
          this.settings = withShared(this.settings, parseShared(raw, sharedOf(this.settings)));
        }
      } catch {
        // Nothing to carry over; the write below publishes what we have.
      }
      await this.writeShared();
      // To the trash rather than deleted outright: it is the plugin's own
      // file, but it is in the user's vault.
      await this.app.vault.trash(legacy, true).catch(() => {});
      return;
    }

    // Whoever writes the file first wins it, so a device that has nothing but
    // the defaults does not get to. See isDefaultShared.
    if (!isDefaultShared(sharedOf(this.settings))) await this.writeShared();
  }

  private async writeShared(): Promise<void> {
    const body = serializeShared(sharedOf(this.settings));
    // saveSettings also runs for the device's own half, the tile size among
    // them, and rewriting an identical file for those is sync churn on every
    // device rather than a change to anything.
    if (body === this.wroteShared) return;
    // Remembered so the modify event our own write raises can be told apart
    // from one that arrived by sync.
    this.wroteShared = body;
    const path = this.sharedPath();
    const folder = this.settings.clippingsFolder;
    if (folder && !this.app.vault.getFolderByPath(normalizePath(folder))) return;
    const existing = this.app.vault.getFileByPath(path);
    // process rewrites atomically, so another plugin editing the same file
    // is never raced; create covers the first publish.
    if (existing) await this.app.vault.process(existing, () => body);
    else await this.app.vault.create(path, body);
  }

  /**
   * Picks up a shared file that has changed underneath us, which is what a
   * sync delivering another device's grids looks like from here.
   */
  private watchShared(): void {
    const reread = async (path: string): Promise<void> => {
      if (path !== this.sharedPath()) return;
      const file = this.app.vault.getFileByPath(this.sharedPath());
      if (!file) return;
      let body: string;
      try {
        body = await this.app.vault.cachedRead(file);
      } catch {
        return;
      }
      // Our own write coming back. Acting on it would be harmless but would
      // rebuild every open wall for nothing.
      if (body === this.wroteShared) return;
      const raw = extractShared(body);
      if (raw === null) return;
      this.settings = withShared(this.settings, parseShared(raw, sharedOf(this.settings)));
      // Now what is on disk, as far as this device knows, so the next save
      // does not write the same thing straight back at whoever sent it.
      this.wroteShared = body;
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
        if (leaf.view instanceof PowerGridView) leaf.view.refreshGrids();
      }
    };

    this.registerEvent(this.app.vault.on("modify", (file) => void reread(file.path)));
    this.registerEvent(this.app.vault.on("create", (file) => void reread(file.path)));
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
    // A stage that no longer exists, or a hand-edited data.json, lands on the
    // default rather than on a wall laid out to an undefined width.
    if (!isStage(this.settings.tileSize)) this.settings.tileSize = DEFAULT_SETTINGS.tileSize;
  }

  async saveSettings(): Promise<void> {
    // The vault's half goes to the vault and is kept out of data.json, so
    // there is one place a grid is defined rather than two that can disagree.
    const local = { ...this.settings } as Partial<PowerGridSettings>;
    for (const key of Object.keys(sharedOf(this.settings))) {
      delete local[key as keyof PowerGridSettings];
    }
    await this.saveData(local);
    await this.writeShared();

    // Saving is also how an open wall hears about it. Every caller of this
    // already means "the settings have changed", so there is no second thing
    // for the settings tab to remember to call, and no way for a new toggle
    // to be added that silently does not take effect.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof PowerGridView) leaf.view.applyLiveSettings();
    }
  }
}
