import { decodeEntities } from "./page-cover";
import type { ClippingRecord } from "./scan";

/**
 * Steam's look: a clipping of a store page drawn as a store card on the wall
 * and as a store page in the detail view.
 *
 * Everything the card says comes from Steam's public store API, asked by the
 * device rather than written into the note, so a Web Clipper clipping and one
 * Oriko made itself look the same, and the price can move without anything
 * editing the note. The art is a snapshot: archived once into the vault under
 * a folder named for the game, so every device shows the same pictures and
 * they outlive the store page. Price and release status are the live part,
 * kept per device and asked again once a day.
 */

export interface SteamPrice {
  currency: string;
  /** In the currency's minor unit, as Steam reports it. */
  initial: number;
  final: number;
  discountPercent: number;
  /** Steam's own rendering, "CDN$ 32.50". Empty when it sent none. */
  initialText: string;
  finalText: string;
}

export interface SteamScreenshot {
  thumb: string;
  full: string;
}

export interface SteamTrailer {
  thumb: string;
  /** HLS master playlist, which iOS plays natively and desktop Chromium does not. */
  hls: string;
}

export interface SteamApp {
  id: string;
  name: string;
  description: string;
  developers: string[];
  publishers: string[];
  genres: string[];
  isFree: boolean;
  price: SteamPrice | null;
  comingSoon: boolean;
  /** Steam's free text: "17 Sep, 2020", "Coming soon", "Q1 2027". */
  releaseDate: string;
  platforms: { windows: boolean; mac: boolean; linux: boolean };
  header: string;
  background: string;
  screenshots: SteamScreenshot[];
  trailers: SteamTrailer[];
}

const STORE_HOSTS = new Set(["store.steampowered.com"]);
/** /app/123, and the age gate's /agecheck/app/123 that a mature page redirects to. */
const APP_PATH = /^\/(?:agecheck\/)?app\/(\d+)(?:\/|$)/;

/** The app id behind a store page URL, or null for anything else. */
export function steamAppId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (!STORE_HOSTS.has(host)) return null;
  return APP_PATH.exec(parsed.pathname)?.[1] ?? null;
}

/**
 * The store API for one app, priced for a country.
 *
 * The country is always sent. Left out, Steam is meant to price for wherever
 * the request comes from, but its answers are cached at the edge without
 * regard to that, and a Canadian wall came back in Korean won.
 */
export function appDetailsUrl(id: string, region: string): string {
  return `https://store.steampowered.com/api/appdetails?appids=${id}&cc=${region.toLowerCase()}&l=english`;
}

/** Where a region is assumed when nothing says otherwise, as Steam itself does. */
export const FALLBACK_REGION = "US";

/**
 * The country to price in, from the locales the system reports, in order of
 * preference: the first one that names a region ("en-CA"), else the region
 * the first language implies ("fr" is France), else the US.
 *
 * @param maximize Intl.Locale's maximize, passed in so the guess can be
 * tested without depending on the runtime's locale data.
 */
export function regionFromLocales(
  locales: readonly string[],
  maximize: (tag: string) => string | undefined = (tag) => new Intl.Locale(tag).maximize().region
): string {
  const valid = (region: string | undefined): region is string =>
    typeof region === "string" && /^[A-Z]{2}$/.test(region);
  for (const tag of locales) {
    try {
      const region = new Intl.Locale(tag.replace(/_/g, "-")).region;
      if (valid(region)) return region;
    } catch {
      // Not a locale; the next one may be.
    }
  }
  for (const tag of locales) {
    try {
      const region = maximize(tag.replace(/_/g, "-"));
      if (valid(region)) return region;
    } catch {
      // As above.
    }
  }
  return FALLBACK_REGION;
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function descriptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(obj(item)?.description)).filter(Boolean);
}

function parsePrice(value: unknown): SteamPrice | null {
  const raw = obj(value);
  if (!raw) return null;
  const finalText = text(raw.final_formatted);
  if (!finalText) return null;
  return {
    currency: text(raw.currency),
    initial: num(raw.initial),
    final: num(raw.final),
    discountPercent: num(raw.discount_percent),
    initialText: text(raw.initial_formatted),
    finalText,
  };
}

/**
 * One app out of an appdetails response, or null when Steam said no: an id
 * that does not exist, or one withheld in the requester's region, both
 * answer `success: false`.
 */
