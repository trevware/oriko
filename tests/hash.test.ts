import { describe, expect, it } from "vitest";
import { hashUrl } from "../src/core/hash";

describe("hashUrl", () => {
  it("returns 12 lowercase hex characters", () => {
    expect(hashUrl("https://example.com/a.jpg")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is stable across calls", () => {
    const a = hashUrl("https://example.com/a.jpg");
    const b = hashUrl("https://example.com/a.jpg");
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    expect(hashUrl("https://example.com/a.jpg")).not.toBe(hashUrl("https://example.com/b.jpg"));
  });

  it("has no collisions across ten thousand generated urls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10000; i++) seen.add(hashUrl(`https://example.com/img-${i}.jpg`));
    expect(seen.size).toBe(10000);
  });

  it("has no collisions across the real clipping url shapes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      seen.add(hashUrl(`https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-indie-roguelike-city-builder-${i}.jpg`));
      seen.add(hashUrl(`https://pbs.twimg.com/media/HP4hnHEa8AAwvW${i}`));
    }
    expect(seen.size).toBe(4000);
  });
});
