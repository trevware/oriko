/**
 * What a tile shows about its clipping on hover, as a handful of small
 * pills. Pure: grid.ts renders what this returns.
 *
 * Two slots, chosen in Settings → Oriko → Show on tiles. The top-right holds
 * one date, read as a relative time; the bottom-left holds one property, its
 * values in a single pill. One of each, not a list: a tile has room for a glance,
 * and a row of mixed properties reads as noise at that size.
 */

import { relativeLabel } from "./dates";
import { domainOf } from "./scan";
import type { ClippingRecord } from "./scan";

export type BadgeCorner = "top-right" | "bottom-left";

export interface TileBadge {
  corner: BadgeCorner;
  text: string;
}

export interface TileSlots {
  /** Frontmatter key shown top-right as a relative time; "" for none. */
  date: string;
  /** Frontmatter key shown bottom-left, one pill per value; "" for none. */
  property: string;
}

export function tileBadges(record: ClippingRecord, slots: TileSlots, now: number): TileBadge[] {
  const out: TileBadge[] = [];

  const when = slots.date ? (record.properties[slots.date] ?? [])[0]?.trim() : "";
  const label = when ? relativeLabel(when, now) : "";
  if (label) out.push({ corner: "top-right", text: label });

  if (slots.property) {
    const values = (record.properties[slots.property] ?? [])
      .map((raw) => raw.trim())
      .filter(Boolean)
      // A URL is unreadable at pill size; its host is the part that means
      // anything on a wall.
      .map((value) => (slots.property === "source" ? domainOf(value) || value : value));
    // One pill, the values run together inside it: a bar reads cleaner than
    // a row of bubbles, and a bar can tick when it is too long.
    if (values.length) out.push({ corner: "bottom-left", text: values.join(" \u00b7 ") });
  }
  return out;
}
