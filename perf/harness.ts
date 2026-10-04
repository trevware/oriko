/**
 * The perf harness page: the real GridRenderer and stylesheet, mounted in a
 * plain Chromium page over a synthetic wall shaped like a real one, with a
 * small API the runner drives through `window.__perf`.
 *
 * Everything here is deterministic for a given seed, so two runs of the same
 * build lay out the same wall and walk the pointer over the same cards.
 */
import "./shim/obsidian";
import type { App } from "obsidian";
import { GridRenderer } from "../src/grid";
import { PlaybackController } from "../src/core/playback";
import type { DensityStage } from "../src/core/density";
import type { TileModel } from "../src/core/tile";
import type { ClippingRecord } from "../src/core/scan";
import type { SteamApp, SteamLook } from "../src/core/steam";
import { postLook } from "../src/core/posts";
import { nextFrames, perfApi } from "./api";

type BandMode = "always" | "hover";

export interface WallSpec {
  /** Total clippings. */
  count: number;
  /** How many of them are X posts and Steam store pages. */
  x: number;
  steam: number;
  bandMode: BandMode;
  stage: DensityStage;
  seed: number;
}

/** A tiny deterministic PRNG, so a seed always builds the same wall. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "the a wall card post shipped today new release design system grid layout motion prototype figma swift obsidian plugin thread look at this how we built why it matters ten tips for faster builds open source".split(
    " "
  );

function sentence(rand: () => number, chars: number): string {
  let out = "";
  while (out.length < chars) out += (out ? " " : "") + WORDS[Math.floor(rand() * WORDS.length)];
  return out.slice(0, chars);
}

/**
 * Full-resolution covers, the way the wall paints them: a real JPEG at the
 * size a clipping's archived original tends to be, so decode and raster cost
 * what they cost in a vault. Distinct per tile, or Chromium would share one
 * decoded bitmap across the whole wall.
 */
async function makeImage(rand: () => number, w: number, h: number, hue: number): Promise<string> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue} 60% 45%)`);
  g.addColorStop(1, `hsl(${(hue + 80) % 360} 55% 25%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Detail, so the JPEG is photo-sized rather than a few kilobytes of flat colour.
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `hsla(${Math.floor(rand() * 360)} 70% ${30 + rand() * 50}% / ${0.15 + rand() * 0.5})`;
    const r = 6 + rand() * w * 0.08;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.86 });
  return URL.createObjectURL(blob);
}

function record(id: string, title: string, source: string, description: string): ClippingRecord {
  return {
    path: `Clippings/${id}.md`,
    title,
    source,
    description,
    categories: ["design", "tools"],
    status: "unread",
    created: "2026-09-20",
    cover: "",
    grid: "",
    folder: "",
    media: [],
    haystack: title.toLowerCase(),
    properties: { categories: ["design", "tools"], created: ["2026-09-20"] },
  };
}

function steamApp(id: string, rand: () => number): SteamApp {
  const discounted = rand() < 0.5;
  return {
    id,
    name: sentence(rand, 18 + Math.floor(rand() * 14)),
    description: "",
    developers: ["Studio"],
    publishers: ["Studio"],
    genres: ["Action", "Indie", "Strategy"],
    isFree: false,
    price: {
      currency: "CAD",
      initial: 3249,
      final: discounted ? 1624 : 3249,
      discountPercent: discounted ? 50 : 0,
      initialText: "CDN$ 32.49",
      finalText: discounted ? "CDN$ 16.24" : "CDN$ 32.49",
    },
    comingSoon: false,
    releaseDate: "17 Sep, 2020",
    platforms: { windows: true, mac: true, linux: false },
    header: "",
    background: "",
    screenshots: [],
    trailers: [],
  };
}

/** Shapes clippings come in, as width by height of the archived original. */
const PLAIN_SHAPES: Array<[number, number]> = [
  [1080, 1920],
  [1080, 1350],
  [1200, 1200],
  [1600, 900],
  [1280, 1600],
  [1500, 1000],
];
const X_SHAPES: Array<[number, number]> = [
  [1200, 1500],
  [1600, 900],
  [1200, 1200],
  [1080, 1350],
];
const STEAM_SHAPE: [number, number] = [920, 430];

