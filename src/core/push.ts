import type { Position } from "./layout";

/**
 * The cards that slide down to make room under a card whose band has slid
 * out on hover: everything below it in its column, and anything wider than
 * one column that moves takes the columns it spans with it, so no card ends
 * up under another. Nothing changes column; the cards only slide.
 *
 * Only cards starting above `reach` are moved. A card further down than the
 * screen shows nothing for its slide, and every card moved is a card the
 * browser has to restyle, twice per hover, so the wall moves what can be
 * seen and the rest is caught by the next render if a scroll brings it near.
 */
export function cardsBelow(positions: Position[], origin: Position, reach = Infinity): Set<string> {
  const floor = origin.y + origin.h - 1;
  const lanes: Array<[number, number]> = [[origin.x + 1, origin.x + origin.w - 1]];
  const below = positions
    .filter((p) => p.id !== origin.id && p.y >= floor && p.y <= reach)
    .sort((a, b) => a.y - b.y);
  const out = new Set<string>();
  for (const p of below) {
    const left = p.x + 1;
    const right = p.x + p.w - 1;
    if (!lanes.some(([a, b]) => left < b && right > a)) continue;
    out.add(p.id);
    lanes.push([left, right]);
  }
  return out;
}
