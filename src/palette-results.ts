import type { PaletteCommand } from "./commands";
import { rank } from "./palette-search";
import type { MatchRange } from "./palette-search";
import type { ClippingRecord } from "./scan";
import { effectiveGrid } from "./spaces";

/**
 * One query, two pools: the commands, and every clipping in the vault.
 *
 * They are ranked apart and shown in sections, because a list that reshuffles
 * across kinds is hard to aim at. What the query does decide is which section
 * comes first: whichever holds the best single match. Typing "manga" is a
 * search for a clipping and the wall's contents lead; typing "delete" is a
 * search for a verb and the actions lead. With no query at all every score is
 * zero, so the sections fall back to their declared order.
 */

export interface PaletteRow {
  /** Stable across a rebuild, so the highlighted row survives a keepOpen tick. */
  key: string;
  label: string;
  icon: string;
  detail?: string;
  destructive?: boolean;
  /** Runs of the label that matched, for highlighting. */
  ranges: MatchRange[];
  /** Set when the row is a command. */
  command?: PaletteCommand;
  /** Set when the row is a clipping: the note's path. */
  clipping?: string;
}

export interface PaletteGroup {
  section: string;
  rows: PaletteRow[];
  /** The best score in this group, which is what orders the groups. */
  score: number;
}

export interface SearchOptions {
  /** Most clippings to show, so the commands are never pushed off screen. */
  limit: number;
  activeGrid: string;
  homeGrid: string;
  registered: ReadonlySet<string>;
}

export const CLIPPINGS_SECTION = "Clippings";

/** Declared order, used when the query cannot separate two sections. */
const SECTION_ORDER = ["Actions", "Grids", "Filters", "Capture", CLIPPINGS_SECTION];

function sectionRank(section: string): number {
  const index = SECTION_ORDER.indexOf(section);
  return index === -1 ? SECTION_ORDER.length : index;
}

export function searchPalette(
  query: string,
  commands: readonly PaletteCommand[],
  clippings: readonly ClippingRecord[],
  options: SearchOptions
): PaletteGroup[] {
  const groups = new Map<string, PaletteGroup>();

  const add = (section: string, row: PaletteRow, score: number): void => {
    const group = groups.get(section);
    if (group) {
      group.rows.push(row);
      group.score = Math.max(group.score, score);
      return;
    }
    groups.set(section, { section, rows: [row], score });
  };

  for (const hit of rank(query, commands, (command) => ({
    primary: command.label,
    secondary: command.keywords,
  }))) {
    const command = hit.item;
    add(
      command.section,
      {
        key: command.id,
        label: command.label,
        icon: command.icon,
        detail: command.detail,
        destructive: command.destructive,
        ranges: hit.ranges,
        command,
      },
      hit.score
    );
  }

  const found = rank(query, clippings, (record) => ({
    primary: record.title,
    secondary: record.haystack,
  }));

  // Capped after ranking, so what survives is the best of the pile rather
  // than whichever thirty happened to be indexed first.
  for (const hit of found.slice(0, options.limit)) {
    const record = hit.item;
    const grid = effectiveGrid(record, options.homeGrid, options.registered);
    add(
      CLIPPINGS_SECTION,
      {
        key: record.path,
        label: record.title,
        icon: "image",
        // Only worth saying when it is somewhere other than where you are.
        detail: grid === options.activeGrid ? undefined : grid,
        ranges: hit.ranges,
        clipping: record.path,
      },
      hit.score
    );
  }

  return [...groups.values()].sort(
    (a, b) => b.score - a.score || sectionRank(a.section) - sectionRank(b.section)
  );
}
