// The wall's performance evaluation inside real Obsidian, over your own
// clippings. Builds the production bundle, makes a throwaway copy of the
// vault's clippings (an APFS clone, so it costs no disk), opens it in a
// separate Obsidian instance with its own profile, and runs the same
// scenarios as perf/run.mjs through the debugging port.
//
// The copy has no Sync, no other plugins and no account, and your own
// Obsidian keeps running untouched. A window opens for the length of the run;
// leave it in front, since a hidden window stops drawing frames.
//
//   npm run perf:obsidian                     evaluate against budgets.json
//   npm run perf:obsidian -- --vault <path>   another vault (default: $ORIKO_PERF_VAULT)
//   npm run perf:obsidian -- --compare before / --save before / --only hover
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, measure, measureSync, parseArgs, report, runChecks } from "./scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(here, ".out");
const resultsDir = join(here, "results");
mkdirSync(out, { recursive: true });
mkdirSync(resultsDir, { recursive: true });
const args = parseArgs(process.argv.slice(2));

const source = args.vault ?? process.env.ORIKO_PERF_VAULT ?? "/Users/trevor/Documents/Aegis";
const binary = process.env.OBSIDIAN_BIN ?? "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const port = Number(process.env.ORIKO_PERF_PORT ?? 9333);
if (!existsSync(join(source, ".obsidian", "plugins", "oriko"))) {
  console.error(`No Oriko install in ${source}. Pass --vault <path> or set ORIKO_PERF_VAULT.`);
  process.exit(2);
}
if (!existsSync(binary)) {
  console.error(`No Obsidian at ${binary}. Set OBSIDIAN_BIN.`);
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* Build                                                              */
/* ------------------------------------------------------------------ */

execFileSync("node", ["esbuild.config.mjs", "--production"], { cwd: root, stdio: "ignore" });
await esbuild.build({
  entryPoints: [join(here, "probe.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: join(out, "probe.js"),
  external: ["obsidian"],
  logLevel: "warning",
});

/* ------------------------------------------------------------------ */
/* The throwaway vault and profile                                    */
/* ------------------------------------------------------------------ */

const work = join(tmpdir(), "oriko-perf");
const vault = join(work, "vault");
const profile = join(work, "profile");
rmSync(work, { recursive: true, force: true });
mkdirSync(join(vault, ".obsidian", "plugins", "oriko"), { recursive: true });
mkdirSync(profile, { recursive: true });

const settings = JSON.parse(readFileSync(join(source, ".obsidian", "plugins", "oriko", "data.json"), "utf8"));
// Clone, not copy: on APFS cpSync falls back to clonefile, so a gigabyte of
// media is instant and takes no space until something writes to it.
const clone = (from, to) => {
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  execFileSync("cp", ["-cR", from, to]);
};
clone(join(source, settings.clippingsFolder ?? "Clippings"), join(vault, settings.clippingsFolder ?? "Clippings"));
clone(
  join(source, settings.attachmentFolder ?? "Attachments/Clippings"),
  join(vault, settings.attachmentFolder ?? "Attachments/Clippings")
);
for (const f of ["app.json", "appearance.json"]) clone(join(source, ".obsidian", f), join(vault, ".obsidian", f));
// The theme and snippets you use, since the wall's styles are matched
// against the whole app's stylesheet on every hover.
clone(join(source, ".obsidian", "themes"), join(vault, ".obsidian", "themes"));
clone(join(source, ".obsidian", "snippets"), join(vault, ".obsidian", "snippets"));
writeFileSync(join(vault, ".obsidian", "community-plugins.json"), JSON.stringify(["oriko"]));
writeFileSync(join(vault, ".obsidian", "core-plugins.json"), JSON.stringify({}));

const plugin = join(vault, ".obsidian", "plugins", "oriko");
for (const f of ["main.js", "manifest.json", "styles.css"]) cpSync(join(root, "dist", f), join(plugin, f));
for (const f of ["cache.json", "steam.json", "x.json"]) clone(join(source, ".obsidian", "plugins", "oriko", f), join(plugin, f));
// Nothing reaches out to the network mid-measurement.
writeFileSync(
  join(plugin, "data.json"),
  JSON.stringify({ ...settings, useResolvers: false, scanPages: false, readImageText: false, panelOpen: false })
);

// The app version you run, if Obsidian has updated itself past the installer.
const appSupport = join(process.env.HOME ?? "", "Library", "Application Support", "obsidian");
if (existsSync(appSupport)) {
  const asars = execFileSync("ls", [appSupport]).toString().split("\n").filter((f) => /^obsidian-.*\.asar$/.test(f));
  for (const a of asars) clone(join(appSupport, a), join(profile, a));
}
writeFileSync(
  join(profile, "obsidian.json"),
  JSON.stringify({ vaults: { orikoperf0000001: { path: vault, ts: Date.now(), open: true } } })
);

/* ------------------------------------------------------------------ */
/* Launch                                                             */
/* ------------------------------------------------------------------ */

const child = spawn(
  binary,
  [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
  ],
  { stdio: "ignore" }
);
const quit = () => {
  if (!child.killed) child.kill("SIGTERM");
};
process.on("exit", quit);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser = null;
for (let i = 0; i < 60 && !browser; i++) {
  await sleep(500);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
}
if (!browser) throw new Error("Obsidian did not open its debugging port");

let page = null;
for (let i = 0; i < 60 && !page; i++) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  page = pages.find((p) => p.url().startsWith("app://obsidian.md/index.html")) ?? null;
  // Restricted mode opens a settings window on a fresh vault; it is not needed.
  for (const p of pages) if (p !== page && p.url() === "about:blank") await p.close().catch(() => {});
  if (!page) await sleep(500);
}
if (!page) throw new Error("no Obsidian window");
// Restricted mode can open its settings window a moment later, too.
for (const c of browser.contexts()) {
  c.on("page", (p) => {
    if (p !== page) p.close().catch(() => {});
  });
}
page.on("pageerror", (err) => console.error("page error:", err.message));
await page.waitForFunction(() => window.app?.workspace?.layoutReady === true, null, { timeout: 60000 });

// Brought up step by step, re-checking everything on each pass: a fresh
// vault asks whether to trust its plugins (this one is a copy of yours with
// Oriko alone in it, so yes), and trusting can reload the window, which
// takes the view and the probe with it.
const probe = readFileSync(join(out, "probe.js"), "utf8");
let ready = null;
let last = null;
for (let i = 0; i < 120 && !ready; i++) {
  last = await page
    .evaluate(async () => {
      const app = window.app;
      if (!app?.workspace?.layoutReady) return { step: "loading" };
      const trust = [...document.querySelectorAll(".modal-container button")].find((b) =>
        /trust author/i.test(b.textContent ?? "")
      );
      if (trust) {
        trust.click();
        return { step: "trusted" };
      }
      if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
      if (!app.plugins.enabledPlugins.has("oriko")) await app.plugins.enablePluginAndSave("oriko");
      if (!app.plugins.plugins.oriko) return { step: "enabling" };
      document.querySelectorAll(".modal-container .modal-close-button").forEach((b) => b.click());
      if (app.workspace.getLeavesOfType("oriko").length === 0) {
        // One size everywhere, so runs on different days compare, and the
        // sidebars closed, as most people browse a wall.
        const win = window.require?.("@electron/remote")?.getCurrentWindow?.();
        win?.setBounds({ x: 40, y: 40, width: 1512, height: 945 });
        win?.webContents?.setBackgroundThrottling?.(false);
        win?.focus?.();
        app.workspace.leftSplit?.collapse?.();
        app.workspace.rightSplit?.collapse?.();
        await app.commands.executeCommandById("oriko:open");
        return { step: "opening" };
      }
      if (!window.__perf) return { step: "probe" };
      if (document.querySelector(".modal-container")) return { step: "modal" };
      if (window.__perf.tileCount() === 0) return { step: "scanning" };
      return { step: "ready", version: app.plugins.plugins.oriko.manifest.version };
    })
    .catch((err) => ({ step: "reloading", error: err.message.split("\n")[0] }));
  if (last.step === "probe") await page.addScriptTag({ content: probe }).catch(() => {});
  if (last.step === "ready") ready = last.version;
  else await sleep(500);
}
if (!ready) throw new Error(`Oriko did not come up in the test window (stuck at ${JSON.stringify(last)})`);
await sleep(1500);
await page.evaluate(() => window.__perf.settle());
await sleep(1500);
for (const p of browser.contexts().flatMap((c) => c.pages())) if (p !== page) await p.close().catch(() => {});
await page.bringToFront();

/* ------------------------------------------------------------------ */
/* Run                                                                */
/* ------------------------------------------------------------------ */

const tiles = await page.evaluate(() => window.__perf.tileCount());
const data = {
  target: "obsidian",
  date: new Date().toISOString(),
  chrome: browser.version(),
  oriko: ready,
  tiles,
  results: {},
};
console.log(`  Oriko ${ready} · ${tiles} tiles on the wall`);
data.results["vault · relayout"] = await measureSync(page);
for (const scenario of SCENARIOS.filter((s) => !args.only || s.name.includes(args.only))) {
  process.stdout.write(`  vault · ${scenario.name} …`);
  data.results[`vault · ${scenario.name}`] = await measure(browser, page, scenario, {
    repeats: args.repeats,
    keepTrace: args.keepTrace ? out : null,
    invalidations: args.invalidations,
  });
  process.stdout.write(" done\n");
}

// Last, so nothing they do can disturb a measurement.
data.checks = { vault: await runChecks(page) };

if (!args.keepOpen) {
  await browser.close().catch(() => {});
  quit();
  await sleep(500);
  rmSync(work, { recursive: true, force: true });
}

const budgets = JSON.parse(readFileSync(join(here, "budgets.json"), "utf8"));
const failures = report({ report: data, budgets, budgetSet: "obsidian", resultsDir, save: args.save, compare: args.compare });
if (failures.length) {
  console.log(`\n${failures.length} budget(s) missed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nAll budgets met.");
