/**
 * Reading dates out of frontmatter, and grouping them into the buckets a
 * filter can offer.
 *
 * Pure, no DOM and no Obsidian. Shared by filter.ts, which buckets values, and
 * facet-catalog.ts, which uses the same test to decide a property is a date.
 *
 * Filtering a date by equality is useless: a clipping wall has as many exact
 * dates as it has clipping days, so `created` offers a list nobody wants to
 * pick from. Buckets are what people actually mean by filtering on a date, and
 * they need no new machinery: a date value simply expands to several values,
 * which categories already do, so counting, toggling and any-within-a-facet all
 * keep working untouched.
 */

const DAY = 86_400_000;

/** Nested, not partitioned, the way Finder and mail clients group by date. A
    date belongs to every bucket it still falls inside, so counts are
    cumulative and picking two buckets simply widens to the larger. */
export const BUCKETS: ReadonlyArray<{ label: string; within: number }> = [
  { label: "Last 7 days", within: 7 * DAY },
  { label: "Last 30 days", within: 30 * DAY },
  { label: "Last 90 days", within: 90 * DAY },
  { label: "Last year", within: 365 * DAY },
];

/** Everything that has fallen out of every bucket above. */
export const OLDER = "Older";

/** Every bucket label, newest first, which is the order a menu lists them in. */
export const BUCKET_LABELS: string[] = [...BUCKETS.map((b) => b.label), OLDER];

/**
 * An ISO date, with or without a time.
 *
 * Deliberately not Date.parse alone, which accepts a bare year: "2026" parses
 * to a valid date, so a property holding years would be mistaken for one
 * holding dates and bucketed into nonsense.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

/**
 * The RFC 2822 form, which is what the Web Clipper actually writes into
 * `published`: "Fri Aug 07 20:16:19 +0000 2026". Matching only ISO left that
 * property typed as text, so its submenu listed sixteen raw timestamps, which
 * is precisely the list bucketing exists to avoid.
 */
const RFC_2822 =
  /^[A-Z][a-z]{2},? [A-Z][a-z]{2} \d{1,2}|^[A-Z][a-z]{2},? \d{1,2} [A-Z][a-z]{2}/;

export function looksLikeDate(value: string): boolean {
  if (!ISO_DATE.test(value) && !RFC_2822.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * Whether a property holds dates, judged on its values rather than its name,
 * so a user's own `reviewed:` is caught and a key that happens to be called
 * `updated` while holding real categories is not.
 */
export function isDateProperty(values: Iterable<string>): boolean {
  let dates = 0;
  let total = 0;
  for (const value of values) {
    total++;
    if (looksLikeDate(value)) dates++;
  }
  return total > 0 && dates * 2 > total;
}

/**
 * The buckets a date value belongs to, in BUCKETS order. Empty for a value
 * that is not a date at all, which contributes nothing rather than inventing
 * a group for it.
 */
export function dateBuckets(value: string, now: number): string[] {
  if (!looksLikeDate(value)) return [];
  const at = Date.parse(value);
  if (Number.isNaN(at)) return [];

  // A date-only value is parsed at UTC midnight while `now` is local, so a
  // clipping made today can read as slightly in the future. Clamping to zero
  // keeps it in the newest bucket instead of stranding it in Older.
  const age = Math.max(0, now - at);

  const labels = BUCKETS.filter((bucket) => age < bucket.within).map((b) => b.label);
  return labels.length > 0 ? labels : [OLDER];
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Today as an ISO date, matching what the Web Clipper writes to `created`.
 *
 * Built from the local calendar rather than toISOString, which converts to UTC
 * first and so stamps tomorrow's date for anyone east of Greenwich in the
 * evening, and yesterday's for anyone west of it in the morning.
 */
export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
