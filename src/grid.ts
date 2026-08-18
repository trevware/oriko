import { App, TFile, normalizePath } from "obsidian";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampCamera,
  initialCamera,
  preserveAnchor,
  visibleContentBand,
  zoomAt,
} from "./camera";
import type { Camera } from "./camera";
import { columnsForWidth, computeLayout, visibleRange } from "./layout";
import type { LayoutResult, Position } from "./layout";
import {
  MARQUEE_SLOP,
  idsInRect,
  mergeSelection,
  rectFromCorners,
} from "./selection";
import type { Rect } from "./selection";
import type { TileModel } from "./tile";

/** Layout gap. Cards sit inset inside their box, adding SELECT_LIFT a side. */
const GAP = 6;
/**
 * How far a selected card grows on every edge. It lives inside the tile's
 * own inset, so expansion can never overlap a neighbour, and it is applied
 * as a per-tile scale rather than an inset change so the compositor can
 * animate it without laying out.
 */
const SELECT_LIFT = 4;
/** Must match the leave animation in styles.css. */
const LEAVE_MS = 200;
/** Per-tile delay when several enter at once, capped so a big batch is not slow. */
const ENTER_STAGGER_MS = 28;
const ENTER_STAGGER_CAP = 6;
const TARGET_COLUMN_WIDTH = 300;
const OVERSCAN = 600;
const MAX_OVERSCAN = 1500;
/** Movement past which a pointer gesture is a pan, not a click. */
const CLICK_SLOP = 3;
/** Trackpad pinch arrives as ctrl+wheel; this tunes how fast it zooms. */
const PINCH_SENSITIVITY = 0.01;

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
 * A pannable, zoomable canvas of virtualized masonry tiles.
 *
 * The camera is a transform on a single layer rather than scroll position,
 * which is what allows zooming and panning into empty space. Only the tiles
 * inside the camera's content band exist in the DOM, and scrolling reuses
 * elements from a pool rather than building them.
 */
export class GridRenderer {
  private viewport: HTMLElement;
  private canvas: HTMLElement;
  private tiles: TileModel[] = [];
  private byId = new Map<string, TileModel>();
  private layout: LayoutResult = { positions: [], totalHeight: 0 };
  private mounted = new Map<string, TileElement>();
  private pool: TileElement[] = [];
  private frame = 0;
  private relayoutFrame = 0;
  private measured = new Map<string, { w: number; h: number }>();
  /** Ids present in the previous setTiles, to tell new tiles from newly visible ones. */
  private known = new Set<string>();
  private entering = new Set<string>();
  /** Elements playing their leave animation, no longer eligible for reuse. */
  private leaving = new Set<TileElement>();

  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private contentWidth = 0;
  private placed = false;

