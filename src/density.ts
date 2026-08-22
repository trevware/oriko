/**
 * How densely the wall is packed: a handful of named stages, each a target
 * column width the layout tries to fit. The smaller the column, the more of
 * the wall fits on screen at once, which is what a pane docked in a sidebar
 * needs.
 *
 * This is deliberately not the camera zoom. Zooming leaves the columns where
 * they are and scales the picture, so zooming out only reveals empty space
 * either side of the wall; a stage reflows it into more, narrower columns.
 *
 * Pure: no Obsidian imports, so it tests.
 */

export type DensityStage = "xs" | "s" | "m" | "l" | "xl";

/** Narrowest first. Order is what shrink and expand step along. */
export const STAGES: readonly DensityStage[] = ["xs", "s", "m", "l", "xl"];

/** The width the wall had before there were stages. */
export const DEFAULT_STAGE: DensityStage = "m";

const COLUMN_WIDTH: Record<DensityStage, number> = {
  xs: 120,
  s: 200,
  m: 300,
  l: 420,
  xl: 600,
};

const LABEL: Record<DensityStage, string> = {
  xs: "Tiny",
  s: "Small",
  m: "Medium",
  l: "Large",
  xl: "Huge",
};

export function isStage(value: unknown): value is DensityStage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

/** Target column width in pixels. An unknown stage gets the default, so a
    stale or hand-edited setting degrades to today's wall rather than to
    nothing. */
export function columnWidthFor(stage: DensityStage): number {
  return COLUMN_WIDTH[stage] ?? COLUMN_WIDTH[DEFAULT_STAGE];
}

export function stageLabel(stage: DensityStage): string {
  return LABEL[stage] ?? LABEL[DEFAULT_STAGE];
}

/** One stage narrower, or the same stage at the narrow end. */
export function shrinkStage(stage: DensityStage): DensityStage {
  const index = STAGES.indexOf(stage);
  return STAGES[Math.max(0, index - 1)] ?? DEFAULT_STAGE;
}

/** One stage wider, or the same stage at the wide end. */
export function expandStage(stage: DensityStage): DensityStage {
  const index = STAGES.indexOf(stage);
  return STAGES[Math.min(STAGES.length - 1, index + 1)] ?? DEFAULT_STAGE;
}