export function parseAppDetails(json: unknown, id: string): SteamApp | null {
  const entry = obj(obj(json)?.[id]);
  if (!entry || entry.success !== true) return null;
  const data = obj(entry.data);
  if (!data) return null;

  const name = text(data.name);
  if (!name) return null;

  const release = obj(data.release_date);
  const platforms = obj(data.platforms);

  const screenshots: SteamScreenshot[] = [];
  for (const item of Array.isArray(data.screenshots) ? data.screenshots : []) {
    const shot = obj(item);
    const full = text(shot?.path_full);
    if (full) screenshots.push({ full, thumb: text(shot?.path_thumbnail) || full });
  }

  const trailers: SteamTrailer[] = [];
  for (const item of Array.isArray(data.movies) ? data.movies : []) {
    const movie = obj(item);
    const hls = text(movie?.hls_h264);
    if (hls) trailers.push({ hls, thumb: text(movie?.thumbnail) });
  }

  return {
    id,
    name,
    description: decodeEntities(text(data.short_description)),
    developers: texts(data.developers),
    publishers: texts(data.publishers),
    genres: descriptions(data.genres),
    isFree: data.is_free === true,
    price: parsePrice(data.price_overview),
    comingSoon: release?.coming_soon === true,
    releaseDate: text(release?.date),
    platforms: {
      windows: platforms?.windows === true,
      mac: platforms?.mac === true,
      linux: platforms?.linux === true,
    },
    header: text(data.header_image),
    background: text(data.background_raw) || text(data.background),
    screenshots,
    trailers,
  };
}

/** What the price corner of a card says. */
export interface PriceTag {
  /** "-75%", or empty when nothing is off. */
  discount: string;
  /** The struck-through price, shown only beside a discount. */
  original: string;
  /** The price you would pay, "Free to Play", or the release status. */
  final: string;
}

/**
 * The card's price corner, the way the store lays it out: a discount box and
 * the old price struck through beside the new one, or just the price.
 *
 * A game that is not out yet says so here rather than showing a price Steam
 * will not sell it for, because "when can I play it" is the question a
 * wishlist card is being asked. A free game that is not out yet says that
 * too: "Free to Play" on something you cannot play reads as a mistake.
 *
 * @param releaseInCorner off where the release date has a row of its own,
 * as in the detail view, so the corner keeps to what the game costs.
 */
export function priceTag(app: SteamApp, releaseInCorner = true): PriceTag | null {
  if (app.comingSoon && releaseInCorner) {
    return { discount: "", original: "", final: app.releaseDate || "Coming soon" };
  }
  if (app.isFree) return { discount: "", original: "", final: "Free to Play" };
  const price = app.price;
  if (!price) return null;
  if (price.discountPercent > 0 && price.initialText) {
    return {
      discount: `-${price.discountPercent}%`,
      original: price.initialText,
      final: price.finalText,
    };
  }
  return { discount: "", original: "", final: price.finalText };
}

/** The platforms row, in the order the store lists them. */
export function platformNames(app: SteamApp): string[] {
  const names: string[] = [];
  if (app.platforms.windows) names.push("Windows");
  if (app.platforms.mac) names.push("macOS");
  if (app.platforms.linux) names.push("Linux");
  return names;
}

/* ------------------------------------------------------------------ */
/* Snapshot art, archived under one folder per game                   */
/* ------------------------------------------------------------------ */

/**
 * Where one game's archived art lives.
 *
 * A folder of its own rather than the flat, hash-named archive the rest of
 * the media goes into, for two reasons. Its names can be worked out from the
 * app id alone, so a device that has not asked Steam yet still finds the
 * pictures another device saved. And the orphan sweep only ever considers
 * hash-named files, so nothing here is mistaken for debris on a device that
 * has not looked the game up: the folder goes when the last clipping of that
 * game does, and not before.
 */
export function steamFolder(attachmentFolder: string, id: string): string {
  return `${attachmentFolder}/Steam/${id}`;
}

/** The app id a path inside a game's folder belongs to, or null. */
export function steamIdOfPath(attachmentFolder: string, path: string): string | null {
  const prefix = `${attachmentFolder}/Steam/`;
  if (!path.startsWith(prefix)) return null;
  const id = path.slice(prefix.length).split("/")[0] ?? "";
  return /^\d+$/.test(id) ? id : null;
}

