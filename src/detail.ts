import { App, TFile, normalizePath, setIcon } from "obsidian";
import { fitRect, flightMidpoint, flipTransform } from "./layout";
import type { Box } from "./layout";
import type { TileModel } from "./tile";

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
const FLIGHT_MS = 560;
const RETURN_MS = 420;
/* Slow to leave, quick through the middle, long soft settle. */
const EASE = "cubic-bezier(0.16, 0.84, 0.24, 1)";

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
  private origin: DetailOrigin | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;
  private closing = false;

  constructor(
    private app: App,
    private container: HTMLElement,
    private actions: DetailActions
  ) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  private resource(path: string): string {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : path;
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

    const back = this.root.createDiv({ cls: "pg-detail-back" });
    setIcon(back, "arrow-left");
    back.setAttribute("aria-label", "Back");
    back.onclick = () => this.close();

    this.stage = this.root.createDiv({ cls: "pg-detail-stage" });

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

    this.paintMedia(model);
    this.paintMeta(model, bounds);
    this.paintActions(model);

    this.onStageReady?.();
    this.fly(target, this.origin);

    this.onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    document.addEventListener("keydown", this.onKey, true);
  }

  private paintMedia(model: TileModel): void {
    if (!this.stage) return;

    if (model.kind === "video") {
      const video = this.stage.createEl("video", { cls: "pg-detail-media" });
      video.src = model.remote ? model.filePath : this.resource(model.filePath);
      video.controls = true;
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      if (model.posterPath) video.poster = this.resource(model.posterPath);
      return;
    }

    const image = this.stage.createEl("img", { cls: "pg-detail-media" });
    image.src = model.remote ? model.filePath : this.resource(model.filePath);
    image.decoding = "async";
  }

  private paintMeta(model: TileModel, bounds: DOMRect): void {
    if (!this.root) return;
    const panel = this.root.createDiv({ cls: "pg-detail-meta" });
    panel.style.width = `${SIDEBAR}px`;
    panel.style.left = `${bounds.width - SIDEBAR}px`;

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
  }

  private paintActions(model: TileModel): void {
    if (!this.root) return;
    const bar = this.root.createDiv({ cls: "pg-detail-actions" });

    const add = (icon: string, label: string, run: () => void): void => {
      const button = bar.createEl("button", { cls: "pg-detail-button" });
      button.setAttribute("aria-label", label);
      setIcon(button, icon);
      button.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        run();
      };
    };

    add("file-text", "Open note", () => {
      this.actions.onOpenNote(model.id);
      this.close();
    });
    add("download", "Export to Downloads", () => this.actions.onExport(model.id));
    add("folder", "Reveal in Finder", () => this.actions.onReveal(model.id));
    add("trash-2", "Delete", () => {
      this.close();
      this.actions.onDelete(model.id);
    });
  }

  private fly(target: Box, origin: DetailOrigin): void {
    if (!this.stage || !this.root) return;

    const t = flipTransform(origin.rect, target, origin.at);
    const mid = flightMidpoint(origin.rect, target, origin.at);
    this.stage.style.transformOrigin = `${origin.at.x * 100}% ${origin.at.y * 100}%`;

    // Three keyframes, so the card can arc and stretch on the way rather
    // than sliding straight down a ruler. The blur resolving as it lands is
    // what sells the movement as fluid.
    this.stage.animate(
      [
        {
          transform: `translate(${t.dx}px, ${t.dy}px) scale(${t.scaleX}, ${t.scaleY})`,
          filter: "blur(0px)",
          offset: 0,
          easing: "cubic-bezier(0.4, 0, 0.5, 1)",
        },
        {
          transform: `translate(${mid.dx}px, ${mid.dy}px) scale(${mid.scaleX}, ${mid.scaleY})`,
          filter: "blur(2.5px)",
          offset: 0.58,
          easing: "cubic-bezier(0.2, 0.6, 0.2, 1)",
        },
        {
          transform: "translate(0px, 0px) scale(1, 1)",
          filter: "blur(0px)",
          offset: 1,
        },
      ],
      { duration: FLIGHT_MS, easing: EASE, fill: "both" }
    );

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
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.root?.remove();
    this.root = null;
    this.stage = null;
    this.origin = null;
    this.closing = false;
    this.onClosed?.();
  }
}
