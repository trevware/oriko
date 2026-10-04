import { describe, expect, it } from "vitest";
import { scanClipping } from "../src/core/scan";
import {
  X_FRESH_MS,
  X_RETRY_MS,
  XStore,
  bandHeight,
  bandLines,
  compactCount,
  parseFxDetails,
  xLook,
  xPostOf,
} from "../src/core/xpost";

const webClipper = scanClipping(
  "Clippings/nadainishi.md",
  {
    title: "なだいにし: そしてなんと！",
    source: "https://x.com/nadainishi/status/2096817665419735487",
    author: ["なだいにし"],
    description: "そしてなんと！\n『ダンダダン』",
  },
  ""
);

describe("xPostOf", () => {
  it("reads the post off the note", () => {
    expect(xPostOf(webClipper)).toEqual({
      id: "2096817665419735487",
      handle: "nadainishi",
      name: "なだいにし",
      text: "そしてなんと！ 『ダンダダン』",
    });
  });

  it("falls back to the handle for the name, and the title for the words", () => {
    const bare = scanClipping(
      "Clippings/x.md",
      { title: "PERFECTL00P: keep climbing", source: "https://twitter.com/PERFECTL00P/status/2090086481281069566" },
      ""
    );
    expect(xPostOf(bare)).toMatchObject({ name: "PERFECTL00P", text: "keep climbing" });
  });

  it("ignores anything that is not a post", () => {
    expect(xPostOf(scanClipping("a.md", { source: "https://x.com/someone" }, ""))).toBeNull();
    expect(xPostOf(scanClipping("b.md", { source: "https://example.com" }, ""))).toBeNull();
  });
});

describe("parseFxDetails", () => {
  it("takes the avatar, the badge and the likes", () => {
    const json = {
      code: 200,
      tweet: {
        likes: 9472,
        author: { avatar_url: "https://pbs.twimg.com/a.jpg", verification: { verified: true } },
      },
    };
    expect(parseFxDetails(json)).toEqual({
      avatar: "https://pbs.twimg.com/a.jpg",
      verified: true,
      likes: 9472,
    });
  });

  it("returns null for a post fxtwitter could not find", () => {
    expect(parseFxDetails({ code: 404, message: "NOT_FOUND" })).toBeNull();
    expect(parseFxDetails(null)).toBeNull();
  });
});

describe("compactCount", () => {
  it("shortens the way X does", () => {
    expect(compactCount(15)).toBe("15");
    expect(compactCount(9472)).toBe("9.4K");
    expect(compactCount(9000)).toBe("9K");
    expect(compactCount(15175)).toBe("15K");
    expect(compactCount(286060)).toBe("286K");
    expect(compactCount(1250000)).toBe("1.2M");
  });
});

describe("band size", () => {
  it("gives a short post one line and a long one two", () => {
    expect(bandLines("", 280)).toBe(0);
    expect(bandLines("keep climbing", 280)).toBe(1);
    expect(bandLines("x".repeat(120), 280)).toBe(2);
  });

  it("counts wide characters as wide", () => {
    // Twenty kana is about 250px, past a 200px column's room.
    expect(bandLines("あ".repeat(20), 200)).toBe(2);
    expect(bandLines("a".repeat(20), 200)).toBe(1);
  });

  it("reserves the row, and a line or two of words", () => {
    expect(bandHeight("", 280)).toBe(43);
    expect(bandHeight("keep climbing", 280)).toBe(66);
    expect(bandHeight("x".repeat(120), 280)).toBe(83);
  });
});

describe("XStore", () => {
  it("believes an answer for a day and retries a failure sooner", () => {
    const store = new XStore();
    expect(store.isDue("1", 0)).toBe(true);
    store.set("1", 0, { avatar: "a", verified: false, likes: 3 });
    expect(store.isDue("1", X_FRESH_MS - 1)).toBe(false);
    store.set("1", 10, null, "HTTP 500");
    expect(store.get("1")?.details?.likes).toBe(3);
    expect(store.isDue("1", 10 + X_RETRY_MS)).toBe(true);
  });

  it("round-trips through JSON and drops what it cannot trust", () => {
    const store = new XStore();
    store.set("1", 5, { avatar: "a", verified: true, likes: 7 });
    const raw = JSON.parse(JSON.stringify(store.toJSON())) as { posts: Record<string, unknown> };
    raw.posts.bad = { fetchedAt: 1 };
    raw.posts["2"] = { fetchedAt: 1, details: { avatar: 3 } };
    const back = XStore.fromJSON(raw);
    expect(back.get("1")?.details).toEqual({ avatar: "a", verified: true, likes: 7 });
    expect(back.get("bad")).toBeUndefined();
    expect(back.get("2")?.details).toBeUndefined();
  });
});

describe("xLook", () => {
  it("is drawn bare until the lookup lands, and again when it does", () => {
    const post = xPostOf(webClipper)!;
    const bare = xLook(post, undefined);
    expect(bare.details).toBeNull();
    const store = new XStore();
    store.set(post.id, 1, { avatar: "a", verified: true, likes: 9 });
    expect(xLook(post, store.get(post.id)).stamp).not.toBe(bare.stamp);
  });
});
