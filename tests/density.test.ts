import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE,
  STAGES,
  columnWidthFor,
  expandStage,
  isStage,
  shrinkStage,
  stageLabel,
} from "../src/density";

describe("stages", () => {
  it("run from narrowest to widest column", () => {
    const widths = STAGES.map((stage) => columnWidthFor(stage));
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
  });

  it("keep the default at the width the wall has always used", () => {
    expect(columnWidthFor(DEFAULT_STAGE)).toBe(300);
  });

  it("each carry a label", () => {
    for (const stage of STAGES) expect(stageLabel(stage).length).toBeGreaterThan(0);
  });
});

describe("shrinkStage / expandStage", () => {
  it("step one stage at a time", () => {
    expect(shrinkStage("m")).toBe("s");
    expect(expandStage("m")).toBe("l");
  });

  it("stop at the ends rather than wrapping", () => {
    expect(shrinkStage(STAGES[0])).toBe(STAGES[0]);
    expect(expandStage(STAGES[STAGES.length - 1])).toBe(STAGES[STAGES.length - 1]);
  });
});

describe("isStage", () => {
  it("accepts a stored stage and rejects anything else", () => {
    expect(isStage("xs")).toBe(true);
    expect(isStage("huge")).toBe(false);
    expect(isStage(undefined)).toBe(false);
    expect(isStage(3)).toBe(false);
  });
});

describe("columnWidthFor", () => {
  it("falls back to the default width for an unknown stage", () => {
    expect(columnWidthFor("bogus" as never)).toBe(columnWidthFor(DEFAULT_STAGE));
  });
});
