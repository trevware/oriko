import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { absolutePath } from "./convert";
import { dedupeMedia, sourceVideoKeyFor } from "./normalize";
import { copyToDownloads, revealInFinder, systemAvailable } from "./system";
import { ActionBar } from "./action-bar";
import { ConfirmDeleteModal } from "./confirm";
import { ContextMenu } from "./context-menu";
import { DetailView } from "./detail";
import type { MenuItem } from "./context-menu";
import {
  GridEditModal,
  GridsPanelModal,
  confirmGridDelete,
  openGridEditor,
} from "./grid-modals";
import type { GridsController } from "./grid-modals";
import { GridRenderer } from "./grid";
import type PowerGridPlugin from "./main";
import { PlaybackController } from "./playback";
import { ProgressBar } from "./progress";
import { SpaceBar } from "./space-bar";
import {
  filterByGrid,
  hotkeyPosition,
  membersOf,
  orderedGrids,
} from "./spaces";
import type { GridSpace } from "./spaces";
import { buildTiles } from "./tile";

export const VIEW_TYPE_GRID = "power-grid";

export class PowerGridView extends ItemView {
  private grid: GridRenderer | null = null;
  private observer: ResizeObserver | null = null;
  private playback: PlaybackController | null = null;
  private progress: ProgressBar | null = null;
  private actionBar: ActionBar | null = null;
  private menu: ContextMenu | null = null;
  private detail: DetailView | null = null;
  private spaceBar: SpaceBar | null = null;
  private onGridKey: ((event: KeyboardEvent) => void) | null = null;
  /**
   * Covers that failed to load, keyed by note path and remembered by
   * signature. Recording the signature is what lets a clipping return once
   * archiving gives it a different, working cover.
   */
  private unloadable = new Map<string, string>();

  constructor(leaf: WorkspaceLeaf, private plugin: PowerGridPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GRID;
  }

  getDisplayText(): string {
    return "Power Grid";
  }

  getIcon(): string {
    return "layout-grid";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("power-grid-view");

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

    this.actionBar = new ActionBar(this.contentEl, {
      onDelete: () => this.confirmDelete(this.grid?.selectedIds() ?? []),
    });
    this.grid.onSelectionChanged = (ids: string[]) => this.actionBar?.setSelection(ids);

    this.menu = new ContextMenu(this.contentEl);
    this.grid.onContextRequested = (ids, x, y) =>
      this.menu?.open(this.menuItems(ids), x, y);

    this.spaceBar = new SpaceBar(this.contentEl, {
      onSwitcher: (x, y) => this.openSwitcher(x, y),
      onCreate: (x, y) => this.openCreate(x, y),
      onSettings: (x, y) => this.openSettings(x, y),
    });
    this.spaceBar.setActive(this.activeGrid());

    this.onGridKey = (event: KeyboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(PowerGridView) !== this) return;
      // The detail view registers in the capture phase too and owns its keys
      // while it is up.
      if (this.detail?.isOpen) return;
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;

      const position = hotkeyPosition(event.key);
      if (position === null) return;
      const grid = this.allGrids()[position];
      if (!grid) return;

      // Obsidian binds these to tab switching, so this only wins while the
      // wall has focus, the same bargain the zoom keys already make.
      event.preventDefault();
      event.stopPropagation();
      void this.activate(grid.name);
    };
    document.addEventListener("keydown", this.onGridKey, true);
    this.grid.onExportRequested = (ids) => void this.exportToDownloads(ids);

    this.detail = new DetailView(this.app, this.contentEl, {
      onExport: (id) => void this.exportToDownloads([id]),
      onReveal: (id) => this.revealFirstFile(id),
      onDelete: (id) => this.confirmDelete([id]),
      onOpenNote: (id) => {
        const file = this.app.vault.getAbstractFileByPath(id);
        if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
      },
    });
    this.detail.onClosed = () => {
      this.grid?.focusTile(null);
      this.playback?.setEnabled(this.plugin.settings.autoplayVideo);
    };
    this.grid.onOpenDetail = (model, origin) => {
      // Hidden when the stage appears, not on click: the media's true size
      // is resolved first, and hiding early leaves a hole in the meantime.
      const detail = this.detail;
      if (!detail) return;
      detail.onStageReady = () => {
        this.grid?.focusTile(model.id);
        // Nothing behind the backdrop is worth decoding. This mattered less
        // when only four tiles could play at once.
        this.playback?.setEnabled(false);
      };
      void detail.open(model, origin);
    };

