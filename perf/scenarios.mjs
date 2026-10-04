// What the perf runners do to the wall, how they measure it, and how they
// report against perf/budgets.json. Shared by run.mjs (a synthetic wall in
// Chrome) and obsidian.mjs (your own clippings in a real Obsidian window).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME = 16;

/** Moves the pointer in a straight line, one event a frame, the way a hand does. */
async function glide(page, from, to, ms) {
  const steps = Math.max(1, Math.round(ms / FRAME));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    await sleep(FRAME);
  }
  return to;
}

/** Off the wall, so nothing is hovered between runs. */
export async function park(page) {
  const view = await page.evaluate(() => window.__perf.viewRect());
  const spot = { x: Math.max(2, view.x - 6), y: view.y + view.h / 2 };
  await page.mouse.move(spot.x, spot.y);
  await sleep(500);
  return spot;
}

export const SCENARIOS = [
  {
    // The first time each card is hovered, run once and first, while the
    // GPU has built none of the hover's shaders: every card on screen and on
    // the screen below, then back up. A new shader is built in the middle of
    // a frame, and the first time macOS sees one it can take a tenth of a
    // second, which is the drawer visibly pausing before it opens. Each run
    // starts from a fresh profile, so the count here is what the hover look
    // costs and is steady from run to run; the pause itself is not, since
    // macOS keeps every shader it has built.
    name: "hover-first-contact",
    repeats: 1,
    async run(page) {
      let at = await park(page);
      const view = await page.evaluate(() => window.__perf.viewRect());
      const centre = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
      let hovered = 0;
      for (const step of [0, 1]) {
        if (step > 0) {
          await page.mouse.move(centre.x, centre.y);
          for (let i = 0; i < 12; i++) {
            await page.mouse.wheel(0, 70);
            await sleep(FRAME);
          }
          await sleep(900);
          at = await park(page);
        }
        for (const card of await page.evaluate(() => window.__perf.hoverCards())) {
          at = await glide(page, at, { x: card.x, y: card.y }, 180);
          await sleep(600);
          at = await park(page);
          await sleep(200);
          hovered++;
        }
      }
      await page.mouse.move(centre.x, centre.y);
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, -70);
        await sleep(FRAME);
      }
      await sleep(900);
      return { cards: hovered };
    },
  },
  {
    // Card to card across the wall, resting on each long enough for its
    // band to slide out and the column under it to make room.
    name: "hover-sweep",
    async run(page) {
      let at = await park(page);
      const cards = (await page.evaluate(() => window.__perf.hoverCards())).slice(0, 10);
      if (cards.length === 0) throw new Error("no cards on screen to hover");
      for (const card of cards) {
        at = await glide(page, at, { x: card.x, y: card.y }, 180);
        await sleep(420);
      }
      return { cards: cards.length };
    },
  },
  {
    // Straight down the column with the most cards and back up: every card
    // the pointer reaches opens and pushes the rest of the column, and shuts
    // as it leaves, which is the motion that cascades.
    name: "hover-column-walk",
    async run(page) {
      await park(page);
      const view = await page.evaluate(() => window.__perf.viewRect());
      const rects = await page.evaluate(() => window.__perf.rects());
      const columns = new Map();
      for (const r of rects) {
        if (!r.card || r.y + r.h < view.y || r.y > view.y + view.h) continue;
        const key = Math.round(r.x);
        columns.set(key, (columns.get(key) ?? 0) + 1);
      }
      const best = [...columns.entries()].sort((a, b) => b[1] - a[1])[0];
      const left = best ? best[0] : view.x;
      const width = rects.find((r) => Math.round(r.x) === left)?.w ?? 200;
      const cx = left + width / 2;
      // About 450px a second: browsing, not flinging.
      const top = { x: cx, y: view.y + 20 };
      const bottom = { x: cx, y: view.y + view.h - 20 };
      await page.mouse.move(top.x, top.y);
      await glide(page, top, bottom, 1800);
      await glide(page, bottom, top, 1800);
      return { cardsInColumn: best ? best[1] : 0 };
    },
  },
  {
    // Wheel-scrolling with the pointer resting on the wall: cards pass under
    // it, so drawers open and shut while the wall moves.
    name: "wheel-scroll-hover",
    async run(page) {
      const view = await page.evaluate(() => window.__perf.viewRect());
      await page.mouse.move(view.x + view.w * 0.42, view.y + view.h * 0.45);
      await sleep(300);
      for (let i = 0; i < 45; i++) {
        await page.mouse.wheel(0, 60);
        await sleep(FRAME);
      }
      for (let i = 0; i < 45; i++) {
        await page.mouse.wheel(0, -60);
        await sleep(FRAME);
      }
      return {};
    },
  },
  {
    // Through the tile sizes and back, which lays the whole wall out again
    // and resizes every card at each step.
    name: "stage-steps",
    async run(page) {
      await park(page);
      const sync = [];
      for (const stage of ["l", "xl", "l", "m", "s", "m"]) {
        const r = await page.evaluate((s) => window.__perf.setStage(s), stage);
        sync.push(r.sync);
        await sleep(650);
      }
      return { syncMax: Math.max(...sync) };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Correctness                                                        */
/* ------------------------------------------------------------------ */

/**
 * The things a speed-up most easily breaks without slowing anything down:
 * the drawer opening to its band's height with the picture kept whole, the
 * column under it moving by exactly that much and moving back, the pills
 * showing on hover and gone at rest, the tilt following the pointer, and
 * the tightest stage dropping the bands. Run once, untimed.
 */
export async function runChecks(page) {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });
  const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;

  const at = await park(page);
  const rects = await page.evaluate(() => window.__perf.rects());
  const cards = await page.evaluate(() => window.__perf.hoverCards());
  // A card with something under it in its column, so there is room to make.
  const card =
    cards.find((c) => rects.some((r) => Math.round(r.x) === Math.round(c.x - c.w / 2) && r.y > c.y + c.h / 2)) ??
    cards[0];
  if (!card) {
    check("a card to hover", false, "no X or Steam card on screen");
    return results;
  }
  // Off centre, so the card tips, and inside the part of it on screen: a
  // tall card's upper half can be above the top of the wall.
  const view = await page.evaluate(() => window.__perf.viewRect());
  const top = Math.max(card.y - card.h / 2, view.y);
  const target = { x: card.x + card.w * 0.3, y: top + (card.y + card.h / 2 - top) * 0.25 };
  await glide(page, at, target, 200);
  await sleep(650);
  const open = await page.evaluate((id) => window.__perf.cardState(id), card.id);
  const under = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return (el?.closest(".pg-tile") ?? el)?.className ?? "nothing";
  }, target);
  const below = rects.filter((r) => Math.round(r.x) === Math.round(card.x - card.w / 2) && r.y > card.y);
  check(
    "drawer opens by its band's height",
    open && open.bandH > 0 && near(open.frameH, open.tileH - 8 + open.bandH),
    open && `frame ${open.frameH}px, tile ${open.tileH}px, band ${open.bandH}px`
  );
  if (!open || open.metaVisibility !== "visible") check("pointer reaches the card", false, `under the pointer: ${under}`);
  check(
    "picture stays whole while open",
    open && near(open.artH, open.tileH - 8),
    open && `art ${open.artH}px for a ${open.tileH}px tile`
  );
  check(
    "column below makes exactly that much room",
    open && (below.length === 0 || (open.lowered.length > 0 && open.lowered.every((l) => near(l.by, open.bandH, 1)))),
    open && `${open.lowered.length} lowered by ${[...new Set(open.lowered.map((l) => Math.round(l.by)))].join("/") || "-"}px`
  );
  check(
    "pills show on hover",
    open && open.metaVisibility === "visible" && open.metaOpacity > 0.99,
    open && `${open.metaVisibility} at ${open.metaOpacity}`
  );
  check("card tilts toward the pointer", open && open.tilt !== "|", open && open.tilt);

  await park(page);
  await sleep(400);
  const shut = await page.evaluate((id) => window.__perf.cardState(id), card.id);
  check(
    "drawer shuts and the column returns",
    shut && near(shut.frameH, shut.tileH - 8) && shut.lowered.length === 0,
    shut && `frame ${shut.frameH}px, ${shut.lowered.length} still lowered`
  );
  check(
    "pills hidden at rest, holding no layers",
    shut && shut.metaVisibility === "hidden",
    shut && `${shut.metaVisibility} at ${shut.metaOpacity}`
  );

  await page.evaluate(() => window.__perf.setStage("xs"));
  await sleep(700);
  const tiny = await page.evaluate((id) => window.__perf.cardState(id), card.id);
  check(
    "tightest stage drops bands and pills",
    tiny && !tiny.bandShown && tiny.metaDisplay === "none",
    tiny && `band ${tiny.bandShown ? "shown" : "hidden"}, pills ${tiny.metaDisplay}`
  );
  await page.evaluate(() => window.__perf.setStage("m"));
  await sleep(900);
  return results;
}

