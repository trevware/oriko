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
 * Of everything sufficiently visible, play only the few nearest the centre
 * of the viewport. Keeps decode work bounded no matter how many media tiles
 * a screen happens to hold.
 */
export function choosePlaying(candidates: PlaybackCandidate[], max: number): string[] {
  return [...candidates]
    .filter((c) => c.ratio >= MIN_RATIO)
    .sort((a, b) => a.centerDistance - b.centerDistance)
    .slice(0, Math.max(0, max))
    .map((c) => c.id);
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

  constructor(
    private root: HTMLElement,
    enabled: boolean,
    private maxConcurrent = 4
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
    if (this.enabled) this.schedule();
    else this.stopAll();
  }

  observe(element: Playable): void {
    if (this.ratios.has(element)) return;
    this.ratios.set(element, 0);
    this.observer?.observe(element);
  }

  forget(element: Playable): void {
    this.observer?.unobserve(element);
    this.ratios.delete(element);
    this.stop(element);
  }

  /** Drops elements that are no longer in the document, after recycling. */
  prune(): void {
    for (const element of [...this.ratios.keys()]) {
      if (!element.isConnected) {
        this.observer?.unobserve(element);
        this.ratios.delete(element);
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
  }
}
