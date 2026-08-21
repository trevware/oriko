import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { absolutePath } from "./convert";
import { dedupeMedia, sourceVideoKeyFor } from "./normalize";
import { copyToDownloads, revealInFinder, systemAvailable } from "./system";
import { ActionBar } from "./action-bar";
import { buildCommands, facetValueCommands } from "./commands";
import type { PaletteContext } from "./commands";
import { ConfirmDeleteModal } from "./confirm";
import { isDateToken, todayISO, tokenLabel } from "./dates";
import { Sheet } from "./sheet";
import type { SheetRow } from "./sheet";
import { isEditable, withValue, withoutValue } from "./editable";
import { ContextMenu } from "./context-menu";
import {
  openDeleteGrid,
  openGridEditor,
  openGridsManager,
  openNewSmartGrid,
  openNewGrid,
} from "./grid-sheets";
import { DetailView } from "./detail";
import { classifyDrop, describeSkipped, titleForDropped, wantsDrop } from "./drop";
import type { MenuItem } from "./context-menu";
import type { GridsController } from "./grid-sheets";
import { GridRenderer } from "./grid";
import { groupedMenu } from "./layout";
import type PowerGridPlugin from "./main";
import { Palette } from "./palette";
import { LayerPanel, PanelToggle } from "./panel";
import { resourceUrl } from "./convert";
import { PlaybackController } from "./playback";
import { ProgressBar } from "./progress";
import type { PropertyVocabulary } from "./filter";
import {
  activeCount,
  smartMembers,
  emptyFilter,
  facetDefs,
  facetLabel,
  facetsOf,
  isFilterEmpty,
  matchesFilter,
  propertyVocabulary,
  pruneFilter,
  toggleFacet,
  typedFacets,
} from "./filter";
import type { FacetDef, FilterState } from "./filter";
import { SpaceBar } from "./space-bar";
import { describeFiles } from "./media-refs";
import { orphansAfterDeleting, removeMedia } from "./sweep";
import {
  effectiveGrid,
  filterByGrid,
  groupedGrids,
  hotkeyPosition,
  isSmartGrid,
  membersOf,
  orderedGrids,
} from "./spaces";
import type { GridSpace, PlacedGrid } from "./spaces";
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
      this.reportCaptureHome(path);
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

    // Hovering a card plays it even when autoplay is off, which is the only
    // way a video moves on such a wall.
    this.grid.onHoverMedia = (media) => this.playback?.hover(media);

    this.grid.onDeleteRequested = (ids: string[]) => this.confirmDelete(ids);

    this.actionBar = new ActionBar(this.contentEl, {
      onDelete: () => this.confirmDelete(this.grid?.selectedIds() ?? []),
    });
    this.grid.onSelectionChanged = (ids: string[]) => {
      this.actionBar?.setSelection(ids);
      this.panel?.setSelection(ids);
    };

    this.menu = new ContextMenu(this.contentEl);
    this.sheet = new Sheet(this.contentEl);
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
      if (this.app.workspace.getActiveViewOfType(PowerGridView) !== this) return;
      // The detail view registers in the capture phase too and owns its keys
      // while it is up.
      if (this.detail?.isOpen) return;
      // Escape backs out one thing at a time, the same bargain the menus and
      // the palette make. A selection is the innermost thing on the wall, so
      // it goes first and the panel only closes once there is none: pressing
      // Escape should never undo two decisions at once.
      if (event.key === "Escape") {
        if (this.palette?.isOpen) return;
        if ((this.grid?.selectedIds().length ?? 0) > 0) return;
        if (!this.panel?.isOpen) return;
        event.preventDefault();
        event.stopPropagation();
        this.togglePanel();
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

    this.detail = new DetailView(this.app, this.contentEl, {
      onExport: (id) => void this.exportToDownloads([id]),
      onReveal: (id) => this.revealFirstFile(id),
      onDelete: (id) => this.confirmDelete([id]),
      onOpenNote: (id) => this.openNote(id),
      onEditProperties: (id, x, y) => this.editProperties(id, x, y),
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
      void detail.open(model, origin);
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

    // dragleave fires again every time the pointer crosses into a child, and
    // the wall is nothing but children. Counting entries against leaves is
    // what stops the target strobing the whole way across the grid.
    let depth = 0;
    const show = (on: boolean): void => {
      if (!on) depth = 0;
      el.toggleClass("is-drop-target", on);
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
        new Notice(`Power Grid: ${describeSkipped(plan.skipped)}`);
        return;
      }

      if (plan.kind === "url") {
        void this.plugin.capture.capture(plan.url);
        return;
      }

      if (plan.skipped.length > 0) {
        new Notice(`Power Grid: ${describeSkipped(plan.skipped)}`);
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

  /**
   * The rows for editing every editable property of one clipping.
   *
   * One clipping only. Across a selection a value is held by some and not
   * others, and a tick that means "some of these" is a different control than
   * this one, not a wider version of it. Shared with the detail view's bar so
   * both surfaces offer the same rows and reach the same single writer.
   */
  propertyRows(id: string): MenuItem[] {
    const rows: MenuItem[] = [];
    for (const def of this.defs()) {
      if (def.source !== "property" || !def.key || !isEditable(def.key)) continue;
      rows.push({
        icon: def.icon,
        label: def.label,
        submenu: this.propertyMenu(id, def.key),
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
    const describe: MenuItem[] = n === 1 ? this.propertyRows(ids[0]) : [];
    const file: MenuItem[] = [];
    const destroy: MenuItem[] = [];

    if (n === 1) {
      reach.push({
        icon: "file-text",
        label: "Open note",
        onSelect: () => this.openNote(ids[0]),
      });
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

    if (this.allGrids().length > 1) {
      file.push({
        icon: "corner-up-right",
        label: "Move to grid",
        submenu: this.allGrids().map((grid) => ({
          icon: grid.icon,
          label: grid.name,
          onSelect: () => void this.moveTo(ids, grid.name),
        })),
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
  private editProperties(id: string, x: number, y: number): void {
    const rows = (): MenuItem[] => this.propertyRows(id);
    const items = rows();
    if (items.length === 0) {
      new Notice("Power Grid: no editable properties are enabled in settings");
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

  /**
   * Settings the wall can adopt where it stands, pushed as they are saved.
   *
   * Only the ones that need nothing rebuilt: anything changing what a tile is
   * or which records are on screen is a refresh, not this. Autoplay qualifies
   * because the controller was always able to be told, and nothing was ever
   * telling it, so the toggle wrote a value the open wall went on ignoring
   * until the view was reopened.
   */
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
    this.facets =
      smart && space.rules ? smartMembers(tiles, space.rules, this.allDefs(tiles)) : tiles;
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
      new Notice(`Power Grid: saved to ${home}`);
      return;
    }

    if (matchesFilter(tile, space.rules, this.allDefs(this.facets))) return;

    new Notice(
      `Power Grid: saved to ${home}. It does not match ${space.name}, so it is not on this wall.`
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
    const defs = this.defs();
    const shown = isFilterEmpty(filter)
      ? this.facets
      : this.facets.filter((tile) => matchesFilter(tile, filter, defs));
    this.grid?.setTiles(shown, options);
    // The same list, so a filter narrows both and neither can drift.
    this.panel?.setTiles(shown, this.activeGrid().name);
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

  /** Pruned on the way out, so a property switched off in settings stops
      counting towards the badge instead of claiming a narrowing that
      matchesFilter is no longer applying. */
  private activeFilter(): FilterState {
    const stored = this.filters.get(this.activeGrid().name) ?? emptyFilter();
    const pruned = pruneFilter(stored, this.defs());
    if (pruned !== stored) {
      if (isFilterEmpty(pruned)) this.filters.delete(this.activeGrid().name);
      else this.filters.set(this.activeGrid().name, pruned);
    }
    return pruned;
  }

  private setFilter(next: FilterState): void {
    if (isFilterEmpty(next)) this.filters.delete(this.activeGrid().name);
    else this.filters.set(this.activeGrid().name, next);
    // Straight to the narrowing pass; the tiles behind it have not changed.
    this.applyFilter({ replace: true });
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
          label: def.shape === "date" ? tokenLabel(value) : value,
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
   * Shows or hides the list over the wall.
   *
   * The panel floats, like every other surface here, so the wall neither
   * reflows nor moves underneath it. What you were looking at stays exactly
   * where it was.
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
      : this.facets.filter((tile) => matchesFilter(tile, filter, this.defs()));
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
        editGrid: () => this.editActiveGrid(),
        deleteGrid: () => this.deleteActiveGrid(),
        manageGrids: () => this.manageGrids(),
        toggleFacet: (id, value) =>
          this.setFilter(toggleFacet(this.activeFilter(), id, value)),
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
  /**
   * Writes one property of one clipping.
   *
   * Guarded by isEditable rather than trusted: the caller is UI, and the keys
   * the Web Clipper owns are a contract this plugin does not get to break.
   * Refusing here means a future caller cannot widen the licence by accident.
   *
   * `updated` is bumped alongside, because vault CLAUDE.md §9 lists it among
   * the properties parsing maintains and every other tool there keeps it
   * current.
   */
  private async setProperty(path: string, key: string, values: string[]): Promise<void> {
    if (!isEditable(key)) {
      new Notice(`Power Grid: ${key} belongs to the clipper and is not editable`);
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
      new Notice(`Power Grid: could not update ${key} (${String(error)})`);
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

  private propertyMenu(path: string, key: string): MenuItem[] {
    const held = this.heldValues(path, key);
    const { values, single } = this.vocabularyFor(key);

    const rows: MenuItem[] = values.map((entry) => {
      const on = held.includes(entry.value);
      return {
        icon: "",
        label: entry.value,
        detail: String(entry.count),
        detailIcon: on ? "check" : undefined,
        keepOpen: true,
        onSelect: () => {
          // A property no clipping holds more than one of reads as a choice,
          // so picking replaces rather than adds. Picking the one already set
          // clears it, which is the only way to unset from a list of values.
          const next = single
            ? on
              ? []
              : [entry.value]
            : on
              ? withoutValue(held, entry.value)
              : withValue(held, entry.value);
          // Recorded before the write, and the write is not waited on. The
          // menu rebuilds from this on the same tick as the click; the note
          // catches up on its own.
          this.edited.set(this.editKey(path, key), next);
          void this.setProperty(path, key, next);
        },
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
          this.promptPropertyValue(path, key, single, held);
          return;
        }

        // Recorded before the write and not waited on, exactly as the value
        // rows do it, so the tick lands on the keystroke that caused it.
        const next = single ? [wanted] : withValue(held, wanted);
        this.edited.set(this.editKey(path, key), next);
        void this.setProperty(path, key, next);
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
            new Notice("Power Grid: a date reads yyyy-mm-dd");
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
    path: string,
    key: string,
    single: boolean,
    held: string[]
  ): void {
    const options = propertyVocabulary(this.facets, key).values;

    const apply = (value: string): void => {
      this.sheet?.close();
      void this.setProperty(path, key, single ? [value] : withValue(held, value));
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
          detailIcon: held.includes(entry.value) ? "check" : undefined,
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
    const { manual, smart } = groupedGrids(this.allGrids());

    // The hint reads the stored position, never the place in this list: the
    // two kinds are grouped here and the hotkeys are not, so a grid shown
    // second may genuinely be \u23184.
    const row = (placed: PlacedGrid, divider = false): MenuItem => ({
      icon: placed.grid.icon,
      label: placed.grid.name,
      detail: placed.position < 9 ? `\u2318${placed.position + 1}` : undefined,
      divider,
      // Shown but inert: the set reads whole, and selecting it would do nothing.
      disabled: placed.grid.name === active,
      onSelect: () => this.activate(placed.grid.name),
    });

    // A rule above the first computed grid, and only when there is one. The
    // two kinds behave differently enough that a drop lands somewhere else,
    // so the picker should not present them as one undifferentiated list.
    const items: MenuItem[] = [
      ...manual.map((placed) => row(placed)),
      ...smart.map((placed, index) => row(placed, index === 0)),
    ];
    this.menu?.open(items, x, y);
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
        {
          icon: "wand-2",
          label: "New smart grid",
          onSelect: () => this.promptNewSmartGrid(),
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
