import { setIcon } from "obsidian";
import { countLabel } from "./core/posts";
import type { PostLook } from "./core/posts";

/**
 * The band under a post's picture: the avatar, the name and badge, a count
 * on the right (likes, or a video's views and length), and the start of
 * what they said under that.
 *
 * Until this device has looked the post up, the avatar is the name's first
 * letter and the count is whatever the note recorded, if anything; both
 * arrive with the lookup, the avatar fading in over the letter.
 */
export function paintPostBand(parent: HTMLElement, look: PostLook, lines: number): HTMLElement {
  const band = parent.createDiv({ cls: "pg-post-band pg-card-band" });
  const who = band.createDiv({ cls: "pg-post-who" });

  const avatar = who.createSpan({ cls: "pg-post-avatar" });
  avatar.createSpan({ cls: "pg-post-initial", text: initialOf(look.name) });
  // The saved copy, else the address the lookup gave. Instagram's and
  // Threads' addresses expire, and an expired one simply leaves the letter.
  const url = look.avatar || look.details?.avatar;
  if (url) {
    const image = avatar.createEl("img", { attr: { alt: "", decoding: "async" } });
    image.onload = () => image.addClass("is-loaded");
    image.onerror = () => image.remove();
    image.src = url;
  }

  who.createSpan({ cls: "pg-post-name", text: look.name });
  if (look.details?.verified) {
    const badge = who.createSpan({ cls: "pg-post-badge" });
    setIcon(badge, "badge-check");
    badge.setAttribute("aria-label", "Verified");
  }
  const count = countLabel(look);
  if (count) {
    const shown = who.createSpan({ cls: "pg-post-count" });
    if (count.kind === "likes") setIcon(shown.createSpan({ cls: "pg-post-heart" }), "heart");
    shown.createSpan({ text: count.text });
  }

  if (lines > 0 && look.post.text) {
    const text = band.createDiv({ cls: "pg-post-text", text: look.post.text });
    text.style.setProperty("--pg-post-lines", String(lines));
  }
  return band;
}

/** The first letter of a name, as one character even when it is outside the basic plane. */
function initialOf(name: string): string {
  const letter = [...name.replace(/[^\p{L}\p{N}]/gu, "")][0] ?? [...name][0] ?? "?";
  return letter.toUpperCase();
}
