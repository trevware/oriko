import { setIcon } from "obsidian";
import { compactCount } from "./core/xpost";
import type { XLook } from "./core/xpost";

/**
 * The band under an X post's picture: the author's avatar, name and badge,
 * the likes on the right, and the start of what they said under that.
 *
 * Until this device has looked the post up, the avatar is the name's first
 * letter and there is no like count; both arrive with the lookup, the
 * avatar fading in over the letter.
 */
export function paintXBand(parent: HTMLElement, x: XLook, lines: number): HTMLElement {
  const band = parent.createDiv({ cls: "pg-x-band pg-card-band" });
  const who = band.createDiv({ cls: "pg-x-who" });

  const avatar = who.createSpan({ cls: "pg-x-avatar" });
  avatar.createSpan({ cls: "pg-x-initial", text: initialOf(x.post.name) });
  const url = x.details?.avatar;
  if (url) {
    const image = avatar.createEl("img", { attr: { alt: "", decoding: "async" } });
    image.onload = () => image.addClass("is-loaded");
    image.onerror = () => image.remove();
    image.src = url;
  }

  who.createSpan({ cls: "pg-x-name", text: x.post.name });
  if (x.details?.verified) {
    const badge = who.createSpan({ cls: "pg-x-badge" });
    setIcon(badge, "badge-check");
    badge.setAttribute("aria-label", "Verified");
  }
  if (x.details && x.details.likes > 0) {
    const likes = who.createSpan({ cls: "pg-x-likes" });
    setIcon(likes.createSpan({ cls: "pg-x-heart" }), "heart");
    likes.createSpan({ text: compactCount(x.details.likes) });
  }

  if (lines > 0 && x.post.text) {
    const text = band.createDiv({ cls: "pg-x-text", text: x.post.text });
    text.style.setProperty("--pg-x-lines", String(lines));
  }
  return band;
}

/** The first letter of a name, as one character even when it is outside the basic plane. */
function initialOf(name: string): string {
  const letter = [...name.replace(/[^\p{L}\p{N}]/gu, "")][0] ?? [...name][0] ?? "?";
  return letter.toUpperCase();
}