  private spaceHeld = false;
  private panning = false;
  private panMoved = false;
  private panOrigin = { x: 0, y: 0, camX: 0, camY: 0 };
  private onKeyDown: ((event: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((event: KeyboardEvent) => void) | null = null;
  private onBlur: (() => void) | null = null;

  private marquee: HTMLElement;
  private selection = new Set<string>();
  private selecting = false;
  private selectionBase = new Set<string>();
  private marqueeOrigin = { x: 0, y: 0 };
  private marqueeMoved = false;

  onRendered: () => void = () => {};
  onSourceFailed: (id: string) => void = () => {};
  onZoomChanged: (zoom: number) => void = () => {};
  onSelectionChanged: (ids: string[]) => void = () => {};
  onDeleteRequested: (ids: string[]) => void = () => {};

  constructor(private app: App, container: HTMLElement) {
    this.viewport = container.createDiv({ cls: "cg-viewport" });
    this.canvas = this.viewport.createDiv({ cls: "cg-canvas" });
    this.marquee = this.viewport.createDiv({ cls: "cg-marquee" });
    this.installGestures();
    this.installSelection();
  }

  get viewportEl(): HTMLElement {
    return this.viewport;
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  private viewportSize(): { width: number; height: number } {
    return {
      width: this.viewport.clientWidth || 800,
      height: this.viewport.clientHeight || 600,
    };
  }

  private contentSize(): { width: number; height: number } {
    return { width: this.contentWidth, height: this.layout.totalHeight };
  }

  private applyCamera(): void {
    this.camera = clampCamera(this.camera, this.viewportSize(), this.contentSize());
    this.canvas.style.transform =
      `translate3d(${this.camera.x}px, ${this.camera.y}px, 0) scale(${this.camera.zoom})`;
    this.schedule();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.applyCamera();
    this.onZoomChanged(this.camera.zoom);
  }

  zoomBy(factor: number, pointer?: { x: number; y: number }): void {
    const size = this.viewportSize();
    const anchor = pointer ?? { x: size.width / 2, y: size.height / 2 };
    const target = zoomAt(this.camera, factor, anchor, MIN_ZOOM, MAX_ZOOM);
    this.animateCamera(target, 180);
    this.onZoomChanged(target.zoom);
  }

  private tweenFrame = 0;

  private cancelTween(): void {
    if (this.tweenFrame) window.cancelAnimationFrame(this.tweenFrame);
    this.tweenFrame = 0;
  }

  /**
   * Eases the camera to a target. Used for keyboard zoom and reset, where a
   * jump is disorienting. Gestures stay immediate, since easing a trackpad
   * would feel like lag.
   */
  private animateCamera(target: Camera, ms = 240): void {
    this.cancelTween();
    const start = { ...this.camera };
    const t0 = performance.now();

    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera = {
        x: start.x + (target.x - start.x) * e,
        y: start.y + (target.y - start.y) * e,
        zoom: start.zoom + (target.zoom - start.zoom) * e,
      };
      this.applyCamera();
      if (k < 1) this.tweenFrame = window.requestAnimationFrame(step);
      else this.tweenFrame = 0;
    };

    this.tweenFrame = window.requestAnimationFrame(step);
  }

  resetView(): void {
    this.cancelTween();
    const size = this.viewportSize();
    this.placed = true;
    this.animateCamera(initialCamera(size, this.contentSize()));
  }

  setTiles(tiles: TileModel[]): void {
    this.tiles = tiles;
    this.byId = new Map(tiles.map((t) => [t.id, t]));

    // New to the data, as opposed to merely scrolled into view.
    this.entering = new Set(tiles.filter((t) => !this.known.has(t.id)).map((t) => t.id));
    this.known = new Set(tiles.map((t) => t.id));

    for (const [id, element] of [...this.mounted]) {
      if (!this.byId.has(id)) {
        this.mounted.delete(id);
        this.playLeave(element);
      }
    }
    this.relayout();
  }

  /** Fades a removed tile out in place, then returns its element to the pool. */
  private playLeave(element: TileElement): void {
    element.root.addClass("is-leaving");
    element.root.removeClass("is-selected");
    this.leaving.add(element);
    window.setTimeout(() => {
      this.leaving.delete(element);
      element.root.removeClass("is-leaving");
      this.release(element);
    }, LEAVE_MS);
  }

  /** The tile nearest the viewport centre, used to hold position across a relayout. */
  private anchor(): { id: string; y: number } | null {
    if (!this.placed || this.layout.positions.length === 0) return null;
    const band = visibleContentBand(this.camera, this.viewportSize());
    const centre = band.top + band.height / 2;

    let best: { id: string; y: number } | null = null;
    let bestDistance = Infinity;
    for (const p of this.layout.positions) {
      const distance = Math.abs(p.y + p.h / 2 - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { id: p.id, y: p.y };
      }
    }
    return best;
  }

  relayout(): void {
    // The wall is laid out at the unzoomed viewport width, so zooming out
    // reveals empty space around it rather than reflowing the columns.
    const anchor = this.anchor();
    const size = this.viewportSize();
    this.contentWidth = size.width;
    const columns = columnsForWidth(size.width, TARGET_COLUMN_WIDTH, GAP);

    this.layout = computeLayout(
      this.tiles.map((t) => {
        const learned = t.provisional ? this.measured.get(t.id) : undefined;
        return { id: t.id, width: learned?.w ?? t.width, height: learned?.h ?? t.height };
      }),
      size.width,
      columns,
      GAP
    );

    if (!this.placed && this.tiles.length > 0) {
      this.placed = true;
      this.camera = initialCamera(size, this.contentSize());
    } else if (anchor) {
      // Adding a clipping inserts at the top and pushes everything down;
      // shift the camera by the same amount so the view does not jump.
      const moved = this.layout.positions.find((p) => p.id === anchor.id);
      if (moved) this.camera = preserveAnchor(this.camera, anchor.y, moved.y);
    }

    this.applyCamera();
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

  private installGestures(): void {
    this.viewport.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        event.preventDefault();
        this.cancelTween();
        const rect = this.viewport.getBoundingClientRect();
        const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };

        // Trackpad pinch and cmd/ctrl+wheel both arrive with ctrlKey set.
        if (event.ctrlKey || event.metaKey) {
          this.setCamera(
            zoomAt(this.camera, Math.exp(-event.deltaY * PINCH_SENSITIVITY), pointer)
          );
          return;
        }

        this.camera = {
          ...this.camera,
          x: this.camera.x - event.deltaX,
          y: this.camera.y - event.deltaY,
        };
        this.applyCamera();
      },
      { passive: false }
    );

    this.onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;

      if (event.code === "Space" && !event.repeat) {
        this.spaceHeld = true;
        this.viewport.addClass("is-pannable");
        event.preventDefault();
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        this.selection.size > 0
      ) {
        event.preventDefault();
        this.onDeleteRequested([...this.selection]);
        return;
      }

      if (event.key === "Escape" && this.selection.size > 0) {
        event.preventDefault();
        this.clearSelection();
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;

      if (event.key === "a") {
        event.preventDefault();
        this.applySelection(new Set(this.tiles.map((t) => t.id)));
        return;
      }
      if (event.key === "0") {
        this.resetView();
        event.preventDefault();
      } else if (event.key === "=" || event.key === "+") {
        this.zoomBy(1.2);
        event.preventDefault();
      } else if (event.key === "-") {
        this.zoomBy(1 / 1.2);
        event.preventDefault();
      }
    };

    this.onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") this.endPan();
    };