/* ------------------------------------------------------------------ */
/* Measurement                                                        */
/* ------------------------------------------------------------------ */

// skia.shaders names every shader the GPU builds; a few hundred events a run.
const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "toplevel",
  "disabled-by-default-skia.shaders",
];
/** What made each style recalc necessary. Heavy, so only on request, to diagnose. */
const INVALIDATION = "disabled-by-default-devtools.timeline.invalidationTracking";

const round = (n) => Math.round(n * 10) / 10;

/** What the renderer and the GPU spent, in ms, from a trace. */
function summarizeTrace(buffer) {
  const events = JSON.parse(buffer.toString()).traceEvents ?? [];
  const names = new Map();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args?.name);
  }
  const sum = {
    busy: 0,
    longestTask: 0,
    style: 0,
    layout: 0,
    paint: 0,
    layerize: 0,
    script: 0,
    gpu: 0,
    gpuLongest: 0,
    shaderCompiles: 0,
    styleCount: 0,
    layoutCount: 0,
    forcedLayouts: 0,
  };
  // A trace can hold more than one renderer (Obsidian's popouts, devtools);
  // the one that did the most work is the wall's.
  const perMain = new Map();
  for (const e of events) {
    if (e.ph !== "X" || typeof e.dur !== "number") continue;
    const key = `${e.pid}:${e.tid}`;
    if (names.get(key) === "CrRendererMain" && e.name === "ThreadControllerImpl::RunTask") {
      perMain.set(key, (perMain.get(key) ?? 0) + e.dur);
    }
  }
  const main = [...perMain.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const e of events) {
    if (e.ph !== "X" || typeof e.dur !== "number") continue;
    const key = `${e.pid}:${e.tid}`;
    const ms = e.dur / 1000;
    if (e.name === "shader_compile") sum.shaderCompiles++;
    if (key === main) {
      switch (e.name) {
        case "ThreadControllerImpl::RunTask":
          sum.busy += ms;
          sum.longestTask = Math.max(sum.longestTask, ms);
          break;
        case "UpdateLayoutTree":
          sum.style += ms;
          sum.styleCount++;
          break;
        case "Layout":
          sum.layout += ms;
          sum.layoutCount++;
          // A layout with a JS stack under it was forced by a read.
          if (e.args?.beginData?.stackTrace?.length) sum.forcedLayouts++;
          break;
        case "Paint":
        case "PrePaint":
          sum.paint += ms;
          break;
        case "Layerize":
          sum.layerize += ms;
          break;
        case "FunctionCall":
        case "EventDispatch":
        case "FireAnimationFrame":
        case "TimerFire":
          sum.script += ms;
          break;
      }
    } else if (names.get(key) === "CrGpuMain" && e.name === "ThreadControllerImpl::RunTask") {
      sum.gpu += ms;
      // Nothing reaches the screen while the GPU's main thread is held.
      sum.gpuLongest = Math.max(sum.gpuLongest, ms);
    }
  }
  for (const k of Object.keys(sum)) sum[k] = round(sum[k]);
  return sum;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function summarizeFrames({ deltas, loaf }) {
  // The display's own frame interval, read off the run rather than assumed,
  // so a 120Hz screen is judged against 8.3ms and a 60Hz one against 16.7ms.
  const interval = percentile(deltas, 50) || 16.7;
  const dropped = deltas.reduce((n, d) => n + Math.max(0, Math.round(d / interval) - 1), 0);
  return {
    frames: deltas.length,
    interval: round(interval),
    p95: round(percentile(deltas, 95)),
    p99: round(percentile(deltas, 99)),
    max: round(Math.max(0, ...deltas)),
    // A frame half again as long as the display's is a visible stutter.
    janky: deltas.filter((d) => d > interval * 1.5).length,
    dropped,
    droppedPct: round((dropped / Math.max(1, deltas.length + dropped)) * 100),
    hitches: deltas.filter((d) => d > 50).length,
    longFrames: loaf.length,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Each scenario `repeats` times, keeping the median of every measure. */
export async function measure(browser, page, scenario, { repeats, keepTrace, invalidations = false }) {
  const runs = [];
  for (let i = 0; i < (scenario.repeats ?? repeats); i++) {
    await park(page);
    await browser.startTracing(page, {
      categories: invalidations ? [...TRACE_CATEGORIES, INVALIDATION] : TRACE_CATEGORIES,
    });
    await page.evaluate(() => window.__perf.startFrames());
    const extra = await scenario.run(page);
    await sleep(350);
    const frames = await page.evaluate(() => window.__perf.stopFrames());
    const buffer = await browser.stopTracing();
    if (keepTrace) writeFileSync(join(keepTrace, `${scenario.name}-${i}.trace.json`), buffer);
    runs.push({ frames: summarizeFrames(frames), trace: summarizeTrace(buffer), extra });
  }
  const pick = (part) =>
    Object.fromEntries(Object.keys(runs[0][part]).map((k) => [k, round(median(runs.map((r) => r[part][k])))]));
  return { frames: pick("frames"), trace: pick("trace"), extra: pick("extra") };
}

/**
 * Composited layers on the wall at rest, the pointer off it. Every layer is
 * GPU memory and a share of the compositor's work on every frame that
 * changes anything, so a stray layer per card is a cost the whole wall pays.
 */
async function countLayers(page) {
  const cdp = await page.context().newCDPSession(page);
  let layers = null;
  cdp.on("LayerTree.layerTreeDidChange", (e) => {
    if (e.layers) layers = e.layers;
  });
  await cdp.send("LayerTree.enable");
  await page.evaluate(() => window.__perf.nextFrames(3));
  await sleep(300);
  await cdp.send("LayerTree.disable").catch(() => {});
  await cdp.detach().catch(() => {});
  return layers ? layers.length : -1;
}

/** Synchronous costs: a full relayout and one render pass, five of each, and the layer count. */
export async function measureSync(page) {
  await park(page);
  const layers = await countLayers(page);
  const relayout = [];
  const render = [];
  for (let i = 0; i < 5; i++) {
    relayout.push(await page.evaluate(() => window.__perf.relayout()));
    render.push(await page.evaluate(() => window.__perf.render()));
    await sleep(50);
  }
  return { sync: { relayoutMs: round(median(relayout)), renderMs: round(median(render)), layers } };
}

/* ------------------------------------------------------------------ */
/* Report                                                             */
/* ------------------------------------------------------------------ */

const SHOWN = [
  "frames.interval",
  "frames.p95",
  "frames.dropped",
  "trace.busy",
  "trace.style",
  "trace.layout",
  "trace.gpuLongest",
  "trace.shaderCompiles",
];

const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * Prints every result against its budget and the saved run named by
 * `compare`, writes the report, and returns the budgets missed.
 */
export function report({ report: data, budgets, budgetSet, resultsDir, save, compare }) {
  const baseline =
    compare && existsSync(join(resultsDir, `${compare}.json`))
      ? JSON.parse(readFileSync(join(resultsDir, `${compare}.json`), "utf8"))
      : null;
  if (compare && !baseline) console.log(`(no saved run called "${compare}" to compare with)`);
  const rulesFor = budgets[budgetSet] ?? {};
  const failures = [];

  console.log(`\nOriko wall performance · ${data.target} · Chrome ${data.chrome}\n`);
  for (const [wall, checks] of Object.entries(data.checks ?? {})) {
    console.log(`${wall} · checks`);
    for (const c of checks) {
      if (!c.ok) failures.push(`${wall}: ${c.name} (${c.detail})`);
      console.log(`  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(42)} ${c.detail ?? ""}`);
    }
  }
  for (const [name, result] of Object.entries(data.results)) {
    const scenario = name.split(" · ").pop();
    const rules = { ...(rulesFor["*"] ?? {}), ...(rulesFor[scenario] ?? {}) };
    const metrics = Object.entries(result).flatMap(([part, values]) =>
      Object.entries(values).map(([k, v]) => [`${part}.${k}`, v])
    );
    const rows = [];
    for (const [key, value] of metrics) {
      const limit = rules[key];
      const before = baseline ? get(baseline.results?.[name], key) : undefined;
      const shown = limit !== undefined || SHOWN.includes(key) || key.startsWith("sync.") || key.startsWith("extra.");
      if (!shown) continue;
      const delta =
        typeof before === "number"
          ? before === 0
            ? value === 0
              ? ""
              : `  (was 0)`
            : `  (${value >= before ? "+" : ""}${Math.round(((value - before) / before) * 100)}% vs ${before})`
          : "";
      const over = typeof limit === "number" && value > limit;
      if (over) failures.push(`${name}: ${key} ${value} > ${limit}`);
      const mark = over ? "✗" : limit !== undefined ? "✓" : " ";
      const bound = limit !== undefined ? `  ≤ ${limit}` : "";
      rows.push(`  ${mark} ${key.padEnd(20)} ${String(value).padStart(8)}${bound}${delta}`);
    }
    console.log(`${name}\n${rows.join("\n")}`);
  }

  writeFileSync(join(resultsDir, `${data.target}-latest.json`), JSON.stringify(data, null, 2));
  if (save) writeFileSync(join(resultsDir, `${save}.json`), JSON.stringify(data, null, 2));
  return failures;
}

export function parseArgs(argv) {
  const flag = (name) => argv.includes(`--${name}`);
  const option = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    headed: flag("headed"),
    keepTrace: flag("keep-trace"),
    only: option("only"),
    save: option("save"),
    compare: option("compare"),
    repeats: Number(option("repeats") ?? 3),
    vault: option("vault"),
    keepOpen: flag("keep-open"),
    invalidations: flag("invalidations"),
  };
}
