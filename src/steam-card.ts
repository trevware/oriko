import { cardGenres, priceTag } from "./core/steam";
import type { SteamApp } from "./core/steam";

/**
 * The pieces of a store card that the wall and the detail view share, so a
 * price reads the same in both.
 */

/**
 * The price corner the way the store draws it: a green discount box, then
 * the old price struck through above the new one. A full price, "Free to
 * Play", or a release status is the final line alone.
 */
export function paintPrice(parent: HTMLElement, app: SteamApp): HTMLElement | null {
  const tag = priceTag(app);
  if (!tag) return null;
  const price = parent.createDiv({ cls: "pg-steam-price" });
  if (tag.discount) price.createDiv({ cls: "pg-steam-discount", text: tag.discount });
  const amounts = price.createDiv({ cls: "pg-steam-amounts" });
  if (tag.original) amounts.createDiv({ cls: "pg-steam-original", text: tag.original });
  amounts.createDiv({ cls: "pg-steam-final", text: tag.final });
  price.toggleClass("is-discounted", Boolean(tag.discount));
  price.toggleClass("is-upcoming", app.comingSoon);
  return price;
}

/** Genre tags, the store's blue-on-blue chips. */
export function paintGenres(parent: HTMLElement, genres: string[]): HTMLElement | null {
  if (genres.length === 0) return null;
  const tags = parent.createDiv({ cls: "pg-steam-tags" });
  for (const genre of genres) tags.createSpan({ cls: "pg-steam-tag", text: genre });
  return tags;
}

/** The band under a card's art: the game's name, a few genres, and the price. */
export function paintBand(parent: HTMLElement, app: SteamApp): HTMLElement {
  const band = parent.createDiv({ cls: "pg-steam-band" });
  band.createDiv({ cls: "pg-steam-name", text: app.name });
  const row = band.createDiv({ cls: "pg-steam-row" });
  paintGenres(row, cardGenres(app, 2));
  paintPrice(row, app);
  return band;
}
