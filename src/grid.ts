import { App, TFile, normalizePath } from "obsidian";
import { columnsForWidth, computeLayout, visibleRange } from "./layout";
import type { LayoutResult, Position } from "./layout";
import type { TileModel } from "./tile";

const GAP = 14;
const TARGET_COLUMN_WIDTH = 300;
const OVERSCAN = 600;

interface TileElement {
  root: HTMLElement;
  media: HTMLElement | null;
  id: string;
  signature: string;
  kind: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Virtualized masonry with a recycled element pool. Only the viewport plus
 * one screen of overscan exists in the DOM, and scrolling reuses elements
 * rather than creating and destroying them.
 */
export class GridRenderer {
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  private tiles: TileModel[] = [];
  private byId = new Map<string, TileModel>();
  private layout: LayoutResult = { positions: [], totalHeight: 0 };
  private mounted = new Map<string, TileElement>();
  private pool: TileElement[] = [];
  private frame = 0;
  private relayoutFrame = 0;
  /** Real dimensions learned by loading a tile whose size was a guess. */
  private measured = new Map<string, { w: number; h: number }>();

  private spaceHeld = false;
  private panning = false;
  /** True when the pointer moved enough to count as a pan, not a click. */
  private panMoved = false;
  private panOrigin = { x: 0, y: 0, left: 0, top: 0 };
  private onKeyDown: ((event: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((event: KeyboardEvent) => void) | null = null;
  private onBlur: (() => void) | null = null;

  /** Called after every render pass so the view can observe new video tiles. */
  onRendered: () => void = () => {};

  /** A tile's cover could not be loaded and it should leave the grid. */
  onSourceFailed: (id: string) => void = () => {};

  constructor(private app: App, container: HTMLElement) {
    this.scroller = container.createDiv({ cls: "cg-scroller" });
    this.spacer = this.scroller.createDiv({ cls: "cg-spacer" });
    this.scroller.addEventListener("scroll", () => this.schedule(), { passive: true });
    this.installPanning();
  }

  /**
   * Trackpad panning on both axes, plus hold-space to grab and drag, the
   * way a canvas tool behaves. Horizontal movement only does anything when
   * the wall is wider than the pane.
   */
  private installPanning(): void {
    this.scroller.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        if (event.ctrlKey) return;
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        if (this.scroller.scrollWidth <= this.scroller.clientWidth) return;
        event.preventDefault();
        this.scroller.scrollLeft += event.deltaX;
      },
      { passive: false }
    );

    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      // Never steal the space bar from a text field.
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.scroller.addClass("is-pannable");
      }
      event.preventDefault();
    };

