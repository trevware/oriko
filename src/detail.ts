import { App, setIcon } from "obsidian";
import { zoomAt } from "./camera";
import { resourceUrl } from "./convert";
import type { Camera } from "./camera";
import { fitRect, flightMidpoint, flipTransform } from "./layout";
import { visibilityAction } from "./playback";
import type { Box, FlightShape } from "./layout";
import type { TileModel } from "./tile";
import { paintSwatchStrip, readSwatches } from "./swatch-strip";
import { attachTip, tipLabel } from "./tip";
import { clampPan, fitZoomRange } from "./viewer";

export interface DetailActions {
  onExport: (id: string) => void;
  onReveal: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenNote: (id: string) => void;
}

export interface DetailOrigin {
  /** The card's rect on screen, relative to the container. */
  rect: Box;
  /** Where in the card the click landed, 0..1 on each axis. */
  at: { x: number; y: number };
}

const PADDING = 56;
const SIDEBAR = 300;
/* Space between the image's right edge and the start of the panel. */
const META_GAP = 24;
const FLIGHT_MS = 650;
const RETURN_MS = 420;
/** Trackpad pinch arrives as ctrl+wheel; matches the grid's feel. */
const PINCH_SENSITIVITY = 0.0022;
/** One notch of the keyboard zoom. */
const KEY_ZOOM_STEP = 1.25;
const FIT: Camera = { x: 0, y: 0, zoom: 1 };
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
      const video = document.createElement("video");
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
  private hotkeys: Array<{ match: (event: KeyboardEvent) => boolean; run: () => void }> = [];

  constructor(
    private app: App,
    private container: HTMLElement,
    private actions: DetailActions
  ) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  private resource(path: string): string {
    return resourceUrl(this.app.vault, path) || path;
  }

  /** Fires once the stage exists, so the source card can be hidden then. */
  onStageReady: (() => void) | null = null;
  /** Fires once the closing flight has finished and the overlay is gone. */
  onClosed: (() => void) | null = null;

  async open(model: TileModel, origin: DetailOrigin): Promise<void> {
    this.close(true);
    this.closing = false;

    const url = model.remote ? model.filePath : this.resource(model.filePath);
    const size = await naturalSize(url, model.kind, {
      width: model.width,
      height: model.height,
    });

    this.root = this.container.createDiv({ cls: "pg-detail" });
    const backdrop = this.root.createDiv({ cls: "pg-detail-backdrop" });
    backdrop.onclick = () => this.close();
    this.backdrop = backdrop;

    const back = this.root.createDiv({ cls: "pg-detail-back" });
    setIcon(back, "arrow-left");
    back.setAttribute("aria-label", "Back");
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

    const target = fitRect(
      size,
      { width: bounds.width - SIDEBAR, height: bounds.height },
      PADDING
    );

    this.stage.style.left = `${target.x}px`;
    this.stage.style.top = `${target.y}px`;
    this.stage.style.width = `${target.w}px`;
    this.stage.style.height = `${target.h}px`;

    this.frame = { width: target.w, height: target.h };
    this.stageClient = { x: bounds.left + target.x, y: bounds.top + target.y };
    this.range = fitZoomRange(size, { width: target.w, height: target.h });
    this.root.toggleClass("is-zoomable", this.range.max > this.range.min);

    const image = this.paintMedia(model);
    const panel = this.paintMeta(model, bounds, target);
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

      // Registered in the capture phase, so stopping here also spares the
      // grid's own document-level handlers, which would otherwise act on a
      // selection sitting invisible behind this overlay.
      const take = (run: () => void): void => {
        event.preventDefault();
        event.stopPropagation();
        run();
      };

      if (event.key === "Escape") return take(() => this.close());

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
      video.controls = true;
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

  private paintMeta(model: TileModel, bounds: DOMRect, stage: Box): HTMLElement | null {
    if (!this.root) return null;
    const panel = this.root.createDiv({ cls: "pg-detail-meta" });

    // Sit against the image rather than in a fixed right-hand column. The
    // stage is centred in the space left of the sidebar, so a portrait used
    // to leave a wide empty channel between the picture and its own details.
    // Clamped so the panel can never run off the right edge.
    panel.style.width = `${SIDEBAR}px`;
    panel.style.left = `${Math.min(stage.x + stage.w + META_GAP, bounds.width - SIDEBAR)}px`;
    // Top aligned with the image, not with the viewport. The stage is centred
    // vertically, so a fixed inset left the details floating against nothing
    // whenever the picture was short. It still runs to the bottom of the
    // overlay and scrolls, since the details can outrun a landscape image.
    panel.style.top = `${stage.y}px`;

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
    field("Categories", model.record.categories.join(", "));
    field("Status", model.record.status);

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
    ): void => {
      const button = bar.createEl("button", { cls: "pg-detail-button" });
      button.setAttribute("aria-label", tipLabel(label, shortcut));
      setIcon(button, icon);
      attachTip(button, label, shortcut);
      button.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        run();
      };
      this.hotkeys.push({ match, run });
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
              Math.exp(-event.deltaY * PINCH_SENSITIVITY),
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

    stage.addEventListener("pointerdown", (event: PointerEvent) => {
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
    this.root?.remove();
    this.root = null;
    this.stage = null;
    this.backdrop = null;
    this.layer = null;
    this.origin = null;
    this.hotkeys = [];
    this.flying = false;
    this.dragging = false;
    this.view = { ...FIT };
    this.closing = false;
    this.onClosed?.();
  }
}
