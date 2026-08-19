import { describe, expect, it } from "vitest";
import { surveyProperties } from "../src/facet-catalog";
import type { ClippingRecord } from "../src/scan";

function record(properties: Record<string, string[]>): ClippingRecord {
  return {
    path: "a.md",
    title: "",
    source: "",
    description: "",
    categories: [],
    status: "unread",
    created: "",
    cover: "",
    grid: "",
    media: [],
    haystack: "",
    properties,
  };
}

/** Records each carrying `key` with one value drawn from `values`. */
function spread(key: string, values: string[], per = 1): ClippingRecord[] {
  const out: ClippingRecord[] = [];
  for (const value of values) {
    for (let i = 0; i < per; i++) out.push(record({ [key]: [value] }));
  }
  return out;
}

const statOf = (records: ClippingRecord[], key: string) =>
  surveyProperties(records).find((s) => s.key === key);

describe("surveyProperties", () => {
  it("counts notes, occurrences and distinct values", () => {
    const stat = statOf(
      [record({ medium: ["photo", "video"] }), record({ medium: ["photo"] })],
      "medium"
    );
    expect(stat).toMatchObject({ notes: 2, occurrences: 3, distinct: 2 });
  });

  it("suggests a property whose values recur", () => {
    expect(statOf(spread("medium", ["photo", "video"], 4), "medium")?.suggested).toBe(true);
  });

  it("rejects a property with only one distinct value", () => {
    expect(statOf(spread("type", ["clipping"], 10), "type")?.suggested).toBe(false);
  });

  it("rejects a property whose every value is unique", () => {
    const authors = Array.from({ length: 16 }, (_, i) => `author ${i}`);
    expect(statOf(spread("author", authors), "author")?.suggested).toBe(false);
  });

  it("rejects a date-shaped property even when its values repeat heavily", () => {
    // The case that motivates the rule: three clipping days across 36 notes
    // looks like an ideal facet by repetition alone, and is useless.
    const dates = ["2026-08-17", "2026-08-18", "2026-08-19"];
    expect(statOf(spread("created", dates, 12), "created")?.suggested).toBe(false);
  });

  it("rejects a timestamped date property too", () => {
    const stamps = ["2026-08-17T09:00:00", "2026-08-18T11:30:00"];
    expect(statOf(spread("logged", stamps, 12), "logged")?.suggested).toBe(false);
  });

  it("never suggests a reserved key", () => {
    expect(statOf(spread("source", ["a.com", "b.com"], 4), "source")?.suggested).toBe(false);
  });

  it("still reports an unsuggested key, since the settings list offers it", () => {
    const authors = Array.from({ length: 16 }, (_, i) => `author ${i}`);
    expect(statOf(spread("author", authors), "author")).toBeDefined();
  });

  it("rejects a property with too many distinct values", () => {
    const many = Array.from({ length: 60 }, (_, i) => `v${i}`);
    expect(statOf(spread("id", many, 3), "id")?.suggested).toBe(false);
  });

  it("orders suggested keys first, then by how many notes carry them", () => {
    const records = [
      ...spread("medium", ["photo", "video"], 4),
      ...spread("type", ["clipping"], 20),
    ];
    const keys = surveyProperties(records).map((s) => s.key);
    expect(keys[0]).toBe("medium");
  });
});
