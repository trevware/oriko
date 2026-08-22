import type { DensityStage } from "./density";
import type { GridSpace } from "./spaces";

export interface PowerGridSettings {
  clippingsFolder: string;
  attachmentFolder: string;
  archiveOnCreate: boolean;
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
  /** Whether the layer panel is showing, kept so it opens as you left it. */
  panelOpen: boolean;
  /**
   * How densely the wall is packed, as a named stage (see density.ts). One
   * setting for every pane rather than one per grid: it is about how much
   * room the pane has, not which grid is in it.
   */
  tileSize: DensityStage;
}

export const DEFAULT_SETTINGS: PowerGridSettings = {
  clippingsFolder: "Clippings",
  attachmentFolder: "Attachments/Clippings",
  archiveOnCreate: true,
  autoplayVideo: true,
  maxBytes: 26214400,
  thumbnailWidth: 400,
  useResolvers: true,
  filterProperties: ["categories", "status"],
  grids: [],
  homeGridName: "Clippings",
  homeGridIcon: "layout-grid",
  activeGrid: "Clippings",
  panelOpen: false,
  tileSize: "m",
};
