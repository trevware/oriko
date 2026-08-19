import { describe, expect, it } from "vitest";
import { BUCKETS, dateBuckets, isDateProperty, looksLikeDate, todayISO } from "../src/dates";

const NOW = Date.parse("2026-08-19T12:00:00Z");
const daysAgo = (n: number): string =>
  new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

describe("looksLikeDate", () => {
  it("accepts a plain ISO date", () => {
    expect(looksLikeDate("2026-08-19")).toBe(true);
  });

  it("accepts a timestamp", () => {
    expect(looksLikeDate("2026-08-19T09:30:00")).toBe(true);
  });

  it("accepts the RFC 2822 form the Web Clipper writes", () => {
    // Real published values in the reference vault look like this, not ISO.
    expect(looksLikeDate("Fri Aug 07 20:16:19 +0000 2026")).toBe(true);
    expect(looksLikeDate("Mon Aug 17 12:25:47 +0000 2026")).toBe(true);
  });

  it("rejects a bare year, which Date.parse would happily accept", () => {
    expect(looksLikeDate("2026")).toBe(false);
  });

  it("rejects a word, a number and a wikilink", () => {
    expect(looksLikeDate("design")).toBe(false);
    expect(looksLikeDate("2026")).toBe(false);
    expect(looksLikeDate("[[@_Kavsoft]]")).toBe(false);
  });
});

describe("isDateProperty", () => {
  it("is true when most values are dates", () => {
    expect(isDateProperty(["2026-08-19", "2026-08-18", "sometime"])).toBe(true);
  });

  it("is false when most values are not", () => {
    expect(isDateProperty(["design", "ios", "2026-08-19"])).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(isDateProperty([])).toBe(false);
  });
});

describe("dateBuckets", () => {
  it("puts a recent date in every bucket it falls inside, nested", () => {
    expect(dateBuckets(daysAgo(3), NOW)).toEqual([
      "Last 7 days",
      "Last 30 days",
      "Last 90 days",
      "Last year",
    ]);
  });

  it("drops the buckets a date has fallen out of", () => {
    expect(dateBuckets(daysAgo(45), NOW)).toEqual(["Last 90 days", "Last year"]);
  });

  it("calls anything past a year old older", () => {
    expect(dateBuckets(daysAgo(400), NOW)).toEqual(["Older"]);
  });

  it("reads a future date as today, so a timezone boundary cannot strand it", () => {
    expect(dateBuckets(daysAgo(-1), NOW)[0]).toBe("Last 7 days");
  });

  it("buckets an RFC 2822 value the same as an ISO one", () => {
    const iso = new Date(NOW - 3 * 86_400_000);
    expect(dateBuckets(iso.toUTCString(), NOW)).toEqual(dateBuckets(daysAgo(3), NOW));
  });

  it("contributes nothing for a value that is not a date", () => {
    expect(dateBuckets("design", NOW)).toEqual([]);
  });

  it("returns buckets in the order BUCKETS declares, oldest last", () => {
    const order = dateBuckets(daysAgo(1), NOW);
    expect(order).toEqual(BUCKETS.map((b) => b.label));
  });
});

describe("todayISO", () => {
  it("formats a date the way the Web Clipper writes created", () => {
    expect(todayISO(new Date(2026, 7, 19))).toBe("2026-08-19");
  });

  it("pads a single-digit month and day", () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("reads the local calendar, not UTC", () => {
    // toISOString converts first, so late evening east of Greenwich would
    // stamp tomorrow and early morning west of it would stamp yesterday.
    const late = new Date(2026, 7, 19, 23, 30);
    expect(todayISO(late)).toBe("2026-08-19");
  });
});