export interface SteamFile {
  url: string;
  path: string;
}

const SCREENSHOT_NAME = /^(ss_[0-9a-f]+)\./i;

/**
 * A screenshot's archived name. Steam names screenshots by their content
 * hash, so the name is kept: a game that swaps a screenshot gets a new file
 * rather than having its old one silently stand in for the new.
 */
export function screenshotFile(folder: string, url: string, index: number): string {
  let base = "";
  try {
    base = new URL(url).pathname.split("/").pop() ?? "";
  } catch {
    base = "";
  }
  const named = SCREENSHOT_NAME.exec(base)?.[1];
  return `${folder}/${named ?? `ss_${String(index + 1).padStart(2, "0")}`}.jpg`;
}

/**
 * Every picture worth keeping for one game, and where each goes.
 *
 * The header and the backdrop keep fixed names, so they are a snapshot: the
 * first art saved is the art the card keeps, even if the developer changes it
 * later. That is what a clipping is.
 */
export function steamFiles(app: SteamApp, attachmentFolder: string): SteamFile[] {
  const folder = steamFolder(attachmentFolder, app.id);
  const files: SteamFile[] = [];
  if (app.header) files.push({ url: app.header, path: `${folder}/header.jpg` });
  if (app.background) files.push({ url: app.background, path: `${folder}/background.jpg` });
  app.screenshots.forEach((shot, index) => {
    files.push({ url: shot.full, path: screenshotFile(folder, shot.full, index) });
  });
  return files;
}

/* ------------------------------------------------------------------ */
/* What gets deleted with a game                                      */
/* ------------------------------------------------------------------ */

