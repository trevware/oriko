import { ORIKO_ICON_ID } from "./core/icon";
import { ItemView, Notice, Platform, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { absolutePath } from "./convert";
import { dedupeMedia, sourceVideoKeyFor } from "./core/normalize";
import { copyToDownloads, revealInFinder, systemAvailable } from "./core/system";
import { ActionBar } from "./action-bar";
import { buildCommands, facetValueCommands } from "./core/commands";
import type { PaletteContext } from "./core/commands";
import { ConfirmDeleteModal } from "./confirm";
import { isDateToken, todayISO } from "./core/dates";
import { settled } from "./core/settle";
import { Sheet } from "./sheet";
import type { SheetRow } from "./sheet";
import { holdingAcross, isEditable, toggleAcross, withValue } from "./core/editable";
import { ContextMenu } from "./context-menu";
import {
  openDeleteGrid,
  openGridEditor,
  openGridsManager,
  openNewSmartGrid,
  openNewGrid,
  openFolderEditor,
  openRemoveFolder,
} from "./grid-sheets";
import { DetailView } from "./detail";
import { classifyDrop, describeSkipped, titleForDropped, wantsDrop } from "./core/drop";
import type { MenuItem } from "./context-menu";
import type { FoldersController, GridsController } from "./grid-sheets";
import { FOLDER_WIDTHS, folderTileId, partitionWall } from "./core/folders";
import type { FolderSpace, FolderTileModel, FolderWidth } from "./core/folders";
import { GridRenderer } from "./grid";
import { groupedMenu } from "./core/layout";
import type OrikoPlugin from "./main";
import { Palette } from "./palette";
import { resourceUrl } from "./convert";
import { PlaybackController } from "./core/playback";
import { isHttpUrl } from "./core/resolve";
import { ProgressBar } from "./core/progress";
import type { PropertyVocabulary } from "./core/filter";
import {
  activeCount,
  smartMembers,
  emptyFilter,
  facetDefs,
  facetLabel,
  facetsOf,
  isEmptyValue,
  isFilterEmpty,
  matchesFilter,
  propertyVocabulary,
  pruneFilter,
  toggleFacet,
  typedFacets,
  valueLabel,
} from "./core/filter";
import type { FacetDef, FilterState } from "./core/filter";
import { SpaceBar } from "./space-bar";
import { STAGES, expandStage, shrinkStage, stageLabel } from "./core/density";
import type { DensityStage } from "./core/density";
import { describeFiles } from "./core/media-refs";
import { orphansAfterDeleting, removeMedia } from "./sweep";
import {
  effectiveGrid,
  filterByGrid,
  groupedGrids,
  hotkeyPosition,
  isSmartGrid,
  membersOf,
  orderedGrids,
} from "./core/spaces";
import type { GridSpace, PlacedGrid } from "./core/spaces";
import { buildTiles, previewOf } from "./core/tile";
import type { TileModel } from "./core/tile";

export const VIEW_TYPE_GRID = "oriko";

/** Dash and gap for the drop frame, in pixels, before they are rounded to fit
    the perimeter. Small: the frame is the size of the pane, and dashes big
    enough to count read as a barber's pole rather than a border. */
const DASH = 5;
const GAP = 6;

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
/** How long the pane has to hold still before the wall is laid out for it. */
const RESIZE_SETTLE_MS = 120;

export class OrikoView extends ItemView {
  private grid: GridRenderer | null = null;
  private observer: ResizeObserver | null = null;
  private playback: PlaybackController | null = null;
  private progress: ProgressBar | null = null;
  private actionBar: ActionBar | null = null;
  private menu: ContextMenu | null = null;
  private detail: DetailView | null = null;
  private spaceBar: SpaceBar | null = null;
  private palette: Palette | null = null;
  /** A clipping just made here, to fly to as soon as it has a tile. */
  private pendingReveal: { path: string; until: number } | null = null;
  private onGridKey: ((event: KeyboardEvent) => void) | null = null;
  private refreshFrame = 0;
  /** A refresh that arrived while a menu, sheet or selection was up. */
  private refreshHeld = false;
  /**
   * The narrowing on the grid now showing. Dropped on a switch and never
   * written to disk: a filter hides things, and one that outlives the grid it
   * was set on becomes a wall that looks emptier than it is for a reason
   * nobody remembers. Each grid opens whole.
   */
  private filter: FilterState = emptyFilter();
  /**
   * The folder open on the wall, or null for the grid whole. Session state
   * beside the filter: never saved, dropped on a grid switch.
   */
  private openFolder: string | null = null;
  /** The grid's folder tiles before filtering, beside `facets`. */
  private folderTiles: FolderTileModel[] = [];
  /**
   * Covers that failed to load, keyed by note path and remembered by
   * signature. Recording the signature is what lets a clipping return once
   * archiving gives it a different, working cover.
   */
  private unloadable = new Map<string, string>();
  private sheet: Sheet | null = null;
  /**
   * Values set from the open menu, before the vault has confirmed them.
   *
   * The tick has to land on the click that caused it, and a write is a disk
   * round trip and a metadata event away. The menu therefore reads this first
   * and the note second. Dropped when a menu opens, and on a failed write, so
   * it can never disagree with the vault for longer than one menu.
   */
  private edited = new Map<string, string[]>();
  /**
   * One property's values, frozen for the life of an open menu.
   *
   * Recounting on every tick reordered the rows under the pointer, because
   * the list is ordered by how many clippings carry each value and ticking
   * one changes that. What a menu offers should not move while you are using
   * it.
   */
  private vocabularies = new Map<string, PropertyVocabulary>();

  constructor(leaf: WorkspaceLeaf, private plugin: OrikoPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GRID;
  }

  getDisplayText(): string {
    return "Oriko";
  }

  getIcon(): string {
    return ORIKO_ICON_ID;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("oriko-view");

    this.progress = new ProgressBar(this.contentEl);
    this.plugin.capture.onProgress = (state) => this.progress?.set(state);
    this.plugin.capture.onFinished = (label, path) => {
      this.progress?.finish(`Clipped ${label}`);
      // Armed, not flown: the tile does not exist until the index change
      // this capture is about to cause has been painted.
      this.pendingReveal = { path, until: performance.now() + REVEAL_WINDOW_MS };
      this.reportCaptureHome(path);
      // Clipped while a folder was open: it goes into the folder, which is
      // where you were looking. The note is the plugin's own and a minute
      // old, so a second frontmatter write here is not a rewrite of anything
      // clipped.
      if (this.openFolder) void this.assign([path], this.activeGrid().name, this.openFolder);
    };

    this.grid = new GridRenderer(this.app, this.contentEl);
    this.grid.setDensity(this.plugin.settings.tileSize);
    this.grid.setTileSlots(this.tileSlots());
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

    // Hovering a card plays it even when autoplay is off, which is the only
    // way a video moves on such a wall.
    this.grid.onHoverMedia = (media) => this.playback?.hover(media);

    this.grid.onDeleteRequested = (ids: string[]) => this.confirmDelete(ids);
    this.grid.onPropertiesRequested = (ids: string[]) => {
      const anchor = this.actionBar?.propertiesAnchor() ?? { x: 0, y: 0 };
      this.editProperties(ids, anchor.x, anchor.y);
    };

    this.actionBar = new ActionBar(this.contentEl, {
      onProperties: (x, y) => this.editProperties(this.grid?.selectedIds() ?? [], x, y),
      onDelete: () => this.confirmDelete(this.grid?.selectedIds() ?? []),
      onMoveToGrid: (x, y) =>
        this.menu?.open(this.gridMoveRows(this.grid?.selectedIds() ?? []), x, y),
      onMoveToFolder: (x, y) =>
        this.menu?.open(this.folderMoveRows(this.grid?.selectedIds() ?? []), x, y),
      onDone: () => this.grid?.clearSelection(),
    });
    this.grid.onSelectionChanged = (ids: string[]) => {
      this.actionBar?.setSelection(ids);
      this.actionBar?.setFolderable(this.canFile());
      if (ids.length === 0) this.releaseRefresh();
      // The wall's own controls give up the bottom to the selection bar,
      // there being room for only one of them across a phone.
      if (Platform.isMobile) this.spaceBar?.setHidden(ids.length > 0);
    };

    this.menu = new ContextMenu(this.contentEl);
    this.sheet = new Sheet(this.contentEl);
    this.menu.onClosed = () => this.releaseRefresh();
    this.sheet.onClosed = () => this.releaseRefresh();
    this.grid.onContextRequested = (ids, x, y) => {
      this.edited.clear();
      this.vocabularies.clear();
      // Rebuilt on each tick: the property rows are keepOpen, so without this
      // the menu would go on showing the values the clipping had when it
      // opened. Same reason the filter menu passes one.
      this.menu?.open(this.menuItems(ids), x, y, () => this.menuItems(ids));
    };

    this.spaceBar = new SpaceBar(this.contentEl, {
      onSwitcher: (x, y) => this.openSwitcher(x, y),
      onCreate: (x, y) => this.openCreate(x, y),
      onSettings: (x, y) => this.openSettings(x, y),
      onFilter: (x, y) => this.openFilter(x, y),
      onBack: () => this.leaveFolder(),
    });
    this.spaceBar.setActive(this.activeGrid());
    this.watchBottomInset();

    /*
     * Wakes up :active on the wall's chrome, on touch.
     *
     * WebKit applies :active to an element only when a touch handler is
     * attached to it or to something above it. The plugin's one touch
     * handler is on the viewport, and every floating control, the space bar,
     * the selection bar, the detail view's own buttons,
     * is a sibling of the viewport rather than a descendant. So none of them
     * were ever in the active state, their press transitions had nothing to
     * animate, and every tap landed with no feedback at all.
     *
     * This handler exists to be attached and does nothing else, which is the
     * documented way to ask for the behaviour. Passive, so it cannot affect
     * scrolling by even the appearance of intent.
     */
    this.registerDomEvent(this.contentEl, "touchstart", () => {}, { passive: true });

    this.palette = new Palette(this.contentEl, {
      pools: () => {
        // One context for both, for the reason paletteContext builds its defs
        // once: reading the wall is the expensive half of a keystroke.
        const context = this.paletteContext();
        return { commands: buildCommands(context), values: facetValueCommands(context) };
      },
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
      if (this.app.workspace.getActiveViewOfType(OrikoView) !== this) return;
      // The detail view registers in the capture phase too and owns its keys
      // while it is up.
      if (this.detail?.isOpen) return;

      // Escape backs out of a folder once nothing else is up to close: the
      // palette, a sheet, a menu and the selection all take it first.
      if (
        event.key === "Escape" &&
        this.openFolder &&
        !this.palette?.isOpen &&
        !this.sheet?.isOpen &&
        !this.menu?.isOpen &&
        (this.grid?.selectedIds().length ?? 0) === 0
      ) {
        event.preventDefault();
        this.leaveFolder();
        return;
      }

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
    this.grid.onOpenFolder = (name) => this.enterFolder(name);
    this.grid.onFolderContextRequested = (name, x, y) => this.openFolderMenu(name, x, y);
    this.grid.onFolderResized = (name, width) => void this.resizeFolder(name, width);

    this.detail = new DetailView(this.app, this.contentEl, {
      onExport: (id) => void this.exportToDownloads([id]),
      onReveal: (id) => this.revealFirstFile(id),
      onDelete: (id) => this.confirmDelete([id]),
      onOpenNote: (id) => this.openNote(id),
      onEditProperties: (id, x, y) => this.editProperties([id], x, y),
      isMenuOpen: () => this.menu?.isOpen ?? false,
    }, () => this.plugin.settings.filterProperties);
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
      void detail.open(model, origin, () => this.grid?.tileRect(model.id) ?? null);
    };

    this.detail.onNavigate = (current, direction) => {
      const next = this.grid?.neighbor(current.id, direction);
      if (!next || !this.detail?.isOpen) return;
      // The wall follows behind the overlay, so the tile is mounted and the
      // eventual close flight has somewhere real to land.
      this.grid?.focusTile(next.id);
      this.grid?.reveal(next.id, { fit: false, select: false });
      void this.detail.show(next, () => this.grid?.tileRect(next.id) ?? null);
    };

    this.grid.onSourceFailed = (id: string, signature: string) => {
      if (this.unloadable.get(id) === signature) return;
      this.unloadable.set(id, signature);
      this.refresh();
    };

    this.plugin.index.onChange(() => this.refresh());
    this.plugin.archiver.onChange(() => this.refresh());

    // The stage is a fixed frame: the wall pans inside it, and nothing else
    // may move it. Overflow: hidden stops a user scrolling it but not the
    // browser doing so on someone's behalf, which focus, scrollIntoView and
    // an overscrolling child list all ask for. One rule, enforced here,
    // rather than a promise every new surface has to remember to keep.
    this.registerDomEvent(this.contentEl, "scroll", () => {
      if (this.contentEl.scrollTop !== 0) this.contentEl.scrollTop = 0;
      if (this.contentEl.scrollLeft !== 0) this.contentEl.scrollLeft = 0;
    });

    // The wall waits for the pane to stop moving. A sidebar toggle animates
    // its width over a couple of hundred milliseconds, and laying the wall
    // out on every frame of that rewrote every visible tile's size and
    // re-rasterized every video each time, which is what the toggle spent
    // its animation on. One layout at the end, restaged like a grid switch
    // rather than glided. The detail panel is a single element and keeps
    // following live.
    const relayoutSettled = settled(
      () => this.grid?.relayout({ restage: true }),
      RESIZE_SETTLE_MS,
      window
    );
    this.register(() => relayoutSettled.cancel());
    this.observer = new ResizeObserver(() => {
      relayoutSettled.call();
      this.detail?.relayout();
    });
    this.observer.observe(this.contentEl);

    // Paste a link anywhere in the grid to clip it, the way you would drop
    // a URL into a board app.
    this.registerDomEvent(document, "paste", (event: ClipboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(OrikoView) !== this) return;
      // Pasting into the palette's search box is typing, not clipping.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const data = event.clipboardData;
      if (!data) return;

      // Media data first: copying an image from a browser also puts its URL
      // on the clipboard, and the bytes in hand beat a link to fetch.
      const file = Array.from(data.files).find(
        (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
      );
      if (file) {
        event.preventDefault();
        void this.plugin.capture.captureMedia(file);
        return;
      }

      const text = data.getData("text/plain")?.trim();
      if (!text) return;
      event.preventDefault();
      void this.plugin.capture.capture(text);
    });

    this.installDropTarget();

    this.refresh();
  }

  /**
   * Dropping pictures, videos or a web link onto the wall clips them, the same
   * three things a paste can carry.
   *
   * dragover has to cancel the event on every single move, not merely once on
   * entry: the drop event never fires otherwise, and Obsidian takes the file
   * instead and imports it as an attachment beside the note you last had open.
   */
  private installDropTarget(): void {
    const el = this.contentEl;

    // The frame's dashes, as a stroke rather than a border, because a CSS
    // border cannot have its dash offset animated and a stroke can. One rect,
    // so the dashes run continuously round the corners instead of four edges
    // meeting at seams. Made once and hidden by CSS until a drag arrives.
    const frame = el.createSvg("svg", { cls: "pg-drop-frame" });
    frame.setAttribute("aria-hidden", "true");
    const dashes = frame.createSvg("rect");

    // dragleave fires again every time the pointer crosses into a child, and
    // the wall is nothing but children. Counting entries against leaves is
    // what stops the target strobing the whole way across the grid.
    let depth = 0;
    /**
     * Fits the dash pattern to the frame it is going round.
     *
     * A dash pattern restarts at the path's start point, so unless the
     * perimeter divides evenly by one dash plus one gap, the last dash lands
     * on top of the first and the top left corner wears a join. Rounding the
     * period to whatever divides the actual perimeter costs a fraction of a
     * pixel each and leaves no seam at all.
     *
     * The perimeter is worked out from the box rather than asked of the path.
     * getTotalLength on a rect whose geometry comes from CSS depends on style
     * and layout having already run, and this is called in the same tick as
     * the class that reveals it, so it was reporting nothing and leaving the
     * seam it exists to remove. Arithmetic on a rounded rectangle needs
     * neither.
     */
    const fitDashes = (): void => {
      const box = el.getBoundingClientRect();
      // 11px a side: the overlay's 10px inset plus half the 2px stroke.
      const width = box.width - 22;
      const height = box.height - 22;
      if (width <= 0 || height <= 0) return;

      const radius = Math.min(
        parseFloat(window.getComputedStyle(dashes).rx) || 0,
        width / 2,
        height / 2
      );
      // Four straights shortened by a radius at each end, plus the four
      // quarter-circles of the corners, which together make one whole one.
      const length = 2 * (width + height) - 8 * radius + 2 * Math.PI * radius;
      if (!(length > 0)) return;

      const count = Math.max(1, Math.round(length / (DASH + GAP)));
      const period = length / count;
      const dash = period * (DASH / (DASH + GAP));
      dashes.style.strokeDasharray = `${dash} ${period - dash}`;
      // One whole period per cycle, so the loop closes on itself.
      el.style.setProperty("--pg-drop-period", `${period}px`);
    };

    const show = (on: boolean): void => {
      if (!on) depth = 0;
      // Named while it is up, because a drop does not always land where you
      // are looking: nothing is filed into a smart grid, so one on screen
      // sends the clipping home and the frame should say so before the drop
      // rather than a toast after it. Carried as a custom property, the label
      // being ::after content and there being no element to set text on.
      if (on) {
        const space = this.activeGrid();
        const target = isSmartGrid(space) ? this.plugin.settings.homeGridName : space.name;
        el.style.setProperty("--pg-drop-label", JSON.stringify(`Drop to add to ${target}`));
      }
      el.toggleClass("is-drop-target", on);
      // After the class, never before: the frame is display none until it is
      // there, and a hidden path has no length to measure.
      if (on) fitDashes();
    };

    this.registerDomEvent(el, "dragenter", (event: DragEvent) => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      // Files are sealed until the drop, so the list of types is the whole of
      // what can be known while there is still time to show a target.
      if (!wantsDrop(types)) return;
      event.preventDefault();
      depth++;
      show(true);
    });

    this.registerDomEvent(el, "dragover", (event: DragEvent) => {
      if (!wantsDrop(Array.from(event.dataTransfer?.types ?? []))) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });

    this.registerDomEvent(el, "dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) show(false);
    });

    this.registerDomEvent(el, "drop", (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!data) return;

      const plan = classifyDrop(
        Array.from(data.files).map((file) => ({ name: file.name, type: file.type })),
        data.getData("text/uri-list") || data.getData("text/plain") || ""
      );
      // Left alone deliberately, so Obsidian's own drags still do what they
      // have always done rather than dying against a preventDefault.
      if (plan.kind === "ignore") return;

      event.preventDefault();
      show(false);

      if (plan.kind === "unsupported") {
        new Notice(`Oriko: ${describeSkipped(plan.skipped)}`);
        return;
      }

      if (plan.kind === "url") {
        void this.plugin.capture.capture(plan.url);
        return;
      }

      if (plan.skipped.length > 0) {
        new Notice(`Oriko: ${describeSkipped(plan.skipped)}`);
      }
      void this.captureDropped(data.files, plan.files.map((file) => file.name));
    });

    // A drag that ends outside the window never sends a leave, so the target
    // would stay lit over a wall that is no longer expecting anything.
    this.registerDomEvent(window, "dragend", () => show(false));
    this.registerDomEvent(window, "blur", () => show(false));
  }

  /**
   * Saves dropped files one at a time.
   *
   * Sequential rather than in parallel: each capture writes an attachment and
   * a note and drives the one progress bar, and several racing each other
   * would fight over the bar and over the unique-name check that keeps two
   * files landing in the same second from overwriting one another.
   */
  private async captureDropped(files: FileList, wanted: string[]): Promise<void> {
    const taking = new Set(wanted);
    for (const file of Array.from(files)) {
      if (!taking.has(file.name)) continue;
      await this.plugin.capture.captureMedia(file, titleForDropped(file.name));
    }
  }

  /**
   * Public: the settings tab calls this when the property list changes, so an
   * open wall picks up a new facet without a reload. Filters left over from a
   * facet that has just been switched off are pruned by activeFilter on the
   * way through.
   */
  refreshFacets(): void {
    this.applyFilter({ replace: true });
  }

  /** Settings changed a tile corner; the wall redraws its badges in place. */
  refreshTileProperties(): void {
    this.grid?.setTileSlots(this.tileSlots());
  }

  private tileSlots(): { date: string; property: string } {
    return { date: this.plugin.settings.tileDate, property: this.plugin.settings.tileProperty };
  }

  /** Public: the ⌘K command in main.ts drives the palette through this. */
  togglePalette(): void {
    if (this.detail?.isOpen) return;
    this.palette?.toggle();
  }

  /**
   * Keeps the wall's floating controls clear of Obsidian's mobile navbar.
   *
   * The navbar is a bar of its own laid over the view, not something the
   * view is sized above, so the space bar and the action bar sit underneath
   * it and the filter and create buttons cannot be reached.
   *
   * There is no height to read: Obsidian publishes --safe-area-inset-bottom
   * and --mobile-toolbar-height, but the latter is the editor's toolbar and
   * neither describes the navbar. So the overlap is measured, which is more
   * honest than a constant anyway: it answers with nothing at all when the
   * navbar is hidden, on a phone that has none, and on desktop.
   */
  private syncBottomInset(): void {
    const navbar = document.body.querySelector<HTMLElement>(".mobile-navbar");
    if (!navbar || !navbar.isShown()) {
      this.contentEl.style.removeProperty("--pg-bottom-inset");
      return;
    }

    const content = this.contentEl.getBoundingClientRect();
    // A view in a background tab is display:none and measures as all
    // zeros, which would pin the inset to 0px until the next resize.
    // Skipped instead: onResize re-measures the moment the tab is shown.
    if (content.width === 0 && content.height === 0) return;

    const bar = navbar.getBoundingClientRect();
    // How much of our own bottom edge the navbar covers, rather than how
    // tall it is: the two differ whenever the view does not run to the
    // bottom of the window.
    const overlap = Math.max(0, content.bottom - bar.top);
    this.contentEl.style.setProperty("--pg-bottom-inset", `${Math.round(overlap)}px`);
  }

  /**
   * Obsidian calls this when the leaf's size changes, which includes going
   * from a hidden background tab to the visible one. That transition fires
   * no workspace resize, so without this a wall opened behind another tab
   * kept a stale inset until it was closed and reopened.
   */
  onResize(): void {
    if (Platform.isMobile) this.syncBottomInset();
  }

  /**
   * The navbar comes and goes, with the keyboard and with rotation, so the
   * measurement is repeated rather than taken once at open.
   */
  private watchBottomInset(): void {
    if (!Platform.isMobile) return;
    this.syncBottomInset();
    this.registerEvent(this.app.workspace.on("resize", () => this.syncBottomInset()));
    this.registerDomEvent(window, "orientationchange", () => this.syncBottomInset());
    // Layout settling after open can move the navbar under us a frame late.
    this.app.workspace.onLayoutReady(() => this.syncBottomInset());
  }

  async onClose(): Promise<void> {
    this.cancelRefresh();
    if (this.onGridKey) document.removeEventListener("keydown", this.onGridKey, true);
    this.onGridKey = null;
    this.palette?.close();
    this.palette = null;
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
      // An embedded vault file is its own archive.
      if (!/^https?:\/\//i.test(media.url)) {
        paths.push(media.url);
        continue;
      }
      const entry = cache.get(media.key);
      if (entry?.file) paths.push(entry.file);
    }
    return [...new Set(paths)];
  }

  /**
   * The rows for editing every editable property of a selection.
   *
   * One clipping or many: each value row reads across the whole selection, a
   * tick where all hold it, a dash where some do, and a tap makes it
   * everywhere or nowhere (toggleAcross). Shared with the detail view's bar
   * and the action bar so every surface offers the same rows and reaches the
   * same single writer, one file at a time.
   */
  propertyRows(ids: string[]): MenuItem[] {
    const rows: MenuItem[] = [];
    for (const def of this.defs()) {
      if (def.source !== "property" || !def.key || !isEditable(def.key)) continue;
      rows.push({
        icon: def.icon,
        label: def.label,
        submenu: this.propertyMenu(ids, def.key),
      });
    }
    return rows;
  }

  /**
   * Grouped by what a row acts on: reaching the clipping, describing it,
   * filing it, destroying it.
   *
   * Describing and filing are ruled apart because the code draws that line
   * too, and for the same reason: a property goes through setProperty behind
   * isEditable, while `grid` is excluded from it and has its own path in
   * assign. One is saying what a clipping is, the other is saying where it
   * lives.
   */
  private menuItems(ids: string[]): MenuItem[] {
    const n = ids.length;
    const count = n === 1 ? "1 selected" : `${n} selected`;

    const reach: MenuItem[] = [];
    const describe: MenuItem[] = this.propertyRows(ids);
    const file: MenuItem[] = [];
    const destroy: MenuItem[] = [];

    if (n === 1) {
      // Touch has no modifier key, so this is the way into selecting more
      // than one thing. Only offered where that is true, and only for a
      // single card, since a menu opened on a selection is already in it.
      if (Platform.isMobile) {
        reach.push({
          icon: "check-circle",
          label: "Select",
          onSelect: () => this.grid?.beginTouchSelection(ids[0]),
        });
      }
      reach.push({
        icon: "file-text",
        label: "Open note",
        onSelect: () => this.openNote(ids[0]),
      });
      const source = this.plugin.index.get(ids[0])?.source ?? "";
      if (isHttpUrl(source)) {
        reach.push({
          icon: "globe",
          label: "Open in browser",
          onSelect: () => {
            window.open(source);
          },
        });
      }
    }

    if (systemAvailable()) {
      reach.push({
        icon: "download",
        label: "Export to Downloads",
        detail: "⌘E",
        onSelect: () => void this.exportToDownloads(ids),
      });

      if (n === 1) {
        reach.push({
          icon: "folder",
          label: "Reveal in Finder",
          onSelect: () => this.revealFirstFile(ids[0]),
        });
      }
    }

    if (this.canFile()) {
      file.push({
        icon: "folder",
        label: "Move to folder",
        submenu: this.folderMoveRows(ids),
      });
    }

    if (this.allGrids().length > 1) {
      file.push({
        icon: "corner-up-right",
        label: "Move to grid",
        submenu: this.gridMoveRows(ids),
      });
    }

    destroy.push({
      icon: "trash-2",
      label: "Delete",
      detail: count,
      destructive: true,
      onSelect: () => this.confirmDelete(ids),
    });

    return groupedMenu([reach, describe, file, destroy]);
  }

  /** The grids a selection can be moved to. One list, for the menu and the bar. */
  private gridMoveRows(ids: string[]): MenuItem[] {
    return this.allGrids().map((grid) => ({
      icon: grid.icon,
      label: grid.name,
      onSelect: () => void this.moveTo(ids, grid.name),
    }));
  }

  /** The folders here, ending in New folder, which takes the selection with it. */
  private folderMoveRows(ids: string[]): MenuItem[] {
    const folders = this.foldersHere();
    return [
      ...folders.map((folder) => ({
        icon: folder.icon,
        label: folder.name,
        onSelect: () => void this.moveToFolder(ids, folder.name),
      })),
      {
        icon: "folder-plus",
        label: "New folder…",
        divider: folders.length > 0,
        onSelect: () => this.promptNewFolder(ids),
      },
    ];
  }

  /**
   * Opens the property rows from the detail view's bar, anchored at the button
   * that asked for them.
   *
   * Elevated, because the detail overlay outranks a menu in the normal stack
   * and the panel would otherwise open behind it. Given a rebuild on the same
   * terms as the wall's menu: these rows keep the panel open so several can be
   * ticked in a row, which only reads correctly if each click repaints them
   * from the state it just wrote.
   */
  private editProperties(ids: string[], x: number, y: number): void {
    if (ids.length === 0) return;
    const rows = (): MenuItem[] => this.propertyRows(ids);
    const items = rows();
    if (items.length === 0) {
      new Notice("Oriko: no editable properties are enabled in settings");
      return;
    }
    this.menu?.open(items, x, y, rows, true);
  }

  private openNote(id: string): void {
    const file = this.app.vault.getAbstractFileByPath(id);
    if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
  }

  private revealFirstFile(id: string): void {
    const file = this.filesFor(id)[0];
    if (!file) {
      new Notice("Oriko: nothing archived for this clipping yet");
      return;
    }
    const absolute = absolutePath(this.app.vault, normalizePath(file));
    if (!absolute || !revealInFinder(absolute)) {
      new Notice("Oriko: could not reveal the file");
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
        ? "Oriko: nothing archived to export yet"
        : `Oriko: exported ${copied} file${copied === 1 ? "" : "s"} to Downloads`
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
        new Notice(`Oriko: could not delete ${file.basename} (${String(error)})`);
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
        ? `Oriko: ${notes} and ${swept} media file${swept === 1 ? "" : "s"} moved to trash`
        : `Oriko: ${notes} moved to trash`
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
    // Held while a menu, a sheet or the selection bar is up. A repaint
    // re-runs the filter, and on a wall narrowed to "is empty" the clipping
    // being given its first category would vanish under the menu before the
    // second could be given. What was changed is on disk already; the wall
    // catches up when the surface comes down (releaseRefresh).
    if (this.holdingRefresh()) {
      this.refreshHeld = true;
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
    this.refreshHeld = false;
  }

  private holdingRefresh(): boolean {
    return (
      (this.menu?.isOpen ?? false) ||
      (this.sheet?.isOpen ?? false) ||
      (this.grid?.selectedIds().length ?? 0) > 0
    );
  }

  /**
   * Runs a held refresh once nothing is holding it. A tick later rather than
   * now: the menu's New value row closes the menu and opens the sheet in the
   * same call, and the wall must not repaint in the gap between.
   */
  private releaseRefresh(): void {
    if (!this.refreshHeld) return;
    queueMicrotask(() => {
      if (!this.refreshHeld || this.holdingRefresh()) return;
      this.refreshHeld = false;
      this.refresh();
    });
  }

  /**
   * Settings the wall can adopt where it stands, pushed as they are saved.
   *
   * Only the ones that need nothing rebuilt: anything changing what a tile is
   * or which records are on screen is a refresh, not this. Autoplay qualifies
   * because the controller was always able to be told, and nothing was ever
   * telling it, so the toggle wrote a value the open wall went on ignoring
   * until the view was reopened.
   */
  /**
   * Takes on a grid list that changed outside this device, which is what a
   * sync delivering another device's configuration looks like from here.
   *
   * Re-activating rather than repainting, because the switcher, the hotkey
   * order and the wall all read the list: activeGrid already falls back to
   * home, so a grid deleted on the other device leaves this one on home
   * rather than staring at a wall that no longer has a name.
   */
  refreshGrids(): void {
    // Deliberately not activate(), which returns early when the name has not
    // changed, and after a sync it usually has not: the grid you are standing
    // in is still called what it was called. What changed is what is in it,
    // or its rules, or which other grids exist beside it, so the wall is
    // repainted outright.
    //
    // activeGrid falls back to home, so a grid deleted on the other device
    // leaves this one on home rather than staring at a wall with no name.
    const space = this.activeGrid();
    this.plugin.settings.activeGrid = space.name;
    this.spaceBar?.setActive(space);
    this.refresh({ replace: true });
  }

  applyLiveSettings(): void {
    // Not while the detail view is up. It turns playback off deliberately and
    // restores it on close, so obeying the setting here would set the wall
    // playing behind the backdrop.
    if (this.detail?.isOpen) return;
    this.playback?.setEnabled(this.plugin.settings.autoplayVideo);
  }

  private paint(options: { replace?: boolean }): void {
    if (!this.grid) return;

    const space = this.activeGrid();
    const smart = isSmartGrid(space);

    // A smart grid's rules run over the whole vault rather than over one
    // wall's slice, because home stays everything: a clipping filed in Manga
    // is still eligible for a smart grid, and would be missing from it if the
    // rules only ever saw the grid it happened to be filed in.
    const tiles = buildTiles(
      smart
        ? this.plugin.index.records()
        : filterByGrid(
            this.plugin.index.records(),
            space.name,
            this.plugin.settings.homeGridName,
            this.registered()
          ),
      this.plugin.archiver.cache,
      this.unloadable
    );

    // Facets are counted from the whole grid, not from what survives the
    // filter: counting the result would make options disappear the moment
    // you used one, leaving no way back. For a smart grid the whole grid is
    // what its rules admitted, so its counts are counts within the rule.
    if (smart) {
      this.facets = space.rules ? smartMembers(tiles, space.rules, this.allDefs(tiles)) : tiles;
      this.folderTiles = [];
    } else {
      // A folder tile stands in for its members, so the wall is the loose
      // tiles plus the folders; inside a folder it is the members alone.
      const parts = partitionWall(tiles, this.plugin.settings.folders, this.folderGridKey());
      const open = this.openFolder
        ? parts.folders.find((f) => f.folder.name === this.openFolder)
        : undefined;
      if (this.openFolder && !open) {
        // Removed on another device, or renamed: the grid whole is the only
        // honest fallback, as home is for a grid that has gone.
        this.openFolder = null;
        this.spaceBar?.setFolder(null);
      }
      this.facets = open ? open.members : parts.loose;
      this.folderTiles = open ? [] : parts.folders;
    }
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
  /**
   * Says where a clipping went when it could not go where you were looking.
   *
   * Nothing is filed into a smart grid, so clipping while one is on screen
   * saves to home. Whether that is worth saying depends on what happens next:
   * a clipping the rules do admit turns up on this very wall and the detour is
   * invisible, which is why it is not mentioned. One they do not simply never
   * appears, and a clip that looks like it did nothing is the thing worth a
   * word.
   */
  private reportCaptureHome(path: string): void {
    const space = this.activeGrid();
    if (!isSmartGrid(space) || !space.rules) return;

    const home = this.plugin.settings.homeGridName;
    const record = this.plugin.index.records().find((entry) => entry.path === path);
    const [tile] = record ? buildTiles([record], this.plugin.archiver.cache) : [];

    // No tile yet means the cover is still resolving, so whether the rules
    // admit it cannot be judged. Where it went still can, and is the half of
    // the message that matters.
    if (!tile) {
      new Notice(`Oriko: saved to ${home}`);
      return;
    }

    if (matchesFilter(tile, space.rules, this.allDefs(this.facets))) return;

    new Notice(
      `Oriko: saved to ${home}. It does not match ${space.name}, so it is not on this wall.`
    );
  }

  private flyToPending(): void {
    const pending = this.pendingReveal;
    if (!pending) return;

    if (performance.now() > pending.until) {
      this.pendingReveal = null;
      return;
    }

    // A filter can hide what was just clipped. Nothing is cleared for it:
    // clipping something is not a request to undo the narrowing you set.
    if (!this.grid?.reveal(pending.path, { fit: false, select: false })) return;
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
    const defs = this.defs();
    const narrow = (tiles: TileModel[]): TileModel[] =>
      isFilterEmpty(filter) ? tiles : tiles.filter((tile) => matchesFilter(tile, filter, defs));
    const shown = narrow(this.facets);
    // A folder stays on a narrowed wall only while something in it matches,
    // and its collage shows the matches. An empty folder shows on a wall that
    // is not narrowed: it was just made, and has to be there to be filled.
    const folders = isFilterEmpty(filter)
      ? this.folderTiles
      : this.folderTiles
          .map((f) => ({ ...f, members: narrow(f.members) }))
          .filter((f) => f.members.length > 0);
    this.grid?.setFolders(folders);
    this.grid?.setTiles(shown, options);
    // The same list, so a filter narrows both and neither can drift.
  }

  /** The grid's tiles before filtering, which is what the facets count. */
  private facets: TileModel[] = [];

  /**
   * The facets on offer, rebuilt from settings on each read. The list is four
   * or five items long, so caching it would cost more in staleness than it
   * saves; typedFacets samples the wall rather than reading all of it, so the
   * cost does not grow with the vault.
   *
   * Date.now() is read here rather than held, so a wall left open overnight
   * buckets against today when you next touch the filter.
   */
  private defs(): FacetDef[] {
    return typedFacets(
      facetDefs(this.plugin.settings.filterProperties),
      this.facets,
      Date.now()
    );
  }

  /**
   * Defs for evaluating a smart grid's rules, typed against every tile rather
   * than against the grid's own.
   *
   * defs() samples this.facets, and for a smart grid this.facets is what the
   * rules produced, so using it here would ask the rules to be evaluated
   * against a typing that only exists once they have been. Circular, and it
   * fails quietly rather than loudly: a date property types as text, its
   * buckets stop matching, and the grid is subtly wrong instead of broken.
   */
  private allDefs(tiles: TileModel[]): FacetDef[] {
    return typedFacets(facetDefs(this.plugin.settings.filterProperties), tiles, Date.now());
  }

  /** The session state the wall painted with, for the diagnostics command. */
  diagnosticState(): { grid: string; unloadable: Array<[string, string]>; filtered: boolean } {
    return {
      grid: this.activeGrid().name,
      unloadable: [...this.unloadable.entries()],
      filtered: !isFilterEmpty(this.activeFilter()),
    };
  }

  /** Pruned on the way out, so a property switched off in settings stops
      counting towards the badge instead of claiming a narrowing that
      matchesFilter is no longer applying. */
  private activeFilter(): FilterState {
    const pruned = pruneFilter(this.filter, this.defs());
    if (pruned !== this.filter) this.filter = pruned;
    return pruned;
  }

  private setFilter(next: FilterState): void {
    this.filter = next;
    // Straight to the narrowing pass; the tiles behind it have not changed.
    this.applyFilter({ replace: true });
    // Placed at the top, as a grid switch is. Left to relayout, the camera
    // kept the tile nearest the centre of the wall you were looking at and
    // followed it to wherever the new set put it, which after clearing a
    // filter meant somewhere far down the full wall. A narrowed or widened
    // wall is a different set of things, and it starts from the top.
    this.grid?.resetView(false);
  }

  private openFilter(x: number, y: number): void {
    const build = (): MenuItem[] => {
      const defs = this.defs();
      const available = facetsOf(this.facets, defs);
      const filter = this.activeFilter();

      const items: MenuItem[] = defs.map((def) => {
        const values = available[def.id] ?? [];
        const chosen = filter[def.id] ?? [];

        const row = (value: string, count: number): MenuItem => ({
          // No left icon at all, so the panel drops the gutter. A chosen value
          // marks itself where its count was: the count of a value you have
          // already picked is not what you are looking at the row for.
          icon: "",
          // A date facet's values are groups and comparisons rather than words
          // a clipping carries, so they are read back as words here. Any other
          // facet's value is already the word.
          label: valueLabel(def, value),
          // Absence is set apart from the values it is the absence of.
          divider: isEmptyValue(def, value),
          detail: String(count),
          detailIcon: chosen.includes(value) ? "check" : undefined,
          keepOpen: true,
          onSelect: () => this.setFilter(toggleFacet(this.activeFilter(), def.id, value)),
        });

        const submenu = values.map((entry) => row(entry.value, entry.count));

        if (def.shape === "date") {
          // A comparison is not a value any clipping reports, so it never
          // shows up in the tally and would have no row to switch it off with.
          for (const value of chosen) {
            if (!isDateToken(value) || values.some((entry) => entry.value === value)) continue;
            const hit = this.facets.filter((tile) =>
              matchesFilter(tile, { [def.id]: [value] }, defs)
            ).length;
            submenu.push(row(value, hit));
          }

          submenu.push({
            icon: "",
            label: "Custom…",
            alwaysShow: true,
            divider: true,
            onSelect: () => this.promptDateFilter(def),
          });
        }

        return {
          icon: def.icon,
          label: def.label,
          // Nothing to offer is still worth showing: an absent row reads as a
          // missing feature, a disabled one reads as an empty shelf.
          disabled: submenu.length === 0,
          detail: values.length === 0 ? "none" : chosen.length > 0 ? `${chosen.length}` : undefined,
          submenu,
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

  // ---- Palette -----------------------------------------------------------

  /**
   * The wall as the palette sees it, rebuilt on every keystroke so its rows
   * describe the selection, filter and grids as they stand rather than as
   * they were when it opened.
   */
  private paletteContext(): PaletteContext {
    const selection = this.grid?.selectedIds() ?? [];
    // Once, not twice: typing the facets walks a sample of the wall.
    const defs = this.defs();

    return {
      selection,
      grids: this.allGrids(),
      activeGrid: this.activeGrid().name,
      homeGrid: this.plugin.settings.homeGridName,
      folders: this.foldersHere(),
      canFile: this.canFile(),
      facetDefs: defs,
      facets: facetsOf(this.facets, defs),
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
        moveToFolder: (ids, folder) => void this.moveToFolder(ids, folder),
        newFolder: (seed) => this.promptNewFolder(seed),
        openFolder: (name) => this.enterFolder(name),
        editGrid: () => this.editActiveGrid(),
        deleteGrid: () => this.deleteActiveGrid(),
        manageGrids: () => this.manageGrids(),
        toggleFacet: (id, value) =>
          this.setFilter(toggleFacet(this.activeFilter(), id, value)),
        clearFilters: () => this.setFilter(emptyFilter()),
        clip: () => void this.plugin.clipFromClipboard(),
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
        new Notice("Oriko: filter cleared to show that clipping");
        return;
      }
    }

    new Notice("Oriko: nothing to show on the wall, opening the note");
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

    // Selection, filter and camera all describe tiles that are about to be
    // replaced, so none of them carries over.
    this.grid?.clearSelection();
    this.filter = emptyFilter();
    this.openFolder = null;
    this.spaceBar?.setFolder(null);
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
  /**
   * Writes one property of one clipping.
   *
   * Guarded by isEditable rather than trusted: the caller is UI, and the keys
   * the Web Clipper owns are a contract this plugin does not get to break.
   * Refusing here means a future caller cannot widen the licence by accident.
   *
   * `updated` is bumped alongside, because the vault's clipping rules list it among
   * the properties parsing maintains and every other tool there keeps it
   * current.
   */
  private async setProperty(path: string, key: string, values: string[]): Promise<void> {
    if (!isEditable(key)) {
      new Notice(`Oriko: ${key} belongs to the clipper and is not editable`);
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return;

    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        // An emptied property is removed rather than written as an empty
        // list, so the note reads the way one that never had the key reads.
        if (values.length === 0) delete fm[key];
        else if (values.length === 1 && !Array.isArray(fm[key])) fm[key] = values[0];
        else fm[key] = values;
        fm.updated = todayISO();
      });
    } catch (error) {
      new Notice(`Oriko: could not update ${key} (${String(error)})`);
      // The menu is showing a value the note does not have. Drop it so the
      // next rebuild tells the truth.
      this.edited.delete(this.editKey(path, key));
    }
    // Nothing is refreshed from here. The vault's own modify event reaches
    // the index and the wall by the path every other edit uses, and forcing
    // it rebuilt the whole grid on every tick.
  }

  /**
   * The rows for editing one property of one clipping.
   *
   * Values come from the wall rather than from a fixed vocabulary, so the
   * menu offers what the vault already uses and spelling stays consistent
   * without anything having to enforce it.
   */
  private editKey(path: string, key: string): string {
    return `${path}\u0000${key}`;
  }

  /** What the menu should show as set: this session's edit if there is one,
      otherwise what the note actually says. */
  private heldValues(path: string, key: string): string[] {
    return (
      this.edited.get(this.editKey(path, key)) ??
      this.plugin.index.get(path)?.properties[key] ??
      []
    );
  }

  private vocabularyFor(key: string): PropertyVocabulary {
    const cached = this.vocabularies.get(key);
    if (cached) return cached;
    const fresh = propertyVocabulary(this.facets, key);
    this.vocabularies.set(key, fresh);
    return fresh;
  }

  private propertyMenu(paths: string[], key: string): MenuItem[] {
    const holdings = paths.map((path) => this.heldValues(path, key));
    const { values, single } = this.vocabularyFor(key);

    // Recorded before the writes, and the writes are not waited on. The menu
    // rebuilds from the record on the same tick as the click; the notes
    // catch up on their own, one processFrontMatter each.
    const write = (next: string[][]): void => {
      paths.forEach((path, index) => {
        this.edited.set(this.editKey(path, key), next[index]);
        void this.setProperty(path, key, next[index]);
      });
    };

    const rows: MenuItem[] = values.map((entry) => {
      const holding = holdingAcross(holdings, entry.value);
      return {
        icon: "",
        label: entry.value,
        detail: String(entry.count),
        // A dash for "some of these": not a tick, since it is not set
        // everywhere, and not blank, since it is not absent either.
        detailIcon: holding === "all" ? "check" : holding === "some" ? "minus" : undefined,
        keepOpen: true,
        onSelect: () => write(toggleAcross(holdings, entry.value, single)),
      };
    });

    // Never offered against a value that is already on the list: that row is
    // sitting one line up, and creating it again would create nothing. Matches
    // how the sheet's own Create row decides.
    const known = (typed: string): boolean =>
      values.some((entry) => entry.value === typed);

    rows.push({
      // No icon, or this one row would reserve the gutter for the whole
      // panel: the panel drops it only when nothing in it has one. The rule
      // above already separates this row from the values.
      icon: "",
      label: "New value…",
      // Names what was typed, so a search that found nothing reads as an offer
      // to make it rather than as a dead end beside the word "No matches".
      labelFor: (typed) => {
        const wanted = typed.trim();
        return wanted && !known(wanted) ? `Create “${wanted}”` : "New value…";
      },
      // Survives typing, so a search that finds nothing still offers to add
      // what was typed rather than leaving a dead end.
      alwaysShow: true,
      // Stays up like the value rows, so the tick it just set can be seen. The
      // branch that hands off to the sheet closes the menu itself.
      keepOpen: true,
      clearsQuery: true,
      divider: rows.length > 0,
      onSelect: (typed) => {
        const wanted = typed.trim();
        // Nothing typed, or typed something that already exists: there is no
        // value to create here, so the fuller prompt takes over.
        if (!wanted || known(wanted)) {
          this.menu?.close();
          this.promptPropertyValue(paths, key, single, holdings);
          return;
        }

        // A new value is held by nothing yet, so this is always an add.
        write(toggleAcross(holdings, wanted, single));
      },
    });

    return rows;
  }

  /** Picks an operator, then a date, and adds the comparison as a value. */
  private promptDateFilter(def: FacetDef): void {
    const sheet = this.sheet;
    if (!sheet) return;

    const askDate = (op: "before" | "since", label: string): void => {
      sheet.push({
        title: label,
        placeholder: "yyyy-mm-dd",
        value: todayISO(),
        filters: false,
        hints: [
          ["\u21b5", "apply"],
          ["esc", "back"],
        ],
        rows: () => [],
        onSubmit: (typed) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(typed)) {
            new Notice("Oriko: a date reads yyyy-mm-dd");
            return;
          }
          sheet.close();
          this.setFilter(toggleFacet(this.activeFilter(), def.id, `${op}:${typed}`));
        },
      });
    };

    sheet.open({
      title: def.label,
      placeholder: "Search…",
      filters: true,
      hints: [
        ["\u2191\u2193", "navigate"],
        ["\u21b5", "select"],
        ["esc", "close"],
      ],
      rows: () => [
        {
          label: "Before",
          icon: "chevron-left",
          onChoose: () => askDate("before", "Before"),
        },
        {
          label: "On or after",
          icon: "chevron-right",
          onChoose: () => askDate("since", "On or after"),
        },
      ],
    });
  }

  private promptPropertyValue(
    paths: string[],
    key: string,
    single: boolean,
    holdings: string[][]
  ): void {
    const options = propertyVocabulary(this.facets, key).values;

    const apply = (value: string): void => {
      this.sheet?.close();
      // Chosen from a list of what to add, so it is an add for every clipping
      // in the selection, including any that already hold it.
      const next = holdings.map((held) => (single ? [value] : withValue(held, value)));
      paths.forEach((path, index) => {
        this.edited.set(this.editKey(path, key), next[index]);
        void this.setProperty(path, key, next[index]);
      });
    };

    const mark = (value: string): string | undefined => {
      const holding = holdingAcross(holdings, value);
      return holding === "all" ? "check" : holding === "some" ? "minus" : undefined;
    };

    this.sheet?.open({
      title: facetLabel(key),
      placeholder: `Add to ${facetLabel(key).toLowerCase()}…`,
      filters: true,
      hints: [
        ["↑↓", "navigate"],
        ["↵", "select"],
        ["esc", "close"],
      ],
      rows: (query) => {
        const rows: SheetRow[] = options.map((entry) => ({
          label: entry.value,
          detail: String(entry.count),
          detailIcon: mark(entry.value),
          onChoose: () => apply(entry.value),
        }));

        // Offered only when it is not already there, so the list never shows
        // Create beside the very value it would duplicate.
        const typed = query.trim();
        if (typed && !options.some((entry) => entry.value === typed)) {
          rows.push({
            label: `Create “${typed}”`,
            icon: "plus",
            alwaysShow: true,
            onChoose: () => apply(typed),
          });
        }
        return rows;
      },
    });
  }

  /**
   * Files clippings onto a grid, and into a folder on it when one is named.
   *
   * The two keys are written in one call so they can never disagree after a
   * move: a folder belongs to one grid, and moving to a grid without naming
   * a folder takes the clipping out of whichever folder it was in.
   */
  private async assign(paths: string[], target: string, folder = ""): Promise<number> {
    const home = this.plugin.settings.homeGridName;
    let written = 0;

    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (!(file instanceof TFile)) continue;
      try {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          // Home is the absence of the key, so moving something back removes
          // it rather than writing the home name in. Loose is the absence of
          // the folder key, on the same terms.
          if (target === home) delete fm.grid;
          else fm.grid = target;
          if (folder) fm.folder = folder;
          else delete fm.folder;
        });
        written++;
      } catch (error) {
        new Notice(`Oriko: could not move ${path} (${String(error)})`);
      }
    }
    return written;
  }

  private openSwitcher(x: number, y: number): void {
    const active = this.activeGrid().name;
    const { manual, smart } = groupedGrids(this.allGrids());

    // The hint reads the stored position, never the place in this list: the
    // two kinds are grouped here and the hotkeys are not, so a grid shown
    // second may genuinely be \u23184.
    const row = (placed: PlacedGrid, heading?: string): MenuItem => ({
      icon: placed.grid.icon,
      label: placed.grid.name,
      detail: placed.position < 9 ? `\u2318${placed.position + 1}` : undefined,
      heading,
      // Shown but inert: the set reads whole, and selecting it would do nothing.
      disabled: placed.grid.name === active,
      onSelect: () => this.activate(placed.grid.name),
    });

    // Named groups rather than a rule between them. The two kinds behave
    // differently enough that a drop lands somewhere else, and a heading says
    // which is which where a rule only says that something changed. Headings
    // only once there is a second group to tell the first apart from: a vault
    // with no smart grids has one list, and captioning it says nothing.
    const captioned = smart.length > 0;
    const items: MenuItem[] = [
      ...manual.map((placed, index) =>
        row(placed, captioned && index === 0 ? "Grids" : undefined)
      ),
      ...smart.map((placed, index) => row(placed, index === 0 ? "Smart grids" : undefined)),
    ];
    this.menu?.open(items, x, y);
  }

  /**
   * Asks which grid a shared clip goes to, then files it there.
   *
   * Home and the manual grids only: a smart grid cannot be filed into
   * (fileableGrid), so offering it would be a row that lands somewhere else.
   * Dismissing the menu files to home rather than dropping the share: the
   * link was sent here to be kept, and a tap away is not a change of mind
   * about that.
   */
  pickGridAndClip(url: string): void {
    const home = this.plugin.settings.homeGridName;
    const { manual } = groupedGrids(this.allGrids());
    const items: MenuItem[] = manual.map((placed, index) => ({
      icon: placed.grid.icon,
      label: placed.grid.name,
      heading: index === 0 ? "Clip to" : undefined,
      onSelect: () => {
        const target = placed.grid.name === home ? "" : placed.grid.name;
        void this.plugin.capture.capture(url, target);
      },
    }));
    const anchor = this.spaceBar?.switcherAnchor() ?? { x: 0, y: 0 };
    this.menu?.open(items, anchor.x, anchor.y, undefined, false, () => {
      new Notice(`Oriko: saved to ${home}`);
      void this.plugin.capture.capture(url, "");
    });
  }

  /** Where the active grid sits in settings.grids, or -1 for home. */
  private activeGridIndex(): number {
    const active = this.activeGrid().name;
    return this.plugin.settings.grids.findIndex((grid) => grid.name === active);
  }

  private editActiveGrid(): void {
    if (!this.sheet) return;
    const index = this.activeGridIndex();
    // Not closed first: openGridEditor opens the sheet itself when none is up,
    // and Sheet.open closes whatever was. Closing here left the editor pushing
    // onto a sheet that no longer existed, which push declines to do.
    openGridEditor(
      this.sheet,
      this.gridsController(),
      this.activeGrid(),
      index === -1 ? undefined : index,
      () => this.refresh()
    );
  }

  private deleteActiveGrid(): void {
    if (!this.sheet) return;
    const index = this.activeGridIndex();
    // Home is where an unknown grid falls back to, so it always has to exist.
    if (index === -1) return;
    // Straight to the question about this grid. It used to open the manager
    // and stop there, leaving you on a list of every grid with nothing chosen,
    // which is not what a row saying Delete grid promises.
    openDeleteGrid(this.sheet, this.gridsController(), this.activeGrid(), index, () =>
      this.refresh()
    );
  }

  private manageGrids(): void {
    if (!this.sheet) return;
    openGridsManager(this.sheet, this.gridsController(), () => this.refresh());
  }

  /**
   * Settings for the pane and the grid on screen, with the whole set one step
   * further in. Rebuilt on each tick because the tile size rows are keepOpen,
   * and the check has to move as you step through them.
   */
  private openSettings(x: number, y: number): void {
    this.menu?.open(this.settingsItems(), x, y, () => this.settingsItems());
  }

  private settingsItems(): MenuItem[] {
    const active = this.activeGrid();
    const isHome = this.activeGridIndex() === -1;

    return [
      {
        icon: "layout-dashboard",
        label: "Tile size",
        detail: stageLabel(this.plugin.settings.tileSize),
        submenu: this.tileSizeItems(),
      },
      {
        icon: "pencil",
        label: "Edit grid",
        divider: true,
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
    ];
  }

  /**
   * Two steppers, then the stages by name with the current one ticked. The
   * steppers are for a pane you are squeezing down a stage at a time while
   * watching it; the names are for going straight to the one you want. Every
   * row keeps the menu open, since one press is rarely the last.
   */
  private tileSizeItems(): MenuItem[] {
    const current = this.plugin.settings.tileSize;
    const first = STAGES[0];
    const last = STAGES[STAGES.length - 1];
    const stages: MenuItem[] = STAGES.map((stage, i) => ({
      icon: "",
      label: stageLabel(stage),
      detailIcon: stage === current ? "check" : undefined,
      divider: i === 0,
      keepOpen: true,
      onSelect: () => this.setTileSize(stage),
    }));
    return [
      {
        icon: "minimize-2",
        label: "Shrink",
        disabled: current === first,
        keepOpen: true,
        onSelect: () => this.setTileSize(shrinkStage(current)),
      },
      {
        icon: "maximize-2",
        label: "Expand",
        disabled: current === last,
        keepOpen: true,
        onSelect: () => this.setTileSize(expandStage(current)),
      },
      ...stages,
    ];
  }

  private setTileSize(stage: DensityStage): void {
    if (stage === this.plugin.settings.tileSize) return;
    this.plugin.settings.tileSize = stage;
    void this.plugin.saveSettings();
    this.grid?.setDensity(stage);
  }

  private openCreate(x: number, y: number): void {
    this.menu?.open(
      [
        {
          icon: "clipboard-paste",
          label: "Clip",
          // Whatever is on the clipboard: a picture, a video, or a link.
          detail: "\u2318N",
          onSelect: () => void this.plugin.clipFromClipboard(),
        },
        {
          icon: "layers",
          label: "New grid",
          divider: true,
          onSelect: () => this.promptNewGrid(),
        },
        {
          icon: "wand-2",
          label: "New smart grid",
          onSelect: () => this.promptNewSmartGrid(),
        },
        {
          icon: "folder-plus",
          label: "New folder",
          divider: true,
          // Inert on a smart grid, so the row does not come and go by where
          // you are; a folder needs a grid that can be filed into.
          disabled: !this.canFile(),
          detail: this.canFile() ? undefined : "Smart grid",
          onSelect: () => this.promptNewFolder([]),
        },
      ],
      x,
      y
    );
  }

  private promptNewGrid(): void {
    if (!this.sheet) return;
    openNewGrid(this.sheet, this.gridsController(), () => this.refresh());
  }

  /** Empty rules rather than none: it is what tells the editor which kind of
      grid it is making, before any of them have been chosen. */
  private promptNewSmartGrid(): void {
    if (!this.sheet) return;
    openNewSmartGrid(this.sheet, this.gridsController(), {}, () => this.refresh());
  }

  private async moveTo(ids: string[], target: string): Promise<void> {
    const moved = await this.assign(ids, target);
    this.grid?.clearSelection();
    new Notice(
      moved === 1
        ? `Oriko: 1 clipping moved to ${target}`
        : `Oriko: ${moved} clippings moved to ${target}`
    );
  }

  // ---- Folders -----------------------------------------------------------

  /** The value a FolderSpace.grid carries for the grid on screen: "" for home. */
  private folderGridKey(): string {
    const active = this.activeGrid().name;
    return active === this.plugin.settings.homeGridName ? "" : active;
  }

  /** Whether the grid on screen can be filed into, and so can hold folders. */
  private canFile(): boolean {
    return !isSmartGrid(this.activeGrid());
  }

  private foldersHere(): FolderSpace[] {
    if (!this.canFile()) return [];
    const key = this.folderGridKey();
    return this.plugin.settings.folders.filter((folder) => folder.grid === key);
  }

  /** Paths of the clippings carrying this folder's name on the grid on screen. */
  private folderMembers(name: string): string[] {
    return filterByGrid(
      this.plugin.index.records(),
      this.activeGrid().name,
      this.plugin.settings.homeGridName,
      this.registered()
    )
      .filter((record) => record.folder.trim() === name)
      .map((record) => record.path);
  }

  private enterFolder(name: string): void {
    if (!this.foldersHere().some((folder) => folder.name === name)) return;
    if (this.openFolder === name) return;
    this.openFolder = name;
    this.grid?.clearSelection();
    this.refresh({ replace: true });
    this.grid?.resetView(false);
    this.spaceBar?.setFolder(name);
  }

  private leaveFolder(): void {
    if (this.openFolder === null) return;
    this.openFolder = null;
    this.grid?.clearSelection();
    this.refresh({ replace: true });
    this.grid?.resetView(false);
    this.spaceBar?.setFolder(null);
  }

  private async moveToFolder(ids: string[], name: string): Promise<void> {
    const folder = this.foldersHere().find((f) => f.name === name);
    if (!folder) return;
    // Already there is not a move, and not a write.
    const paths = ids.filter((id) => this.plugin.index.get(id)?.folder.trim() !== name);
    const moved = paths.length > 0 ? await this.assign(paths, this.activeGrid().name, name) : 0;
    this.grid?.clearSelection();
    new Notice(
      moved === 1
        ? `Oriko: 1 clipping moved to ${name}`
        : `Oriko: ${moved} clippings moved to ${name}`
    );
  }

  /** Opens the editor for a new folder; `seed` is moved in once it is made. */
  private promptNewFolder(seed: string[]): void {
    if (!this.sheet || !this.canFile()) return;
    openFolderEditor(
      this.sheet,
      this.foldersController(),
      { name: "", icon: "folder", grid: this.folderGridKey(), width: 1 },
      true,
      (saved) => {
        if (seed.length > 0) void this.moveToFolder(seed, saved.name);
        this.refresh();
        // Folders lead the wall, so a new one is at the top; go there, or
        // it was made somewhere you cannot see, and light it as it lands.
        // After the repaint, which is the frame after this one.
        this.grid?.spotlight(folderTileId(saved));
        window.requestAnimationFrame(() => this.grid?.resetView());
      }
    );
  }

  private editFolder(folder: FolderSpace): void {
    if (!this.sheet) return;
    openFolderEditor(this.sheet, this.foldersController(), folder, false, () => this.refresh());
  }

  private removeFolder(folder: FolderSpace): void {
    if (!this.sheet) return;
    openRemoveFolder(this.sheet, this.foldersController(), folder, () => this.refresh());
  }

  private async resizeFolder(name: string, width: FolderWidth): Promise<void> {
    const entry = this.foldersHere().find((folder) => folder.name === name);
    if (!entry || entry.width === width) return;
    entry.width = width;
    await this.plugin.saveSettings();
    // The drag already laid the wall out at this width, so the repaint moves
    // nothing and the camera stays where the hand left it.
    this.refresh();
  }

  private openFolderMenu(name: string, x: number, y: number): void {
    const folder = this.foldersHere().find((f) => f.name === name);
    if (!folder) return;
    const labels: Record<string, string> = { 1: "Small", 2: "Wide", 3: "Extra wide" };
    const items: MenuItem[] = [
      { icon: "folder-open", label: "Open", onSelect: () => this.enterFolder(name) },
      {
        icon: "pencil",
        label: "Edit folder",
        divider: true,
        onSelect: () => this.editFolder(folder),
      },
      {
        icon: "move-horizontal",
        label: "Size",
        detail: labels[String(folder.width)],
        submenu: FOLDER_WIDTHS.map((width) => ({
          icon: "",
          label: labels[String(width)],
          detailIcon: width === folder.width ? "check" : undefined,
          onSelect: () => void this.resizeFolder(name, width),
        })),
      },
      {
        icon: "trash-2",
        label: "Remove folder",
        divider: true,
        destructive: true,
        onSelect: () => this.removeFolder(folder),
      },
    ];
    this.menu?.open(items, x, y);
  }

  private foldersController(): FoldersController {
    const settings = this.plugin.settings;
    return {
      folders: () => this.foldersHere(),
      memberCount: (name) => this.folderMembers(name).length,
      create: async (folder) => {
        settings.folders.push(folder);
        await this.plugin.saveSettings();
      },
      rename: async (from, next) => {
        const key = this.folderGridKey();
        const entry = settings.folders.find((f) => f.grid === key && f.name === from);
        if (!entry) return;
        const members = next.name !== from ? this.folderMembers(from) : [];
        entry.name = next.name;
        entry.icon = next.icon;
        if (this.openFolder === from) {
          this.openFolder = next.name;
          this.spaceBar?.setFolder(next.name);
        }
        await this.plugin.saveSettings();
        if (members.length > 0) await this.assign(members, this.activeGrid().name, next.name);
        this.refresh();
      },
      remove: async (name) => {
        const key = this.folderGridKey();
        const index = settings.folders.findIndex((f) => f.grid === key && f.name === name);
        if (index === -1) return;
        settings.folders.splice(index, 1);
        // Members keep a key that no longer resolves, which folders.ts reads
        // as loose. Nothing is rewritten, so recreating the folder undoes this.
        if (this.openFolder === name) {
          this.openFolder = null;
          this.spaceBar?.setFolder(null);
        }
        await this.plugin.saveSettings();
        this.refresh({ replace: true });
      },
    };
  }

  private gridsController(): GridsController {
    const settings = this.plugin.settings;

    return {
      home: () => this.homeGrid(),
      grids: () => settings.grids,
      memberCount: (name) => membersOf(this.plugin.index.records(), name).length,

      // Every tile, typed and tallied together. A rule is written against the
      // whole vault, so the active grid's vocabulary would be the wrong one,
      // and its counts would not survive switching to the grid being made.
      ruleWorld: () => {
        const tiles = buildTiles(
          this.plugin.index.records(),
          this.plugin.archiver.cache,
          this.unloadable
        );
        const defs = this.allDefs(tiles);
        return {
          defs,
          facets: facetsOf(tiles, defs),
          matches: (rules) => smartMembers(tiles, rules, defs).length,
        };
      },

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
          // Home arrives whole, as it would through activate().
          this.filter = emptyFilter();
        }
        await this.plugin.saveSettings();
        this.spaceBar?.setActive(this.activeGrid());
        this.refresh();
      },
    };
  }
}
