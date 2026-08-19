import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { absolutePath } from "./convert";
import { dedupeMedia, sourceVideoKeyFor } from "./normalize";
import { copyToDownloads, revealInFinder, systemAvailable } from "./system";
import { ActionBar } from "./action-bar";
import { buildCommands } from "./commands";
import type { PaletteContext } from "./commands";
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
import { Palette } from "./palette";
import { LayerPanel, PanelToggle } from "./panel";
import { resourceUrl } from "./convert";
import { PlaybackController } from "./playback";
import { ProgressBar } from "./progress";
import {
  FACETS,
  activeCount,
  emptyFilter,
  facetsOf,
  isFilterEmpty,
  matchesFilter,
  toggleFacet,
} from "./filter";
import type { Facet, FilterState } from "./filter";
import { SpaceBar } from "./space-bar";
import { describeFiles } from "./media-refs";
import { orphansAfterDeleting, removeMedia } from "./sweep";
import {
  effectiveGrid,
  filterByGrid,
  hotkeyPosition,
  membersOf,
  orderedGrids,
} from "./spaces";
import type { GridSpace } from "./spaces";
import { buildTiles, previewOf } from "./tile";
import type { TileModel } from "./tile";

export const VIEW_TYPE_GRID = "power-grid";

/**
 * Most clippings the palette lists at once. A cap rather than a scroll to
 * the horizon: past a handful you are not reading the list any more, you are
 * typing more of the query, and leaving room below them is what keeps the
 * commands reachable without scrolling.
 */
const PALETTE_CLIPPINGS = 8;

/**
 * How long a just-clipped note stays worth flying to.
 *
 * The flight waits for the tile rather than firing on the spot, because a
 * fresh clipping often has no cover until the archiver resolves one. Some
 * never get a renderable cover at all, and without a deadline that clipping
 * would leave a reveal armed to go off on whatever unrelated repaint came
 * next, minutes later.
 */
const REVEAL_WINDOW_MS = 20000;

export class PowerGridView extends ItemView {
  private grid: GridRenderer | null = null;
  private observer: ResizeObserver | null = null;
  private playback: PlaybackController | null = null;
  private progress: ProgressBar | null = null;
  private actionBar: ActionBar | null = null;
  private menu: ContextMenu | null = null;
  private detail: DetailView | null = null;
  private spaceBar: SpaceBar | null = null;
  private palette: Palette | null = null;
  private panel: LayerPanel | null = null;
  private panelToggle: PanelToggle | null = null;
  /** A clipping just made here, to fly to as soon as it has a tile. */
  private pendingReveal: { path: string; until: number } | null = null;
  private onGridKey: ((event: KeyboardEvent) => void) | null = null;
  private refreshFrame = 0;
  /**
   * One filter per grid, kept for the session.
   *
   * Keyed by grid name, so it follows a rename and goes with a deletion. Not
   * written to disk: a filter hides things, and one that survives a restart
   * becomes a wall that looks emptier than it is for a reason nobody
   * remembers. Within a session the count on the filter button is the
   * reminder, which is why retaining it across switches is safe and
   * retaining it across launches is not.
   */
  private filters = new Map<string, FilterState>();
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
    this.plugin.capture.onFinished = (label, path) => {
      this.progress?.finish(`Clipped ${label}`);
      // Armed, not flown: the tile does not exist until the index change
      // this capture is about to cause has been painted.
      this.pendingReveal = { path, until: performance.now() + REVEAL_WINDOW_MS };
    };

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
    this.grid.onSelectionChanged = (ids: string[]) => {
      this.actionBar?.setSelection(ids);
      this.panel?.setSelection(ids);
    };

    this.menu = new ContextMenu(this.contentEl);
    this.grid.onContextRequested = (ids, x, y) =>
      this.menu?.open(this.menuItems(ids), x, y);

    this.spaceBar = new SpaceBar(this.contentEl, {
      onSwitcher: (x, y) => this.openSwitcher(x, y),
      onCreate: (x, y) => this.openCreate(x, y),
      onSettings: (x, y) => this.openSettings(x, y),
      onFilter: (x, y) => this.openFilter(x, y),
    });
    this.spaceBar.setActive(this.activeGrid());

