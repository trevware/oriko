import { App, Platform, setIcon } from "obsidian";
import {
  KEY_ZOOM_STEP,
  pinchCamera,
  pinchFactor,
  pinchMidpoint,
  pinchSpan,
  staleTouches,
  zoomAt,
} from "./core/camera";
import type { PinchStart, Point } from "./core/camera";
import { resourceUrl } from "./convert";
import type { Camera, Size } from "./core/camera";
import { facetLabel } from "./core/filter";
import { flightMidpoint, flipTransform } from "./core/layout";
import { visibilityAction } from "./core/playback";
import type { Box, FlightShape } from "./core/layout";
import type { TileModel } from "./core/tile";
import { paintSwatchStrip, readSwatches } from "./core/swatch-strip";
import { attachTip } from "./core/tip";
import { systemAvailable } from "./core/system";
import { clampPan, detailLayout, fitZoomRange } from "./core/viewer";
import type { DetailLayout } from "./core/viewer";

export interface DetailActions {
  onExport: (id: string) => void;
  onReveal: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenNote: (id: string) => void;
  /**
   * Opens the property rows, anchored at the button that asked. The view owns
   * the menu and the single writer behind it, so this passes the request on
   * rather than editing anything here: the licence to write a note the plugin
   * did not create stays in one place, with one gate.
   */
  onEditProperties: (id: string, x: number, y: number) => void;
  /** Whether a menu is up, so the overlay can leave the keyboard to it. */
  isMenuOpen: () => boolean;
}

export interface DetailOrigin {
  /** The card's rect on screen, relative to the container. */
  rect: Box;
  /** Where in the card the click landed, 0..1 on each axis. */
  at: { x: number; y: number };
}

const FLIGHT_MS = 650;
/**
 * When the details begin arriving, measured into the card's flight, and how
 * long they take.
 *
 * Held back into the last third of it. Starting sooner had the details racing
 * the picture across the screen so both landed at once, and neither was then
 * the thing being watched. The card settles, and the details follow it in.
 */
const META_DELAY_MS = Math.round(FLIGHT_MS * 0.7);
const META_MS = 340;
const RETURN_MS = 420;
const FIT: Camera = { x: 0, y: 0, zoom: 1 };
/**
 * Frontmatter keys the panel already reports in its own words, so enabling one
 * as a filter property does not print it twice. Filename and Resolution are
 * read off the media rather than the note, so no key can collide with them.
 */
const INTRINSIC = new Set(["title", "source", "created"]);
/* One curve for the whole opening flight: a soft push off the card, then a
   long decelerating glide into place. Deliberately the only easing in play,
   see fly(). */
const EASE = "cubic-bezier(0.4, 0, 0.12, 1)";
/* Calmer than the default arc. Over a flight this long a pronounced bow and
   squash stop reading as weight and start reading as a wobble. */
const OPEN_SHAPE: FlightShape = { arc: 0.09, arcCap: 74, stretch: 0.035 };

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Full-bleed view of a single clipping, flying out of the card that was
 * clicked and back into it on close.
 *
 * The flight is a FLIP: the stage is laid out at its final rect, then given
 * the transform that puts it back over the card, and only that transform is
 * animated. The click position becomes the transform origin, so a corner
 * click swings out while a centre click grows straight forward.
 */
/**
 * True pixel size of the media, so the stage can be built at the right
 * shape from the first frame. Resolves immediately for anything the grid
 * already decoded, which is the common case, and gives up quickly rather
 * than holding the open hostage to a slow network.
 */
