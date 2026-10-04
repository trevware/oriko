import { describe, expect, it } from "vitest";
import { scanClipping } from "../src/core/scan";
import {
  AVATAR_FRESH_MS,
  POST_FRESH_MS,
  POST_RETRY_MS,
  PostStore,
  bandHeight,
  bandLines,
  compactCount,
  countLabel,
  decodeText,
  formatDuration,
  parseCount,
  personKey,
  postLook,
  postOf,
} from "../src/core/posts";
import type { Post } from "../src/core/posts";

describe("decodeText", () => {
  it("decodes the numeric entities the Web Clipper leaves in titles", () => {
    expect(decodeText("&#x30ad;&#x30b7;&#x30de; (&#064;kishima)")).toBe("キシマ (@kishima)");
    expect(decodeText("Up &amp; Down &#x1f680;")).toBe("Up & Down 🚀");
  });

  it("leaves text without entities alone", () => {
    expect(decodeText("plain words")).toBe("plain words");
  });
});

describe("parseCount", () => {
  it("reads the ways sites write a count", () => {
    expect(parseCount("1,575")).toBe(1575);
    expect(parseCount("219")).toBe(219);
    expect(parseCount("1.2K")).toBe(1200);
    expect(parseCount("12K")).toBe(12000);
    expect(parseCount("3.4M")).toBe(3400000);
    expect(parseCount("")).toBe(0);
    expect(parseCount("lots")).toBe(0);
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

describe("formatDuration", () => {
  it("writes a video's length the way YouTube does", () => {
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(61)).toBe("1:01");
    expect(formatDuration(1270)).toBe("21:10");
    expect(formatDuration(4102)).toBe("1:08:22");
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

describe("PostStore", () => {
  it("believes an answer for a day and retries a failure sooner", () => {
    const store = new PostStore();
    expect(store.isDue("x:1", 0)).toBe(true);
    store.set("x:1", 0, { avatar: "a", verified: false, count: 3 });
    expect(store.isDue("x:1", POST_FRESH_MS - 1)).toBe(false);
    store.set("x:1", 10, null, "HTTP 500");
    expect(store.get("x:1")?.details?.count).toBe(3);
    expect(store.isDue("x:1", 10 + POST_RETRY_MS)).toBe(true);
  });

  it("keeps a saved avatar for a week", () => {
    const store = new PostStore();
    const who = personKey("instagram", "Shota.Ohnishi");
    expect(who).toBe("instagram:shota.ohnishi");
    expect(store.avatarDue(who, 0)).toBe(true);
    store.setAvatar(who, { file: "avatars/a.jpg", url: "https://a", savedAt: 0 });
    expect(store.avatarDue(who, AVATAR_FRESH_MS - 1)).toBe(false);
    expect(store.avatarDue(who, AVATAR_FRESH_MS)).toBe(true);
  });

  it("round-trips through JSON and drops what it cannot trust", () => {
    const store = new PostStore();
    store.set("youtube:abc", 5, { avatar: "a", verified: false, count: 7, duration: 61, name: "Chan" });
    store.setAvatar("youtube:@chan", { file: "avatars/c.jpg", url: "u", savedAt: 5 });
    const raw = JSON.parse(JSON.stringify(store.toJSON())) as {
      posts: Record<string, unknown>;
      avatars: Record<string, unknown>;
    };
    raw.posts["x:bad"] = { fetchedAt: "soon" };
    raw.posts["x:2"] = { fetchedAt: 1, details: { avatar: 3 } };
    raw.avatars["x:nobody"] = { file: 4 };
    const back = PostStore.fromJSON(raw);
    expect(back.get("youtube:abc")?.details).toEqual({
      avatar: "a",
      verified: false,
      count: 7,
      duration: 61,
      name: "Chan",
    });
    expect(back.get("x:bad")).toBeUndefined();
    expect(back.get("x:2")?.details).toBeUndefined();
    expect(back.avatar("youtube:@chan")?.file).toBe("avatars/c.jpg");
    expect(back.avatar("x:nobody")).toBeUndefined();
  });

  it("takes in what the X card's own store remembered", () => {
    const old = {
      version: 1,
      posts: {
        "2096817665419735487": {
          fetchedAt: 9,
          details: { avatar: "https://pbs.twimg.com/a.jpg", verified: true, likes: 9472 },
        },
        "2096817665419735488": { fetchedAt: 3, failed: "HTTP 404" },
      },
    };
    const store = PostStore.fromXStore(old);
    expect(store.get("x:2096817665419735487")).toEqual({
      fetchedAt: 9,
      details: { avatar: "https://pbs.twimg.com/a.jpg", verified: true, count: 9472 },
    });
    expect(store.get("x:2096817665419735488")).toEqual({ fetchedAt: 3, failed: "HTTP 404" });
  });
});

const instagram: Post = {
  site: "instagram",
  id: "Dcwu4-xz65x",
  handle: "shota.ohnishi",
  name: "大西翔太 SHOTA OHNISHI",
  text: "slise❌→hinge⭕️",
  count: 1075,
};

describe("postLook", () => {
  it("is drawn bare until the lookup lands, and again when it does or the avatar is saved", () => {
    const bare = postLook(instagram, undefined);
    expect(bare.details).toBeNull();
    const looked = postLook(instagram, { fetchedAt: 1, details: { avatar: "a", verified: true, count: 1575 } });
    expect(looked.stamp).not.toBe(bare.stamp);
    const saved = postLook(
      instagram,
      { fetchedAt: 1, details: { avatar: "a", verified: true, count: 1575 } },
      "app://avatar.jpg"
    );
    expect(saved.stamp).not.toBe(looked.stamp);
    expect(saved.avatar).toBe("app://avatar.jpg");
  });

  it("names the post by what the lookup learned when the note did not say", () => {
    const video: Post = { site: "youtube", id: "DL2WnXqzZi8", handle: "", name: "", text: "I Learn" };
    expect(postLook(video, undefined).name).toBe("YouTube");
    expect(
      postLook(video, { fetchedAt: 1, details: { avatar: "", verified: false, count: 1, name: "Up & Down Golf" } }).name
    ).toBe("Up & Down Golf");
  });
});

describe("countLabel", () => {
  it("shows likes from the note until a lookup brings fresher ones", () => {
    expect(countLabel(postLook(instagram, undefined))).toEqual({ kind: "likes", text: "1K" });
    expect(
      countLabel(postLook(instagram, { fetchedAt: 1, details: { avatar: "", verified: false, count: 1575 } }))
    ).toEqual({ kind: "likes", text: "1.5K" });
  });

  it("shows nothing for a post with no count yet", () => {
    expect(countLabel(postLook({ ...instagram, count: undefined }, undefined))).toBeNull();
  });

  it("gives a video its views and length", () => {
    const video: Post = { site: "youtube", id: "DL2WnXqzZi8", handle: "", name: "", text: "" };
    const look = postLook(video, {
      fetchedAt: 1,
      details: { avatar: "", verified: false, count: 84093, duration: 4102 },
    });
    expect(countLabel(look)).toEqual({ kind: "views", text: "84K views · 1:08:22" });
    expect(countLabel(postLook(video, undefined))).toBeNull();
  });
});

describe("postOf", () => {
  it("finds the site a clipping came from", () => {
    const sources: Record<string, string> = {
      x: "https://x.com/nadainishi/status/2096817665419735487",
      instagram: "https://www.instagram.com/reel/Dcwu4-xz65x/",
      threads: "https://www.threads.com/share/BAVLaykohQ/",
      youtube: "https://www.youtube.com/watch?v=DL2WnXqzZi8",
    };
    for (const [site, source] of Object.entries(sources)) {
      expect(postOf(scanClipping(`Clippings/${site}.md`, { title: "t", source }, ""))?.site).toBe(site);
    }
    expect(postOf(scanClipping("Clippings/page.md", { source: "https://example.com/a" }, ""))).toBeNull();
  });
});
