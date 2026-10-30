import {
  Notice,
  ObsidianProtocolData,
  Platform,
  Plugin,
  addIcon,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  parseYaml,
} from "obsidian";
import { buildDiagnostics } from "./core/diagnose";
import { setToolOverrides } from "./convert";
import { ArchiveService } from "./archive-service";
import { SteamService } from "./steam-service";
import { ColorService } from "./color-service";
import { RevisitService } from "./revisit-service";
import { PostService } from "./post-service";
import { CaptureService } from "./capture";
import { ClippingIndex } from "./index-store";
import { OrikoSettings, DEFAULT_SETTINGS, isCardMode } from "./core/settings";
import { isRevisitForget } from "./core/revisit";
import { isStage } from "./core/density";
import {
  LEGACY_SHARED_FILES,
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
import { sharedClipGrid } from "./core/spaces";
import { ORIKO_ICON_ID, ORIKO_ICON_SVG } from "./core/icon";
import { ConfirmSweepModal } from "./confirm";
import { findOrphans, removeMedia, staleKeys } from "./sweep";
import { OrikoSettingTab } from "./settings-tab";
import { OrikoView, VIEW_TYPE_GRID } from "./view";
import { ApiKeyEngine } from "./api-engine";
import { ClaudeCodeEngine, claudeAvailable } from "./claude-engine";
import { PlusAccount, OrikoPlusEngine } from "./plus-engine";
import { INSTALL_KEY, LICENSE_SECRET, installLabel } from "./core/plus-engine";
import { SwitchingEngine, effectiveEngine, engineBlocker, engineReady } from "./core/engines";
import { API_KEY_SECRET } from "./core/engines";
import type { EngineBlocker, EngineKind, EngineState } from "./core/engines";
import { DescribeService } from "./describe-service";
import { AutoDescribe, clipComplete } from "./core/auto-describe";
import { needsDescribing } from "./core/describe";

export default class OrikoPlugin extends Plugin {
  settings: OrikoSettings = DEFAULT_SETTINGS;
  index!: ClippingIndex;
  archiver!: ArchiveService;
  steam!: SteamService;
  posts!: PostService;
  /** Each picture's palette on this device, for the Color filter. */
  colors!: ColorService;
  revisit!: RevisitService;
  capture!: CaptureService;
  describer!: DescribeService;
  /** Describes clippings that land while the wall is open, when the setting asks for it. */
  private autoDescribe!: AutoDescribe;
  /** Trevware Plus's account calls, for the engine and for settings. */
  plus!: PlusAccount;
  /** The last shared file this device wrote, to recognise its own echo. */
  private wroteShared = "";
  private archiveTimer = 0;
  /** A download pass is scheduled and hasn't started, which Describe for new clips waits out. */
  private archiveQueued = false;

  /**
   * Schedules the background archive pass, debounced: a sync storm of
   * created files coalesces into one pass instead of stacking timers, and
   * the pending timer is cleared on unload so nothing fires afterwards.
   */
  private scheduleArchive(delayMs: number): void {
    window.clearTimeout(this.archiveTimer);
    this.archiveQueued = true;
    this.archiveTimer = window.setTimeout(() => {
      this.archiveQueued = false;
      // The download is a new clipping's last step here, so its end is
      // when Describe for new clippings looks again.
      void this.archiver.archiveMissing().then(() => this.autoDescribe.check());
    }, delayMs);
  }

  private steamTimer = 0;

  /**
   * Asks Steam about any game clipping that is due, debounced like the
   * archive pass. Runs whether or not automatic downloads are on, because a
   * store card is drawn from what Steam says, not from saved files; the
   * setting only decides whether the art is saved into the vault as well.
   */
  scheduleLookups(delayMs: number): void {
    window.clearTimeout(this.steamTimer);
    // Posts ride the same timer: both are a per-device look-up that a new
    // clipping wants answered quickly and a sync storm wants once.
    this.steamTimer = window.setTimeout(() => {
      void this.steam.refresh(this.settings.archiveOnCreate);
      void this.posts.refresh();
    }, delayMs);
  }

  async onload(): Promise<void> {
    addIcon(ORIKO_ICON_ID, ORIKO_ICON_SVG);
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
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/oriko`
    );
    await this.archiver.loadCache();
    this.steam = new SteamService(
      this.app,
      () => this.settings,
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/oriko`,
      () => this.archiver.cache,
      () => this.index.records()
    );
    await this.steam.load();
    this.posts = new PostService(
      this.app,
      () => this.settings,
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/oriko`,
      () => this.index.records()
    );
    await this.posts.load();
    this.colors = new ColorService(
      this.app,
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/oriko`
    );
    await this.colors.load();
    this.register(() => this.colors.stop());
    this.revisit = new RevisitService(
      this.app,
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/oriko`
    );
    await this.revisit.load();
    this.plus = new PlusAccount({
      license: () => this.plusLicense(),
      install: () => this.plusInstall(),
      label: () => installLabel(platformName(), this.app.vault.getName()),
    });
    this.describer = new DescribeService(
      this.app,
      new SwitchingEngine(
        {
          "claude-code": new ClaudeCodeEngine(() => this.settings.describePreferLogin),
          "api-key": new ApiKeyEngine(() => this.describeKey()),
          "oriko-plus": new OrikoPlusEngine(this.plus, () => this.plusLicense()),
        },
        () => this.describeEngine()
      ),
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/oriko`,
      () => this.index.records(),
      (path) => this.index.get(path),
      () => this.archiver.cache
    );
    await this.describer.load();
    // A run still going when the plugin unloads would keep Claude Code processes alive.
    this.register(() => this.describer.stop());
    this.autoDescribe = new AutoDescribe({
      enabled: () => this.settings.describeNew && this.describeAvailable(),
      complete: (path) => {
        const record = this.index.get(path);
        if (!record) return false;
        const downloading = this.settings.archiveOnCreate && (this.archiveQueued || this.archiver.busy);
        return clipComplete(
          record.media,
          (link) => this.app.metadataCache.getFirstLinkpathDest(link, path) !== null,
          downloading
        );
      },
      needs: (path) => {
        const record = this.index.get(path);
        return record !== undefined && needsDescribing([record]).length > 0;
      },
      busy: () => this.describer.busy,
      // Through the wall, which owns the undo entry and redraws the tiles as
      // labels land. With no wall open the clips stay for Describe uncategorized.
      run: (paths) => this.wall()?.describeArrived(paths) ?? Promise.resolve(),
    });
    this.index.onArrived((path) => this.autoDescribe.arrived(path));
    // A run anyone started ends with a look at the clips queued behind it.
    this.describer.onIdle = () => this.autoDescribe.check();
    this.register(() => this.autoDescribe.clear());
    this.register(() => window.clearTimeout(this.steamTimer));
    // Prices move while Obsidian stays open for days. The pass asks only
    // about games whose answer is a day old, so an hourly look costs nothing.
    this.registerInterval(window.setInterval(() => this.scheduleLookups(0), 60 * 60 * 1000));
    this.capture = new CaptureService(
      this.app,
      () => this.settings,
      this.archiver,
      this.index
    );
    this.capture.onXDetails = (id, details) => this.posts.seed("x", id, details);
    // Describe for new clippings is capture's own last step: capture says
    // which note it is about to write, and hands it over once it is done.
    this.capture.onClaim = (path) => this.autoDescribe.claim(path);
    this.capture.onCaptured = (path) => this.autoDescribe.captured(path);

    this.registerView(
      VIEW_TYPE_GRID,
      (leaf: WorkspaceLeaf) => new OrikoView(leaf, this)
    );

    // obsidian://oriko?url=… — the share-sheet route in. An iOS Shortcut
    // hands the shared link straight here, so clipping from another app
    // never touches the clipboard. Prose around the link is tolerated
    // because share sheets send captions, not bare URLs.
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
      void this.activateView().then((view) => {
        const s = this.settings;
        const grid = sharedClipGrid(s.sharedClipTarget, s.activeGrid, s.homeGridName, s.grids);
        if (grid !== null || !view) return this.capture.capture(url, grid ?? undefined);
        view.pickGridAndClip(url);
      });
    };
    this.registerObsidianProtocolHandler("oriko", handleClipUri);

    this.addSettingTab(new OrikoSettingTab(this.app, this));
    installRepair(this);

    this.addRibbonIcon(ORIKO_ICON_ID, "Open Oriko", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open",
      name: "Open the wall",
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
        const view = this.app.workspace.getActiveViewOfType(OrikoView);
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
        const view = this.app.workspace.getActiveViewOfType(OrikoView);
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

    // The wall's whole pipeline runs blind on mobile, where there is no
    // console to ask; this puts the paint's own arithmetic on the clipboard
    // so a phone can answer "why is this tile missing" by pasting.
    this.addCommand({
      id: "copy-diagnostics",
      name: "Copy grid diagnostics",
      callback: async () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)[0];
        const view = leaf?.view instanceof OrikoView ? leaf.view : null;
        const state = view?.diagnosticState();
        const report = buildDiagnostics({
          version: this.manifest.version,
          platform: Platform.isMobile ? "mobile" : "desktop",
          activeGrid: state?.grid ?? this.settings.activeGrid,
          home: this.settings.homeGridName,
          registered: this.settings.grids.map((grid) => grid.name),
          records: this.index.records(),
          cache: this.archiver.cache,
          unloadable: state?.unloadable ?? [],
          filtered: state?.filtered ?? false,
        });
        await navigator.clipboard.writeText(report);
        new Notice("Oriko: diagnostics copied to the clipboard");
      },
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
        this.scheduleLookups(1000);
        // A clipping added afterwards, by the Web Clipper or by Oriko itself,
        // gets its store card without waiting for the hourly look.
        // Short, because a store page's card waits in its building state
        // until Steam has answered; long enough to fold a sync storm into one.
        this.index.onChange(() => this.scheduleLookups(400));
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
        if (!(f instanceof TFile)) return;
        // A picture or video a synced clip was waiting on may be this file.
        this.autoDescribe.check();
        if (!admits(f.path)) return;
        // The Web Clipper writes the body and frontmatter in stages, so
        // give it a moment before scanning for media to download. Queued
        // before the scan, so a new clip counts as downloading from the
        // moment it arrives.
        if (this.settings.archiveOnCreate) {
          this.scheduleArchive(2000);
        }
        void this.index.handleModify(f);
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
        if (!(f instanceof TFile)) return;
        this.autoDescribe.renamed(oldPath, f.path);
        if (admits(oldPath)) void this.index.handleRename(f, oldPath);
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
    // Store art is saved by its own pass, which the setting otherwise skips.
    void this.steam.refresh(true);
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

  /** Opens the wall, or brings it forward, and hands back its view. */
  async activateView(): Promise<OrikoView | null> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID);
    let leaf = existing[0];
    if (leaf) {
      await this.app.workspace.revealLeaf(leaf);
    } else {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_GRID, active: true });
    }
    return leaf.view instanceof OrikoView ? leaf.view : null;
  }

  /** Where the vault's half of the settings lives. */
  private sharedPath(): string {
    return normalizePath(`${this.settings.clippingsFolder}/${SHARED_FILE}`);
  }

  /** Where it lived before it was markdown. */
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
    // Adapter, not the Vault API, throughout this method and writeShared:
    // it runs at onload, before the vault index is populated on a cold
    // start, and getFileByPath answering null here once cost a device its
    // grids. The adapter reads the filesystem and is always ready.
    const adapter = this.app.vault.adapter;

    if (await adapter.exists(path)) {
      try {
        const body = await adapter.read(path);
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

    // The names this file has carried before. Read once, so a vault that
    // already published one carries over instead of starting again, and
    // then retired: leaving both would be two files claiming to define the
    // same grids.
    for (const name of LEGACY_SHARED_FILES) {
      const legacy = normalizePath(`${this.settings.clippingsFolder}/${name}`);
      if (!(await adapter.exists(legacy))) continue;
      try {
        const raw = extractShared(await adapter.read(legacy));
        if (raw !== null) {
          this.settings = withShared(this.settings, parseShared(raw, sharedOf(this.settings)));
        }
      } catch {
        // Nothing to carry over; the write below publishes what we have.
      }
      await this.writeShared();
      // To the trash rather than deleted outright: it is the plugin's own
      // file, but it is in the user's vault.
      await adapter.trashLocal(legacy).catch(() => {});
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
    // Adapter for the same reason syncShared gives: this can run at onload,
    // when the vault index cannot yet answer for the folder or the file.
    if (folder && !(await this.app.vault.adapter.exists(normalizePath(folder)))) return;
    await this.app.vault.adapter.write(path, body);
  }

  /**
   * Picks up a shared file that has changed underneath us, which is what a
   * sync delivering another device's grids looks like from here.
   */
  private watchShared(): void {
    const reread = async (path: string): Promise<void> => {
      if (path !== this.sharedPath()) return;
      let body: string;
      try {
        body = await this.app.vault.adapter.read(this.sharedPath());
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
        if (leaf.view instanceof OrikoView) leaf.view.refreshGrids();
      }
    };

    this.registerEvent(this.app.vault.on("modify", (file) => void reread(file.path)));
    this.registerEvent(this.app.vault.on("create", (file) => void reread(file.path)));
  }

  /** Describe is offered on desktop, when switched on, and once its engine can run. */
  describeAvailable(): boolean {
    if (!this.settings.describeEnabled || !Platform.isDesktopApp) return false;
    return engineReady(this.describeState());
  }

  /** What the engine is missing on this device, when Describe is on but can't run. */
  describeBlocked(): EngineBlocker | null {
    if (!this.settings.describeEnabled || !Platform.isDesktopApp) return null;
    return engineBlocker(this.describeState());
  }

  private describeState(): EngineState {
    const engine = this.describeEngine();
    return {
      enabled: true,
      desktop: true,
      engine,
      claudeFound: engine === "claude-code" && claudeAvailable(),
      hasKey: engine === "api-key" && this.describeKey() !== null,
      hasLicense: engine === "oriko-plus" && this.plusLicense() !== null,
    };
  }

  /** The first open wall, or null when none is open. */
  private wall(): OrikoView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)[0];
    return leaf?.view instanceof OrikoView ? leaf.view : null;
  }

  /** The engine Describe runs on: the user's pick, or Claude Code when installed until they pick. */
  describeEngine(): EngineKind {
    return effectiveEngine(this.settings.describeEngine, Platform.isDesktopApp && claudeAvailable());
  }

  /** The Trevware Plus license key, from Obsidian's keychain on this device. */
  plusLicense(): string | null {
    return this.app.secretStorage.getSecret(LICENSE_SECRET)?.trim() || null;
  }

  /** This device's Trevware Plus install id, made the first time it is asked for. */
  plusInstall(): string {
    const saved: unknown = this.app.loadLocalStorage(INSTALL_KEY);
    if (typeof saved === "string" && saved) return saved;
    const id = crypto.randomUUID();
    this.app.saveLocalStorage(INSTALL_KEY, id);
    return id;
  }

  /** The user's Anthropic API key, from Obsidian's keychain on this device. */
  describeKey(): string | null {
    return this.app.secretStorage.getSecret(API_KEY_SECRET)?.trim() || null;
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<OrikoSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
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
    if (!isCardMode(this.settings.steamCards)) this.settings.steamCards = DEFAULT_SETTINGS.steamCards;
    if (!isCardMode(this.settings.xCards)) this.settings.xCards = DEFAULT_SETTINGS.xCards;
    if (!isRevisitForget(this.settings.revisitForget)) this.settings.revisitForget = DEFAULT_SETTINGS.revisitForget;
    // A post site added since this vault last saved its settings starts the
    // way X posts already show, so the wall does not change under you.
    for (const key of ["instagramCards", "threadsCards", "youtubeCards"] as const) {
      if (!isCardMode(this.settings[key])) this.settings[key] = this.settings.xCards;
    }
    setToolOverrides({
      ytdlp: this.settings.ytdlpPath,
      ffmpeg: this.settings.ffmpegPath,
      claude: this.settings.claudePath,
    });
  }

  async saveSettings(): Promise<void> {
    // The vault's half goes to the vault and is kept out of data.json, so
    // there is one place a grid is defined rather than two that can disagree.
    const local = { ...this.settings } as Partial<OrikoSettings>;
    for (const key of Object.keys(sharedOf(this.settings))) {
      delete local[key as keyof OrikoSettings];
    }
    await this.saveData(local);
    await this.writeShared();
    setToolOverrides({
      ytdlp: this.settings.ytdlpPath,
      ffmpeg: this.settings.ffmpegPath,
      claude: this.settings.claudePath,
    });

    // Saving is also how an open wall hears about it. Every caller of this
    // already means "the settings have changed", so there is no second thing
    // for the settings tab to remember to call, and no way for a new toggle
    // to be added that silently does not take effect.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof OrikoView) leaf.view.applyLiveSettings();
    }
  }
}

/** How Trevware Plus names this device, beside the vault's name. */
function platformName(): string {
  if (Platform.isMacOS) return "macOS";
  if (Platform.isWin) return "Windows";
  if (Platform.isLinux) return "Linux";
  return "Desktop";
}
