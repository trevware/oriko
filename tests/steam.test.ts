import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { scanClipping } from "../src/core/scan";
import {
  STEAM_FRESH_MS,
  STEAM_RETRY_MS,
  SteamStore,
  appDetailsUrl,
  pricingRegion,
  regionFromLocales,
  cardGenres,
  parseAppDetails,
  platformNames,
  priceTag,
  screenshotFile,
  steamAppId,
  steamBandHeight,
  steamFiles,
  steamIdOfPath,
  steamIdsLeftBehind,
  steamLook,
  steamOrphanFiles,
} from "../src/core/steam";
import type { SteamApp } from "../src/core/steam";

const FIXTURE: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/steam-appdetails.json", import.meta.url), "utf8")
);

function app(id: string): SteamApp {
  const parsed = parseAppDetails(FIXTURE, id);
  if (!parsed) throw new Error(`fixture ${id} did not parse`);
  return parsed;
}

const ROCO = "https://store.steampowered.com/app/4821880/Roco_Kingdom/";
const FOLDER = "Attachments/Clippings";

function record(path: string, source: string) {
  return scanClipping(path, { title: path, source }, "");
}

describe("steamAppId", () => {
  it("reads the id off a store page", () => {
    expect(steamAppId(ROCO)).toBe("4821880");
    expect(steamAppId("https://store.steampowered.com/app/1145360")).toBe("1145360");
    expect(steamAppId("https://store.steampowered.com/app/1145360/?snr=1_7")).toBe("1145360");
  });

  it("follows a mature game's age gate", () => {
    expect(steamAppId("https://store.steampowered.com/agecheck/app/1145360/")).toBe("1145360");
  });

  it("ignores everything that is not a store app page", () => {
    expect(steamAppId("https://store.steampowered.com/sub/1234/")).toBeNull();
    expect(steamAppId("https://steamcommunity.com/app/1145360")).toBeNull();
    expect(steamAppId("https://example.com/app/1145360")).toBeNull();
    expect(steamAppId("not a url")).toBeNull();
    expect(steamAppId("")).toBeNull();
  });
});

describe("parseAppDetails", () => {
  it("reads an unreleased free game", () => {
    const roco = app("4821880");
    expect(roco.name).toBe("Roco Kingdom");
    expect(roco.isFree).toBe(true);
    expect(roco.comingSoon).toBe(true);
    expect(roco.releaseDate).toBe("Coming soon");
    expect(roco.price).toBeNull();
    expect(roco.developers).toEqual(["Morefun Studios"]);
    expect(roco.genres).toContain("RPG");
    expect(roco.platforms).toEqual({ windows: true, mac: false, linux: false });
    expect(roco.header).toMatch(/header\.jpg/);
    expect(roco.background).toMatch(/page_bg_raw\.jpg/);
    expect(roco.screenshots).toHaveLength(3);
    expect(roco.screenshots[0].full).toMatch(/1920x1080/);
    expect(roco.trailers[0].hls).toMatch(/\.m3u8/);
  });

  it("reads a discounted price", () => {
    const hades = app("1145360");
    expect(hades.price).toMatchObject({
      currency: "CAD",
      discountPercent: 75,
      initialText: "CDN$ 32.50",
      finalText: "CDN$ 8.12",
    });
  });

  it("returns null when Steam says no", () => {
    expect(parseAppDetails({ "1": { success: false } }, "1")).toBeNull();
    expect(parseAppDetails({}, "1")).toBeNull();
    expect(parseAppDetails(null, "1")).toBeNull();
    expect(parseAppDetails({ "1": { success: true, data: { name: "" } } }, "1")).toBeNull();
  });

  it("decodes entities in the description", () => {
    const parsed = parseAppDetails(
      { "7": { success: true, data: { name: "X", short_description: "Rock &amp; roll" } } },
      "7"
    );
    expect(parsed?.description).toBe("Rock & roll");
  });
});

describe("priceTag", () => {
  it("says when an unreleased game is coming rather than a price", () => {
    expect(priceTag(app("4821880"))).toEqual({ discount: "", original: "", final: "Coming soon" });
  });

  it("lays out a discount the way the store does", () => {
    expect(priceTag(app("1145360"))).toEqual({
      discount: "-75%",
      original: "CDN$ 32.50",
      final: "CDN$ 8.12",
    });
  });

  it("calls a released free game free to play", () => {
    const free = { ...app("4821880"), comingSoon: false };
    expect(priceTag(free)?.final).toBe("Free to Play");
  });

  it("shows a full price with nothing struck through", () => {
    const hades = app("1145360");
    const full = { ...hades, price: { ...hades.price!, discountPercent: 0, initialText: "" } };
    expect(priceTag(full)).toEqual({ discount: "", original: "", final: "CDN$ 8.12" });
  });

  it("keeps to the price when the release date has a row of its own", () => {
    expect(priceTag(app("4821880"), false)?.final).toBe("Free to Play");
    const paid = { ...app("1145360"), comingSoon: true };
    expect(priceTag(paid, false)?.final).toBe("CDN$ 8.12");
    expect(priceTag({ ...paid, price: null }, false)).toBeNull();
  });

  it("has nothing to say for a released game with no price", () => {
    expect(priceTag({ ...app("1145360"), price: null })).toBeNull();
  });
});