    // Losing focus mid-drag would otherwise leave the grab cursor stuck on.
    this.onBlur = () => this.endPan();

    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    this.viewport.addEventListener("pointerdown", (event: PointerEvent) => {
      if (!this.spaceHeld && event.button !== 1) return;
      event.preventDefault();
      this.cancelTween();
      this.panning = true;
      this.panMoved = false;
      this.panOrigin = {
        x: event.clientX,
        y: event.clientY,
        camX: this.camera.x,
        camY: this.camera.y,
      };
      this.viewport.addClass("is-panning");
      this.viewport.setPointerCapture(event.pointerId);
    });

    this.viewport.addEventListener("pointermove", (event: PointerEvent) => {
      if (!this.panning) return;
      const dx = event.clientX - this.panOrigin.x;
      const dy = event.clientY - this.panOrigin.y;
      if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) this.panMoved = true;
      this.camera = {
        ...this.camera,
        x: this.panOrigin.camX + dx,
        y: this.panOrigin.camY + dy,
      };
      this.applyCamera();
    });

    const stop = (event: PointerEvent): void => {
      if (!this.panning) return;
      this.panning = false;
      this.viewport.removeClass("is-panning");
      if (this.viewport.hasPointerCapture(event.pointerId)) {
        this.viewport.releasePointerCapture(event.pointerId);
      }
      // Cleared after the click that follows pointerup has been handled.
      window.setTimeout(() => {
        this.panMoved = false;
      }, 0);
    };

    this.viewport.addEventListener("pointerup", stop);
    this.viewport.addEventListener("pointercancel", stop);
  }

  /** Screen point to content point under the current camera. */
  private toContentPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.camera.x) / this.camera.zoom,
      y: (clientY - rect.top - this.camera.y) / this.camera.zoom,
    };
  }

  private installSelection(): void {
    this.viewport.addEventListener("pointerdown", (event: PointerEvent) => {
      // Panning owns space-drag and middle-click; a tile owns its own click.
      if (this.spaceHeld || event.button !== 0) return;
      if ((event.target as HTMLElement | null)?.closest(".cg-tile")) return;

      this.selecting = true;
      this.marqueeMoved = false;
      this.selectionBase = new Set(this.selection);
      const point = this.toContentPoint(event.clientX, event.clientY);
      this.marqueeOrigin = point;
      this.viewport.setPointerCapture(event.pointerId);
    });

    this.viewport.addEventListener("pointermove", (event: PointerEvent) => {
      if (!this.selecting) return;
      const point = this.toContentPoint(event.clientX, event.clientY);
      const rect = rectFromCorners(
        this.marqueeOrigin.x,
        this.marqueeOrigin.y,
        point.x,
        point.y
      );

      const travelled = Math.max(rect.w, rect.h) * this.camera.zoom;
      if (!this.marqueeMoved && travelled < MARQUEE_SLOP) return;
      this.marqueeMoved = true;

      this.drawMarquee(rect);
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      this.applySelection(
        mergeSelection(this.selectionBase, idsInRect(this.layout.positions, rect), additive)
      );
    });

    const finish = (event: PointerEvent): void => {
      if (!this.selecting) return;
      this.selecting = false;
      this.marquee.removeClass("is-active");
      if (this.viewport.hasPointerCapture(event.pointerId)) {
        this.viewport.releasePointerCapture(event.pointerId);
      }
      // A click on empty space with no drag clears the selection.
      if (!this.marqueeMoved) this.applySelection(new Set());
      this.marqueeMoved = false;
    };

    this.viewport.addEventListener("pointerup", finish);
    this.viewport.addEventListener("pointercancel", finish);
  }

  private drawMarquee(rect: Rect): void {
    this.marquee.addClass("is-active");
    // Drawn in screen space so its border stays 1px at any zoom.
    this.marquee.style.transform = `translate3d(${
      rect.x * this.camera.zoom + this.camera.x
    }px, ${rect.y * this.camera.zoom + this.camera.y}px, 0)`;
    this.marquee.style.width = `${rect.w * this.camera.zoom}px`;
    this.marquee.style.height = `${rect.h * this.camera.zoom}px`;
  }

  private applySelection(next: Set<string>): void {
    const changed =
      next.size !== this.selection.size || [...next].some((id) => !this.selection.has(id));
    this.selection = next;
    this.paintSelection();
    if (changed) this.onSelectionChanged([...next]);
  }

  private paintSelection(): void {
    for (const [id, element] of this.mounted) {
      element.root.toggleClass("is-selected", this.selection.has(id));
    }
  }

  selectedIds(): string[] {
    return [...this.selection];
  }

  clearSelection(): void {
    this.applySelection(new Set());
  }

  private endPan(): void {
    this.spaceHeld = false;
    this.panning = false;
    this.viewport.removeClass("is-pannable");
    this.viewport.removeClass("is-panning");
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
    const root = this.canvas.createDiv({ cls: "cg-tile" });
    return { root, media: null, id: "", signature: "", kind: "" };
  }

  private release(tile: TileElement): void {
    if (this.leaving.has(tile)) return;
    tile.root.style.display = "none";
    tile.root.removeClass("is-gliding");
    tile.root.removeClass("is-entering");
    tile.root.empty();
    tile.id = "";
    tile.signature = "";
    tile.kind = "";
    tile.media = null;
    this.pool.push(tile);
  }

  private sourceFor(path: string, remote: boolean): string {
    if (!path) return "";
    if (remote) return path;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : "";
  }

  private swapImage(image: HTMLImageElement, next: string): void {
    if (!next || image.src === next) return;
    const preload = new Image();
    preload.src = next;
    void preload
      .decode()
      .then(() => {
        if (!image.isConnected) return;
        image.src = next;
        image.addClass("is-loaded");
      })
      .catch(() => undefined);
  }

  private openNote(model: TileModel, event: MouseEvent): void {
    const file = this.app.vault.getAbstractFileByPath(model.record.path);
    if (!(file instanceof TFile)) return;
    const newPane = event.metaKey || event.ctrlKey;
    void this.app.workspace.getLeaf(newPane ? "tab" : false).openFile(file);
  }

  private paint(element: TileElement, model: TileModel, position: Position, order: number): void {
    element.root.style.display = "";

    // A tile that keeps representing the same clipping glides to its new
    // position; a pooled element reused for a different clipping snaps,
    // otherwise it would visibly fly across the canvas.
    element.root.toggleClass("is-gliding", element.id === model.id);
    element.root.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    element.root.style.width = `${position.w}px`;
    element.root.style.height = `${position.h}px`;

    // Scale that grows the card by exactly SELECT_LIFT on each edge, whatever
    // its size. A uniform factor would lift a tall tile far more than a short
    // one; the anisotropy here is under 2% and invisible.
    const sx = position.w > SELECT_LIFT * 2 ? position.w / (position.w - SELECT_LIFT * 2) : 1;
    const sy = position.h > SELECT_LIFT * 2 ? position.h / (position.h - SELECT_LIFT * 2) : 1;
    element.root.style.setProperty("--cg-sx", sx.toFixed(4));
    element.root.style.setProperty("--cg-sy", sy.toFixed(4));

    if (element.signature === model.signature) return;

    // Posters are always local files; the painted asset may be either.
    const still = this.sourceFor(model.posterPath, false);
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
      this.swapImage(image, original);
      if (model.animated && still && original) {
        image.dataset.stillSrc = still;
        image.dataset.animatedSrc = original;
      } else {
        delete image.dataset.stillSrc;
        delete image.dataset.animatedSrc;
      }
      element.signature = model.signature;
      return;
    }

    const isNew = this.entering.has(model.id);
    if (isNew) {
      this.entering.delete(model.id);
      const delay = Math.min(order, ENTER_STAGGER_CAP) * ENTER_STAGGER_MS;
      element.root.style.setProperty("--cg-enter-delay", `${delay}ms`);
      element.root.addClass("is-entering");
      window.setTimeout(
        () => element.root.removeClass("is-entering"),
        delay + 420
      );
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
      video.addEventListener("error", () => this.onSourceFailed(model.id), { once: true });
      // A poster paints immediately; without one, wait for the first frame.
      if (still && !model.remote) video.addClass("is-loaded");
      else video.addEventListener("loadeddata", () => video.addClass("is-loaded"), { once: true });
      element.media = video;
    } else {
      const image = frame.createEl("img", { cls: "cg-media" });
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = model.record.title;
      // Always the full-resolution asset, so the tile stays sharp at any zoom.
      image.src = original;

      if (model.animated && still) {
        image.dataset.stillSrc = still;
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

      image.addEventListener("load", () => image.addClass("is-loaded"), { once: true });
      // A cached image can already be complete before the listener attaches.
      if (image.complete && image.naturalWidth > 0) image.addClass("is-loaded");

      element.media = image;
    }

    const meta = frame.createDiv({ cls: "cg-meta" });
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
    const band = visibleContentBand(this.camera, this.viewportSize());
    // Overscan is a screen-space budget, so it grows in content units as you
    // zoom out. Capped, or a far-out view would mount hundreds of tiles.
    const overscan = Math.min(OVERSCAN / this.camera.zoom, MAX_OVERSCAN);
    const visible = visibleRange(this.layout.positions, band.top, band.height, overscan);
    const wanted = new Set(visible.map((p) => p.id));

    for (const [id, element] of [...this.mounted]) {
      if (!wanted.has(id)) {
        this.mounted.delete(id);
        this.release(element);
      }
    }

    let order = 0;
    for (const position of visible) {
      const model = this.byId.get(position.id);
      if (!model) continue;
      let element = this.mounted.get(position.id);
      if (!element) {
        element = this.acquire();
        this.mounted.set(position.id, element);
      }
      this.paint(element, model, position, order++);
    }

    this.paintSelection();
    this.onRendered();
  }

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
    this.cancelTween();
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