async function buildTiles(spec: WallSpec): Promise<TileModel[]> {
  const rand = mulberry32(spec.seed);
  // Spread the X and Steam cards through the wall the way a real vault does,
  // rather than in a block at the top.
  const kinds: Array<"x" | "steam" | "plain"> = [];
  for (let i = 0; i < spec.count; i++) kinds.push("plain");
  const slots = [...kinds.keys()].sort(() => rand() - 0.5);
  for (let i = 0; i < spec.x; i++) kinds[slots[i]] = "x";
  for (let i = spec.x; i < spec.x + spec.steam; i++) kinds[slots[i]] = "steam";

  const jobs = kinds.map(async (kind, i): Promise<TileModel> => {
    const id = `Clippings/clip-${i}.md`;
    const shape =
      kind === "steam"
        ? STEAM_SHAPE
        : kind === "x"
          ? X_SHAPES[Math.floor(rand() * X_SHAPES.length)]
          : PLAIN_SHAPES[Math.floor(rand() * PLAIN_SHAPES.length)];
    // Half size: the decode and raster are still well past a column's worth
    // of pixels at 2x, and the harness builds a few hundred of these.
    const [w, h] = shape;
    const url = await makeImage(rand, Math.round(w / 2), Math.round(h / 2), Math.floor(rand() * 360));
    const text = sentence(rand, 30 + Math.floor(rand() * 220));
    const rec = record(
      `clip-${i}`,
      kind === "x" ? `Someone: ${text}` : sentence(rand, 30),
      kind === "x"
        ? `https://x.com/someone/status/${1800000000000000000 + i}`
        : kind === "steam"
          ? `https://store.steampowered.com/app/${100000 + i}/`
          : `https://example.com/${i}`,
      kind === "x" ? text : ""
    );
    const model: TileModel = {
      id,
      record: rec,
      posterPath: "",
      filePath: url,
      remote: true,
      kind: "image",
      animated: false,
      width: w,
      height: h,
      provisional: false,
      signature: `${id}|${url}`,
    };
    if (kind === "x") {
      model.post = postLook(
        { site: "x", id: String(1800000000000000000 + i), handle: "someone", name: `Someone ${i}`, text },
        { fetchedAt: 1, details: { avatar: "", verified: rand() < 0.4, count: Math.floor(rand() * 90000) } }
      );
      model.bandMode = spec.bandMode;
      model.signature += `|post|${model.post.stamp}|${spec.bandMode}`;
    }
    if (kind === "steam") {
      const app = steamApp(String(100000 + i), rand);
      const look: SteamLook = {
        app,
        header: { path: url, remote: true },
        background: null,
        screenshots: [],
        trailerFile: "",
        stamp: `steam-${i}`,
      };
      model.steam = look;
      model.bandMode = spec.bandMode;
      model.signature += `|steam|${look.stamp}|${spec.bandMode}`;
    }
    return model;
  });
  return Promise.all(jobs);
}

/* ------------------------------------------------------------------ */
/* The page API                                                       */
/* ------------------------------------------------------------------ */

const app = {} as App;
let grid: GridRenderer | null = null;
let playback: PlaybackController | null = null;

function host(): HTMLElement {
  const el = document.getElementById("view");
  if (!el) throw new Error("no #view");
  return el;
}

const api = perfApi(() => grid);

const harness = {
  ...api,

  /** Builds a wall to the spec and waits until it has painted and settled. */
  async setup(spec: WallSpec): Promise<{ tiles: number; build: number }> {
    const started = performance.now();
    grid?.destroy();
    playback?.destroy();
    host().empty();
    const tiles = await buildTiles(spec);
    grid = new GridRenderer(app, host());
    // The view's own wiring, so each render pays what it pays in Obsidian.
    playback = new PlaybackController(grid.viewportEl, false);
    grid.onRendered = () => {
      playback?.prune();
      for (const media of grid?.mountedMedia() ?? []) playback?.observe(media);
    };
    grid.onHoverMedia = (media) => playback?.hover(media);
    grid.setDensity(spec.stage);
    grid.setTileSlots({ date: "created", property: "categories" });
    grid.setTiles(tiles, { replace: true });
    await nextFrames(3);
    await api.settle();
    // Let the arrival animations finish so they are not measured.
    await new Promise((r) => window.setTimeout(r, 900));
    return { tiles: tiles.length, build: performance.now() - started };
  },
};

(window as unknown as { __perf: typeof harness }).__perf = harness;
document.body.dataset.ready = "1";