    this.grid.onSourceFailed = (id: string, signature: string) => {
      if (this.unloadable.get(id) === signature) return;
      this.unloadable.set(id, signature);
      this.refresh();
    };

    this.plugin.index.onChange(() => this.refresh());
    this.plugin.archiver.onChange(() => this.refresh());

    this.observer = new ResizeObserver(() => this.grid?.relayout());
    this.observer.observe(this.contentEl);

    // Paste a link anywhere in the grid to clip it, the way you would drop
    // a URL into a board app.
    this.registerDomEvent(document, "paste", (event: ClipboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(PowerGridView) !== this) return;
      const data = event.clipboardData;
      if (!data) return;

      // Image data first: copying an image from a browser also puts its URL
      // on the clipboard, and the bytes in hand beat a link to fetch.
      const file = Array.from(data.files).find((f) => f.type.startsWith("image/"));
      if (file) {
        event.preventDefault();
        void this.plugin.capture.captureImage(file);
        return;
      }

      const text = data.getData("text/plain")?.trim();
      if (!text) return;
      event.preventDefault();
      void this.plugin.capture.capture(text);
    });

    this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.onGridKey) document.removeEventListener("keydown", this.onGridKey, true);
    this.onGridKey = null;
    this.spaceBar?.destroy();
    this.spaceBar = null;
    this.observer?.disconnect();
    this.observer = null;
    this.playback?.destroy();
    this.playback = null;
    this.plugin.capture.onProgress = null;
    this.plugin.capture.onFinished = null;
    this.progress?.destroy();
    this.progress = null;
    this.actionBar?.destroy();
    this.actionBar = null;
    this.menu?.close();
    this.menu = null;
    this.detail?.close(true);
    this.detail = null;
    this.grid?.destroy();
    this.grid = null;
  }

  /** Every archived file belonging to a clipping, originals only. */
  private filesFor(id: string): string[] {
    const record = this.plugin.index.get(id);
    if (!record) return [];

    const cache = this.plugin.archiver.cache;
    const paths: string[] = [];

    if (record.source) {
      const video = cache.get(sourceVideoKeyFor(record.source));
      if (video?.file) paths.push(video.file);
    }
    // Looked up through the same dedupe the archiver used, so the keys
    // match; comparing a raw URL against a normalized key would not.
    for (const media of dedupeMedia(record.media)) {
      const entry = cache.get(media.key);
      if (entry?.file) paths.push(entry.file);
    }
    return [...new Set(paths)];
  }

  private menuItems(ids: string[]): MenuItem[] {
    const n = ids.length;
    const count = n === 1 ? "1 selected" : `${n} selected`;
    const items: MenuItem[] = [];

    if (n === 1) {
      items.push({
        icon: "file-text",
        label: "Open note",
        onSelect: () => {
          const file = this.app.vault.getAbstractFileByPath(ids[0]);
          if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
        },
      });
    }

    if (systemAvailable()) {
      items.push({
        icon: "download",
        label: "Export to Downloads",
        detail: "⌘E",
        onSelect: () => void this.exportToDownloads(ids),
      });

      if (n === 1) {
        items.push({
          icon: "folder",
          label: "Reveal in Finder",
          onSelect: () => this.revealFirstFile(ids[0]),
        });
      }
    }

    if (this.allGrids().length > 1) {
      items.push({
        icon: "corner-up-right",
        label: "Move to grid",
        submenu: this.allGrids().map((grid) => ({
          icon: grid.icon,
          label: grid.name,
          onSelect: () => void this.moveTo(ids, grid.name),
        })),
      });
    }

    items.push({
      icon: "trash-2",
      label: "Delete",
      detail: count,
      destructive: true,
      onSelect: () => this.confirmDelete(ids),
    });

    return items;
  }

  private revealFirstFile(id: string): void {
    const file = this.filesFor(id)[0];
    if (!file) {
      new Notice("Power Grid: nothing archived for this clipping yet");
      return;
    }
    const absolute = absolutePath(this.app.vault, normalizePath(file));
    if (!absolute || !revealInFinder(absolute)) {
      new Notice("Power Grid: could not reveal the file");
    }
  }

  async exportToDownloads(ids: string[]): Promise<void> {
    let copied = 0;
    for (const id of ids) {
      for (const file of this.filesFor(id)) {
        const absolute = absolutePath(this.app.vault, normalizePath(file));
        if (!absolute) continue;
        const name = file.slice(file.lastIndexOf("/") + 1);
        if (copyToDownloads(absolute, name)) copied++;
      }
    }
    new Notice(
      copied === 0
        ? "Power Grid: nothing archived to export yet"
        : `Power Grid: exported ${copied} file${copied === 1 ? "" : "s"} to Downloads`
    );
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
        new Notice(`Power Grid: could not delete ${file.basename} (${String(error)})`);
      }
    }
    this.grid?.clearSelection();
    new Notice(
      removed === 1 ? "Power Grid: 1 note moved to trash" : `Power Grid: ${removed} notes moved to trash`
    );
  }

  refresh(): void {
    if (!this.grid) return;
    const tiles = buildTiles(
      filterByGrid(
        this.plugin.index.records(),
        this.activeGrid().name,
        this.plugin.settings.homeGridName,
        this.registered()
      ),
      this.plugin.archiver.cache,
      this.unloadable
    );
    this.grid.setTiles(tiles);
  }

  // ---- Grids -------------------------------------------------------------

  private homeGrid(): GridSpace {
    return {
      name: this.plugin.settings.homeGridName,
      icon: this.plugin.settings.homeGridIcon,
    };
  }

  private registered(): Set<string> {
    return new Set(this.plugin.settings.grids.map((grid) => grid.name));
  }

  private allGrids(): GridSpace[] {
    return orderedGrids(this.homeGrid(), this.plugin.settings.grids);
  }

  /** Falls back to home, so a stale saved name cannot leave the wall empty. */
  private activeGrid(): GridSpace {
    const name = this.plugin.settings.activeGrid;
    return this.allGrids().find((grid) => grid.name === name) ?? this.homeGrid();
  }

  private async activate(name: string): Promise<void> {
    if (this.plugin.settings.activeGrid === name) return;
    this.plugin.settings.activeGrid = name;
    await this.plugin.saveSettings();

    // Selection and camera both describe tiles that are about to be replaced.
    this.grid?.clearSelection();
    this.refresh();
    this.grid?.resetView();
    this.spaceBar?.setActive(this.activeGrid());
  }

  /**
   * The only place the plugin writes to a note it did not create, and it
   * writes exactly one key. processFrontMatter rewrites the frontmatter block
   * alone, so the clipped body is never touched.
   */
  private async assign(paths: string[], target: string): Promise<number> {
    const home = this.plugin.settings.homeGridName;
    let written = 0;

    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (!(file instanceof TFile)) continue;
      try {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          // Home is the absence of the key, so moving something back removes
          // it rather than writing the home name in.
          if (target === home) delete fm.grid;
          else fm.grid = target;
        });
        written++;
      } catch (error) {
        new Notice(`Power Grid: could not move ${path} (${String(error)})`);
      }
    }
    return written;
  }

  private openSwitcher(x: number, y: number): void {
    const active = this.activeGrid().name;
    const items: MenuItem[] = this.allGrids().map((grid, index) => ({
      icon: grid.icon,
      label: grid.name,
      detail: index < 9 ? `\u2318${index + 1}` : undefined,
      // Shown but inert: the set reads whole, and selecting it would do nothing.
      disabled: grid.name === active,
      onSelect: () => void this.activate(grid.name),
    }));
    this.menu?.open(items, x, y);
  }

  /** Settings for the grid on screen, with the whole set one step further in. */
  private openSettings(x: number, y: number): void {
    const active = this.activeGrid();
    const index = this.plugin.settings.grids.findIndex((grid) => grid.name === active.name);
    const controller = this.gridsController();
    const isHome = index === -1;

    this.menu?.open(
      [
        {
          icon: "pencil",
          label: "Edit grid",
          detail: active.name,
          onSelect: () =>
            openGridEditor(this.app, controller, active, isHome ? undefined : index, () =>
              this.refresh()
            ),
        },
        {
          icon: "trash-2",
          label: "Delete grid",
          // Home is where an unknown grid falls back to, so something has to
          // always be there. Shown rather than hidden, so the row does not
          // appear and vanish depending on where you are.
          detail: isHome ? "Home grid" : undefined,
          disabled: isHome,
          destructive: !isHome,
          onSelect: () => confirmGridDelete(this.app, controller, active, index),
        },
        {
          icon: "layers",
          label: "Manage grids",
          divider: true,
          detail: `${this.allGrids().length} grids`,
          onSelect: () => new GridsPanelModal(this.app, controller).open(),
        },
      ],
      x,
      y
    );
  }

  private openCreate(x: number, y: number): void {
    this.menu?.open(
      [
        {
          icon: "link",
          label: "Clip link",
          detail: "\u2318N",
          onSelect: () => void this.plugin.capture.captureFromClipboard(),
        },
        {
          icon: "image",
          label: "Clip image",
          detail: "\u21e7\u2318N",
          onSelect: () => void this.plugin.clipImageFromClipboard(),
        },
        {
          icon: "layers",
          label: "New grid",
          divider: true,
          onSelect: () => this.promptNewGrid(),
        },
      ],
      x,
      y
    );
  }

  private promptNewGrid(): void {
    new GridEditModal(this.app, {
      heading: "New grid",
      cta: "Create",
      initial: { name: "", icon: "star" },
      existing: this.plugin.settings.grids.map((grid) => grid.name),
      home: this.plugin.settings.homeGridName,
      onSubmit: (space) => void this.gridsController().create(space),
    }).open();
  }

  private async moveTo(ids: string[], target: string): Promise<void> {
    const moved = await this.assign(ids, target);
    this.grid?.clearSelection();
    new Notice(
      moved === 1
        ? `Power Grid: 1 clipping moved to ${target}`
        : `Power Grid: ${moved} clippings moved to ${target}`
    );
  }

  private gridsController(): GridsController {
    const settings = this.plugin.settings;

    return {
      home: () => this.homeGrid(),
      grids: () => settings.grids,
      memberCount: (name) => membersOf(this.plugin.index.records(), name).length,

      create: async (space) => {
        settings.grids.push(space);
        await this.plugin.saveSettings();
        // Land in what you just made rather than leaving it to be found.
        await this.activate(space.name);
      },

      rename: async (from, next) => {
        const members = membersOf(this.plugin.index.records(), from).map((r) => r.path);

        if (from === settings.homeGridName) {
          settings.homeGridName = next.name;
          settings.homeGridIcon = next.icon;
        } else {
          const entry = settings.grids.find((grid) => grid.name === from);
          if (!entry) return;
          entry.name = next.name;
          entry.icon = next.icon;
        }
        if (settings.activeGrid === from) settings.activeGrid = next.name;
        await this.plugin.saveSettings();

        // Renaming home rewrites only the notes that spell it out; the rest
        // belong to it by absence and need no touching. assign() then drops
        // their key entirely, since the target is home.
        if (next.name !== from && members.length > 0) {
          await this.assign(members, next.name);
        }

        this.spaceBar?.setActive(this.activeGrid());
        this.refresh();
      },

      reorder: async (index, delta) => {
        const target = index + delta;
        if (target < 0 || target >= settings.grids.length) return;
        const [moved] = settings.grids.splice(index, 1);
        settings.grids.splice(target, 0, moved);
        await this.plugin.saveSettings();
      },

      remove: async (index) => {
        const [removed] = settings.grids.splice(index, 1);
        if (!removed) return;
        // Members keep a key that no longer resolves, which spaces.ts reads as
        // home. Nothing is rewritten, so recreating the grid undoes this.
        if (settings.activeGrid === removed.name) {
          settings.activeGrid = settings.homeGridName;
        }
        await this.plugin.saveSettings();
        this.spaceBar?.setActive(this.activeGrid());
        this.refresh();
      },
    };
  }
}