function idsOf(records: readonly ClippingRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    const id = steamAppId(record.source);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Games whose last clipping is among the ones going, so their art goes too.
 * Two clippings of one store page share the folder, as two clippings of one
 * image share its file.
 */
export function steamIdsLeftBehind(
  going: readonly ClippingRecord[],
  surviving: readonly ClippingRecord[]
): string[] {
  const kept = idsOf(surviving);
  return [...idsOf(going)].filter((id) => !kept.has(id));
}

/** Files in game folders that no clipping points at any more. */
export function steamOrphanFiles(
  records: readonly ClippingRecord[],
  onDisk: readonly string[],
  attachmentFolder: string
): string[] {
  const kept = idsOf(records);
  return onDisk.filter((path) => {
    const id = steamIdOfPath(attachmentFolder, path);
    return id !== null && !kept.has(id);
  });
}

/* ------------------------------------------------------------------ */
/* The per-device store                                               */
/* ------------------------------------------------------------------ */

export interface SteamEntry {
  fetchedAt: number;
  /** The country the price was asked for. A different one is asked again. */
  region?: string;
  app?: SteamApp;
  /** Why the last ask failed, so a dead id is not asked about on every pass. */
  failed?: string;
}

/** How long a price is believed before Steam is asked again. */
export const STEAM_FRESH_MS = 24 * 60 * 60 * 1000;
/** A failed ask is retried sooner: it is usually the network, not the game. */
export const STEAM_RETRY_MS = 6 * 60 * 60 * 1000;

/**
 * What this device last heard from Steam, by app id.
 *
 * Rebuildable, like the media cache: deleting it costs one round of asking
 * Steam again, and the art is in the vault regardless.
 */
export class SteamStore {
  private entries = new Map<string, SteamEntry>();

  get(id: string): SteamEntry | undefined {
    return this.entries.get(id);
  }

  app(id: string): SteamApp | undefined {
    return this.entries.get(id)?.app;
  }

  /**
   * Records an answer. A failure keeps the app that was there: a store page
   * that cannot be reached today still has yesterday's card.
   */
  set(id: string, now: number, app: SteamApp | null, failed = "", region = ""): void {
    const previous = this.entries.get(id);
    const entry: SteamEntry = { fetchedAt: now };
    if (region) entry.region = region;
    const kept = app ?? previous?.app;
    if (kept) entry.app = kept;
    if (!app && failed) entry.failed = failed;
    this.entries.set(id, entry);
  }

  /**
   * Whether Steam is due to be asked about this id: never asked, asked for
   * another country, or asked long enough ago.
   */
  isDue(id: string, now: number, region = ""): boolean {
    const entry = this.entries.get(id);
    if (!entry) return true;
    if (region && entry.region !== region) return true;
    const wait = entry.failed ? STEAM_RETRY_MS : STEAM_FRESH_MS;
    return now - entry.fetchedAt >= wait;
  }

  toJSON(): { version: number; apps: Record<string, SteamEntry> } {
    return { version: 1, apps: Object.fromEntries(this.entries) };
  }

  static fromJSON(data: unknown): SteamStore {
    const store = new SteamStore();
    const apps = obj(obj(data)?.apps);
    if (!apps) return store;
    for (const [id, raw] of Object.entries(apps)) {
      const entry = obj(raw);
      if (!entry || typeof entry.fetchedAt !== "number" || !/^\d+$/.test(id)) continue;
      const app = obj(entry.app);
      // Only an app shaped like one survives a load, so a hand edit or an
      // older format cannot leave a card with no name to draw.
      store.entries.set(id, {
        fetchedAt: entry.fetchedAt,
        ...(typeof entry.region === "string" ? { region: entry.region } : {}),
        ...(app && typeof app.name === "string" && Array.isArray(app.screenshots)
          ? { app: app as unknown as SteamApp }
          : {}),
        ...(typeof entry.failed === "string" ? { failed: entry.failed } : {}),
      });
    }
    return store;
  }
}

/* ------------------------------------------------------------------ */
/* The look a tile is drawn with                                      */
/* ------------------------------------------------------------------ */

/** A local file when one has been saved, otherwise Steam's own URL. */
export interface SteamAsset {
  path: string;
  remote: boolean;
}

export interface SteamLook {
  app: SteamApp;
  header: SteamAsset;
  background: SteamAsset | null;
  screenshots: Array<{ full: SteamAsset; thumb: SteamAsset }>;
  /** The trailer yt-dlp saved, if any, as a vault path. */
  trailerFile: string;
  /** Changes whenever the card must be drawn again. */
  stamp: string;
}

/**
 * Puts together what a card and the detail view draw from: the app, and for
 * each picture the saved copy where there is one.
 *
 * @param exists asked per path, so this stays free of the vault.
 */
export function steamLook(
  app: SteamApp,
  fetchedAt: number,
  attachmentFolder: string,
  exists: (path: string) => boolean,
  trailerFile: string
): SteamLook {
  const folder = steamFolder(attachmentFolder, app.id);
  const asset = (path: string, url: string): SteamAsset =>
    exists(path) ? { path, remote: false } : { path: url, remote: true };

  const header = asset(`${folder}/header.jpg`, app.header);
  const background = app.background ? asset(`${folder}/background.jpg`, app.background) : null;
  const screenshots = app.screenshots.map((shot, index) => {
    const full = asset(screenshotFile(folder, shot.full, index), shot.full);
    // The saved full-size copy is local and already decoded faster than a
    // remote thumbnail would arrive, so it serves as its own thumbnail.
    return { full, thumb: full.remote ? { path: shot.thumb, remote: true } : full };
  });

  const local = [header, background, ...screenshots.map((s) => s.full)].filter(
    (a): a is SteamAsset => a !== null && !a.remote
  ).length;

  return {
    app,
    header,
    background,
    screenshots,
    trailerFile,
    stamp: `${fetchedAt}|${local}|${header.remote ? "r" : "l"}|${trailerFile}`,
  };
}

/**
 * How tall a store card's band of details is, for a wall laid out to this
 * column width.
 *
 * None at the tightest stage, which exists to show more pictures and has no
 * room for a name and a price; there the card is its art, like any tile.
 * Otherwise it grows a little with the column, so the text in it can too.
 */
export function steamBandHeight(columnWidth: number): number {
  if (columnWidth <= 140) return 0;
  return Math.round(Math.min(78, Math.max(52, 30 + columnWidth * 0.12)));
}

/** Genres the price corner already says, so the tags need not. */
const SAID_BY_PRICE = new Set(["free to play"]);

/** The genres worth a tag, in Steam's order, at most `max` of them. */
export function cardGenres(app: SteamApp, max = Infinity): string[] {
  return app.genres.filter((g) => !SAID_BY_PRICE.has(g.toLowerCase())).slice(0, max);
}
