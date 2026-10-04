/**
 * What the perf runners drive inside a page through `window.__perf`, the same
 * in the synthetic harness and inside a real Obsidian window, so a scenario is
 * written once and measured against both.
 */
import type { GridRenderer } from "../src/grid";
import type { DensityStage } from "../src/core/density";
import type { TileModel } from "../src/core/tile";

interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  card: boolean;
}

interface LoafEntry {
  duration: number;
  blockingDuration: number;
}

/** rAF-to-rAF intervals and long animation frames, between start and stop. */
class FrameRecorder {
  private deltas: number[] = [];
  private last = 0;
  private running = false;
  private loaf: LoafEntry[] = [];
  private observer: PerformanceObserver | null = null;

  start(): void {
    this.deltas = [];
    this.loaf = [];
    this.running = true;
    this.last = 0;
    const tick = (t: number) => {
      if (!this.running) return;
      if (this.last) this.deltas.push(t - this.last);
      this.last = t;
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Array<Record<string, number>>) {
          this.loaf.push({ duration: e.duration, blockingDuration: e.blockingDuration ?? 0 });
        }
      });
      this.observer.observe({ type: "long-animation-frame", buffered: false });
    } catch {
      this.observer = null;
    }
  }

  stop(): { deltas: number[]; loaf: LoafEntry[] } {
    this.running = false;
    this.observer?.disconnect();
    return { deltas: this.deltas, loaf: this.loaf };
  }
}

export function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = () => (--n <= 0 ? resolve() : window.requestAnimationFrame(step));
    window.requestAnimationFrame(step);
  });
}

/** The renderer's own state, which the runner reads but the plugin keeps private. */
interface GridInternals {
  tiles: TileModel[];
  viewport: HTMLElement;
  mounted: Map<string, { root: HTMLElement }>;
  positionById: Map<string, { x: number; y: number; w: number; h: number }>;
}

/** What a card looks like right now, for the correctness checks. */
export interface CardState {
  id: string;
  /** The tile's height in the layout, and the frame's and art's laid-out heights. */
  tileH: number;
  frameH: number;
  artH: number;
  bandH: number;
  bandShown: boolean;
  metaVisibility: string;
  metaOpacity: number;
  metaDisplay: string;
  tilt: string;
  /** Cards drawn lower than their layout says, and by how much. */
  lowered: Array<{ id: string; by: number }>;
}

export function perfApi(getGrid: () => GridRenderer | null) {
  const recorder = new FrameRecorder();
  const inside = (grid: GridRenderer) => grid as unknown as GridInternals;

  const api = {
    ready(): boolean {
      return getGrid() !== null;
    },

    tileCount(): number {
      const grid = getGrid();
      return grid ? inside(grid).tiles.length : 0;
    },

    viewRect(): { x: number; y: number; w: number; h: number } {
      const grid = getGrid();
      const r = grid ? inside(grid).viewport.getBoundingClientRect() : new DOMRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },

    /** Every tile in client space, marking the post and Steam cards. */
    rects(): Rect[] {
      const grid = getGrid();
      if (!grid) return [];
      const out: Rect[] = [];
      for (const t of inside(grid).tiles) {
        const r = grid.tileRect(t.id);
        if (r) out.push({ id: t.id, ...r, card: Boolean(t.post || t.steam) });
      }
      return out;
    },

    /** Centres of cards on screen, top to bottom, with room under them for a band. */
    hoverCards(): Rect[] {
      const view = api.viewRect();
      return api
        .rects()
        .filter(
          (r) =>
            r.card &&
            r.y + r.h / 2 > view.y + 20 &&
            r.y + r.h / 2 < view.y + view.h - 120 &&
            r.x >= view.x - 1 &&
            r.x + r.w <= view.x + view.w + 1
        )
        .map((r) => ({ ...r, x: r.x + r.w / 2, y: r.y + r.h / 2 }))
        .sort((a, b) => a.y - b.y || a.x - b.x);
    },

    startFrames(): void {
      recorder.start();
    },

    stopFrames(): { deltas: number[]; loaf: LoafEntry[] } {
      return recorder.stop();
    },

    /** A stage change, timed from the call to its return. */
    setStage(stage: DensityStage): { sync: number } {
      const grid = getGrid();
      if (!grid) return { sync: 0 };
      const started = performance.now();
      grid.setDensity(stage);
      return { sync: performance.now() - started };
    },

    /** A full relayout, timed synchronously, the way a filter or a new clip triggers one. */
    relayout(): number {
      const grid = getGrid();
      if (!grid) return 0;
      const started = performance.now();
      grid.relayout({ hold: true });
      return performance.now() - started;
    },

    /** One render pass over every mounted tile, as each scroll frame runs. */
    render(): number {
      const grid = getGrid();
      if (!grid) return 0;
      const started = performance.now();
      grid.render();
      return performance.now() - started;
    },

    /** Resolves once every picture on the wall has decoded. */
    async settle(): Promise<void> {
      const grid = getGrid();
      if (!grid) return;
      const images = Array.from(inside(grid).viewport.querySelectorAll<HTMLImageElement>("img.pg-media"));
      await Promise.all(images.map((i) => i.decode().catch(() => undefined)));
      await nextFrames(4);
    },

    nextFrames,

    /** The card as drawn: its parts' sizes, its pills, its tilt, and what it has pushed. */
    cardState(id: string): CardState | null {
      const grid = getGrid();
      if (!grid) return null;
      const g = inside(grid);
      const root = g.mounted.get(id)?.root;
      const position = g.positionById.get(id);
      const frame = root?.firstElementChild;
      if (!root || !position || !(frame instanceof HTMLElement)) return null;
      const art = frame.querySelector<HTMLElement>(":scope > .pg-steam-art");
      const band = frame.querySelector<HTMLElement>(":scope > .pg-card-band");
      const meta = frame.querySelector<HTMLElement>(".pg-meta");
      const metaStyle = meta ? getComputedStyle(meta) : null;
      const lowered: Array<{ id: string; by: number }> = [];
      for (const [other, el] of g.mounted) {
        const p = g.positionById.get(other);
        const m = /translate3d\([^,]+,\s*(-?[\d.]+)px/.exec(el.root.style.transform);
        if (!p || !m) continue;
        const by = Number(m[1]) - p.y;
        if (Math.abs(by) > 0.5) lowered.push({ id: other, by });
      }
      return {
        id,
        tileH: position.h,
        frameH: frame.offsetHeight,
        artH: art?.offsetHeight ?? 0,
        bandH: band?.offsetHeight ?? 0,
        bandShown: band ? getComputedStyle(band).display !== "none" : false,
        metaVisibility: metaStyle?.visibility ?? "",
        metaOpacity: metaStyle ? Number(metaStyle.opacity) : 0,
        metaDisplay: metaStyle?.display ?? "",
        tilt: `${frame.style.getPropertyValue("--pg-rx")}|${frame.style.getPropertyValue("--pg-ry")}`,
        lowered,
      };
    },
  };
  return api;
}

export type PerfApi = ReturnType<typeof perfApi>;
