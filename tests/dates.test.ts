import { describe, expect, it } from "vitest";
import {
  BUCKETS,
  dateBuckets,
  dateTokenMatches,
  isDateProperty,
  looksLikeDate,
  todayISO,
  tokenLabel,
  windowLabel,
} from "../src/dates";

// Built locally, not from a UTC string: these assert on windows measured from
// local midnight, so a UTC clock would make them pass or fail by timezone.
const NOW = new Date(2026, 7, 19, 12, 0, 0).getTime();
const daysAgo = (n: number): string => {
  const d = new Date(NOW - n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
    expect(dateBuckets(daysAgo(-1), NOW)[0]).toBe("Today");
  });

  it("buckets an RFC 2822 value the same as an ISO one", () => {
    const iso = new Date(NOW - 3 * 86_400_000);
    expect(dateBuckets(iso.toUTCString(), NOW)).toEqual(dateBuckets(daysAgo(3), NOW));
  });

  it("contributes nothing for a value that is not a date", () => {
    expect(dateBuckets("design", NOW)).toEqual([]);
  });

  it("returns buckets in the order BUCKETS declares, oldest last", () => {
    expect(dateBuckets(daysAgo(0), NOW)).toEqual(BUCKETS.map((b) => b.label));
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

describe("windowLabel", () => {
  it("names a window in the units it was given", () => {
    expect(windowLabel({ amount: 14, unit: "day" })).toBe("Last 14 days");
    expect(windowLabel({ amount: 6, unit: "month" })).toBe("Last 6 months");
  });

  it("does not pluralise one", () => {
    expect(windowLabel({ amount: 1, unit: "week" })).toBe("Last 1 week");
  });
});

describe("dateBuckets with the built-in windows", () => {
  // A Wednesday, so "this week" is a partial week and distinguishable from
  // the rolling seven days.
  const WED = new Date(2026, 7, 19, 12, 0, 0).getTime();
  const at = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const ago = (days: number): string => at(new Date(WED - days * 86_400_000));

  it("puts today in every window", () => {
    expect(dateBuckets(ago(0), WED)).toEqual([
      "Today",
      "This week",
      "Last 7 days",
      "Last 30 days",
      "Last 90 days",
      "Last year",
    ]);
  });

  it("drops today once the date is yesterday", () => {
    expect(dateBuckets(ago(1), WED)[0]).toBe("This week");
  });

  it("drops this week for a date before the week began", () => {
    // Wednesday minus four days is the Saturday before, a different week.
    expect(dateBuckets(ago(4), WED)[0]).toBe("Last 7 days");
  });

  it("still calls anything past a year old older", () => {
    expect(dateBuckets(ago(400), WED)).toEqual(["Older"]);
  });
});

describe("dateBuckets with a custom window", () => {
  const NOW = new Date(2026, 7, 19, 12, 0, 0).getTime();
  const ago = (days: number): string => {
    const d = new Date(NOW - days * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("offers the window, ordered by how far back it reaches", () => {
    const windows = [{ amount: 14, unit: "day" as const }];
    expect(dateBuckets(ago(10), NOW, windows)).toEqual([
      "Last 14 days",
      "Last 30 days",
      "Last 90 days",
      "Last year",
    ]);
  });

  it("ignores one that duplicates a built-in", () => {
    const windows = [{ amount: 30, unit: "day" as const }];
    expect(dateBuckets(ago(10), NOW, windows).filter((l) => l === "Last 30 days")).toHaveLength(1);
  });
});

describe("date tokens", () => {
  const NOW = Date.parse("2026-08-19T12:00:00Z");

  it("matches a value before a cutoff", () => {
    expect(dateTokenMatches("before:2026-08-19", ["2026-08-18"], NOW)).toBe(true);
    expect(dateTokenMatches("before:2026-08-19", ["2026-08-19"], NOW)).toBe(false);
  });

  it("takes on or after as inclusive of the day named", () => {
    expect(dateTokenMatches("since:2026-08-19", ["2026-08-19"], NOW)).toBe(true);
    expect(dateTokenMatches("since:2026-08-19", ["2026-08-18"], NOW)).toBe(false);
  });

  it("knows an absent value from one that is there", () => {
    expect(dateTokenMatches("empty", [], NOW)).toBe(true);
    expect(dateTokenMatches("empty", ["2026-08-19"], NOW)).toBe(false);
  });

  it("is not a token at all for a bucket label", () => {
    expect(dateTokenMatches("Last 7 days", ["2026-08-19"], NOW)).toBe(null);
  });

  it("reads a token back as words", () => {
    expect(tokenLabel("before:2026-08-19")).toBe("Before 2026-08-19");
    expect(tokenLabel("since:2026-08-19")).toBe("On or after 2026-08-19");
    expect(tokenLabel("empty")).toBe("Is empty");
  });
});
