/**
 * The perf API injected into a real Obsidian window, pointed at the first
 * open Oriko view. Bundled by perf/obsidian.mjs and added as a script tag.
 */
import type { App } from "obsidian";
import type { GridRenderer } from "../src/grid";
import { perfApi } from "./api";

declare const app: App;

function grid(): GridRenderer | null {
  const view = app.workspace.getLeavesOfType("oriko")[0]?.view as unknown as { grid?: GridRenderer } | undefined;
  return view?.grid ?? null;
}

(window as unknown as { __perf: ReturnType<typeof perfApi> }).__perf = perfApi(grid);
