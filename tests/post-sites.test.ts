import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { scanClipping } from "../src/core/scan";
import { instagramEmbedUrl, instagramPostOf, parseInstagramEmbed } from "../src/core/instagram-post";
import {
  parseThreadsEmbed,
  parseThreadsPostPage,
  threadsEmbedUrl,
  threadsPostOf,
} from "../src/core/threads-post";
import { parseYoutubeChannel, parseYoutubeWatch, youtubePostOf } from "../src/core/youtube-post";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/* The notes below are copied from the Aegis vault as the Web Clipper wrote them. */

describe("Instagram", () => {
  const note = scanClipping(
    "Clippings/shota.md",
    {
      title:
        '&#x5927;&#x897f;&#x7fd4;&#x592a; SHOTA OHNISHI on Instagram: "slise&#x274c;&#x2192;hinge&#x2b55;&#xfe0f;  Aim for 300 yards&#x1f680;',
      source: "https://www.instagram.com/reel/Dcwu4-xz65x/",
      author: [],
      description:
        '1,075 likes, 1 comments - shota.ohnishi on September 1, 2026: "slise&#x274c;&#x2192;hinge&#x2b55;&#xfe0f;  Aim for 300 yards&#x1f680;"',
    },
    ""
  );

  it("reads the post off the note", () => {
    expect(instagramPostOf(note)).toEqual({
      site: "instagram",
      id: "Dcwu4-xz65x",
      handle: "shota.ohnishi",
      name: "大西翔太 SHOTA OHNISHI",
      text: "slise❌→hinge⭕️ Aim for 300 yards🚀",
      count: 1075,
    });
  });

  it("takes the words from the title when the description has no summary", () => {
    const bare = scanClipping(
      "Clippings/bare.md",
      { title: 'Instagram post by someone: "hello there"', source: "https://www.instagram.com/p/ABCDE12345/" },
      ""
    );
    expect(instagramPostOf(bare)).toEqual({
      site: "instagram",
      id: "ABCDE12345",
      handle: "",
      name: "",
      text: "hello there",
    });
  });

  it("reads a note whose poster hides their likes", () => {
    const hidden = scanClipping(
      "Clippings/ester.md",
      {
        title: 'ESTER COLLINS on Instagram: "Your sign to add custom wooden wedges"',
        source: "https://www.instagram.com/reel/DbuQqpNMFUZ/?stkn=MTBlaXFrenBjZnZkZQ==",
        description: 'estermarieee on August 6, 2026: "Your sign to add custom wooden wedges".',
      },
      ""
    );
    expect(instagramPostOf(hidden)).toEqual({
      site: "instagram",
      id: "DbuQqpNMFUZ",
      handle: "estermarieee",
      name: "ESTER COLLINS",
      text: "Your sign to add custom wooden wedges",
    });
  });

  it("ignores anything that is not a post", () => {
    expect(instagramPostOf(scanClipping("a.md", { source: "https://www.instagram.com/shota.ohnishi/" }, ""))).toBeNull();
    expect(instagramPostOf(scanClipping("b.md", { source: "https://x.com/a/status/12345" }, ""))).toBeNull();
  });

  it("asks the post's embed page", () => {
    expect(instagramEmbedUrl("Dcwu4-xz65x")).toBe("https://www.instagram.com/p/Dcwu4-xz65x/embed/captioned/");
  });

  it("reads the avatar, the badge and the likes off the embed page", () => {
    expect(parseInstagramEmbed(fixture("instagram-embed.html"))).toEqual({
      avatar:
        "https://scontent.cdninstagram.com/v/t51.2885-19/327622258_103213565981963_5659577425855081829_n.jpg?stp=dst-jpg_s100x100&oe=6AC8AF11",
      verified: true,
      count: 1575,
      handle: "shota.ohnishi",
    });
  });

  it("finds the avatar inside a story ring", () => {
    const ringed = fixture("instagram-embed.html").replace('class="Avatar"', 'class="Avatar InsideRing"');
    expect(parseInstagramEmbed(ringed)?.avatar).toContain("327622258_103213565981963");
  });

  it("takes the poster's avatar on a post made with others", () => {
    const collab = fixture("instagram-embed.html")
      .replace('class="AvatarContainer"', 'class="CollabAvatarContainer"')
      .replace('class="Avatar"', 'class="CollabAvatar"');
    expect(parseInstagramEmbed(collab)?.avatar).toContain("327622258_103213565981963");
  });

  it("returns null for a post that cannot be embedded", () => {
    expect(parseInstagramEmbed('<html><body><div class="EmbedBroken"></div></body></html>')).toBeNull();
  });

  it("returns null for a page that is not an embed", () => {
    expect(parseInstagramEmbed("<html><title>Instagram</title></html>")).toBeNull();
  });
});

