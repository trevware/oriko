import { App } from "obsidian";
import { resourceUrl } from "./convert";
import {
  KEY_ZOOM_STEP,
  MAX_ZOOM,
  MIN_ZOOM,
  FLING_MIN_SPEED,
  cameraOvershoot,
  clampCamera,
  decayFactor,
  elasticCamera,
  flingVelocity,
  initialCamera,
  pinchCamera,
  pinchFactor,
  pinchMidpoint,
  pinchSpan,
  preserveAnchor,
  revealCamera,
  visibleContentBand,
  zoomAt,
} from "./camera";
import type { Camera, PinchStart, Point, Sample } from "./camera";
import { DEFAULT_STAGE, columnWidthFor } from "./density";
import type { DensityStage } from "./density";
import {
  columnsForWidth,
  computeLayout,
  pressureAt,
  shouldMountAll,
  visibleRange,
} from "./layout";
import type { Box, LayoutResult, Position } from "./layout";
import {
  MARQUEE_SLOP,
  idsInRect,
  mergeSelection,
  rangeSelection,
  rectFromCorners,
  toggleSelection,
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
/* Must outlast the pg-vanish keyframes, or the element returns to the pool
   mid-animation and the departure is cut off. */
const LEAVE_MS = 260;
/* Matches the pg-pop keyframes. */
const ENTER_MS = 460;
/** Per-tile delay when several enter at once, capped so a big batch is not slow. */
const ENTER_STAGGER_MS = 28;
const ENTER_STAGGER_CAP = 6;
const OVERSCAN = 600;
const MAX_OVERSCAN = 1500;
/**
 * At or below this many tiles the whole wall is mounted and never recycled.
 * See shouldMountAll in layout.ts for why, and why the figure is deliberately
 * cautious rather than as high as the DOM could bear.
 */
const MOUNT_ALL_BUDGET = 150;
/** Movement past which a pointer gesture is a pan, not a click. */
const CLICK_SLOP = 3;
/**
 * How long a finger must rest on a card before it starts a selection.
 * Long enough not to fire on a slow flick, short enough that the gesture
 * feels answered rather than ignored.
 */
const LONG_PRESS_MS = 450;
/**
 * A finger wanders further than a mouse does, so a press survives more
 * travel than a click before it is reclassified as a pan.
 */
const TOUCH_SLOP = 10;
/** How long the wall takes to return after being pulled past an edge. */
const SETTLE_MS = 400;
/**
 * A frame longer than this was the app being away, not the wall moving
 * slowly. Coasting across the whole gap would teleport it.
 */
const MAX_FRAME_MS = 64;
/** Enough of the drag's tail to read a flick from; older samples are noise. */
const SAMPLE_LIMIT = 8;
/** Degrees a card tips at its edges. Small: it should read as give, not spin. */
const MAX_TILT_DEG = 5.5;

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
  /**
   * Set for the one render following a replace. Holds off the glide, so the
   * wall restages instead of every survivor sliding to a new spot.
   */
  private restaging = false;
  /** Elements playing their leave animation, no longer eligible for reuse. */
  private leaving = new Set<TileElement>();

  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private contentWidth = 0;
  private placed = false;

  private spaceHeld = false;
  private panning = false;
  private panMoved = false;
  /**
   * Live touches by pointer id. A finger is the only pointer the wall
   * tracks by identity: mouse gestures are told apart by button and
   * modifier, but two touches are distinguishable only by their ids.
   */
  private touches = new Map<number, Point>();
  private touchPan: { x: number; y: number; camX: number; camY: number } | null = null;
  private pinch: PinchStart | null = null;
  /** The tail of the current drag, for reading the speed it ends at. */
  private samples: Sample[] = [];
  private velocity = { vx: 0, vy: 0 };
  private momentumFrame = 0;
  private longPress = 0;
  /**
   * Touch has no modifier keys, so multi-select is a mode rather than a
   * chord: a long press turns it on and taps then add and remove, the way
   * Photos and Files do it. Cleared when the selection empties.
   */
  private touchSelecting = false;
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
  /** Where a shift-click measures its range from. */
  private selectionAnchor: string | null = null;
  /** Tile the layer panel is pointing at, if any. */
  private highlighted: string | null = null;

  private positionById = new Map<string, Position>();
  private tiltedId: string | null = null;
  private pointer: { x: number; y: number } | null = null;
  private tiltFrame = 0;
  private hoveredMedia: HTMLVideoElement | HTMLImageElement | null = null;
  /** The card under the pointer changed. Set by the view, to drive playback
      for a wall whose autoplay is off. */
  onHoverMedia: ((media: HTMLVideoElement | HTMLImageElement | null) => void) | null = null;

  /** The card currently open in the detail view, hidden while it is. */
  private focusedId: string | null = null;

  onRendered: () => void = () => {};
  onSourceFailed: (id: string, signature: string) => void = () => {};
  onZoomChanged: (zoom: number) => void = () => {};
  onSelectionChanged: (ids: string[]) => void = () => {};
  onDeleteRequested: (ids: string[]) => void = () => {};
  onContextRequested: (ids: string[], x: number, y: number) => void = () => {};
  onExportRequested: (ids: string[]) => void = () => {};
  onOpenDetail: (
    model: TileModel,
    origin: { rect: { x: number; y: number; w: number; h: number }; at: { x: number; y: number } }
  ) => void = () => {};

  /**
   * Column width the layout aims for. Set through setDensity; the stage it
   * came from is also stamped on the viewport so the stylesheet can trim the
   * card chrome that stops fitting as the columns narrow.
   */
  private targetColumnWidth = columnWidthFor(DEFAULT_STAGE);

  constructor(private app: App, container: HTMLElement) {
    this.viewport = container.createDiv({ cls: "pg-viewport" });
    this.viewport.dataset.density = DEFAULT_STAGE;
    this.canvas = this.viewport.createDiv({ cls: "pg-canvas" });
    this.marquee = this.viewport.createDiv({ cls: "pg-marquee" });
    this.installGestures();
    this.installSelection();
    this.installTilt();
    this.installTouch();
  }

  get viewportEl(): HTMLElement {
    return this.viewport;
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  /**
   * Reflows the wall into the columns a stage asks for. The camera is left
   * to relayout, which keeps whatever tile was at the centre at the centre,
   * so stepping through the stages reads as the wall tightening around the
   * place you were looking rather than jumping back to the top.
   */
  setDensity(stage: DensityStage): void {
    const width = columnWidthFor(stage);
    this.viewport.dataset.density = stage;
    if (width === this.targetColumnWidth) return;
    this.targetColumnWidth = width;
    if (this.tiles.length > 0) this.relayout();
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
    this.paintCamera();
  }

  /**
   * Writes the camera out as it stands, bounds unenforced.
   *
   * Everything that is not a touch gesture wants applyCamera, which holds
   * the wall against its edges. A finger is the exception: it may pull the
   * wall past them, and settle brings it back when the finger goes.
   */
  private paintCamera(): void {
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

  /**
   * `animate: false` places the camera outright. There is no spatial
   * continuity between two different sets of contents, so tweening from a
   * position in the old wall to one in the new is motion that means nothing,
   * and it costs a render per frame while the new images are still decoding.
   */
  resetView(animate = true): void {
    this.cancelTween();
    const size = this.viewportSize();
    this.placed = true;
    const target = initialCamera(size, this.contentSize());
    if (!animate) {
      this.camera = target;
      this.applyCamera();
      this.schedule();
      return;
    }
    this.animateCamera(target);
  }

  /**
   * `replace` means the wall is showing a different set of things, not that
   * things were added to the set it was already showing.
   *
   * It restages the whole wall: everything on it pops in at its new position
   * and nothing glides there. Gliding is right when a clipping is added to
   * the set you are already looking at, since the tiles around it are the
   * same tiles and should be followed to where they went. It is wrong when
   * the set itself changes. A filter reflows the masonry, so a dozen
   * survivors set off along a dozen different paths at once, and that reads
   * as jitter rather than as movement.
   *
   * The departure is suppressed with it. The arrival pop stays: it is what
   * makes a switch land rather than cut, and it is cheap, being bounded by
   * what is actually on screen.
   *
   * The departure is not cheap, and the cost is not the animation. playLeave
   * holds every departing element for LEAVE_MS before returning it to the
   * pool, so on a switch the pool is empty at exactly the moment the arriving
   * tiles come looking for elements, and the wall builds a screen of fresh
   * DOM instead of recycling the subtrees being vacated in front of it.
   * Releasing at once means the arrivals reuse them.
   */
  setTiles(tiles: TileModel[], options: { replace?: boolean } = {}): void {
    this.tiles = tiles;
    this.byId = new Map(tiles.map((t) => [t.id, t]));

    // New to the data, as opposed to merely scrolled into view. On a replace
    // everything counts as arriving, including whatever survived the change.
    this.entering = options.replace
      ? new Set(tiles.map((t) => t.id))
      : new Set(tiles.filter((t) => !this.known.has(t.id)).map((t) => t.id));
    this.restaging = options.replace === true;
    this.known = new Set(tiles.map((t) => t.id));

    for (const [id, element] of [...this.mounted]) {
      if (!this.byId.has(id)) {
        this.mounted.delete(id);
        if (options.replace) this.release(element);
        else this.playLeave(element);
      }
    }
    this.relayout();
  }

  /** Pops a newly arrived tile in, staggered so a batch lands as a wave. */
  private playEnter(element: TileElement, id: string, order: number): void {
    this.entering.delete(id);
    const delay = Math.min(order, ENTER_STAGGER_CAP) * ENTER_STAGGER_MS;
    element.root.style.setProperty("--pg-enter-delay", `${delay}ms`);
    element.root.addClass("is-entering");
    window.setTimeout(() => element.root.removeClass("is-entering"), delay + ENTER_MS + 60);
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
    // A pane behind another tab measures 0 by 0. Laying it out then would
    // fall back to viewportSize's nominal size and arrange the wall for a
    // pane that does not exist, moving the camera to suit; switching back
    // laid it out again for the real width, and the tiles gliding from the
    // phantom positions to the real ones read as the wall rearranging
    // itself. Nothing is visible while hidden, so nothing is done: the
    // resize that brings the pane back is what lays it out.
    if (this.viewport.clientWidth === 0 || this.viewport.clientHeight === 0) return;

    // The wall is laid out at the unzoomed viewport width, so zooming out
    // reveals empty space around it rather than reflowing the columns.
    const anchor = this.anchor();
    const size = this.viewportSize();
    this.contentWidth = size.width;
    const columns = columnsForWidth(size.width, this.targetColumnWidth, GAP);

    this.positionById.clear();
    this.layout = computeLayout(
      this.tiles.map((t) => {
        const learned = t.provisional ? this.measured.get(t.id) : undefined;
        return { id: t.id, width: learned?.w ?? t.width, height: learned?.h ?? t.height };
      }),
      size.width,
      columns,
      GAP
    );

    for (const position of this.layout.positions) {
      this.positionById.set(position.id, position);
    }

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
          this.setCamera(zoomAt(this.camera, pinchFactor(event.deltaY), pointer));
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
        this.selectAll();
        return;
      }

      if (event.key === "e" && this.selection.size > 0) {
        event.preventDefault();
        this.onExportRequested([...this.selection]);
        return;
      }
      if (event.key === "0") {
        this.resetView();
        event.preventDefault();
      } else if (event.key === "=" || event.key === "+") {
        this.zoomBy(KEY_ZOOM_STEP);
        event.preventDefault();
      } else if (event.key === "-") {
        this.zoomBy(1 / KEY_ZOOM_STEP);
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
      // A touch reports button 0 like a left click, so without this a finger
      // drag rubber-band selects instead of moving the wall, and the capture
      // below swallows the rest of the gesture. installTouch owns touch.
      if (event.pointerType === "touch") return;
      if ((event.target as HTMLElement | null)?.closest(".pg-tile")) return;

      this.selecting = true;
      this.marqueeMoved = false;
      this.viewport.addClass("is-selecting");
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
      const hits = idsInRect(this.layout.positions, rect);
      if (hits.length > 0) this.selectionAnchor = hits[hits.length - 1];
      this.applySelection(mergeSelection(this.selectionBase, hits, additive));
    });

    const finish = (event: PointerEvent): void => {
      if (!this.selecting) return;
      this.selecting = false;
      this.viewport.removeClass("is-selecting");
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
    // Nothing selected is the way out of touch selection mode, so a tap on
    // the last selected card leaves taps opening cards again.
    if (next.size === 0) this.touchSelecting = false;
    this.paintSelection();
    if (changed) this.onSelectionChanged([...next]);
  }

  private paintSelection(): void {
    for (const [id, element] of this.mounted) {
      element.root.toggleClass("is-selected", this.selection.has(id));
    }
  }

  /**
   * Centres a tile and selects it, which is how the palette lands on a
   * clipping that could be anywhere on a wall thousands of pixels tall.
   * Selecting it as well is what makes the arrival useful: whatever you
   * searched for is then the thing ⌘E, a move or a delete acts on.
   *
   * Returns false when this wall has no tile for that clipping, so the
   * caller can fall back to opening the note rather than flying nowhere.
   */
  /**
   * Brings a tile into view. From the palette it is fitted and selected: you
   * asked for it by name. A clipping that has just been pasted is only
   * brought on screen, at the zoom you had and with the selection as it
   * was; a paste is not a request to look at one thing.
   */
  reveal(id: string, options: { fit?: boolean; select?: boolean } = {}): boolean {
    const position = this.positionById.get(id);
    if (!position) return false;
    const fit = options.fit ?? true;

    this.cancelTween();
    this.animateCamera(
      revealCamera(this.camera, this.viewportSize(), position, this.contentSize(), fit)
    );
    if (options.select ?? true) {
      this.selectionAnchor = id;
      this.applySelection(new Set([id]));
    }
    return true;
  }

  /**
   * A click in the layer panel, given the wall's own selection semantics so
   * the two surfaces cannot disagree about what a shift-click means.
   *
   * A plain pick also flies there, which is the whole point of the panel:
   * the list is how you find something, the wall is where you look at it.
   */
  pick(id: string, mode: "replace" | "toggle" | "range"): void {
    if (mode === "toggle") {
      this.selectOnly(id, toggleSelection(this.selection, id));
      return;
    }
    if (mode === "range") {
      this.applySelection(
        rangeSelection(
          this.tiles.map((t) => t.id),
          this.selectionAnchor,
          id,
          this.selection
        )
      );
      return;
    }
    this.selectOnly(id, new Set([id]));
    this.reveal(id);
  }

  /**
   * Rings the tile under the cursor in the panel. Kept as state rather than
   * a one-off class because tiles are recycled: without it, scrolling the
   * wall would move the ring onto whichever clipping inherited the element.
   */
  highlightTile(id: string | null): void {
    if (this.highlighted === id) return;
    this.highlighted = id;
    for (const [tileId, element] of this.mounted) {
      element.root.toggleClass("is-peeked", tileId === id);
    }
  }

  selectAll(): void {
    this.applySelection(new Set(this.tiles.map((t) => t.id)));
  }

  selectedIds(): string[] {
    return [...this.selection];
  }

  clearSelection(): void {
    this.selectionAnchor = null;
    this.applySelection(new Set());
  }

  /**
   * The wall's touch gestures.
   *
   * The camera moves on a wheel, a held space or the middle button, and a
   * finger produces none of the three, so before this there was no way to
   * move the wall on a phone at all. `touch-action: none` on the viewport
   * means the browser will not scroll for us either, which is right for a
   * canvas that owns its gestures and fatal for one that does not.
   *
   * Touches are tracked by pointer id because that is the only thing that
   * tells two fingers apart. One finger pans, two pinch, and the count
   * changing mid-gesture restarts whichever is now in effect from where
   * the surviving fingers actually are: rebasing rather than continuing is
   * what stops the wall jumping when a finger lifts out of a pinch.
   */
  private installTouch(): void {
    const at = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

    const beginPan = (from: Point): void => {
      this.pinch = null;
      this.touchPan = { x: from.x, y: from.y, camX: this.camera.x, camY: this.camera.y };
      // The trail belongs to this finger's travel, not the last one's, or
      // lifting out of a pinch flings the wall on stale samples.
      this.samples = [];
      this.sample(from);
    };

    const beginPinch = (a: Point, b: Point): void => {
      this.touchPan = null;
      this.pinch = {
        camera: this.camera,
        span: pinchSpan(a, b),
        midpoint: pinchMidpoint(a, b),
      };
    };

    this.viewport.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      this.cancelTween();
      // Catching a coasting wall stops it dead, the way a finger on a
      // spinning record does.
      this.stopMomentum();
      this.touches.set(event.pointerId, at(event));
      this.viewport.setPointerCapture(event.pointerId);

      const live = [...this.touches.values()];
      if (live.length === 1) {
        this.panMoved = false;
        this.samples = [];
        this.sample(live[0]);
        beginPan(live[0]);
        return;
      }
      // A second finger means the gesture is a zoom, never a tap, so the
      // click that eventually follows must not open anything.
      this.clearLongPress();
      this.panMoved = true;
      beginPinch(live[0], live[1]);
    });

    this.viewport.addEventListener("pointermove", (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (!this.touches.has(event.pointerId)) return;
      this.touches.set(event.pointerId, at(event));

      const live = [...this.touches.values()];
      if (live.length >= 2 && this.pinch) {
        this.setCamera(pinchCamera(this.pinch, live[0], live[1], MIN_ZOOM, MAX_ZOOM));
        return;
      }

      if (live.length !== 1 || !this.touchPan) return;
      const dx = live[0].x - this.touchPan.x;
      const dy = live[0].y - this.touchPan.y;
      if (Math.abs(dx) > TOUCH_SLOP || Math.abs(dy) > TOUCH_SLOP) {
        // Past the slop this is a pan, not a press held slightly unsteadily.
        this.panMoved = true;
        this.clearLongPress();
      }

      this.sample(live[0]);
      // Softened from where the finger has asked for, never from where the
      // wall already is: applying the curve to its own output every frame
      // would compound it into treacle.
      this.camera = elasticCamera(
        { ...this.camera, x: this.touchPan.camX + dx, y: this.touchPan.camY + dy },
        this.viewportSize(),
        this.contentSize()
      );
      this.paintCamera();
    });

    const lift = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") return;
      if (!this.touches.delete(event.pointerId)) return;
      if (this.viewport.hasPointerCapture(event.pointerId)) {
        this.viewport.releasePointerCapture(event.pointerId);
      }
      this.clearLongPress();

      const live = [...this.touches.values()];
      if (live.length >= 2) return beginPinch(live[0], live[1]);
      if (live.length === 1) return beginPan(live[0]);

      this.touchPan = null;
      this.pinch = null;
      const { vx, vy } = flingVelocity(this.samples);
      this.samples = [];
      this.fling(vx, vy);
      // Cleared after the click that follows the last lift, exactly as the
      // mouse pan does: a drag ending over a card must not also open it.
      window.setTimeout(() => {
        this.panMoved = false;
      }, 0);
    };

    this.viewport.addEventListener("pointerup", lift);
    this.viewport.addEventListener("pointercancel", lift);

    /*
     * Obsidian mobile watches for a downward drag in a view and opens the
     * command palette on it. A one-finger pan is that drag, so scrolling the
     * wall down was opening the palette on top of it.
     *
     * `touch-action: none` only tells the *browser* not to scroll; it says
     * nothing to a recogniser written in JavaScript. Claiming the gesture
     * means handling the touch event: propagation stops here so no ancestor
     * listener sees it, on touchstart as well, since a recogniser that never
     * arms cannot fire wherever it happens to listen for the movement.
     *
     * preventDefault is confined to touchmove on purpose. On touchstart it
     * also suppresses the synthetic click, and a tap still needs that click
     * to open a card.
     */
    const claim = (event: TouchEvent): void => {
      // Unconditional because the viewport holds only the canvas and the
      // marquee: every overlay that scrolls itself, the sheet and palette
      // and action bar, mounts on the view instead. Nothing inside here
      // wants a touch the wall should not have. Checking the tracked
      // touches instead would tie this to whether pointerdown or touchstart
      // fires first, which the two engines do not agree on.
      event.stopPropagation();
      if (event.type === "touchmove") event.preventDefault();
    };

    this.viewport.addEventListener("touchstart", claim, { passive: false });
    this.viewport.addEventListener("touchmove", claim, { passive: false });
  }

  /** Adds a point to the drag's trail, keeping only its tail. */
  private sample(point: Point): void {
    this.samples.push({ x: point.x, y: point.y, t: performance.now() });
    if (this.samples.length > SAMPLE_LIMIT) this.samples.shift();
  }

  /**
   * Hands the wall to its own momentum when the last finger leaves.
   *
   * A release past an edge has nowhere to coast to, only somewhere to
   * return to, and a release that was not moving has nothing to coast
   * with. Either way the answer is to settle.
   */
  private fling(vx: number, vy: number): void {
    this.stopMomentum();

    const viewport = this.viewportSize();
    const content = this.contentSize();
    const past = cameraOvershoot(this.camera, viewport, content);
    if (past.x !== 0 || past.y !== 0 || Math.hypot(vx, vy) < FLING_MIN_SPEED) {
      this.settle();
      return;
    }

    this.velocity = { vx, vy };
    let last = performance.now();

    const step = (now: number): void => {
      // A frame longer than MAX_FRAME_MS was the app being away rather than
      // the wall running slowly, and coasting across it would teleport.
      const dt = Math.min(MAX_FRAME_MS, now - last);
      last = now;

      const factor = decayFactor(dt);
      this.velocity = { vx: this.velocity.vx * factor, vy: this.velocity.vy * factor };

      const next = {
        ...this.camera,
        x: this.camera.x + this.velocity.vx * dt,
        y: this.camera.y + this.velocity.vy * dt,
      };
      const over = cameraOvershoot(next, viewport, content);
      // An axis that has run out of wall stops there rather than coasting
      // on into the rubber band, which would make the bounce grow with the
      // speed it arrived at.
      if (over.x !== 0) this.velocity.vx = 0;
      if (over.y !== 0) this.velocity.vy = 0;

      this.camera = elasticCamera(next, viewport, content);
      this.paintCamera();

      const spent = Math.hypot(this.velocity.vx, this.velocity.vy) < FLING_MIN_SPEED;
      if (over.x !== 0 || over.y !== 0 || spent) {
        this.momentumFrame = 0;
        this.settle();
        return;
      }
      this.momentumFrame = window.requestAnimationFrame(step);
    };

    this.momentumFrame = window.requestAnimationFrame(step);
  }

  /**
   * Eases the wall back inside its bounds after a pull or a bounce.
   *
   * Deliberately not animateCamera, which applies the camera every frame
   * and so clamps it. Every frame of a return is out of bounds by
   * definition, so that would snap the wall back on the first one and the
   * ease would never be seen. Runs on tweenFrame all the same, so the next
   * touch cancels it like any other camera animation.
   */
  private settle(): void {
    const target = clampCamera(this.camera, this.viewportSize(), this.contentSize());
    if (target.x === this.camera.x && target.y === this.camera.y) return;

    this.cancelTween();
    const start = { ...this.camera };
    const t0 = performance.now();

    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / SETTLE_MS);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera = {
        ...this.camera,
        x: start.x + (target.x - start.x) * e,
        y: start.y + (target.y - start.y) * e,
      };
      this.paintCamera();
      this.tweenFrame = k < 1 ? window.requestAnimationFrame(step) : 0;
    };

    this.tweenFrame = window.requestAnimationFrame(step);
  }

  private stopMomentum(): void {
    if (this.momentumFrame) window.cancelAnimationFrame(this.momentumFrame);
    this.momentumFrame = 0;
    this.velocity = { vx: 0, vy: 0 };
  }

  /**
   * Starts the clock on a press. Touch has no modifier keys, so a long
   * press is the only way in to multi-select; it turns the mode on and
   * taps then add and remove until the selection empties.
   */
  private armLongPress(id: string): void {
    this.clearLongPress();
    this.longPress = window.setTimeout(() => {
      this.longPress = 0;
      this.touchSelecting = true;
      this.selectOnly(id, new Set([id]));
      // The press is answered now. Suppressing the click that follows the
      // lift stops the card it just selected from opening on top of it.
      this.panMoved = true;
    }, LONG_PRESS_MS);
  }

  private clearLongPress(): void {
    if (this.longPress) window.clearTimeout(this.longPress);
    this.longPress = 0;
  }

  /**
   * Tips the card under the cursor away from it, as though the edge being
   * pointed at were pressed in. Worked out in content space from the camera,
   * so no element is measured and nothing is read from layout per frame.
   */
  private installTilt(): void {
    this.viewport.addEventListener(
      "pointermove",
      (event: PointerEvent) => {
        // A finger is not a hover. Following it tips whichever card is
        // under the drag, which reads as the wall coming apart in your hand.
        if (event.pointerType === "touch") return;
        this.pointer = { x: event.clientX, y: event.clientY };
        this.scheduleTilt();
      },
      { passive: true }
    );

    this.viewport.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.clearTilt();
    });
  }

  private scheduleTilt(): void {
    if (this.tiltFrame) return;
    this.tiltFrame = window.requestAnimationFrame(() => {
      this.tiltFrame = 0;
      this.applyTilt();
    });
  }

  private clearTilt(): void {
    this.setHoveredMedia(null);
    if (!this.tiltedId) return;
    const element = this.mounted.get(this.tiltedId);
    element?.root.style.removeProperty("--pg-rx");
    element?.root.style.removeProperty("--pg-ry");
    this.tiltedId = null;
  }

  /**
   * The playable inside the card the pointer is over, or null.
   *
   * Reported from the tilt, which already tracks which card that is and
   * already stands down for Reduce Motion, a pan, a selection and a held
   * space. Every one of those is a moment the wall should not also start
   * playing something, so following it is the answer rather than a
   * coincidence.
   */
  private setHoveredMedia(next: HTMLElement | null): void {
    const playable =
      next instanceof HTMLVideoElement ||
      (next instanceof HTMLImageElement && next.dataset.animatedSrc)
        ? (next as HTMLVideoElement | HTMLImageElement)
        : null;
    if (this.hoveredMedia === playable) return;
    this.hoveredMedia = playable;
    this.onHoverMedia?.(playable);
  }

  private applyTilt(): void {
    // A drag is already saying something with the cursor; tilting during one
    // would fight it.
    if (!this.pointer || this.panning || this.selecting || this.spaceHeld) {
      this.clearTilt();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.clearTilt();
      return;
    }

    const point = this.toContentPoint(this.pointer.x, this.pointer.y);

    for (const [id, element] of this.mounted) {
      const box = this.positionById.get(id);
      if (!box) continue;
      const pressure = pressureAt(point, box);
      if (!pressure) continue;

      if (this.tiltedId !== id) this.clearTilt();
      this.tiltedId = id;
      this.setHoveredMedia(element.media);
      // Pressing the right edge tips the right side away, so rotateY follows
      // dx and rotateX opposes dy.
      element.root.style.setProperty("--pg-ry", `${(pressure.dx * MAX_TILT_DEG).toFixed(2)}deg`);
      element.root.style.setProperty("--pg-rx", `${(-pressure.dy * MAX_TILT_DEG).toFixed(2)}deg`);
      return;
    }

    this.clearTilt();
  }

  /**
   * Hides the card that is open in the detail view.
   *
   * Hiding it is what makes the return read as one motion: leave it in
   * place and the flight lands on top of a duplicate of itself.
   */
  focusTile(id: string | null): void {
    this.focusedId = id;
    this.render();
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
    const root = this.canvas.createDiv({ cls: "pg-tile" });
    return { root, media: null, id: "", signature: "", kind: "" };
  }

  private release(tile: TileElement): void {
    if (this.leaving.has(tile)) return;
    if (this.tiltedId === tile.id) this.tiltedId = null;
    tile.root.style.removeProperty("--pg-rx");
    tile.root.style.removeProperty("--pg-ry");
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
    return resourceUrl(this.app.vault, path, remote);
  }

  /**
   * Reveals an image once there is a frame to paint, not merely bytes.
   *
   * `load` fires before the image is decoded, so revealing there starts the
   * fade on an empty box and lets the decode land partway through it. decode()
   * settles when the bitmap exists, which costs a few milliseconds more and
   * buys a tile that is simply present. It rejects on a source that fails,
   * which the error listener already handles, so there is nothing to do here.
   */
  private revealWhenDecoded(image: HTMLImageElement): void {
    void image
      .decode()
      .then(() => {
        if (image.isConnected) image.addClass("is-loaded");
      })
      .catch(() => undefined);
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

  /**
   * The card's rect on screen in client coordinates, or null if it is not in
   * the layout. Worked out from the position and the camera rather than read
   * off the element, so it answers for a card that is not mounted too.
   */
  tileRect(id: string): Box | null {
    const position = this.positionById.get(id);
    if (!position) return null;
    const bounds = this.viewport.getBoundingClientRect();
    return {
      x: bounds.left + position.x * this.camera.zoom + this.camera.x,
      y: bounds.top + position.y * this.camera.zoom + this.camera.y,
      w: position.w * this.camera.zoom,
      h: position.h * this.camera.zoom,
    };
  }

  /** Reports the card's rect on screen so the detail view can fly from it. */
  private openDetail(model: TileModel, event: MouseEvent): void {
    const rect = this.tileRect(model.id);
    if (!rect) return;

    const at = {
      x: rect.w > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.x) / rect.w)) : 0.5,
      y: rect.h > 0 ? Math.max(0, Math.min(1, (event.clientY - rect.y) / rect.h)) : 0.5,
    };

    this.onOpenDetail(model, { rect, at });
  }

  private selectOnly(id: string, next: Set<string>): void {
    this.selectionAnchor = id;
    this.applySelection(next);
  }

  private paint(element: TileElement, model: TileModel, position: Position, order: number): void {
    element.root.style.display = "";
    element.root.toggleClass("is-peeked", model.id === this.highlighted);

    // A tile that keeps representing the same clipping glides to its new
    // position; a pooled element reused for a different clipping snaps,
    // otherwise it would visibly fly across the canvas.
    element.root.toggleClass("is-gliding", !this.restaging && element.id === model.id);
    element.root.toggleClass("is-focus-hidden", this.focusedId === model.id);
    element.root.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    element.root.style.width = `${position.w}px`;
    element.root.style.height = `${position.h}px`;

    // Scale that grows the card by exactly SELECT_LIFT on each edge, whatever
    // its size. A uniform factor would lift a tall tile far more than a short
    // one; the anisotropy here is under 2% and invisible.
    const sx = position.w > SELECT_LIFT * 2 ? position.w / (position.w - SELECT_LIFT * 2) : 1;
    const sy = position.h > SELECT_LIFT * 2 ? position.h / (position.h - SELECT_LIFT * 2) : 1;
    element.root.style.setProperty("--pg-sx", sx.toFixed(4));
    element.root.style.setProperty("--pg-sy", sy.toFixed(4));

    // Ahead of the early returns below. A pooled element can come back
    // already carrying the incoming tile's signature, and a genuinely new
    // clipping that landed on one would then skip its entrance entirely.
    if (this.entering.has(model.id)) this.playEnter(element, model.id, order);

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

    element.id = model.id;
    element.signature = model.signature;
    element.kind = model.kind;
    element.root.empty();
    element.media = null;

    const frame = element.root.createDiv({ cls: "pg-frame" });

    if (model.kind === "video") {
      const video = frame.createEl("video", { cls: "pg-media" });
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
      video.addEventListener(
        "error",
        () => this.onSourceFailed(model.id, model.signature),
        { once: true }
      );
      // A poster paints immediately; without one, wait for the first frame.
      if (still && !model.remote) video.addClass("is-loaded");
      else video.addEventListener("loadeddata", () => video.addClass("is-loaded"), { once: true });
      element.media = video;
    } else {
      const image = frame.createEl("img", { cls: "pg-media" });
      // Deliberately not loading="lazy". The grid decides for itself what is
      // worth mounting, and the browser's own heuristic measures intersection
      // against a canvas sitting under a transform, so it holds the fetch back
      // until the tile has already arrived on screen. Which is the hitch.
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
          if (image.isConnected) this.onSourceFailed(model.id, model.signature);
        },
        { once: true }
      );

      this.revealWhenDecoded(image);

      element.media = image;
    }

    const meta = frame.createDiv({ cls: "pg-meta" });
    meta.createDiv({ cls: "pg-title", text: model.record.title });
    const sub = meta.createDiv({ cls: "pg-sub" });
    const domain = domainOf(model.record.source);
    if (domain) sub.createSpan({ text: domain });
    if (model.record.categories.length) {
      if (domain) sub.createSpan({ cls: "pg-dot", text: "·" });
      sub.createSpan({ text: model.record.categories.join(", ") });
    }

    // Armed on the card because the id is in scope here; every way out of
    // a press (a second finger, movement past the slop, the lift) is on the
    // viewport, which sees the whole gesture.
    element.root.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      this.armLongPress(model.id);
    });

    element.root.oncontextmenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // Right-clicking outside the selection acts on that card alone, which
      // is what every file manager does.
      if (!this.selection.has(model.id)) {
        this.selectOnly(model.id, new Set([model.id]));
      }
      this.onContextRequested([...this.selection], event.clientX, event.clientY);
    };

    element.root.onclick = (event: MouseEvent) => {
      // A pan that ends over a tile must not also open it.
      if (this.panMoved) return;

      // Once a long press has opened selection mode, a tap adds and removes
      // rather than opening. It is cmd-click, without a cmd key to hold.
      if (this.touchSelecting) {
        this.selectOnly(model.id, toggleSelection(this.selection, model.id));
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        this.selectOnly(model.id, toggleSelection(this.selection, model.id));
        return;
      }

      if (event.shiftKey) {
        this.applySelection(
          rangeSelection(
            this.tiles.map((t) => t.id),
            this.selectionAnchor,
            model.id,
            this.selection
          )
        );
        return;
      }

      this.openDetail(model, event);
    };
  }

  /**
   * The tiles worth having in the DOM.
   *
   * A small wall keeps all of them, so nothing is ever torn down and no tile
   * has to be rebuilt and re-decoded when it comes back into view. A large one
   * falls back to the window around the camera. Removal still works either
   * way: the layout only holds positions for tiles that currently exist, so a
   * deleted clipping drops out of this list and is released by the caller.
   */
  private visiblePositions(): Position[] {
    if (shouldMountAll(this.layout.positions.length, MOUNT_ALL_BUDGET)) {
      return this.layout.positions;
    }

    const band = visibleContentBand(this.camera, this.viewportSize());
    // Overscan is a screen-space budget, so it grows in content units as you
    // zoom out. Capped, or a far-out view would mount hundreds of tiles.
    const overscan = Math.min(OVERSCAN / this.camera.zoom, MAX_OVERSCAN);
    return visibleRange(this.layout.positions, band.top, band.height, overscan);
  }

  render(): void {
    const visible = this.visiblePositions();
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

    // Spent. Tiles mounted by a later scroll are following the wall, not
    // restaging with it, so they glide as usual.
    this.restaging = false;

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
    this.stopMomentum();
    if (this.tiltFrame) window.cancelAnimationFrame(this.tiltFrame);
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
