import type { DensityStage } from "./density";
import type { GridSpace, SharedClipTarget } from "./spaces";

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
   * Frontmatter keys shown on a tile when it is hovered, in order. A date
   * reads as a relative time in the top-right; anything else is a pill in
   * the bottom-left. See badges.ts.
   */
  tileProperties: string[];

  /**
   * Grids the user created, in the order they appear in the switcher, which
   * is also the order their hotkeys run in. Home is not stored here: it always
   * exists and is always first.
   */
  grids: GridSpace[];
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
   * How densely the wall is packed, as a named stage (see density.ts). One
   * setting for every pane rather than one per grid: it is about how much
   * room the pane has, not which grid is in it.
   */
  tileSize: DensityStage;
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
  tileProperties: ["created", "categories"],
  grids: [],
  homeGridName: "Clippings",
  homeGridIcon: "layout-grid",
  activeGrid: "Clippings",
  sharedClipTarget: "last-opened",
  tileSize: "m",
  ytdlpPath: "",
  ffmpegPath: "",
};
