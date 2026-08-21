/* A tile a quarter showing is enough to be worth playing: by the time it is
   half on screen it should already be running, not just starting. */
const MIN_RATIO = 0.25;

/* How far beyond the viewport the observer reaches, as a share of its own
   height. This buys preload, not playback: a video half a screen out starts
   fetching so it is ready by the time it arrives. */
const PRELOAD_MARGIN = "50% 0px";

export interface Edges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The share of an element's area lying inside the root, from 0 to 1.
 *
 * IntersectionObserver reports its ratio against the *expanded* root, so once
 * a rootMargin is in play a tile a screen below the fold reports 1.0. That is
 * the right answer for preloading and the wrong one for playback, so play
 * eligibility is measured here against the true viewport instead.
 */
export function visibleRatio(rect: Edges, root: Edges): number {
  const area = (rect.bottom - rect.top) * (rect.right - rect.left);
  if (!(area > 0)) return 0;

  const height = Math.min(rect.bottom, root.bottom) - Math.max(rect.top, root.top);
  const width = Math.min(rect.right, root.right) - Math.max(rect.left, root.left);
  if (height <= 0 || width <= 0) return 0;

  return (height * width) / area;
}

export interface PlaybackCandidate {
  id: string;
  centerDistance: number;
  ratio: number;
}

/**
 * Everything sufficiently visible plays, nearest the centre of the viewport
 * first. If a video is in frame it should be moving, so max is unbounded by
 * default; it stays a parameter because the ordering is what decides who
 * survives should a cap ever be wanted back.
 */
export function choosePlaying(candidates: PlaybackCandidate[], max: number): string[] {
  return [...candidates]
    .filter((c) => c.ratio >= MIN_RATIO)
    .sort((a, b) => a.centerDistance - b.centerDistance)
    .slice(0, Math.max(0, max))
    .map((c) => c.id);
}

export type VisibilityAction = "pause" | "resume" | "none";

export interface VisibilityState {
  hidden: boolean;
  playing: boolean;
  /** True when this code paused it, as opposed to the viewer having done so. */
  suspended: boolean;
}

/**
 * What to do with a lone video when the window comes and goes.
 *
 * The wall's own videos are governed by what is on screen, so they need no
 * memory; the detail view's single video does, because it must come back
 * exactly as it was left. Resuming only what was suspended here is the whole
 * point: a video the viewer paused deliberately has to stay paused.
 */
export function visibilityAction({ hidden, playing, suspended }: VisibilityState): VisibilityAction {
  if (hidden) return playing ? "pause" : "none";
  return suspended ? "resume" : "none";
}

type Playable = HTMLVideoElement | HTMLImageElement;

/**
 * Drives autoplay for video tiles and animated GIF tiles from one observer.
 *
 * A GIF in an img tag cannot be paused, so stopping it means swapping the
 * src back to its still thumbnail; playing it means swapping in the
 * original. Video uses preload="none" until it nears the viewport.
 */
export class PlaybackController {
  private observer: IntersectionObserver | null = null;
  private ratios = new Map<Playable, number>();
  private enabled: boolean;
  private frame = 0;
  /** The one element the pointer is over, or null. Only ever consulted while
      autoplay is off, which is the only time it decides anything. */
  private hovered: Playable | null = null;

  constructor(
    private root: HTMLElement,
    enabled: boolean,
    /* No cap: a video in frame plays. The rootMargin means offscreen tiles
       are only ever preloaded, never played, so this bounds itself to what
       is actually on screen. */
    private maxConcurrent = Number.POSITIVE_INFINITY
  ) {
    this.enabled = enabled && !PlaybackController.prefersReducedMotion();

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as Playable;
          this.ratios.set(element, entry.intersectionRatio);
          if (entry.intersectionRatio > 0 && element instanceof HTMLVideoElement) {
            if (element.preload === "none") element.preload = "metadata";
            const pending = element.dataset.src;
            if (pending && !element.src) element.src = pending;
          }
        }
        this.schedule();
      },
      { root, rootMargin: PRELOAD_MARGIN, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private static prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private onVisibility = (): void => {
    if (document.hidden) this.stopAll();
    else this.schedule();
  };

  setEnabled(on: boolean): void {
    this.enabled = on && !PlaybackController.prefersReducedMotion();
    if (this.enabled) {
      this.schedule();
      return;
    }
    this.stopAll();
    // stopAll has just stopped the card under the pointer along with the rest.
    // Turning autoplay off while hovering something should leave that one
    // playing, or the setting would appear to take a card away rather than
    // stop the wall running by itself.
    this.playHovered();
  }

  /**
   * The card the pointer is over, played even when autoplay is off.
   *
   * With autoplay on this decides nothing: everything in frame is already
   * playing and apply() owns it. With autoplay off it is the only way a video
   * moves at all, which is the point of it. The setting is a request that the
   * wall not run by itself, not a refusal to ever show you a video.
   */
  hover(element: Playable | null): void {
    if (this.hovered === element) return;
    const previous = this.hovered;
    this.hovered = element;

    if (this.enabled) return;
    if (previous) this.stop(previous);
    this.playHovered();
  }

  /**
   * Guarded against Reduce Motion here as well as by the caller. Autoplay's
   * own flag already folds it in, so without this the one path that ignores
   * that flag would be the one path that ignores the preference too.
   */
  private playHovered(): void {
    if (!this.hovered) return;
    if (PlaybackController.prefersReducedMotion()) return;
    this.play(this.hovered);
  }

  observe(element: Playable): void {
    if (this.ratios.has(element)) return;
    this.ratios.set(element, 0);
    this.observer?.observe(element);
  }

  forget(element: Playable): void {
    this.observer?.unobserve(element);
    this.ratios.delete(element);
    if (this.hovered === element) this.hovered = null;
    this.stop(element);
  }

  /** Drops elements that are no longer in the document, after recycling. */
  prune(): void {
    for (const element of [...this.ratios.keys()]) {
      if (!element.isConnected) {
        this.observer?.unobserve(element);
        this.ratios.delete(element);
        // Tiles are pooled, so the element the pointer was over can be taken
        // out from under it by a repaint rather than by the pointer leaving.
        if (this.hovered === element) this.hovered = null;
      }
    }
  }

  private play(element: Playable): void {
    if (element instanceof HTMLVideoElement) {
      if (element.paused) void element.play().catch(() => undefined);
      return;
    }
    const original = element.dataset.animatedSrc;
    if (original && element.src !== original) element.src = original;
  }

  private stop(element: Playable): void {
    if (element instanceof HTMLVideoElement) {
      if (!element.paused) element.pause();
      return;
    }
    const still = element.dataset.stillSrc;
    if (still && element.src !== still) element.src = still;
  }

  private stopAll(): void {
    for (const element of this.ratios.keys()) this.stop(element);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.apply();
    });
  }

  private apply(): void {
    if (!this.enabled) return;

    const rootRect = this.root.getBoundingClientRect();
    const rootCenter = rootRect.top + rootRect.height / 2;
    const elements = [...this.ratios.keys()];

    const candidates = elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      return {
        id: String(index),
        centerDistance: Math.abs(rect.top + rect.height / 2 - rootCenter),
        ratio: visibleRatio(rect, rootRect),
      };
    });

    const playing = new Set(choosePlaying(candidates, this.maxConcurrent));
    elements.forEach((element, index) => {
      if (playing.has(String(index))) this.play(element);
      else this.stop(element);
    });
  }

  destroy(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = null;
    this.ratios.clear();
    this.hovered = null;
  }
}
