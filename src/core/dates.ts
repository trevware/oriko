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

/** Local midnight, which is what a person means by the start of a day. */
function startOfDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Monday: a week that starts on Sunday puts a weekend either side of the
    boundary, and a clipping wall is mostly weekday work. */
function startOfWeek(now: number): number {
  const d = new Date(startOfDay(now));
  return d.getTime() - ((d.getDay() + 6) % 7) * DAY;
}

export interface Bucket {
  label: string;
  /** The instant this window opens, given now. */
  since: (now: number) => number;
}

/**
 * Nested, not partitioned, the way Finder and mail clients group by date. A
 * date belongs to every window it still falls inside, so counts are cumulative
 * and picking two widens to the larger. Narrowest first, which is how they
 * read.
 */
export const BUCKETS: ReadonlyArray<Bucket> = [
  { label: "Today", since: startOfDay },
  { label: "This week", since: startOfWeek },
  { label: "Last 7 days", since: (now) => now - 7 * DAY },
  { label: "Last 30 days", since: (now) => now - 30 * DAY },
  { label: "Last 90 days", since: (now) => now - 90 * DAY },
  { label: "Last year", since: (now) => now - 365 * DAY },
];

/** Everything that has fallen out of every window above. */
export const OLDER = "Older";

/** Every window label, narrowest first, then Older. */
export function bucketLabels(): string[] {
  return [...BUCKETS.map((bucket) => bucket.label), OLDER];
}

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
 * The windows a date value belongs to, narrowest first. Empty for a value that
 * is not a date at all, which contributes nothing rather than inventing a
 * group for it.
 */
export function dateBuckets(value: string, now: number): string[] {
  if (!looksLikeDate(value)) return [];
  const at = parseDate(value);
  if (Number.isNaN(at)) return [];

  // A date-only value is parsed at UTC midnight while `now` is local, so a
  // clipping made today can read as slightly in the future. Clamping keeps it
  // in the newest window instead of stranding it in Older.
  const when = Math.min(at, now);

  const labels = BUCKETS.filter((bucket) => when >= bucket.since(now)).map(
    (bucket) => bucket.label
  );
  return labels.length > 0 ? labels : [OLDER];
}

/**
 * The filters a date facet carries that are not windows.
 *
 * Encoded as strings so filter state stays a list of chosen values and needs
 * no second shape for predicates: `before:2020-01-01`, `since:2020-01-01`,
 * `empty`.
 */
const TOKEN = /^(before|since):(\d{4}-\d{2}-\d{2})$/;

/** Bare date, no time. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * When a value happened, in local time.
 *
 * A bare `2026-08-19` is parsed by Date.parse as UTC midnight, which is the
 * previous evening for everyone west of Greenwich: the day a clipping was made
 * would fall outside Today for half the world. A date with no time means that
 * calendar day where the reader is, so it is built locally.
 */
export function parseDate(value: string): number {
  const parts = DATE_ONLY.exec(value);
  if (parts) {
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).getTime();
  }
  return Date.parse(value);
}

export function isDateToken(value: string): boolean {
  return value === "empty" || TOKEN.test(value);
}

/**
 * True or false when the value is a token, and null when it is an ordinary
 * window label, where plain membership decides instead.
 */
export function dateTokenMatches(value: string, held: string[], now: number): boolean | null {
  if (value === "empty") return held.length === 0;

  const parts = TOKEN.exec(value);
  if (!parts) return null;

  const cutoff = parseDate(parts[2]);
  if (Number.isNaN(cutoff)) return false;

  return held.some((entry) => {
    if (!looksLikeDate(entry)) return false;
    const at = parseDate(entry);
    if (Number.isNaN(at)) return false;
    // On or after includes the day named and before excludes it, so the pair
    // covers every date exactly once with no gap and no overlap.
    return parts[1] === "before" ? at < cutoff : at >= cutoff;
  });
}

export function tokenLabel(value: string): string {
  if (value === "empty") return "Is empty";
  const parts = TOKEN.exec(value);
  if (!parts) return value;
  return parts[1] === "before" ? `Before ${parts[2]}` : `On or after ${parts[2]}`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * A date as ISO, matching what the Web Clipper writes to `created`.
 *
 * Built from the local calendar rather than toISOString, which converts to UTC
 * first and so stamps tomorrow's date for anyone east of Greenwich in the
 * evening, and yesterday's for anyone west of it in the morning.
 *
 * @param now injectable so the format is testable without a fixed clock.
 */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