    this.onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      this.endPan();
    };

    // Losing focus mid-drag would otherwise leave the grab cursor stuck on.
    this.onBlur = () => this.endPan();

    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    this.scroller.addEventListener("pointerdown", (event: PointerEvent) => {
      const middleClick = event.button === 1;
      if (!this.spaceHeld && !middleClick) return;
      event.preventDefault();
      this.panning = true;
      this.panMoved = false;
      this.panOrigin = {
        x: event.clientX,
        y: event.clientY,
        left: this.scroller.scrollLeft,
        top: this.scroller.scrollTop,
      };
      this.scroller.addClass("is-panning");
      this.scroller.setPointerCapture(event.pointerId);
    });

    this.scroller.addEventListener("pointermove", (event: PointerEvent) => {
      if (!this.panning) return;
      const dx = event.clientX - this.panOrigin.x;
      const dy = event.clientY - this.panOrigin.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.panMoved = true;
      this.scroller.scrollLeft = this.panOrigin.left - dx;
      this.scroller.scrollTop = this.panOrigin.top - dy;
    });

    const stop = (event: PointerEvent): void => {
      if (!this.panning) return;
      this.panning = false;
      this.scroller.removeClass("is-panning");
      if (this.scroller.hasPointerCapture(event.pointerId)) {
        this.scroller.releasePointerCapture(event.pointerId);
      }
      // Cleared after the click event that follows pointerup has run.
      window.setTimeout(() => {
        this.panMoved = false;
      }, 0);
    };

    this.scroller.addEventListener("pointerup", stop);
    this.scroller.addEventListener("pointercancel", stop);
  }

  private endPan(): void {
    this.spaceHeld = false;
    this.panning = false;
    this.scroller.removeClass("is-pannable");
    this.scroller.removeClass("is-panning");
  }

  get scrollerEl(): HTMLElement {
    return this.scroller;
  }

  setTiles(tiles: TileModel[]): void {
    this.tiles = tiles;
    this.byId = new Map(tiles.map((t) => [t.id, t]));

    // Drop mounted elements whose model is gone, so filtering cannot leave
    // a stale tile painted at a recycled position.
    for (const [id, element] of [...this.mounted]) {
      if (!this.byId.has(id)) {
        this.mounted.delete(id);
        this.release(element);
      }
    }
    this.relayout();
  }

  relayout(): void {
    const width = this.scroller.clientWidth || 800;
    const columns = columnsForWidth(width, TARGET_COLUMN_WIDTH, GAP);
    this.layout = computeLayout(
      this.tiles.map((t) => {
        // A measurement only overrides a guess, never a size read from the
        // archived file's own header.
        const learned = t.provisional ? this.measured.get(t.id) : undefined;
        return {
          id: t.id,
          width: learned?.w ?? t.width,
          height: learned?.h ?? t.height,
        };
      }),
      width,
      columns,
      GAP
    );
    this.spacer.style.height = `${this.layout.totalHeight}px`;
    this.render();
  }

  private scheduleRelayout(): void {
    if (this.relayoutFrame) return;
    this.relayoutFrame = window.requestAnimationFrame(() => {
      this.relayoutFrame = 0;
      this.relayout();
    });
  }

  private measure(id: string, w: number, h: number): void {
    if (!(w > 0 && h > 0)) return;
    const previous = this.measured.get(id);
    if (previous && previous.w === w && previous.h === h) return;
    this.measured.set(id, { w, h });
    this.scheduleRelayout();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private acquire(): TileElement {
    const recycled = this.pool.pop();
    if (recycled) return recycled;
    const root = this.spacer.createDiv({ cls: "cg-tile" });
    return { root, media: null, id: "", signature: "", kind: "" };
  }

  private release(tile: TileElement): void {
    tile.root.style.display = "none";
    tile.root.empty();
    tile.id = "";
    tile.signature = "";
    tile.kind = "";
    tile.media = null;
    this.pool.push(tile);
  }

  /** Remote covers address the origin directly; local ones go through the vault. */
  private sourceFor(path: string, remote: boolean): string {
    if (!path) return "";
    if (remote) return path;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : "";
  }

  /**
   * Decodes the replacement before showing it, so a tile swapping from the
   * origin server to its archived copy never flashes empty.
   */
  private swapImage(image: HTMLImageElement, next: string): void {
    if (!next || image.src === next) return;
    const preload = new Image();
    preload.src = next;
    void preload
      .decode()
      .then(() => {
        if (image.isConnected) image.src = next;
      })
      .catch(() => undefined);
  }

  private openNote(model: TileModel, event: MouseEvent): void {
    const file = this.app.vault.getAbstractFileByPath(model.record.path);
    if (!(file instanceof TFile)) return;
    const newPane = event.metaKey || event.ctrlKey;
    void this.app.workspace.getLeaf(newPane ? "tab" : false).openFile(file);
  }

  private paint(element: TileElement, model: TileModel, position: Position): void {
    element.root.style.display = "";
    element.root.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    element.root.style.width = `${position.w}px`;
    element.root.style.height = `${position.h}px`;

    // Same content already painted: reposition only, never rebuild.
    if (element.signature === model.signature) return;

    const still = this.sourceFor(model.thumbPath, model.remote);
    const original = this.sourceFor(model.filePath, model.remote);

    // An image tile whose source changed (archiving replaced the remote copy
    // with a local one) swaps in place rather than rebuilding the tile.
    if (
      element.id === model.id &&
      element.kind === "image" &&
      model.kind === "image" &&
      element.media instanceof HTMLImageElement
    ) {
      const image = element.media;
      this.swapImage(image, still || original);
      if (model.animated && original) {
        image.dataset.stillSrc = still || original;
        image.dataset.animatedSrc = original;
      } else {
        delete image.dataset.stillSrc;
        delete image.dataset.animatedSrc;
      }
      element.signature = model.signature;
      return;
    }

    element.id = model.id;
    element.signature = model.signature;
    element.kind = model.kind;
    element.root.empty();
    element.media = null;

    const frame = element.root.createDiv({ cls: "cg-frame" });

    if (model.kind === "video") {
      const video = frame.createEl("video", { cls: "cg-media" });
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      // A remote video has no poster, so it needs metadata to paint a frame.
      video.preload = model.remote ? "metadata" : "none";
      if (still && !model.remote) video.poster = still;
      if (model.remote) video.src = original;
      else video.dataset.src = original;

      if (model.provisional) {
        video.addEventListener(
          "loadedmetadata",
          () => this.measure(model.id, video.videoWidth, video.videoHeight),
          { once: true }
        );
      }
      element.media = video;
    } else {
      const image = frame.createEl("img", { cls: "cg-media" });
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = model.record.title;
      image.src = still || original;

      if (model.animated && original) {
        // A GIF cannot be paused in place, so playback swaps between the
        // still thumbnail and the original.
        image.dataset.stillSrc = still || original;
        image.dataset.animatedSrc = original;
      }

      if (model.provisional) {
        image.addEventListener(
          "load",
          () => this.measure(model.id, image.naturalWidth, image.naturalHeight),
          { once: true }
        );
      }

      // A remote cover can 403 on a hotlink-protected host. Drop the tile
      // rather than leaving a broken image in the wall.
      image.addEventListener(
        "error",
        () => {
          if (image.isConnected) this.onSourceFailed(model.id);
        },
        { once: true }
      );

      element.media = image;
    }

    const meta = element.root.createDiv({ cls: "cg-meta" });
    meta.createDiv({ cls: "cg-title", text: model.record.title });
    const sub = meta.createDiv({ cls: "cg-sub" });
    const domain = domainOf(model.record.source);
    if (domain) sub.createSpan({ text: domain });
    if (model.record.categories.length) {
      if (domain) sub.createSpan({ cls: "cg-dot", text: "·" });
      sub.createSpan({ text: model.record.categories.join(", ") });
    }

    element.root.onclick = (event: MouseEvent) => {
      // A pan that ends over a tile must not also open it.
      if (this.panMoved) return;
      this.openNote(model, event);
    };
  }

  render(): void {
    const visible = visibleRange(
      this.layout.positions,
      this.scroller.scrollTop,
      this.scroller.clientHeight,
      OVERSCAN
    );
    const wanted = new Set(visible.map((p) => p.id));

    for (const [id, element] of [...this.mounted]) {
      if (!wanted.has(id)) {
        this.mounted.delete(id);
        this.release(element);
      }
    }

    for (const position of visible) {
      const model = this.byId.get(position.id);
      if (!model) continue;
      let element = this.mounted.get(position.id);
      if (!element) {
        element = this.acquire();
        this.mounted.set(position.id, element);
      }
      this.paint(element, model, position);
    }

    this.onRendered();
  }

  /** Video and animated-image elements currently in the DOM. */
  mountedMedia(): Array<HTMLVideoElement | HTMLImageElement> {
    const out: Array<HTMLVideoElement | HTMLImageElement> = [];
    for (const tile of this.mounted.values()) {
      const media = tile.media;
      if (media instanceof HTMLVideoElement) out.push(media);
      else if (media instanceof HTMLImageElement && media.dataset.animatedSrc) out.push(media);
    }
    return out;
  }

  destroy(): void {
    if (this.onKeyDown) document.removeEventListener("keydown", this.onKeyDown);
    if (this.onKeyUp) document.removeEventListener("keyup", this.onKeyUp);
    if (this.onBlur) window.removeEventListener("blur", this.onBlur);
    if (this.frame) window.cancelAnimationFrame(this.frame);
    if (this.relayoutFrame) window.cancelAnimationFrame(this.relayoutFrame);
    this.mounted.clear();
    this.measured.clear();
    this.pool = [];
  }
}