    this.panel = new LayerPanel(this.contentEl, this.app.vault, {
      // Selection semantics belong to the wall, so the panel forwards rather
      // than deciding what a shift-click means.
      onPick: (id, mode) => this.grid?.pick(id, mode),
      onHover: (id) => this.grid?.highlightTile(id),
    });
    this.panelToggle = new PanelToggle(this.contentEl, () => this.togglePanel());
    if (this.plugin.settings.panelOpen) this.panel.open();
    this.panelToggle.setOpen(this.plugin.settings.panelOpen);

    this.palette = new Palette(this.contentEl, {
      commands: () => buildCommands(this.paletteContext()),
      // Every clipping in the vault, not just this wall's: the whole point
      // of searching is to find the one you cannot remember filing.
      clippings: () => this.plugin.index.records(),
      options: () => ({
        limit: PALETTE_CLIPPINGS,
        activeGrid: this.activeGrid().name,
        homeGrid: this.plugin.settings.homeGridName,
        registered: this.registered(),
      }),
      onClipping: (path) => this.revealClipping(path),
      preview: (path) => this.previewUrl(path),
    });

    this.onGridKey = (event: KeyboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(PowerGridView) !== this) return;
      // The detail view registers in the capture phase too and owns its keys
      // while it is up.
      if (this.detail?.isOpen) return;
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;

      // Fallback only. ⌘K is claimed by Obsidian's own dispatcher, so the
      // command in main.ts is what actually carries it; this catches ctrl+K
      // and any platform where the chord does reach the document. Skipped
      // when the command already ran, or the two would open and close it in
      // the same keystroke.
      if (event.key.toLowerCase() === "k") {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        this.togglePalette();
        return;
      }

      // The palette has the keyboard while it is up, grid hotkeys included:
      // switching walls out from under a search would leave it answering
      // about a wall that is no longer there.
      if (this.palette?.isOpen) return;

      const position = hotkeyPosition(event.key);
      if (position === null) return;
      const grid = this.allGrids()[position];
      if (!grid) return;

