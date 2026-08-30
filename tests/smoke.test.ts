import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/core/settings";

describe("settings", () => {
  it("defaults to the Clippings folder", () => {
    expect(DEFAULT_SETTINGS.clippingsFolder).toBe("Clippings");
  });

  it("caps files at 25MB", () => {
    expect(DEFAULT_SETTINGS.maxBytes).toBe(25 * 1024 * 1024);
  });
});