function naturalSize(
  url: string,
  kind: "image" | "video",
  fallback: { width: number; height: number },
  timeoutMs = 220
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (size: { width: number; height: number }): void => {
      if (settled) return;
      settled = true;
      resolve(size.width > 0 && size.height > 0 ? size : fallback);
    };

    const timer = window.setTimeout(() => finish(fallback), timeoutMs);
    const done = (size: { width: number; height: number }): void => {
      window.clearTimeout(timer);
      finish(size);
    };

    if (kind === "video") {
      const video = createEl("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => done({ width: video.videoWidth, height: video.videoHeight });
      video.onerror = () => done(fallback);
      video.src = url;
      return;
    }

    const image = new Image();
    if (image.complete && image.naturalWidth > 0) {
      done({ width: image.naturalWidth, height: image.naturalHeight });
      return;
    }
    image.onload = () => done({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => done(fallback);
    image.src = url;
    // A decoded image reports its size synchronously once src is assigned.
    if (image.complete && image.naturalWidth > 0) {
      done({ width: image.naturalWidth, height: image.naturalHeight });
    }
  });
}

export class DetailView {
  private root: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  /** Held so the return can cancel it; a fill-forwards animation would
      otherwise pin the backdrop opaque and the card would fly home against
      it rather than against the wall. */
  private veil: Animation | null = null;
  /**
   * The details panel's entrance.
   *
   * Driven here rather than by a CSS transition for the reason the veil is,
   * and it is the same reason: the panel is built and the root is given
   * is-open inside one task, so a transition between the two states depends on
   * a style flush happening to land in between, and none does. The panel was
   * simply appearing.
   */
  private reveal: Animation | null = null;
  /** Carries the zoom transform. Kept off the stage, whose own transform is
      owned by the flight animation and would override anything set inline. */
  private layer: HTMLElement | null = null;
  private origin: DetailOrigin | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;
  /**
   * Watches the window while a video is on the stage, so it stops with it.
   *
   * The wall's PlaybackController is switched off while the detail view is
   * up, and this video was never registered with it in the first place, so
   * without this a minimised app would go on decoding it, sound and all.
   */
  private onVisibility: (() => void) | null = null;
  /** True only when the pause was ours to undo, not the viewer's. */
  private suspended = false;
  private closing = false;

  /** The media's true size, kept so the pane can be refitted on resize. */
  private natural: Size = { width: 0, height: 0 };
  private meta: HTMLElement | null = null;
  /** Where the card is now, asked on relayout so the return flight heads
      for the card as the wall has since laid it out, not where it was. */
  private originNow: (() => Box | null) | null = null;
  /** A resize that arrived mid-flight, to be applied when the flight lands:
      the stage's rect is animating and refitting it then would be nonsense. */
  private relayoutPending = false;

  private view: Camera = { ...FIT };
  private range = { min: 1, max: 1 };
  private frame: { width: number; height: number } = { width: 0, height: 0 };
  /**
   * The stage's top left in client coordinates, worked out once from the
   * layout rather than measured per event. Measuring meant a
   * getBoundingClientRect on every wheel tick, immediately after the previous
   * tick had written a transform, which forces a synchronous style flush each
   * time. That read-after-write is what made zooming hitch.
   */
  private stageClient = { x: 0, y: 0 };
  private applyFrame = 0;
  /** Input is ignored until the opening flight lands, since the stage's rect
      is mid-animation and pointer maths against it would be nonsense. */
  private flying = false;
  private dragging = false;
  private zoomedNow = false;
  private dragFrom = { x: 0, y: 0, viewX: 0, viewY: 0 };
  /** Live touches on the stage, by pointer id. Two of them are a pinch. */
  private touches = new Map<number, Point>();
  private pinchStart: PinchStart | null = null;
  private hotkeys: Array<{ match: (event: KeyboardEvent) => boolean; run: () => void }> = [];

  constructor(
    private app: App,
    private container: HTMLElement,
    private actions: DetailActions,
    /** The filter properties, read fresh so the panel follows a settings
        change without the view being rebuilt. */
    private properties: () => string[]
  ) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  private resource(path: string): string {
    return resourceUrl(this.app.vault, path) || path;
  }

  /** Fires once the stage exists, so the source card can be hidden then. */
  onStageReady: (() => void) | null = null;
  /** Asked to move one step along the wall when an arrow key is pressed. */
  onNavigate: ((current: TileModel, direction: -1 | 1) => void) | null = null;
  /** The clipping on the stage right now, which navigation steps from. */
  private current: TileModel | null = null;
  /** Fires once the closing flight has finished and the overlay is gone. */
  onClosed: (() => void) | null = null;

  async open(
    model: TileModel,
    origin: DetailOrigin,
    originNow: (() => Box | null) | null = null
  ): Promise<void> {
    this.close(true);
    this.closing = false;
    this.current = model;
    this.originNow = originNow;

    const url = model.remote ? model.filePath : this.resource(model.filePath);
    const size = await naturalSize(url, model.kind, {
      width: model.width,
      height: model.height,
    });

    this.root = this.container.createDiv({ cls: "pg-detail" });
    const backdrop = this.root.createDiv({ cls: "pg-detail-backdrop" });
    backdrop.onclick = () => this.close();
    this.backdrop = backdrop;

    // One of the wall's own chrome buttons, not a member of the detail view's
    // action bar. The create, filter and panel controls are each a single
    // button that is itself the floating surface, and back reads as one of
    // that set, so it shares their rules rather than imitating them.
    const back = this.root.createEl("button", { cls: "pg-detail-back" });
    setIcon(back, "arrow-left");
    attachTip(back, "Back", "\u238b");
    back.onclick = () => this.close();

    this.stage = this.root.createDiv({ cls: "pg-detail-stage" });
    this.layer = this.stage.createDiv({ cls: "pg-detail-zoom" });
    this.view = { ...FIT };
    this.dragging = false;

    const bounds = this.container.getBoundingClientRect();

    // The caller reports the card in client coordinates; everything below
    // works in container coordinates, where the stage is positioned.
    this.origin = {
      at: origin.at,
      rect: {
        x: origin.rect.x - bounds.left,
        y: origin.rect.y - bounds.top,
        w: origin.rect.w,
        h: origin.rect.h,
      },
    };

    this.natural = size;
    const layout = detailLayout(size, { width: bounds.width, height: bounds.height });
    const target = layout.stage;
    this.place(layout, bounds);

    const image = this.paintMedia(model);
    const panel = this.paintMeta(model, layout);
    this.meta = panel;
    this.paintActions(model);
    if (image) void this.paintSwatches(panel, image);

    this.onStageReady?.();
    this.zoomedNow = false;
    this.applyView();
    this.installGestures();
    this.fly(target, this.origin);

    this.onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // A focused swatch handles its own Enter and Space. Without it here,
      // the view's own Enter binding would close the overlay and open the note
      // rather than copying the colour the swatch is showing.
      if (target?.closest("input, textarea, [contenteditable='true'], .pg-swatch")) {
        return;
      }

      // A menu opened from the bar owns the keyboard while it is up. Both
      // handlers are capture-phase on document and this one was registered
      // first, so without standing aside Escape would throw away the whole
      // overlay instead of the panel in front of it.
      if (this.actions.isMenuOpen()) return;

      // Registered in the capture phase, so stopping here also spares the
      // grid's own document-level handlers, which would otherwise act on a
      // selection sitting invisible behind this overlay.
      const take = (run: () => void): void => {
        event.preventDefault();
        event.stopPropagation();
        run();
      };

      if (event.key === "Escape") return take(() => this.close());

      // Left and right walk the wall without leaving the overlay, in the
      // order the wall is showing, filters and sort included.
      const current = this.current;
      if (current && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const direction = event.key === "ArrowRight" ? 1 : -1;
        return take(() => this.onNavigate?.(current, direction));
      }

      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === "0") return take(() => this.setView({ ...FIT }));
      if (mod && (event.key === "=" || event.key === "+")) {
        return take(() => this.zoomStep(KEY_ZOOM_STEP));
      }
      if (mod && event.key === "-") return take(() => this.zoomStep(1 / KEY_ZOOM_STEP));

      for (const hotkey of this.hotkeys) {
        if (hotkey.match(event)) return take(hotkey.run);
      }
    };
    document.addEventListener("keydown", this.onKey, true);
  }

  /** Returns the image on the stage, or null when the stage holds a video.
      The palette needs the decoded element, and this is the only place that
      knows which of the two was built. */
  private paintMedia(model: TileModel): HTMLImageElement | null {
    const host = this.layer;
    if (!host) return null;

    if (model.kind === "video") {
      const video = host.createEl("video", { cls: "pg-detail-media" });
      video.src = model.remote ? model.filePath : this.resource(model.filePath);
      // Desktop only fades Chromium's control bar in on hover, but iOS
      // parks its overlay on top of the video from the first frame. So on
      // mobile the video opens bare — it is already playing on a loop — and
      // the first tap summons the native controls for scrubbing and sound.
      video.controls = !Platform.isMobile;
      if (Platform.isMobile) {
        video.addEventListener("click", () => (video.controls = true), { once: true });
      }
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      if (model.posterPath) video.poster = this.resource(model.posterPath);
      this.watchVisibility(video);
      return null;
    }

    const image = host.createEl("img", { cls: "pg-detail-media" });
    image.src = model.remote ? model.filePath : this.resource(model.filePath);
    image.decoding = "async";
    return image;
  }

  /** Parity with the wall: nothing plays behind a window you cannot see. */
  private watchVisibility(video: HTMLVideoElement): void {
    this.onVisibility = () => {
      const action = visibilityAction({
        hidden: document.hidden,
        playing: !video.paused,
        suspended: this.suspended,
      });
      if (action === "pause") {
        video.pause();
        this.suspended = true;
      } else if (action === "resume") {
        this.suspended = false;
        void video.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private stopWatchingVisibility(): void {
    if (this.onVisibility) {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.onVisibility = null;
    this.suspended = false;
  }

  /**
   * Slides an element up out of nothing, after a wait.
   *
   * fill "both" so the delay holds the element hidden rather than showing it
   * and then snatching it away on the first frame, and so it stays put once it
   * has arrived. Reduced motion gets no animation at all, which leaves the
   * element on its own styles; those must therefore be the arrived state, not
   * the hidden one.
   */
  private static slideIn(el: HTMLElement, delay: number, duration: number): Animation | null {
    if (DetailView.prefersReducedMotion()) return null;
    return el.animate(
      [
        { opacity: 0, transform: "translateX(10px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration, delay, easing: "cubic-bezier(0.19, 1, 0.26, 1)", fill: "both" }
    );
  }

  /**
   * Swaps the overlay to another clipping in place. No flight is replayed
   * and nothing behind changes: the media, details and actions are rebuilt
   * for the new model, the zoom returns to fit, and the close flight is
   * re-aimed at the card this now shows. What the arrow keys use.
   */
  async show(model: TileModel, originNow: (() => Box | null) | null = null): Promise<void> {
    if (!this.root || !this.stage || !this.layer || this.closing) return;
    this.current = model;
    this.originNow = originNow;

    // The outgoing video goes quiet before the new media arrives.
    this.stopWatchingVisibility();
    this.suspended = false;

    const url = model.remote ? model.filePath : this.resource(model.filePath);
    const size = await naturalSize(url, model.kind, {
      width: model.width,
      height: model.height,
    });
    if (!this.root || !this.stage || !this.layer || this.closing) return;

    this.natural = size;
    this.view = { ...FIT };
    this.dragging = false;
    this.zoomedNow = false;
    this.touches.clear();
    this.pinchStart = null;
    this.cancelApply();

    const bounds = this.container.getBoundingClientRect();
    const layout = detailLayout(size, { width: bounds.width, height: bounds.height });

    this.layer.empty();
    this.meta?.remove();
    this.root.querySelector(".pg-detail-actions")?.remove();
    this.hotkeys = [];

    this.place(layout, bounds);
    this.applyView();
    const image = this.paintMedia(model);
    const panel = this.paintMeta(model, layout, false);
    this.meta = panel;
    this.paintActions(model);
    if (image) void this.paintSwatches(panel, image);

    // The return flight heads for the card this shows now, not the one the
    // overlay was opened from.
    const rect = originNow?.();
    if (rect) {
      this.origin = {
        at: { x: 0.5, y: 0.5 },
        rect: { x: rect.x - bounds.left, y: rect.y - bounds.top, w: rect.w, h: rect.h },
      };
    }
  }

  private static prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * Puts the stage and the details where a layout says, and works out
   * everything that hangs off the stage's rect: the frame zoom pans within,
   * its client offset, and how far the media can be zoomed inside it.
   */
  private place(layout: DetailLayout, bounds: DOMRect): void {
    if (!this.root || !this.stage) return;
    const target = layout.stage;
    this.stage.style.left = `${target.x}px`;
    this.stage.style.top = `${target.y}px`;
    this.stage.style.width = `${target.w}px`;
    this.stage.style.height = `${target.h}px`;

    this.frame = { width: target.w, height: target.h };
    this.stageClient = { x: bounds.left + target.x, y: bounds.top + target.y };
    this.range = fitZoomRange(this.natural, { width: target.w, height: target.h });
    this.root.toggleClass("is-zoomable", this.range.max > this.range.min);
    // Stacked is a narrow pane: the stylesheet gives the details room to
    // clear the action bar they would otherwise run under.
    this.root.toggleClass("is-stacked", layout.mode === "stacked");

    if (this.meta) {
      this.meta.style.width = `${layout.meta.width}px`;
      this.meta.style.left = `${layout.meta.x}px`;
      this.meta.style.top = `${layout.meta.y}px`;
    }
  }

  /**
   * Refits the picture and its details to the pane as it is now. The view
   * calls this from its resize observer, so dragging the tab into a wider
   * pane, or the sidebar narrower, rearranges the overlay in place instead
   * of leaving it in the shape of the pane it opened in.
   */
  relayout(): void {
    if (!this.root || !this.stage || this.closing) return;
    if (this.flying) {
      this.relayoutPending = true;
      return;
    }
    const bounds = this.container.getBoundingClientRect();
    // A pane that has been hidden has no size to fit; it will be asked
    // again when it comes back.
    if (!(bounds.width > 0 && bounds.height > 0)) return;

    this.place(detailLayout(this.natural, bounds), bounds);

    // Back to fit: the zoom range was worked out against the old frame, and
    // a pan offset in the old frame's pixels means nothing in the new one.
    this.dragging = false;
    this.view = { ...FIT };
    this.cancelApply();
    this.applyView();

    const rect = this.originNow?.();
    if (rect && this.origin) {
      this.origin = {
        at: this.origin.at,
        rect: { x: rect.x - bounds.left, y: rect.y - bounds.top, w: rect.w, h: rect.h },
      };
    }
  }

  private paintMeta(
    model: TileModel,
    layout: DetailLayout,
    animate = true
  ): HTMLElement | null {
    if (!this.root) return null;
    const panel = this.root.createDiv({ cls: "pg-detail-meta" });
    // The entrance belongs to the opening flight. An arrow-key swap rebuilds
    // this panel in place, where replaying the slide reads as a stutter.
    this.reveal = animate ? DetailView.slideIn(panel, META_DELAY_MS, META_MS) : null;

    // Where the panel goes is decided with the stage in detailLayout: beside
    // the picture in a wide pane, sat against its edge rather than in a
    // fixed column; under it in a narrow one. Either way it runs to the
    // bottom of the overlay and scrolls, since the details can outrun the
    // picture.
    panel.style.width = `${layout.meta.width}px`;
    panel.style.left = `${layout.meta.x}px`;
    panel.style.top = `${layout.meta.y}px`;

    const field = (label: string, value: string): void => {
      if (!value) return;
      const block = panel.createDiv({ cls: "pg-detail-field" });
      block.createDiv({ cls: "pg-detail-label", text: label });
      block.createDiv({ cls: "pg-detail-value", text: value });
    };

    field("Title", model.record.title);
    if (model.width > 4 && model.height > 3) {
      field("Resolution", `${model.width} × ${model.height}`);
    }
    field("Filename", model.filePath.slice(model.filePath.lastIndexOf("/") + 1));
    field("Source", domainOf(model.record.source));
    field("Date", model.record.created ? `Clipped ${model.record.created}` : "");

    // The same list the filter menu offers, so what you can narrow by and what
    // the panel tells you about a clipping cannot drift apart. Categories and
    // Status were hardcoded here and are simply the two that ship enabled.
    // A property the clipping does not carry prints nothing rather than an
    // empty row: this panel is a description of one picture, not a form.
    for (const key of this.properties()) {
      if (INTRINSIC.has(key)) continue;
      field(facetLabel(key), (model.record.properties[key] ?? []).join(", "));
    }

    return panel;
  }

  /**
   * Adds the palette once the picture has decoded.
   *
   * Not awaited before the flight: the colours are worth a moment's wait, the
   * opening animation is not. A large picture can still be decoding when the
   * view is closed and another opened, so the panel is only written to while
   * it is still in the document.
   */
  private async paintSwatches(
    panel: HTMLElement | null,
    image: HTMLImageElement
  ): Promise<void> {
    if (!panel) return;
    const swatches = await readSwatches(image);
    if (!panel.isConnected || swatches.length === 0) return;

    // Held until the panel has actually arrived. Reading the colours takes a
    // few tens of milliseconds off an image the stage has already decoded,
    // so without this the palette spent its whole entrance behind a panel
    // still waiting out its own delay, and by the time anything was visible
    // every swatch had finished. The row appearing after the panel is also
    // the order that reads correctly: the details land, then their colours.
    await this.reveal?.finished.catch(() => undefined);
    if (!panel.isConnected) return;

    paintSwatchStrip(panel, swatches);
  }

  private paintActions(model: TileModel): void {
    if (!this.root) return;
    const bar = this.root.createDiv({ cls: "pg-detail-actions" });

    // Every tip advertises a key, so every key is bound below. A label
    // promising a shortcut that does nothing is worse than no label.
    const add = (
      icon: string,
      label: string,
      shortcut: string,
      match: (event: KeyboardEvent) => boolean,
      run: () => void
    ): HTMLElement => {
      const button = bar.createEl("button", { cls: "pg-detail-button" });
      setIcon(button, icon);
      attachTip(button, label, shortcut);
      button.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        run();
      };
      this.hotkeys.push({ match, run });
      return button;
    };

    /* Groups the bar by what a button acts on, matching the rules in the
       wall's context menu so the two surfaces read the same way round. */
    const rule = (): void => {
      bar.createDiv({ cls: "pg-bar-divider" });
    };

    const mod = (event: KeyboardEvent): boolean => event.metaKey || event.ctrlKey;

    add(
      "file-text",
      "Open note",
      "\u23ce",
      (event) => event.key === "Enter" && !mod(event),
      () => {
        this.actions.onOpenNote(model.id);
        this.close();
      }
    );
    // Both reach for the filesystem, which mobile does not have. Gated the way
    // the wall's context menu already gates them: without this the bar shows
    // two controls that cannot work, and Export answers a tap by claiming
    // nothing has been archived, when the truth is there is nowhere to put it.
    if (systemAvailable()) {
      add(
        "download",
        "Export to Downloads",
        "\u2318E",
        (event) => mod(event) && !event.shiftKey && event.key.toLowerCase() === "e",
        () => this.actions.onExport(model.id)
      );
      add(
        "folder",
        "Reveal in Finder",
        "\u2318\u21e7R",
        (event) => mod(event) && event.shiftKey && event.key.toLowerCase() === "r",
        () => this.actions.onReveal(model.id)
      );
    }

    rule();

    // Anchored at the button's top edge rather than the pointer, so the panel
    // has a fixed home whether it was opened by click or by key. placeMenu
    // flips it up over the bar, since there is never room below.
    let properties: HTMLElement | null = null;
    const openProperties = (): void => {
      const rect = properties?.getBoundingClientRect();
      if (!rect) return;
      this.actions.onEditProperties(model.id, rect.left + rect.width / 2, rect.top);
    };
    // Shown whether or not anything is editable. Which keys those are is the
    // gate's business, and it refuses in one place with a reason; re-deciding
    // it here would be the same rule written twice, free to drift.
    properties = add(
      "sliders-horizontal",
      "Properties",
      "P",
      (event) => !mod(event) && !event.shiftKey && event.key.toLowerCase() === "p",
      openProperties
    );

    rule();

    add(
      "trash-2",
      "Delete",
      "\u232b",
      (event) => (event.key === "Backspace" || event.key === "Delete") && !mod(event),
      () => {
        this.close();
        this.actions.onDelete(model.id);
      }
    );
  }

  private canZoom(): boolean {
    return this.range.max > this.range.min;
  }

  /** Client coordinates to stage-local, which is also the zoom layer's own
      untransformed space since the layer is inset 0 with a 0 0 origin. */
  private stagePoint(clientX: number, clientY: number): { x: number; y: number } {
    return { x: clientX - this.stageClient.x, y: clientY - this.stageClient.y };
  }

  /**
   * Records where the view should be. The write is deferred to the next
   * frame: a trackpad delivers wheel and pointer events faster than the
   * display refreshes, and every extra transform written between two frames
   * is work whose result is thrown away before anything sees it.
   */
  private setView(next: Camera): void {
    const zoom = Math.min(this.range.max, Math.max(this.range.min, next.zoom));
    this.view = clampPan({ ...next, zoom }, this.frame);

    if (this.applyFrame) return;
    this.applyFrame = window.requestAnimationFrame(() => {
      this.applyFrame = 0;
      this.applyView();
    });
  }

  private applyView(): void {
    if (!this.layer) return;
    const { x, y, zoom } = this.view;
    // translate3d rather than translate: it keeps the layer on the compositor
    // for certain, instead of relying on will-change alone.
    this.layer.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;

    // Guarded, so a gesture is not invalidating styles on the whole overlay
    // on every frame to set a class that has not changed.
    const zoomed = zoom > this.range.min + 0.001;
    if (zoomed !== this.zoomedNow) {
      this.zoomedNow = zoomed;
      this.root?.toggleClass("is-zoomed", zoomed);
    }
  }

  private cancelApply(): void {
    if (this.applyFrame) window.cancelAnimationFrame(this.applyFrame);
    this.applyFrame = 0;
  }

  private zoomStep(factor: number): void {
    if (!this.canZoom()) return;
    const centre = { x: this.frame.width / 2, y: this.frame.height / 2 };
    this.setView(zoomAt(this.view, factor, centre, this.range.min, this.range.max));
  }

  private installGestures(): void {
    const root = this.root;
    const stage = this.stage;
    if (!root || !stage) return;

    root.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        if (this.flying || !this.canZoom()) return;

        // Trackpad pinch and cmd/ctrl+wheel both arrive with ctrlKey set.
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.setView(
            zoomAt(
              this.view,
              pinchFactor(event.deltaY),
              this.stagePoint(event.clientX, event.clientY),
              this.range.min,
              this.range.max
            )
          );
          return;
        }

        // At fit there is nowhere to pan, so a plain scroll is left alone
        // rather than absorbed into nothing.
        if (this.view.zoom <= this.range.min) return;
        event.preventDefault();
        this.setView({
          ...this.view,
          x: this.view.x - event.deltaX,
          y: this.view.y - event.deltaY,
        });
      },
      { passive: false }
    );

    stage.addEventListener("dblclick", (event: MouseEvent) => {
      if (this.flying || !this.canZoom()) return;
      event.preventDefault();
      event.stopPropagation();

      if (this.view.zoom > this.range.min) {
        this.setView({ ...FIT });
        return;
      }
      this.setView(
        zoomAt(
          this.view,
          this.range.max / this.view.zoom,
          this.stagePoint(event.clientX, event.clientY),
          this.range.min,
          this.range.max
        )
      );
    });

    /*
     * Two fingers zoom the picture.
     *
     * Everything below is drag-panning, which needs the view already zoomed
     * in to have anywhere to go, so on a phone there was no way to zoom in
     * the first place: the only route was the wheel. This is the way in.
     *
     * Measured in stage-local coordinates because that is the space the
     * zoom layer's own transform lives in, and routed through setView like
     * every other change, so it inherits the clamping, the frame deferral
     * and the single transform write.
     */
    const pinchPoints = (): [Point, Point] | null => {
      const live = [...this.touches.values()];
      return live.length >= 2 ? [live[0], live[1]] : null;
    };

    stage.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType !== "touch" || this.flying || !this.canZoom()) return;
      // A primary touch means no other finger is down: anything still
      // tracked was orphaned by a lift iOS never delivered, and pairing
      // this finger with it would turn a drag into a pinch. Same guard as
      // the wall's.
      if (staleTouches(event.isPrimary, this.touches.size)) {
        this.touches.clear();
        this.pinchStart = null;
      }
      this.touches.set(
        event.pointerId,
        this.stagePoint(event.clientX, event.clientY)
      );
      const pair = pinchPoints();
      if (!pair) return;

      // A second finger ends any drag in progress: the gesture has become a
      // zoom, and letting the pan carry on would fight the anchor.
      this.dragging = false;
      root.removeClass("is-panning");
      this.pinchStart = {
        camera: this.view,
        span: pinchSpan(pair[0], pair[1]),
        midpoint: pinchMidpoint(pair[0], pair[1]),
      };
      stage.setPointerCapture(event.pointerId);
    });

    stage.addEventListener("pointermove", (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (!this.touches.has(event.pointerId)) return;
      this.touches.set(
        event.pointerId,
        this.stagePoint(event.clientX, event.clientY)
      );

      const pair = pinchPoints();
      if (!pair || !this.pinchStart) return;
      event.preventDefault();
      this.setView(
        pinchCamera(this.pinchStart, pair[0], pair[1], this.range.min, this.range.max)
      );
    });

    const endPinch = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") return;
      if (!this.touches.delete(event.pointerId)) return;
      if (stage.hasPointerCapture(event.pointerId)) {
        stage.releasePointerCapture(event.pointerId);
      }

      const pair = pinchPoints();
      if (!pair) {
        this.pinchStart = null;
        return;
      }
      // Still two fingers down, so rebase rather than carry on measuring
      // against a finger that has gone.
      this.pinchStart = {
        camera: this.view,
        span: pinchSpan(pair[0], pair[1]),
        midpoint: pinchMidpoint(pair[0], pair[1]),
      };
    };

    stage.addEventListener("pointerup", endPinch);
    stage.addEventListener("pointercancel", endPinch);

    stage.addEventListener("pointerdown", (event: PointerEvent) => {
      // A pinch owns the gesture once a second finger is down.
      if (this.touches.size >= 2) return;
      if (this.flying || this.view.zoom <= this.range.min) return;
      // A video fills the stage, so a drag here would land on its controls.
      // Zoom and scroll-panning still work; only drag-panning steps aside.
      if (event.target instanceof HTMLVideoElement) return;
      event.preventDefault();
      this.dragging = true;
      this.dragFrom = {
        x: event.clientX,
        y: event.clientY,
        viewX: this.view.x,
        viewY: this.view.y,
      };
      stage.setPointerCapture(event.pointerId);
      root.addClass("is-panning");
    });

    stage.addEventListener("pointermove", (event: PointerEvent) => {
      if (!this.dragging) return;
      event.preventDefault();
      this.setView({
        ...this.view,
        x: this.dragFrom.viewX + (event.clientX - this.dragFrom.x),
        y: this.dragFrom.viewY + (event.clientY - this.dragFrom.y),
      });
    });

    const endDrag = (event: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      if (stage.hasPointerCapture(event.pointerId)) {
        stage.releasePointerCapture(event.pointerId);
      }
      root.removeClass("is-panning");
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
  }

  private fly(target: Box, origin: DetailOrigin): void {
    if (!this.stage || !this.root) return;

    const t = flipTransform(origin.rect, target, origin.at);
    const mid = flightMidpoint(origin.rect, target, origin.at, 0.58, OPEN_SHAPE);
    this.stage.style.transformOrigin = `${origin.at.x * 100}% ${origin.at.y * 100}%`;

    // Three keyframes so the card arcs rather than sliding down a ruler, but
    // only the middle one shapes the path: the segments carry no easing of
    // their own, so EASE alone governs velocity across the whole flight. The
    // per-keyframe curves that used to be here composed with it, making the
    // card accelerate, slow into the midpoint, then accelerate again. That
    // uneven velocity read as unsmooth far more than the duration did.
    //
    // Transform only, no filter. An animated blur forces the stage to
    // re-rasterize every frame, and the stage holds a full size image;
    // dropping it is what lets the flight run on the compositor.
    const flight = this.stage.animate(
      [
        {
          transform: `translate(${t.dx}px, ${t.dy}px) scale(${t.scaleX}, ${t.scaleY})`,
          offset: 0,
        },
        {
          transform: `translate(${mid.dx}px, ${mid.dy}px) scale(${mid.scaleX}, ${mid.scaleY})`,
          offset: 0.58,
        },
        {
          transform: "translate(0px, 0px) scale(1, 1)",
          offset: 1,
        },
      ],
      { duration: FLIGHT_MS, easing: EASE, fill: "both" }
    );

    // The wall dims away behind the rising card rather than being cut. Driven
    // here rather than by a CSS transition because the backdrop is created
    // and given is-open within one task, so whether a transition fires at all
    // would depend on a style flush happening to land in between.
    //
    // Over three quarters of the flight, so the wall is gone by the time the
    // card settles instead of lingering faintly underneath it.
    this.veil = this.backdrop?.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: FLIGHT_MS * 0.55,
        easing: "cubic-bezier(0.4, 0, 0.6, 1)",
        fill: "both",
      }
    ) ?? null;

    this.flying = true;
    flight.onfinish = () => {
      this.flying = false;
      if (this.relayoutPending) {
        this.relayoutPending = false;
        this.relayout();
      }
    };
    flight.oncancel = () => {
      this.flying = false;
    };

    this.root.addClass("is-open");
  }

  close(immediate = false): void {
    if (!this.root || this.closing) {
      if (immediate) this.teardown();
      return;
    }
    this.closing = true;

    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;

    if (immediate || !this.stage || !this.origin) {
      this.teardown();
      return;
    }

    const target: Box = {
      x: this.stage.offsetLeft,
      y: this.stage.offsetTop,
      w: this.stage.offsetWidth,
      h: this.stage.offsetHeight,
    };
    const t = flipTransform(this.origin.rect, target, this.origin.at);
    const mid = flightMidpoint(this.origin.rect, target, this.origin.at, 0.42);

    // Back to fit before the flight, so the card returns to the wall showing
    // the picture the tile shows, not whatever corner you were inspecting.
    this.dragging = false;
    this.view = { ...FIT };
    this.cancelApply();
    this.applyView();

    // Hand the backdrop back to CSS, which drops it instantly once is-open
    // goes. The returning card has to have the wall to land on.
    this.veil?.cancel();
    this.veil = null;
    this.reveal?.cancel();
    this.reveal = null;

    this.root.removeClass("is-open");
    const animation = this.stage.animate(
      [
        { transform: "translate(0px, 0px) scale(1, 1)", filter: "blur(0px)" },
        {
          transform: `translate(${mid.dx}px, ${mid.dy}px) scale(${mid.scaleX}, ${mid.scaleY})`,
          filter: "blur(2px)",
          offset: 0.5,
        },
        {
          transform: `translate(${t.dx}px, ${t.dy}px) scale(${t.scaleX}, ${t.scaleY})`,
          filter: "blur(0px)",
        },
      ],
      { duration: RETURN_MS, easing: "cubic-bezier(0.32, 0.72, 0.2, 1)", fill: "both" }
    );
    animation.onfinish = () => this.teardown();
    // A cancelled animation must not leave the overlay stranded.
    animation.oncancel = () => this.teardown();
  }

  private teardown(): void {
    this.cancelApply();
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.stopWatchingVisibility();
    this.veil?.cancel();
    this.veil = null;
    this.reveal?.cancel();
    this.reveal = null;
    this.root?.remove();
    this.root = null;
    this.stage = null;
    this.backdrop = null;
    this.layer = null;
    this.origin = null;
    this.originNow = null;
    this.meta = null;
    this.relayoutPending = false;
    this.hotkeys = [];
    this.current = null;
    this.flying = false;
    this.dragging = false;
    this.view = { ...FIT };
    this.closing = false;
    this.onClosed?.();
  }
}