describe("platformNames", () => {
  it("lists platforms in store order", () => {
    const all = { ...app("4821880"), platforms: { windows: true, mac: true, linux: true } };
    expect(platformNames(all)).toEqual(["Windows", "macOS", "Linux"]);
    expect(platformNames(app("4821880"))).toEqual(["Windows"]);
  });
});

describe("steamFiles", () => {
  it("names the header and backdrop as a snapshot and screenshots by content", () => {
    const files = steamFiles(app("4821880"), FOLDER);
    const folder = `${FOLDER}/Steam/4821880`;
    expect(files[0].path).toBe(`${folder}/header.jpg`);
    expect(files[1].path).toBe(`${folder}/background.jpg`);
    expect(files[2].path).toMatch(new RegExp(`^${folder}/ss_[0-9a-f]+\\.jpg$`));
    expect(files).toHaveLength(2 + 3);
  });

  it("numbers a screenshot whose name it cannot read", () => {
    expect(screenshotFile("F", "https://x/y/shot.png", 0)).toBe("F/ss_01.jpg");
    expect(screenshotFile("F", "nope", 11)).toBe("F/ss_12.jpg");
  });
});

describe("steamIdOfPath", () => {
  it("recognises a path in a game's folder", () => {
    expect(steamIdOfPath(FOLDER, `${FOLDER}/Steam/4821880/header.jpg`)).toBe("4821880");
    expect(steamIdOfPath(FOLDER, `${FOLDER}/abc123def456-header.jpg`)).toBeNull();
    expect(steamIdOfPath(FOLDER, `${FOLDER}/Steam/notes/x.jpg`)).toBeNull();
  });
});

describe("what goes with a game", () => {
  const a = record("a.md", ROCO);
  const b = record("b.md", "https://store.steampowered.com/app/4821880");
  const c = record("c.md", "https://store.steampowered.com/app/1145360/Hades/");
  const other = record("d.md", "https://example.com");

  it("keeps the folder while another clipping of the game survives", () => {
    expect(steamIdsLeftBehind([a], [b, c, other])).toEqual([]);
  });

  it("lets it go with the last clipping of the game", () => {
    expect(steamIdsLeftBehind([a, b], [c, other])).toEqual(["4821880"]);
    expect(steamIdsLeftBehind([other], [a])).toEqual([]);
  });

  it("finds folders no clipping points at", () => {
    const onDisk = [
      `${FOLDER}/Steam/4821880/header.jpg`,
      `${FOLDER}/Steam/999/header.jpg`,
      `${FOLDER}/abc123def456-x.jpg`,
    ];
    expect(steamOrphanFiles([a, c], onDisk, FOLDER)).toEqual([`${FOLDER}/Steam/999/header.jpg`]);
  });
});

describe("SteamStore", () => {
  const roco = app("4821880");

  it("is due for anything it has not heard about", () => {
    expect(new SteamStore().isDue("1", 0)).toBe(true);
  });

  it("believes an answer for a day", () => {
    const store = new SteamStore();
    store.set("4821880", 1000, roco);
    expect(store.isDue("4821880", 1000 + STEAM_FRESH_MS - 1)).toBe(false);
    expect(store.isDue("4821880", 1000 + STEAM_FRESH_MS)).toBe(true);
  });

  it("retries a failure sooner and keeps yesterday's card", () => {
    const store = new SteamStore();
    store.set("4821880", 0, roco);
    store.set("4821880", 1000, null, "HTTP 503");
    expect(store.app("4821880")?.name).toBe("Roco Kingdom");
    expect(store.get("4821880")?.failed).toBe("HTTP 503");
    expect(store.isDue("4821880", 1000 + STEAM_RETRY_MS)).toBe(true);
  });

  it("round-trips through JSON and drops what it cannot trust", () => {
    const store = new SteamStore();
    store.set("4821880", 5, roco);
    const raw = JSON.parse(JSON.stringify(store.toJSON())) as {
      apps: Record<string, unknown>;
    };
    raw.apps.junk = { fetchedAt: 1 };
    raw.apps["12"] = { fetchedAt: "soon" };
    raw.apps["13"] = { fetchedAt: 1, app: { nope: true } };
    const back = SteamStore.fromJSON(raw);
    expect(back.app("4821880")?.name).toBe("Roco Kingdom");
    expect(back.get("junk")).toBeUndefined();
    expect(back.get("12")).toBeUndefined();
    expect(back.get("13")?.app).toBeUndefined();
    expect(SteamStore.fromJSON(null).isDue("1", 0)).toBe(true);
  });
});

