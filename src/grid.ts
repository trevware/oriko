import { App, Platform } from "obsidian";
import { resourceUrl } from "./convert";
import {
  KEY_ZOOM_STEP,
  MAX_ZOOM,
  MIN_ZOOM,
  clampCamera,
  clampZoom,
  initialCamera,
  pinchCamera,
  pinchFactor,
  pinchMidpoint,
  pinchSpan,
  preserveAnchor,
  revealCamera,
  staleTouches,
  visibleContentBand,
  zoomAt,
} from "./core/camera";
import type { Camera, PinchStart, Point } from "./core/camera";
import { DEFAULT_STAGE, columnWidthFor } from "./core/density";
import type { DensityStage } from "./core/density";
import {
  columnsForWidth,
  computeLayout,
  pressureAt,
  shouldMountAll,
  visibleRange,
} from "./core/layout";
import type { Box, LayoutResult, Position } from "./core/layout";
import {
  MARQUEE_SLOP,
  idsInRect,
  mergeSelection,
  rangeSelection,
  rectFromCorners,
  toggleSelection,
} from "./core/selection";
import type { Rect } from "./core/selection";
import type { TileModel } from "./core/tile";

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
/** The arrival run backwards, ahead of a reflow. Matches .is-vacating in styles.css. */
const VACATE_MS = 260;
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
  /**
   * The wall has been emptied ahead of a reflow (vacate) and is waiting for
   * the relayout that brings it back. That relayout restages whatever the
   * width turns out to be: a pane that ends where it started still has to
   * bring its tiles back.
   */
  private vacated = false;
  /** When the last vacating tile finishes shrinking out; the restage waits for it. */
  private vacateUntil = 0;
  private vacateTimer = 0;
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
  private readonly nativeScroll: boolean;
  /** Sized to the scaled wall, so the browser has something to scroll over. */
  private scroller: HTMLElement | null = null;
  private onScroll: (() => void) | null = null;
  /**
   * True while a pinch has the wall off the scroller and on the camera.
   * See takeFromScroller.
   */
  private pinching = false;
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
  onPropertiesRequested: (ids: string[]) => void = () => {};
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

    /*
     * On touch the wall is scrolled by the browser rather than by us.
     *
     * WebKit's scroller already has momentum and rubber-banding, written by
     * the people who decided what those should feel like and running off the
     * main thread. Reimplementing it means guessing constants and getting a
     * worse answer, so the viewport becomes a real scroll box and a spacer
     * sized to the wall gives it something to travel over. The camera stops
     * being state we animate and becomes a reading of the scroll position.
     *
     * Desktop keeps the transform camera: it has a wheel, a held space and a
     * marquee, none of which a scroll box would improve.
     */
    this.nativeScroll = Platform.isMobile;
    if (this.nativeScroll) {
      this.viewport.addClass("is-native-scroll");
      this.scroller = this.viewport.createDiv({ cls: "pg-scroll" });
      this.canvas = this.scroller.createDiv({ cls: "pg-canvas" });
      this.onScroll = () => this.readScroll();
      this.viewport.addEventListener("scroll", this.onScroll, { passive: true });
    } else {
      this.canvas = this.viewport.createDiv({ cls: "pg-canvas" });
    }

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

  private applyCamera(smooth = false): void {
    if (this.nativeScroll && !this.pinching) {
      // Only the zoom is ours to clamp. How far the wall may travel is the
      // scroller's business, and it is already the authority on that.
      this.camera = { ...this.camera, zoom: clampZoom(this.camera.zoom) };
      this.writeScroll(smooth);
      return;
    }
    this.camera = clampCamera(this.camera, this.viewportSize(), this.contentSize());
    this.canvas.style.transform =
      `translate3d(${this.camera.x}px, ${this.camera.y}px, 0) scale(${this.camera.zoom})`;
    this.schedule();
  }

  /**
   * Sizes the spacer to the scaled wall and moves the scroller to where the
   * camera says it should be.
   *
   * The scroll position is left alone unless it has actually drifted:
   * writing back a position the scroller has just reported would interrupt
   * the fling that is delivering it, which is the one thing this whole
   * approach exists to avoid.
   */
  private writeScroll(smooth: boolean): void {
    if (!this.scroller) return;
    const content = this.contentSize();
    const zoom = this.camera.zoom;

    this.scroller.style.width = `${content.width * zoom}px`;
    this.scroller.style.height = `${content.height * zoom}px`;
    this.canvas.style.transform = `scale(${zoom})`;

    const left = this.scrollerOffset(zoom) - this.camera.x;
    const top = -this.camera.y;
    if (
      Math.abs(this.viewport.scrollLeft - left) > 0.5 ||
      Math.abs(this.viewport.scrollTop - top) > 0.5
    ) {
      this.viewport.scrollTo({ left, top, behavior: smooth ? "smooth" : "auto" });
    }
    this.schedule();
  }

  /**
   * The camera, read back off the scroller rather than written to it.
   *
   * Deliberately not applyCamera: answering a scroll by writing a scroll
   * would fight the momentum that is producing it.
   */
  private readScroll(): void {
    if (this.pinching) return;
    this.camera = {
      ...this.camera,
      x: this.scrollerOffset(this.camera.zoom) - this.viewport.scrollLeft,
      y: -this.viewport.scrollTop,
    };
    this.schedule();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.applyCamera();
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
    // A scroller animates itself, and better than writing a position into
    // it every frame would. Asking it to go somewhere smoothly is the tween.
    if (this.nativeScroll) {
      this.camera = target;
      this.applyCamera(true);
      return;
    }
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
    element.root.removeClass("is-vacating");
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

  /**
   * Empties the wall ahead of a reflow, if one is coming.
   *
   * Called on the first notice of a resize, while the pane is still moving.
   * Every mounted tile plays its arrival in reverse and holds invisible, so
   * the pane animates over a bare wall rather than over tiles frozen at
   * positions that are about to be wrong; relayout({ restage }) then pops
   * them back in at their new places once the pane settles. Only a width
   * change reflows, so only a width change empties the wall.
   */
  vacateIfReflowing(): void {
    if (this.vacated || !this.placed) return;
    const width = this.viewport.clientWidth;
    if (width === 0 || width === this.contentWidth) return;
    this.vacated = true;
    this.vacateUntil = performance.now() + VACATE_MS + ENTER_STAGGER_CAP * ENTER_STAGGER_MS;
    let order = 0;
    for (const element of this.mounted.values()) {
      const delay = Math.min(order++, ENTER_STAGGER_CAP) * ENTER_STAGGER_MS;
      element.root.style.setProperty("--pg-enter-delay", `${delay}ms`);
      element.root.removeClass("is-entering");
      element.root.addClass("is-vacating");
    }
  }

  /**
   * `restage` plays a width change the way a grid switch is played: every
   * tile pops in at its new place and nothing glides there. A reflow moves
   * every tile along its own path at once, which reads as jitter, and each
   * glide is a transform transition on a tile that may be a playing video;
   * the pop is bounded by what is on screen and lands rather than cuts.
   * Only a width change restages, since only a width change reflows: a
   * height change (the keyboard, a status bar) leaves every position as it
   * was, and popping the wall for that would be noise.
   */
  relayout(options: { restage?: boolean } = {}): void {
    // A vacated wall comes back only once it has finished going: the pane
    // often settles before the last tile has shrunk out, and restaging then
    // cut the departure to a flash. The layout itself can wait; nothing is
    // visible to be laid out.
    if (this.vacated) {
      const remaining = this.vacateUntil - performance.now();
      if (remaining > 0) {
        window.clearTimeout(this.vacateTimer);
        this.vacateTimer = window.setTimeout(() => {
          this.vacateTimer = 0;
          this.relayout(options);
        }, remaining);
        return;
      }
    }
    window.clearTimeout(this.vacateTimer);
    this.vacateTimer = 0;

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
    // A vacated wall restages on whatever relayout comes next, asked to or
    // not: a measurement landing first must not leave it empty.
    if (this.placed && (this.vacated || (options.restage && size.width !== this.contentWidth))) {
      this.entering = new Set(this.tiles.map((t) => t.id));
      this.restaging = true;
    }
    this.vacated = false;
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

      const modified = event.metaKey || event.ctrlKey || event.altKey;
      if ((event.key === "p" || event.key === "P") && this.selection.size > 0 && !modified) {
        event.preventDefault();
        this.onPropertiesRequested([...this.selection]);
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

  selectAll(): void {
    this.applySelection(new Set(this.tiles.map((t) => t.id)));
  }

  selectedIds(): string[] {
    return [...this.selection];
  }

  /**
   * The tile one step along the wall's own order, filter and sort applied,
   * or null at either end. What the detail view's arrow keys walk.
   */
  neighbor(id: string, direction: -1 | 1): TileModel | null {
    const index = this.tiles.findIndex((tile) => tile.id === id);
    if (index < 0) return null;
    return this.tiles[index + direction] ?? null;
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
    };

    const beginPinch = (a: Point, b: Point): void => {
      this.touchPan = null;
      // Taken off the scroller first: the gesture is measured against the
      // camera, so the camera has to be the one saying where the wall is
      // before the start is recorded.
      if (this.nativeScroll) this.takeFromScroller();
      this.pinch = {
        camera: this.camera,
        span: pinchSpan(a, b),
        midpoint: pinchMidpoint(a, b),
      };
    };

    this.viewport.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      this.cancelTween();
      // A primary touch means no other finger is down, whatever the map
      // says: a lift iOS never delivered (the long-press menu taking the
      // touch, typically) leaves an orphan here, and pairing the new finger
      // with it would turn this one-finger drag into a pinch.
      if (staleTouches(event.isPrimary, this.touches.size)) {
        this.touches.clear();
        this.pinch = null;
        this.touchPan = null;
      }
      this.touches.set(event.pointerId, at(event));
      this.viewport.setPointerCapture(event.pointerId);

      const live = [...this.touches.values()];
      if (live.length === 1) {
        this.panMoved = false;
        // The scroller owns one-finger travel where there is one.
        if (!this.nativeScroll) beginPan(live[0]);
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
        // Identical on both platforms while the pinch is on: the wall is a
        // camera, and applyCamera clamps it as it goes.
        this.setCamera(pinchCamera(this.pinch, live[0], live[1], MIN_ZOOM, MAX_ZOOM));
        return;
      }

      if (this.nativeScroll || live.length !== 1 || !this.touchPan) return;
      const dx = live[0].x - this.touchPan.x;
      const dy = live[0].y - this.touchPan.y;
      if (Math.abs(dx) > TOUCH_SLOP || Math.abs(dy) > TOUCH_SLOP) {
        // Past the slop this is a pan, not a press held slightly unsteadily.
        this.panMoved = true;
        this.clearLongPress();
      }
      this.camera = {
        ...this.camera,
        x: this.touchPan.camX + dx,
        y: this.touchPan.camY + dy,
      };
      this.applyCamera();
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
      // Down to one finger or none: the zoom is over, so the wall goes back
      // to the scroller and gets its momentum and its edges back.
      if (this.nativeScroll) this.giveToScroller();
      if (live.length === 1) {
        if (!this.nativeScroll) beginPan(live[0]);
        return;
      }

      this.touchPan = null;
      this.pinch = null;
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
      // On a native scroller preventDefault would cancel the very scroll
      // being handed to the browser, so the gesture is only hidden from
      // Obsidian's recogniser, never cancelled.
      if (this.nativeScroll) {
        event.stopPropagation();
        return;
      }
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

    /*
     * A tap on empty space clears the selection.
     *
     * Desktop gets this from the marquee, whose own click handling treats a
     * press that never moved as a request to select nothing. That stands
     * down for touch, so without this there is no way out of selection mode
     * except tapping every selected card off again, and while a selection is
     * up the wall's own controls have given the bottom bar to the selection
     * bar. That is a trap, not a mode.
     */
    this.viewport.addEventListener("click", (event: MouseEvent) => {
      if (!this.nativeScroll || this.selection.size === 0) return;
      // A pan or a pinch that happens to end over empty space is not a tap,
      // and the cards answer their own.
      if (this.panMoved) return;
      if ((event.target as HTMLElement | null)?.closest(".pg-tile")) return;
      this.clearSelection();
    });
  }

  /**
   * How far the scrolled content is pushed in from the viewport's left edge.
   *
   * `margin: 0 auto` centres the wall whenever the scaled content is
   * narrower than the viewport, which is every zoom below the fit. That
   * centring sits between viewport coordinates and the wall's own, so every
   * conversion between them goes through it. It is zero at fit and above,
   * which is why leaving it out looks correct until the first pinch outwards.
   *
   * clampCamera centres an axis with no travel by exactly the same rule,
   * which is what lets the camera and the scroller mean the same thing.
   */
  private scrollerOffset(zoom: number): number {
    const scaled = this.contentSize().width * zoom;
    return Math.max(0, (this.viewportSize().width - scaled) / 2);
  }

  /*
   * A pinch takes the wall off the scroller and puts it on the camera.
   *
   * Zoom and a scroll container do not get on: the travel available depends
   * on the zoom, so changing one has to resize the other, and doing that per
   * frame both costs a layout and argues with the scroller about where the
   * content should be. Showing the gesture as a transform and turning it
   * into a scroll position at the end was worse, because the two are not the
   * same thing: a transform can show a position the scroller cannot
   * represent, and the release then clamps it. That is what snapped.
   *
   * So for the length of the gesture the wall is exactly what it is on
   * desktop, and what the detail view is always: a camera written as one
   * transform, clamped as it goes. Both hand-offs are conversions between
   * two ways of saying the same position, and because the camera is held to
   * what the scroller can represent throughout, handing back is an identity
   * rather than a correction. Nothing is left to snap to.
   */
  private takeFromScroller(): void {
    if (!this.scroller || this.pinching) return;
    const zoom = this.camera.zoom;

    // Where the scroller is showing, said as a camera.
    this.camera = {
      zoom,
      x: this.scrollerOffset(zoom) - this.viewport.scrollLeft,
      y: -this.viewport.scrollTop,
    };
    this.pinching = true;
    this.viewport.addClass("is-pinching");

    // The canvas has to start at the viewport's own origin for the camera to
    // mean anything, so the spacer stops taking up room and stops being
    // centred. Scrolled to zero for the same reason, and it can be: the
    // viewport is not scrollable while this class is on it.
    this.scroller.setCssStyles({ margin: "0", width: "0px", height: "0px" });
    this.viewport.scrollTo({ left: 0, top: 0, behavior: "auto" });

    this.applyCamera();
  }

  /** Hands the wall back, at the position the camera is already showing. */
  private giveToScroller(): void {
    if (!this.scroller || !this.pinching) return;
    this.pinching = false;
    this.viewport.removeClass("is-pinching");
    this.scroller.setCssStyles({ margin: "" });
    // Sizes the spacer and scrolls to the camera's position, which the
    // scroller can reach because clampCamera never let it be anywhere else.
    this.applyCamera();
    this.onZoomChanged(this.camera.zoom);
  }

  /**
   * Starts the clock on a press, which opens the card's menu.
   *
   * Touch has no right button, so a press is the only thing a context menu
   * can hang off. Selection mode is reached from inside that menu rather
   * than from the press itself: one gesture cannot mean two things, and of
   * the two the menu is the one worth reaching in a single motion.
   */
  private armLongPress(id: string, at: Point): void {
    this.clearLongPress();
    this.longPress = window.setTimeout(() => {
      this.longPress = 0;
      // Pressing outside the selection acts on that card alone, which is
      // what the right-click on a desktop does and what a file manager does
      // everywhere.
      if (!this.selection.has(id)) this.selectOnly(id, new Set([id]));
      // The press has been answered. Suppressing the click that follows the
      // lift stops the card opening behind the menu that just appeared.
      this.panMoved = true;
      this.onContextRequested([...this.selection], at.x, at.y);
    }, LONG_PRESS_MS);
  }

  /**
   * Turns on the mode in which a tap adds and removes rather than opening.
   * Offered from the card's menu, touch having no modifier key to hold.
   */
  beginTouchSelection(id: string): void {
    this.touchSelecting = true;
    this.selectOnly(id, new Set([id]));
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
        ? next
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
    tile.root.setCssStyles({ display: "none" });
    tile.root.removeClass("is-gliding");
    tile.root.removeClass("is-entering");
    tile.root.removeClass("is-vacating");
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
   * buys a tile that is simply present.
   *
   * A rejection is not proof of a bad source: Chromium's decode cache is far
   * smaller than a wall of full-resolution pages, and decode() rejects when
   * the bitmap loses that race even though the image loaded and will paint on
   * demand. So a rejected image that has pixels is revealed anyway; one still
   * loading gets its reveal from `load`; one with no pixels really did fail,
   * and the error listener drops the tile.
   */
  private revealWhenDecoded(image: HTMLImageElement): void {
    const reveal = () => {
      if (image.isConnected) image.addClass("is-loaded");
    };
    void image
      .decode()
      .then(reveal)
      .catch(() => {
        if (image.complete && image.naturalWidth > 0) reveal();
        else image.addEventListener("load", reveal, { once: true });
      });
  }

  private swapImage(image: HTMLImageElement, next: string): void {
    if (!next || image.src === next) return;
    const preload = new Image();
    preload.src = next;
    const swap = () => {
      if (!image.isConnected) return;
      image.src = next;
      image.addClass("is-loaded");
    };
    void preload
      .decode()
      .then(swap)
      .catch(() => {
        // Same decode-cache caveat as revealWhenDecoded; a preload that truly
        // failed has no pixels, and then the tile keeps its current source.
        if (preload.complete && preload.naturalWidth > 0) swap();
      });
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
    element.root.setCssStyles({ display: "" });

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
      this.armLongPress(model.id, { x: event.clientX, y: event.clientY });
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
    if (this.onScroll) this.viewport.removeEventListener("scroll", this.onScroll);
    if (this.tiltFrame) window.cancelAnimationFrame(this.tiltFrame);
    if (this.onKeyDown) document.removeEventListener("keydown", this.onKeyDown);
    if (this.onKeyUp) document.removeEventListener("keyup", this.onKeyUp);
    if (this.onBlur) window.removeEventListener("blur", this.onBlur);
    if (this.frame) window.cancelAnimationFrame(this.frame);
    if (this.relayoutFrame) window.cancelAnimationFrame(this.relayoutFrame);
    window.clearTimeout(this.vacateTimer);
    this.mounted.clear();
    this.measured.clear();
    this.pool = [];
  }
}
