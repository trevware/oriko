// The wall's performance evaluation on a synthetic wall: builds the real
// renderer and stylesheet into a test page, drives it in Chrome the way a
// hand would, and checks the results against perf/budgets.json. Fast,
// repeatable, and needs nothing but Chrome. perf/obsidian.mjs runs the same
// scenarios against your own clippings in a real Obsidian window.
//
//   npm run perf                       evaluate, exit 1 if a budget is missed
//   npm run perf -- --headed           watch it run in a visible window
//   npm run perf -- --only hover       only the scenarios whose name has "hover"
//   npm run perf -- --save before      also keep this run as results/before.json
//   npm run perf -- --compare before   show the change from a kept run
import esbuild from "esbuild";
import { chromium } from "playwright-core";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCENARIOS, measure, measureSync, parseArgs, report, runChecks } from "./scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(here, ".out");
const resultsDir = join(here, "results");
mkdirSync(out, { recursive: true });
mkdirSync(resultsDir, { recursive: true });
const args = parseArgs(process.argv.slice(2));

await esbuild.build({
  entryPoints: [join(here, "harness.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: join(out, "harness.js"),
  alias: { obsidian: join(here, "shim", "obsidian.ts") },
  logLevel: "warning",
});
copyFileSync(join(root, "styles.css"), join(out, "styles.css"));
writeFileSync(
  join(out, "index.html"),
  `<!doctype html>
<html class="theme-dark">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  /* The handful of Obsidian theme variables the stylesheet reads. */
  :root {
    --background-primary: #1e1e1e;
    --background-secondary: #262626;
    --background-modifier-border: #363636;
    --text-normal: #dadada;
    --text-muted: #999;
    --text-faint: #666;
    --interactive-accent: #7f6df2;
    --color-accent: #7f6df2;
    --font-interface: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-monospace: Menlo, monospace;
  }
  html, body { margin: 0; height: 100%; background: var(--background-primary); color: var(--text-normal);
    font-family: var(--font-interface); overflow: hidden; }
  /* Obsidian's view-content: a flex column the viewport fills, with a
     gutter beside it, as Obsidian has, for the pointer to rest off the wall. */
  #view { position: absolute; inset: 0 0 0 24px; display: flex; flex-direction: column; }
</style>
</head>
<body>
<div id="view" class="oriko-view view-content"></div>
<script src="harness.js"></script>
</body>
</html>
`
);

// "vault" is shaped like the Aegis wall on 2026-10-04: 119 clippings on its
// main grid, 56 of them X posts and Steam store pages, cards on hover,
// Medium tiles, all of it mounted. The "cards" walls are the stress case:
// past the mount-everything budget, mostly cards.
const WALLS = {
  vault: { count: 119, x: 53, steam: 3, bandMode: "hover", stage: "m", seed: 7 },
  "cards-hover": { count: 260, x: 150, steam: 40, bandMode: "hover", stage: "m", seed: 11 },
  "cards-always": { count: 260, x: 150, steam: 40, bandMode: "always", stage: "m", seed: 11 },
};
const PLAN = {
  vault: ["hover-sweep", "hover-column-walk", "wheel-scroll-hover", "stage-steps"],
  "cards-hover": ["hover-sweep", "hover-column-walk", "wheel-scroll-hover"],
  "cards-always": ["wheel-scroll-hover", "stage-steps"],
};

const browser = await chromium.launch({
  channel: "chrome",
  headless: !args.headed,
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
});
const context = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on("pageerror", (err) => console.error("page error:", err.message));
await page.goto(pathToFileURL(join(out, "index.html")).href);
await page.waitForFunction(() => document.body.dataset.ready === "1");

const data = { target: "synthetic", date: new Date().toISOString(), chrome: browser.version(), results: {} };
for (const [wall, spec] of Object.entries(WALLS)) {
  const scenarios = SCENARIOS.filter((s) => PLAN[wall].includes(s.name) && (!args.only || s.name.includes(args.only)));
  // `--only checks` runs no scenario, just the correctness checks.
  if (scenarios.length === 0 && args.only !== "checks") continue;
  await page.evaluate((s) => window.__perf.setup(s), spec);
  data.results[`${wall} · relayout`] = await measureSync(page);
  for (const scenario of scenarios) {
    process.stdout.write(`  ${wall} · ${scenario.name} …`);
    data.results[`${wall} · ${scenario.name}`] = await measure(browser, page, scenario, {
      repeats: args.repeats,
      keepTrace: args.keepTrace ? out : null,
    });
    process.stdout.write(" done\n");
  }
  // Last, so nothing they do can disturb a measurement.
  if (spec.bandMode === "hover") (data.checks ??= {})[wall] = await runChecks(page);
}
await browser.close();

const budgets = JSON.parse(readFileSync(join(here, "budgets.json"), "utf8"));
const failures = report({ report: data, budgets, budgetSet: "synthetic", resultsDir, save: args.save, compare: args.compare });
if (failures.length) {
  console.log(`\n${failures.length} budget(s) missed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nAll budgets met.");