describe("steamLook", () => {
  const roco = app("4821880");
  const folder = `${FOLDER}/Steam/4821880`;

  it("uses Steam's own URLs until the art is saved", () => {
    const look = steamLook(roco, 1, FOLDER, () => false, "");
    expect(look.header).toEqual({ path: roco.header, remote: true });
    expect(look.screenshots[0].thumb).toEqual({ path: roco.screenshots[0].thumb, remote: true });
  });

  it("switches to the saved copies, and its stamp moves with them", () => {
    const before = steamLook(roco, 1, FOLDER, () => false, "");
    const after = steamLook(roco, 1, FOLDER, () => true, "");
    expect(after.header).toEqual({ path: `${folder}/header.jpg`, remote: false });
    expect(after.screenshots[0].thumb).toEqual(after.screenshots[0].full);
    expect(after.stamp).not.toBe(before.stamp);
  });

  it("changes its stamp when Steam is asked again or the trailer lands", () => {
    const one = steamLook(roco, 1, FOLDER, () => false, "");
    expect(steamLook(roco, 2, FOLDER, () => false, "").stamp).not.toBe(one.stamp);
    expect(steamLook(roco, 1, FOLDER, () => false, "v.mp4").stamp).not.toBe(one.stamp);
  });
});

describe("card details", () => {
  it("has no band at the tightest stage and a modest one elsewhere", () => {
    expect(steamBandHeight(120)).toBe(0);
    expect(steamBandHeight(200)).toBe(54);
    expect(steamBandHeight(300)).toBe(66);
    expect(steamBandHeight(600)).toBe(78);
  });

  it("leaves Free to Play to the price corner", () => {
    expect(cardGenres(app("4821880"), 3)).toEqual(["Action", "Adventure", "Casual"]);
    expect(cardGenres(app("4821880"))).not.toContain("Free To Play");
    expect(cardGenres({ ...app("4821880"), genres: ["Free To Play", "RPG"] })).toEqual(["RPG"]);
  });
});

describe("pricing region", () => {
  it("prices for the country the system names", () => {
    expect(regionFromLocales(["en-CA"])).toBe("CA");
    expect(regionFromLocales(["en_CA"])).toBe("CA");
    expect(regionFromLocales(["en", "fr-FR"])).toBe("FR");
  });

  it("falls back to the region a bare language implies, then the US", () => {
    expect(regionFromLocales(["ko"], () => "KR")).toBe("KR");
    expect(regionFromLocales(["xx"], () => undefined)).toBe("US");
    expect(regionFromLocales([])).toBe("US");
    expect(regionFromLocales(["not a locale!"], () => undefined)).toBe("US");
  });

  it("always sends the country", () => {
    expect(appDetailsUrl("4821880", "CA")).toContain("cc=ca");
  });

  it("asks again when the region changes, keeping the card meanwhile", () => {
    const store = new SteamStore();
    store.set("4821880", 0, app("4821880"), "", "KR");
    expect(store.isDue("4821880", 1, "KR")).toBe(false);
    expect(store.isDue("4821880", 1, "CA")).toBe(true);
    const back = SteamStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    expect(back.get("4821880")?.region).toBe("KR");
    expect(back.isDue("4821880", 1, "CA")).toBe(true);
  });

  it("treats an answer saved before regions as due", () => {
    const store = new SteamStore();
    store.set("4821880", 0, app("4821880"));
    expect(store.isDue("4821880", 1, "CA")).toBe(true);
  });
});

describe("pricingRegion", () => {
  it("takes the country from the time zone over a locale Obsidian imposes", () => {
    expect(pricingRegion("America/Toronto", ["en-US"])).toBe("CA");
    expect(pricingRegion("Asia/Seoul", ["en-US"])).toBe("KR");
    expect(pricingRegion("Europe/London", ["en-US"])).toBe("GB");
  });

  it("knows the legacy names some runtimes report", () => {
    expect(pricingRegion("Asia/Calcutta", [])).toBe("IN");
    expect(pricingRegion("US/Eastern", [])).toBe("US");
  });

  it("falls back to the locales for a zone that names no country", () => {
    expect(pricingRegion("UTC", ["fr-CA"])).toBe("CA");
    expect(pricingRegion("", ["de-DE"])).toBe("DE");
  });
});