describe("Threads", () => {
  const share = scanClipping(
    "Clippings/agus.md",
    {
      title: "Agus Anugrah (&#064;agusanugrah_) on Threads",
      source: "https://www.threads.com/share/BAVLaykohQ/",
      description: "Apple OS 27 liquid glass effect using gsap and css",
    },
    ""
  );

  it("reads the post off the note", () => {
    expect(threadsPostOf(share)).toEqual({
      site: "threads",
      id: "BAVLaykohQ",
      handle: "agusanugrah_",
      name: "Agus Anugrah",
      text: "Apple OS 27 liquid glass effect using gsap and css",
    });
  });

  it("keeps a name with a dash in it whole", () => {
    const named = scanClipping(
      "Clippings/onebite.md",
      {
        title: "&#x4e00;&#x53e3;&#x8a2d;&#x8a08; - OneBite Design (&#064;onebite_design) on Threads",
        source: "https://www.threads.com/share/_ndknC6Gq/",
      },
      ""
    );
    expect(threadsPostOf(named)).toMatchObject({ name: "一口設計 - OneBite Design", handle: "onebite_design" });
  });

  it("takes the handle and code straight from a post link", () => {
    const direct = scanClipping(
      "Clippings/direct.md",
      { title: "", source: "https://www.threads.net/@agusanugrah_/post/Dd4lBcBkyeD?xmt=abc" },
      ""
    );
    expect(threadsPostOf(direct)).toMatchObject({ id: "Dd4lBcBkyeD", handle: "agusanugrah_", name: "agusanugrah_" });
  });

  it("finds the real post a share link lands on", () => {
    expect(parseThreadsPostPage(fixture("threads-post.html"))).toEqual({
      handle: "agusanugrah_",
      code: "Dd4lBcBkyeD",
    });
    expect(parseThreadsPostPage("<html></html>")).toBeNull();
  });

  it("asks the post's embed page", () => {
    expect(threadsEmbedUrl({ handle: "agusanugrah_", code: "Dd4lBcBkyeD" })).toBe(
      "https://www.threads.com/@agusanugrah_/post/Dd4lBcBkyeD/embed"
    );
  });

  it("reads the avatar and the likes off the embed page", () => {
    expect(parseThreadsEmbed(fixture("threads-embed.html"))).toEqual({
      avatar:
        "https://scontent.cdninstagram.com/v/t51.2885-19/358059651_809476420500565_8019106228591902897_n.jpg?stp=dst-jpg_s100x100&oe=6AC8AF11",
      verified: false,
      count: 219,
      handle: "agusanugrah_",
    });
    expect(parseThreadsEmbed("<html></html>")).toBeNull();
  });
});

describe("YouTube", () => {
  const video = scanClipping(
    "Clippings/ghost.md",
    {
      title: "『攻殻機動隊 THE GHOST IN THE SHELL』制作現場にDIVEせよ！｜プライムビデオ",
      source: "https://www.youtube.com/watch?v=BZZoL_IoBZs",
      author: ["[[Prime Video JP - プライムビデオ]]"],
    },
    ""
  );

  it("reads the video off the note", () => {
    expect(youtubePostOf(video)).toEqual({
      site: "youtube",
      id: "BZZoL_IoBZs",
      handle: "",
      name: "Prime Video JP - プライムビデオ",
      text: "『攻殻機動隊 THE GHOST IN THE SHELL』制作現場にDIVEせよ！｜プライムビデオ",
    });
  });

  it("knows every shape of a video link", () => {
    for (const source of [
      "https://youtu.be/DL2WnXqzZi8",
      "https://www.youtube.com/watch?v=DL2WnXqzZi8&feature=youtu.be",
      "https://www.youtube.com/shorts/DL2WnXqzZi8",
    ]) {
      expect(youtubePostOf(scanClipping("v.md", { title: "t", source }, ""))?.id).toBe("DL2WnXqzZi8");
    }
    expect(youtubePostOf(scanClipping("c.md", { source: "https://www.youtube.com/@UpDownGolf" }, ""))).toBeNull();
  });

  it("reads the views, the length and the channel off the watch page", () => {
    expect(parseYoutubeWatch(fixture("youtube-watch.html"))).toEqual({
      details: { avatar: "", verified: false, count: 84093, duration: 4102, name: "Up & Down Golf", handle: "@UpDownGolf" },
      channel: "https://www.youtube.com/@UpDownGolf",
    });
    expect(parseYoutubeWatch("<html></html>")).toBeNull();
  });

  it("reads a channel's avatar off its page", () => {
    expect(parseYoutubeChannel(fixture("youtube-channel.html"))).toBe(
      "https://yt3.googleusercontent.com/BQrs66W2wsQOEpG8qfrSz0t0Er1KbLUZ5hv_gaJHpTR3hYO9OUnS-5rudb6Dl58MW6pfdJrSKWw=s900-c-k-c0x00ffffff-no-rj"
    );
    expect(parseYoutubeChannel("<html></html>")).toBe("");
  });
});
