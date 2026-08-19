import { Vault, setIcon } from "obsidian";
import { resourceUrl } from "./convert";
import { windowRange } from "./layout";
import { domainOf } from "./scan";
import { previewOf } from "./tile";
import type { TileModel } from "./tile";

/**
 * The layer panel: the wall as a list.
 *
 * The canvas is the wrong shape for three questions it gets asked anyway.
 * What else is on this grid while I am zoomed into a corner of it? What is
 * this picture actually called? How do I select these five without dragging
 * a marquee across the ones between them? A list answers all three without
 * changing the canvas, so the two stay in step rather than competing: the
 * panel lists exactly what the wall shows, in the wall's own order, and
 * clicking a row flies there.
 *
 * Windowed, because a grid is not bounded by what fits on screen. Rows are a
 * fixed height so the window is arithmetic rather than a search, and the DOM
 * holds twenty-odd rows whether the grid has fifty clippings or fifty
 * thousand.
 */

/** Fixed by design: uniform heights are what make windowRange arithmetic. */
const ROW_HEIGHT = 44;
const OVERSCAN = 4;

export interface PanelHandlers {
  /** Selection semantics live on the wall, so a pick is forwarded to it. */
  onPick: (id: string, mode: "replace" | "toggle" | "range") => void;
  /** Rings the tile under the cursor, so the list connects to the canvas. */
  onHover: (id: string | null) => void;
}

interface Row {
  root: HTMLElement;
  thumb: HTMLElement;
  image: HTMLImageElement;
  name: HTMLElement;
  detail: HTMLElement;
  /** What it is currently showing, so a scroll only rewrites what changed. */
  id: string;
  src: string;
}

export class LayerPanel {
  private root: HTMLElement | null = null;
  private heading: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private spacer: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private rows: Row[] = [];

  private tiles: TileModel[] = [];
  private selection = new Set<string>();
  private title = "";

  constructor(
    private container: HTMLElement,
    private vault: Vault,
    private handlers: PanelHandlers
  ) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(): void {
    if (this.isOpen) return;

    this.root = this.container.createDiv({ cls: "pg-panel" });

    const head = this.root.createDiv({ cls: "pg-panel-head" });
    // No close button of its own: the floating handle outside is the one
    // control, and it is where the panel was opened from.
    this.heading = head.createDiv({ cls: "pg-panel-title" });

    this.scroller = this.root.createDiv({ cls: "pg-panel-list" });
    this.spacer = this.scroller.createDiv({ cls: "pg-panel-spacer" });
    this.scroller.addEventListener("scroll", () => this.paintWindow(), { passive: true });
    // Leaving the list, rather than one row: moving between two rows fires
    // the next row's enter first, so a per-row leave would clear the ring
    // that row had just set.
    this.scroller.onmouseleave = () => this.handlers.onHover(null);
    this.root.onmouseleave = () => this.handlers.onHover(null);

    this.paint();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.heading = null;
    this.scroller = null;
    this.spacer = null;
    this.emptyEl = null;
    this.rows = [];
  }

  /** Whatever the wall is showing, after its filter, in its own order. */
  setTiles(tiles: TileModel[], gridName: string): void {
    this.tiles = tiles;
    this.title = gridName;
    if (this.isOpen) this.paint();
  }

  setSelection(ids: string[]): void {
    this.selection = new Set(ids);
    if (!this.isOpen) return;
    this.paintSelection();
    this.scrollTo(ids[ids.length - 1]);
  }

  private paint(): void {
    if (!this.spacer || !this.heading) return;

    const count = this.tiles.length;
    this.heading.setText(this.title);
    this.heading.dataset.count = count === 1 ? "1 clipping" : `${count} clippings`;
    this.spacer.style.height = `${count * ROW_HEIGHT}px`;

    if (count === 0 && !this.emptyEl && this.scroller) {
      this.emptyEl = this.scroller.createDiv({ cls: "pg-panel-empty", text: "Nothing here yet" });
    } else if (count > 0 && this.emptyEl) {
      this.emptyEl.remove();
      this.emptyEl = null;
    }

    this.paintWindow();
  }

