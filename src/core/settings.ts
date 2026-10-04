import type { DensityStage } from "./density";
import type { GridLook, LookScope } from "./look";
import type { FolderSpace } from "./folders";
import type { GridSpace, SharedClipTarget } from "./spaces";

/**
 * How a site's card shows its details on the wall: a band under the picture
 * all the time, the band over the picture while you hover, or a plain tile.
 */
export type CardMode = "always" | "hover" | "never";

export function isCardMode(value: unknown): value is CardMode {
  return value === "always" || value === "hover" || value === "never";
}

export interface OrikoSettings {
  clippingsFolder: string;
  attachmentFolder: string;
  archiveOnCreate: boolean;
  /** Add new files in the clippings folder to the wall as they appear. */
  watchClippings: boolean;
  autoplayVideo: boolean;
  maxBytes: number;
  thumbnailWidth: number;
  /**
   * Allow community mirrors to resolve media that a site will not publish
   * itself: fxtwitter for X, kkinstagram for Instagram. Sends the pasted URL
   * to that mirror. With this off, those posts fall back to whatever poster
   * image the site gives its own crawlers.
   */
  useResolvers: boolean;

  /**
   * Frontmatter keys offered as filter facets, in the order they appear in the
   * menu. The default reproduces the four-facet menu this replaced.
   */
  filterProperties: string[];

  /**
   * What a hovered tile shows, see badges.ts. `tileDate` is a date property
   * read as a relative time in the top-right; `tileProperty` is any other
   * property, a pill per value in the bottom-left. "" leaves a corner empty.
   */
  tileDate: string;
  tileProperty: string;

  /**
   * Grids the user created, in the order they appear in the switcher, which
   * is also the order their hotkeys run in. Home is not stored here: it always
   * exists and is always first.
   */
  grids: GridSpace[];
  /** The folders on every grid, shared with the grids. See folders.ts. */
  folders: FolderSpace[];
  /** Display name of the implicit grid. A clipping with no key belongs to it. */
  homeGridName: string;
  homeGridIcon: string;
  /** Name of the grid on screen, persisted so a restart reopens where you were. */
  activeGrid: string;
  /**
   * Where a clip arriving through the obsidian://oriko URI is filed: the
   * share sheet on a phone, a terminal on a desktop. In-app clips always go
   * to the open grid; this exists because on a phone the open grid is
   * whatever was left up hours ago.
   */
  sharedClipTarget: SharedClipTarget;
  /** Whether the layer panel is showing, kept so it opens as you left it. */
  /**
   * How densely the wall is packed, as a named stage (see density.ts). The
   * shared answer, used by every grid while `gridLookScope` is "all" and by
   * any grid that has not set its own while it is "grid".
   */
  tileSize: DensityStage;

  /**
   * Whether the five look settings answer once for every grid, or once per
   * grid. See look.ts, which owns what "the five" are and how a grid's own
   * value falls back to the shared one.
   */
  gridLookScope: LookScope;
  /** Home's own look. Home is not in `grids`, so it keeps its slot here,
      beside the name and icon it already keeps here for the same reason. */
  homeGridLook?: GridLook;
  /**
   * Per-grid tile size, by grid key ("" for home). Apart from the rest of a
   * grid's look and out of SharedConfig on purpose: a stage is a target
   * column width in pixels, so a grid set to Huge on a desktop would arrive
   * on a phone as one column per row. Keyed by name because it is not stored
   * with the grid, which is why renameGridDef has to move its key.
   */
  gridTileSizes: Record<string, DensityStage>;
  /** How a Steam store page shows its name, genres and price on the wall. */
  steamCards: CardMode;
  /** How an X post shows who posted it and what they said on the wall. */
  xCards: CardMode;
  /** Full path to yt-dlp, "" to discover it on PATH and in common installs. */
  ytdlpPath: string;
  /** Full path to ffmpeg, "" to discover it on PATH and in common installs. */
  ffmpegPath: string;
}

export const DEFAULT_SETTINGS: OrikoSettings = {
  clippingsFolder: "Clippings",
  attachmentFolder: "Attachments/Clippings",
  archiveOnCreate: true,
  watchClippings: true,
  autoplayVideo: true,
  maxBytes: 26214400,
  thumbnailWidth: 400,
  useResolvers: true,
  filterProperties: ["categories", "status"],
  tileDate: "created",
  tileProperty: "categories",
  grids: [],
  folders: [],
  homeGridName: "Clippings",
  homeGridIcon: "layout-grid",
  activeGrid: "Clippings",
  sharedClipTarget: "last-opened",
  tileSize: "m",
  gridLookScope: "all",
  gridTileSizes: {},
  steamCards: "always",
  xCards: "always",
  ytdlpPath: "",
  ffmpegPath: "",
};
