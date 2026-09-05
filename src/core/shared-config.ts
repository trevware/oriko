import { DEFAULT_SETTINGS } from "./settings";
import type { OrikoSettings } from "./settings";
import { isFolderWidth } from "./folders";
import type { FolderSpace } from "./folders";
import type { GridSpace } from "./spaces";

/**
 * The half of the settings that describes the vault, and therefore belongs
 * to the vault.
 *
 * Grids were kept with the rest of the settings, in the plugin's own
 * data.json, which is per-device and travels only if a sync happens to carry
 * `.obsidian`. So a grid made on a desktop did not exist on a phone, while
 * the clippings in it did: membership is a `grid:` key in frontmatter and had
 * been in the vault all along. Only the definition was stranded.
 *
 * What stays behind is what is true of a device rather than of a vault: how
 * densely the wall is packed, whether the panel is open, which grid was last
 * on screen. A phone has a smaller screen than a desktop and should be
 * allowed to disagree about all three.
 */
export interface SharedConfig {
  grids: GridSpace[];
  /** Absent in a file written before folders, which reads as none. */
  folders: FolderSpace[];
  homeGridName: string;
  homeGridIcon: string;
  filterProperties: string[];
}

/*
 * Markdown, holding JSON in a fenced block, rather than a .json file.
 *
 * Not for reading pleasure: it is what every sync path carries without being
 * asked. Obsidian Sync syncs notes by default and treats .json as an
 * unsupported type that is off until someone finds the toggle, which is
 * exactly how the first version of this file failed to reach a phone. Every
 * other transport carries .md too, so this survives changing sync method
 * later.
 *
 * The leading underscore is the vault's own mark for a file in the clippings
 * folder that is not a clipping, and isInFolder already skips those, so the
 * index never sees it despite it now being a note.
 */
export const SHARED_FILE = "_Oriko.md";
/**
 * Earlier names for the same file, read once and retired so a vault that
 * already published one carries over instead of starting again. Ordered
 * newest first: the pre-rename .md, then the .json that preceded it.
 */
export const LEGACY_SHARED_FILES = ["_Power Grid.md", "_Power Grid.json"];

export function sharedOf(settings: OrikoSettings): SharedConfig {
  // Copied, not referenced. The caller pushes grids onto this list, and
  // handing out the array inside DEFAULT_SETTINGS would let a vault with no
  // grids yet write real user data into a module-level constant.
  return {
    grids: [...settings.grids],
    folders: [...settings.folders],
    homeGridName: settings.homeGridName,
    homeGridIcon: settings.homeGridIcon,
    filterProperties: [...settings.filterProperties],
  };
}

/**
 * Whether a device has anything of its own to say about the vault.
 *
 * This decides which device gets to write the file first, and it has to,
 * because whoever writes it wins: every other device reads that file and
 * adopts it. A vault upgraded on a phone before the desktop it was
 * configured on would otherwise publish an empty grid list, and the desktop
 * would come up, read it, and lose everything it had.
 *
 * So a device holding nothing but the defaults stays quiet and waits to be
 * told. The one with the grids publishes them, and if no device has any
 * there is nothing to lose by there being no file yet.
 */
export function isDefaultShared(shared: SharedConfig): boolean {
  const base = sharedOf(DEFAULT_SETTINGS);
  return (
    shared.grids.length === 0 &&
    shared.folders.length === 0 &&
    shared.homeGridName === base.homeGridName &&
    shared.homeGridIcon === base.homeGridIcon &&
    shared.filterProperties.length === base.filterProperties.length &&
    shared.filterProperties.every((p, i) => p === base.filterProperties[i])
  );
}

export function withShared(
  settings: OrikoSettings,
  shared: SharedConfig
): OrikoSettings {
  return { ...settings, ...shared };
}

function isGrid(value: unknown): value is GridSpace {
  if (typeof value !== "object" || value === null) return false;
  const grid = value as Partial<GridSpace>;
  if (typeof grid.name !== "string" || grid.name === "") return false;
  if (typeof grid.icon !== "string") return false;
  // Rules are the smart grid's membership. Absent is a manual grid; anything
  // that is not an object is a file someone has edited into nonsense, and
  // dropping the rules turns that grid manual rather than losing it.
  return grid.rules === undefined || (typeof grid.rules === "object" && grid.rules !== null);
}

function isFolder(value: unknown): value is FolderSpace {
  if (typeof value !== "object" || value === null) return false;
  const folder = value as Partial<FolderSpace>;
  if (typeof folder.name !== "string" || folder.name === "") return false;
  if (typeof folder.icon !== "string") return false;
  if (typeof folder.grid !== "string") return false;
  // A width the wall cannot lay out is a folder it cannot show, and showing
  // it at some guessed size would then be written back as the truth.
  return isFolderWidth(folder.width);
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v): v is string => typeof v === "string") ? [...value] : null;
}

/**
 * Reads what a shared file claims, field by field, keeping whatever this
 * device already had wherever the file does not say something usable.
 *
 * Per field rather than all or nothing on purpose. This file is synced, so
 * it can arrive half-written or merged badly by something that has never
 * heard of it, and one bad key should not throw away the grids next to it.
 */
export function parseShared(raw: unknown, fallback: SharedConfig): SharedConfig {
  if (typeof raw !== "object" || raw === null) return fallback;
  const from = raw as Record<string, unknown>;

  const grids = Array.isArray(from.grids) ? from.grids.filter(isGrid) : null;
  // Missing is the pre-folders file, and that means no folders rather than
  // whatever this device last saw: the file is the truth for the vault.
  const folders = Array.isArray(from.folders) ? from.folders.filter(isFolder) : [];
  const properties = strings(from.filterProperties);

  return {
    grids: grids ?? fallback.grids,
    folders,
    homeGridName:
      typeof from.homeGridName === "string" && from.homeGridName !== ""
        ? from.homeGridName
        : fallback.homeGridName,
    homeGridIcon:
      typeof from.homeGridIcon === "string" && from.homeGridIcon !== ""
        ? from.homeGridIcon
        : fallback.homeGridIcon,
    filterProperties: properties ?? fallback.filterProperties,
  };
}

/** What a device should start from when no file has been written yet. */
export function defaultShared(): SharedConfig {
  return sharedOf(DEFAULT_SETTINGS);
}

const FENCE = "```";

/** Serialised the way it is written, so a caller can tell its own write back
    from one that arrived by sync without re-reading the file. */
export function serializeShared(shared: SharedConfig): string {
  return [
    "# Oriko",
    "",
    "The grids and folders in this vault, shared by every device that opens it. Written by the Oriko plugin; change them in the app rather than here.",
    "",
    `${FENCE}json`,
    JSON.stringify(shared, null, 2),
    FENCE,
    "",
  ].join("\n");
}

/**
 * Pulls the configuration out of a file, whichever of the two forms it is in.
 *
 * The fenced block is the current one. A file that is bare JSON is the .json
 * this replaced, read so that a vault which already published one is carried
 * over rather than starting again.
 */
export function extractShared(text: string): unknown {
  const fenced = new RegExp(`${FENCE}json\\s*\\n([\\s\\S]*?)${FENCE}`).exec(text);
  const body = fenced ? fenced[1] : text;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