  private paintWindow(): void {
    const scroller = this.scroller;
    if (!scroller) return;

    const { start, end } = windowRange({
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
      rowHeight: ROW_HEIGHT,
      count: this.tiles.length,
      overscan: OVERSCAN,
    });

    const needed = end - start;
    while (this.rows.length < needed) this.rows.push(this.buildRow());

    this.rows.forEach((row, offset) => {
      if (offset >= needed) {
        row.root.style.display = "none";
        return;
      }
      this.paintRow(row, this.tiles[start + offset], start + offset);
    });
  }

  private buildRow(): Row {
    const root = this.scroller!.createDiv({ cls: "pg-panel-row" });
    const thumb = root.createDiv({ cls: "pg-panel-thumb" });
    const image = thumb.createEl("img");
    image.loading = "lazy";
    image.decoding = "async";
    const name = root.createDiv({ cls: "pg-panel-name" });
    const detail = root.createDiv({ cls: "pg-panel-detail" });

    const row: Row = { root, thumb, image, name, detail, id: "", src: "" };

    root.onclick = (event: MouseEvent) => {
      if (!row.id) return;
      const mode = event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace";
      this.handlers.onPick(row.id, mode);
    };
    root.onmouseenter = () => this.handlers.onHover(row.id || null);

    return row;
  }

  private paintRow(row: Row, tile: TileModel, index: number): void {
    row.root.style.display = "";
    row.root.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
    row.root.toggleClass("is-selected", this.selection.has(tile.id));

    if (row.id === tile.id) return;
    row.id = tile.id;

    row.name.setText(tile.record.title);
    row.detail.setText(domainOf(tile.record.source));
    row.root.toggleClass("is-video", tile.kind === "video");

    const preview = previewOf(tile);
    const src = preview ? resourceUrl(this.vault, preview.path, preview.remote) : "";
    // Guarded: reassigning the same src restarts the fetch and flashes the
    // row, and a fast scroll repaints the same rows many times.
    if (src !== row.src) {
      row.src = src;
      // Removed rather than blanked: src="" resolves against the page and
      // fires a request for the document itself.
      if (src) row.image.src = src;
      else row.image.removeAttribute("src");
    }
    row.thumb.toggleClass("is-blank", src === "");
  }

  private paintSelection(): void {
    for (const row of this.rows) {
      row.root.toggleClass("is-selected", row.id !== "" && this.selection.has(row.id));
    }
  }

  /** Brings a tile selected on the wall into view in the list. */
  private scrollTo(id: string | undefined): void {
    const scroller = this.scroller;
    if (!scroller || !id) return;

    const index = this.tiles.findIndex((tile) => tile.id === id);
    if (index === -1) return;

    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight;
    }
  }
}

/**
 * The handle that shows the panel, floating in the top-left corner of the
 * wall on the same surface as every other control.
 *
 * Kept out of the space bar deliberately. That bar speaks about the grid you
 * are in: which one, what is filtering it, what to add. This one changes the
 * shape of the pane itself, and it belongs at the edge it moves.
 */
export class PanelToggle {
  private root: HTMLElement;

  constructor(container: HTMLElement, private onToggle: () => void) {
    this.root = container.createEl("button", { cls: "pg-panel-toggle" });
    this.root.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.onToggle();
    };
    this.setOpen(false);
  }

  /** The icon carries the state; the panel being on screen says the rest. */
  setOpen(open: boolean): void {
    this.root.empty();
    setIcon(this.root, open ? "panel-left-close" : "panel-left");
    this.root.setAttribute("aria-label", open ? "Hide list" : "Show list");
    this.root.toggleClass("is-open", open);
  }

  destroy(): void {
    this.root.remove();
  }
}
