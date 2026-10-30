import { describe, expect, it } from "vitest";
import { SwitchingEngine, effectiveEngine, engineBlocker, engineReady } from "../src/core/engines";
import type { DescribeEngine } from "../src/core/describe-run";

const fake = (name: string, log: string[]): DescribeEngine => ({
  run: async () => {
    log.push(`run:${name}`);
    return { ok: true, results: [] };
  },
  cancelAll: () => log.push(`cancel:${name}`),
});

describe("effectiveEngine", () => {
  it("keeps the engine the user chose", () => {
    expect(effectiveEngine("api-key", true)).toBe("api-key");
    expect(effectiveEngine("claude-code", false)).toBe("claude-code");
  });

  it("starts on Claude Code when it is installed, otherwise the API key", () => {
    expect(effectiveEngine("", true)).toBe("claude-code");
    expect(effectiveEngine("", false)).toBe("api-key");
  });
});

describe("engineReady", () => {
  const base = { enabled: true, desktop: true, claudeFound: true, hasKey: false, hasLicense: false };

  it("offers Describe once the chosen engine can run", () => {
    expect(engineReady({ ...base, engine: "claude-code" })).toBe(true);
    expect(engineReady({ ...base, engine: "api-key" })).toBe(false);
    expect(engineReady({ ...base, engine: "api-key", hasKey: true })).toBe(true);
    expect(engineReady({ ...base, engine: "claude-code", claudeFound: false })).toBe(false);
  });

  it("offers Power-Up once a license key is saved", () => {
    expect(engineReady({ ...base, engine: "oriko-plus" })).toBe(false);
    expect(engineReady({ ...base, engine: "oriko-plus", hasLicense: true })).toBe(true);
  });

  it("stays off when switched off or away from the desktop", () => {
    expect(engineReady({ ...base, engine: "claude-code", enabled: false })).toBe(false);
    expect(engineReady({ ...base, engine: "claude-code", desktop: false })).toBe(false);
  });
});

describe("engineBlocker", () => {
  const base = { enabled: true, desktop: true, claudeFound: true, hasKey: false, hasLicense: false };

  it("says nothing once the engine can run, or while Describe is off or away from the desktop", () => {
    expect(engineBlocker({ ...base, engine: "claude-code" })).toBeNull();
    expect(engineBlocker({ ...base, engine: "oriko-plus", hasLicense: true })).toBeNull();
    expect(engineBlocker({ ...base, engine: "oriko-plus", enabled: false })).toBeNull();
    expect(engineBlocker({ ...base, engine: "oriko-plus", desktop: false })).toBeNull();
  });

  it("names what each engine is missing and where to put it", () => {
    expect(engineBlocker({ ...base, engine: "claude-code", claudeFound: false })).toEqual({
      label: "Describe can't find Claude Code",
      hint: "Set Claude Code path under Settings → Oriko, or pick another engine.",
    });
    expect(engineBlocker({ ...base, engine: "api-key" })).toEqual({
      label: "Describe needs an API key",
      hint: "Paste it under Settings → Oriko → Anthropic API key, or pick another engine.",
    });
    expect(engineBlocker({ ...base, engine: "oriko-plus" })).toEqual({
      label: "Describe needs a license key",
      hint: "Paste it under Settings → Oriko → License key, or pick another engine.",
    });
  });
});

describe("SwitchingEngine", () => {
  it("runs each batch on the engine chosen at that moment", async () => {
    const log: string[] = [];
    let choice: "claude-code" | "api-key" | "oriko-plus" = "claude-code";
    const engine = new SwitchingEngine(
      { "claude-code": fake("cc", log), "api-key": fake("api", log), "oriko-plus": fake("plus", log) },
      () => choice
    );
    await engine.run([], [], 1000, "standard");
    choice = "api-key";
    await engine.run([], [], 1000, "standard");
    choice = "oriko-plus";
    await engine.run([], [], 1000, "standard");
    expect(log).toEqual(["run:cc", "run:api", "run:plus"]);
  });

  it("cancels every engine", () => {
    const log: string[] = [];
    const engine = new SwitchingEngine(
      { "claude-code": fake("cc", log), "api-key": fake("api", log), "oriko-plus": fake("plus", log) },
      () => "api-key"
    );
    engine.cancelAll();
    expect(log).toEqual(["cancel:cc", "cancel:api", "cancel:plus"]);
  });
});