      // Obsidian binds these to tab switching, so this only wins while the
      // wall has focus, the same bargain the zoom keys already make.
      event.preventDefault();
      event.stopPropagation();
      this.activate(grid.name);
    };
    document.addEventListener("keydown", this.onGridKey, true);
    this.grid.onExportRequested = (ids) => void this.exportToDownloads(ids);

    this.detail = new DetailView(this.app, this.contentEl, {
      onExport: (id) => void this.exportToDownloads([id]),
      onReveal: (id) => this.revealFirstFile(id),
      onDelete: (id) => this.confirmDelete([id]),
      onOpenNote: (id) => this.openNote(id),
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
      // Pasting into the palette's search box is typing, not clipping.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
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

  /** Public: the ⌘K command in main.ts drives the palette through this. */
  togglePalette(): void {
    if (this.detail?.isOpen) return;
    this.palette?.toggle();
  }

  async onClose(): Promise<void> {
    this.cancelRefresh();
    if (this.onGridKey) document.removeEventListener("keydown", this.onGridKey, true);
    this.onGridKey = null;
    this.palette?.close();
    this.palette = null;
    this.panel?.close();
    this.panel = null;
    this.panelToggle?.destroy();
    this.panelToggle = null;
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
        onSelect: () => this.openNote(ids[0]),
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

  private openNote(id: string): void {
    const file = this.app.vault.getAbstractFileByPath(id);
    if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
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
    const media = this.doomedMedia(ids);
    new ConfirmDeleteModal(
      this.app,
      titles,
      () => void this.deleteClippings(ids, media.paths),
      media.paths.length > 0 ? describeFiles(media) : undefined
    ).open();
  }

  /** The archived files these clippings would leave behind, and their size. */
  private doomedMedia(ids: string[]) {
    return orphansAfterDeleting(
      this.app,
      this.plugin.index.records(),
      ids,
      this.plugin.archiver.cache,
      this.plugin.settings.attachmentFolder
    );
  }

  /**
   * @param media archived files worked out *before* the notes went, since
   * afterwards the records they were derived from no longer exist. Already
   * reference counted, so nothing a surviving clipping uses is in here.
   */
  private async deleteClippings(ids: string[], media: string[] = []): Promise<void> {
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

    // Only after the notes are gone: a failed trashFile leaves a clipping
    // pointing at media, and that media should still be there.
    const files = removed === ids.length ? media : [];
    const swept = await removeMedia(this.app, this.plugin.archiver.cache, files);
    if (swept > 0) await this.plugin.archiver.saveCache();

    this.grid?.clearSelection();
    const notes = removed === 1 ? "1 note" : `${removed} notes`;
    new Notice(
      swept > 0
        ? `Power Grid: ${notes} and ${swept} media file${swept === 1 ? "" : "s"} moved to trash`
        : `Power Grid: ${notes} moved to trash`
    );
  }

  /**
   * Coalesced to one repaint a frame.
   *
   * The archiver emits once per clipping it finishes, so a pass over a few
   * hundred used to run a few hundred full sorts, filters, tile builds and
   * relayouts, most of them landing in the same frame and all but the last
   * discarded. A switch is exempt: it is a direct answer to a click and has
   * to land now.
   */
  refresh(options: { replace?: boolean } = {}): void {
    if (options.replace) {
      this.cancelRefresh();
      this.paint(options);
      return;
    }
    if (this.refreshFrame) return;
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = 0;
      this.paint({});
    });
  }

  private cancelRefresh(): void {
    if (this.refreshFrame) window.cancelAnimationFrame(this.refreshFrame);
    this.refreshFrame = 0;
  }

  private paint(options: { replace?: boolean }): void {
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

    // Facets are counted from the whole grid, not from what survives the
    // filter: counting the result would make options disappear the moment
    // you used one, leaving no way back.
    this.facets = tiles;
    this.applyFilter(options);
    this.flyToPending();
  }

  /**
   * Moves to a clipping made from this wall, once it has a tile to move to.
   *
   * Left until after the tiles are set, so the layout it needs is the one
   * just computed. A pending that finds no tile is kept rather than dropped:
   * the cover may still be resolving, and the next repaint is the one that
   * will have it.
   */
  private flyToPending(): void {
    const pending = this.pendingReveal;
    if (!pending) return;

    if (performance.now() > pending.until) {
      this.pendingReveal = null;
      return;
    }

    // A filter can hide what was just clipped. Nothing is cleared for it:
    // clipping something is not a request to undo the narrowing you set.
    if (!this.grid?.reveal(pending.path)) return;
    this.pendingReveal = null;
  }

  /**
   * The cheap half of a repaint: the grid's tiles are already built, so
   * narrowing them is a single pass.
   *
   * Toggling a filter changes nothing about the records, so re-sorting them,
   * re-filtering by grid and rebuilding every tile was three passes and a
   * heap of per-record allocation to answer a question that only concerned
   * which of the existing tiles to show.
   */
  private applyFilter(options: { replace?: boolean }): void {
    const filter = this.activeFilter();
    this.spaceBar?.setFilterCount(activeCount(filter));
    const shown = isFilterEmpty(filter)
      ? this.facets
      : this.facets.filter((tile) => matchesFilter(tile, filter));
    this.grid?.setTiles(shown, options);
    // The same list, so a filter narrows both and neither can drift.
    this.panel?.setTiles(shown, this.activeGrid().name);
  }

  /** The grid's tiles before filtering, which is what the facets count. */
  private facets: TileModel[] = [];

  private activeFilter(): FilterState {
    return this.filters.get(this.activeGrid().name) ?? emptyFilter();
  }

  private setFilter(next: FilterState): void {
    if (isFilterEmpty(next)) this.filters.delete(this.activeGrid().name);
    else this.filters.set(this.activeGrid().name, next);
    // Straight to the narrowing pass; the tiles behind it have not changed.
    this.applyFilter({ replace: true });
  }

  private openFilter(x: number, y: number): void {
    const build = (): MenuItem[] => {
      const available = facetsOf(this.facets);
      const filter = this.activeFilter();
      const labels: Record<Facet, string> = {
        categories: "Categories",
        statuses: "Status",
        kinds: "Media type",
        domains: "Source",
      };
      const icons: Record<Facet, string> = {
        categories: "tag",
        statuses: "circle-dot",
        kinds: "image",
        domains: "globe",
      };

      const items: MenuItem[] = FACETS.map((facet) => {
        const values = available[facet];
        const chosen = filter[facet];
        return {
          icon: icons[facet],
          label: labels[facet],
          // Nothing to offer is still worth showing: an absent row reads as a
          // missing feature, a disabled one reads as an empty shelf.
          disabled: values.length === 0,
          detail: values.length === 0 ? "none" : chosen.length > 0 ? `${chosen.length}` : undefined,
          submenu: values.map((entry) => ({
            icon: chosen.includes(entry.value) ? "check" : "",
            label: entry.value,
            detail: String(entry.count),
            keepOpen: true,
            onSelect: () => this.setFilter(toggleFacet(this.activeFilter(), facet, entry.value)),
          })),
        };
      });

      const active = activeCount(filter);
      items.push({
        icon: "circle-slash",
        label: "Clear filters",
        divider: true,
        disabled: active === 0,
        detail: active > 0 ? `${active} active` : undefined,
        keepOpen: true,
        onSelect: () => this.setFilter(emptyFilter()),
      });

      return items;
    };

    this.menu?.open(build(), x, y, build);
  }

  /**
   * Shows or hides the list beside the wall.
   *
   * The wall lays out at the width of its viewport, so the panel takes space
   * from it rather than covering it, and the relayout is explicit: the
   * observer watches the pane, whose size has not changed.
   */
  togglePanel(): void {
    const panel = this.panel;
    if (!panel) return;

    if (panel.isOpen) panel.close();
    else panel.open();

    this.plugin.settings.panelOpen = panel.isOpen;
    this.panelToggle?.setOpen(panel.isOpen);
    if (panel.isOpen) {
      this.panel?.setTiles(this.shownTiles(), this.activeGrid().name);
      this.panel?.setSelection(this.grid?.selectedIds() ?? []);
    } else {
      // Nothing is pointing at a tile any more.
      this.grid?.highlightTile(null);
    }
    this.grid?.relayout();
    void this.plugin.saveSettings();
  }

  /**
   * A thumbnail for any clipping in the vault, tile or no tile.
   *
   * The palette searches every grid, so most results have no tile on this
   * wall to borrow from. Building one for the record is cheap: picking a
   * cover is a handful of map lookups, and it means the list shows the same
   * picture the wall would.
   */
  private previewUrl(path: string): string {
    const record = this.plugin.index.get(path);
    if (!record) return "";
    const [tile] = buildTiles([record], this.plugin.archiver.cache);
    const preview = tile ? previewOf(tile) : null;
    return preview ? resourceUrl(this.app.vault, preview.path, preview.remote) : "";
  }

  /** What the wall is showing right now, filter applied. */
  private shownTiles(): TileModel[] {
    const filter = this.activeFilter();
    return isFilterEmpty(filter)
      ? this.facets
      : this.facets.filter((tile) => matchesFilter(tile, filter));
  }

  // ---- Palette -----------------------------------------------------------

  /**
   * The wall as the palette sees it, rebuilt on every keystroke so its rows
   * describe the selection, filter and grids as they stand rather than as
   * they were when it opened.
   */
  private paletteContext(): PaletteContext {
    const selection = this.grid?.selectedIds() ?? [];

    return {
      selection,
      grids: this.allGrids(),
      activeGrid: this.activeGrid().name,
      homeGrid: this.plugin.settings.homeGridName,
      facets: facetsOf(this.facets),
      filter: this.activeFilter(),
      hasSystem: systemAvailable(),
      // Every row runs the method its context-menu equivalent runs. The two
      // surfaces list different things; neither reimplements the work.
      actions: {
        openNote: (id) => this.openNote(id),
        exportSelection: (ids) => void this.exportToDownloads(ids),
        reveal: (id) => this.revealFirstFile(id),
        move: (ids, grid) => void this.moveTo(ids, grid),
        remove: (ids) => this.confirmDelete(ids),
        switchGrid: (name) => this.activate(name),
        newGrid: () => this.promptNewGrid(),
        editGrid: () => this.editActiveGrid(),
        deleteGrid: () => this.deleteActiveGrid(),
        manageGrids: () => this.manageGrids(),
        toggleFacet: (facet, value) =>
          this.setFilter(toggleFacet(this.activeFilter(), facet, value)),
        clearFilters: () => this.setFilter(emptyFilter()),
        clipLink: () => void this.plugin.capture.captureFromClipboard(),
        clipImage: () => void this.plugin.clipImageFromClipboard(),
        archiveAll: () => this.plugin.archiveAllMedia(),
        selectAll: () => this.grid?.selectAll(),
        resetZoom: () => this.grid?.resetView(),
      },
    };
  }

  /**
   * Lands on a clipping the palette found, wherever it lives: switch grid
   * first if it is on another wall, then centre and select the tile.
   *
   * A filter can hide the very thing that was just searched for. Dropping it
   * is the right answer there, because asking for a clipping by name is a
   * more specific instruction than the narrowing that was left on earlier.
   * With no tile at all (nothing renderable in the note) the note itself is
   * the only place left to go.
   */
  private revealClipping(path: string): void {
    const record = this.plugin.index.get(path);
    if (!record) return;

    const grid = effectiveGrid(record, this.plugin.settings.homeGridName, this.registered());
    this.activate(grid);
    if (this.grid?.reveal(path)) return;

    if (!isFilterEmpty(this.activeFilter())) {
      this.setFilter(emptyFilter());
      if (this.grid?.reveal(path)) {
        new Notice("Power Grid: filter cleared to show that clipping");
        return;
      }
    }

    new Notice("Power Grid: nothing to show on the wall, opening the note");
    this.openNote(path);
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

  private activate(name: string): void {
    if (this.plugin.settings.activeGrid === name) return;
    this.plugin.settings.activeGrid = name;

    // Selection and camera describe tiles that are about to be replaced. The
    // filter does not: each grid keeps its own, so switching restores
    // whatever this one was last narrowed to.
    this.grid?.clearSelection();
    // replace, not add: departing tiles go straight back to the pool so the
    // arrivals can recycle them, and the camera is placed rather than tweened.
    // The arrivals still pop.
    this.refresh({ replace: true });
    this.grid?.resetView(false);
    this.spaceBar?.setActive(this.activeGrid());

    // Persisting which grid you are in is a disk write. Awaiting it before
    // repainting put a file system round trip in front of every switch, which
    // is most of what the first switch felt like.
    void this.plugin.saveSettings();
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
      onSelect: () => this.activate(grid.name),
    }));
    this.menu?.open(items, x, y);
  }

  /** Where the active grid sits in settings.grids, or -1 for home. */
  private activeGridIndex(): number {
    const active = this.activeGrid().name;
    return this.plugin.settings.grids.findIndex((grid) => grid.name === active);
  }

  private editActiveGrid(): void {
    const index = this.activeGridIndex();
    openGridEditor(
      this.app,
      this.gridsController(),
      this.activeGrid(),
      index === -1 ? undefined : index,
      () => this.refresh()
    );
  }

  private deleteActiveGrid(): void {
    const index = this.activeGridIndex();
    // Home is where an unknown grid falls back to, so it always has to exist.
    if (index === -1) return;
    confirmGridDelete(this.app, this.gridsController(), this.activeGrid(), index);
  }

  private manageGrids(): void {
    new GridsPanelModal(this.app, this.gridsController()).open();
  }

  /** Settings for the grid on screen, with the whole set one step further in. */
  private openSettings(x: number, y: number): void {
    const active = this.activeGrid();
    const isHome = this.activeGridIndex() === -1;

    this.menu?.open(
      [
        {
          icon: "pencil",
          label: "Edit grid",
          detail: active.name,
          onSelect: () => this.editActiveGrid(),
        },
        {
          icon: "trash-2",
          label: "Delete grid",
          // Shown rather than hidden, so the row does not appear and vanish
          // depending on where you are.
          detail: isHome ? "Home grid" : undefined,
          disabled: isHome,
          destructive: !isHome,
          onSelect: () => this.deleteActiveGrid(),
        },
        {
          icon: "layers",
          label: "Manage grids",
          divider: true,
          detail: `${this.allGrids().length} grids`,
          onSelect: () => this.manageGrids(),
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
        this.activate(space.name);
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
        const carried = this.filters.get(from);
        if (carried) {
          this.filters.delete(from);
          this.filters.set(next.name, carried);
        }
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
        this.filters.delete(removed.name);
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
