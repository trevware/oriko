/**
 * What a tile shows about its clipping on hover, as a handful of small
 * pills. Pure: grid.ts renders what this returns.
 *
 * The user picks the frontmatter keys (Settings → Oriko → Show on tiles).
 * Which corner a value lands in is decided by what it is, not by which key
 * carried it: anything that reads as a date becomes a relative time in the
 * top-right, and everything else is a pill in the bottom-left, one per value,
 * in the order the keys were chosen.
 */

import { looksLikeDate, relativeLabel } from "./dates";
import { domainOf } from "./scan";
import type { ClippingRecord } from "./scan";

export type BadgeCorner = "top-right" | "bottom-left";

export interface TileBadge {
  corner: BadgeCorner;
  text: string;
}

export function tileBadges(
  record: ClippingRecord,
  keys: readonly string[],
  now: number
): TileBadge[] {
  const out: TileBadge[] = [];
  for (const key of keys) {
    for (const raw of record.properties[key] ?? []) {
      const value = raw.trim();
      if (!value) continue;
      if (looksLikeDate(value)) {
        const label = relativeLabel(value, now);
        if (label) out.push({ corner: "top-right", text: label });
        continue;
      }
      // A URL is unreadable at pill size; its host is the part that means
      // anything on a wall.
      const text = key === "source" ? domainOf(value) || value : value;
      out.push({ corner: "bottom-left", text });
    }
  }
  return out;
}
