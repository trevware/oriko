import type { DateWindow } from "./dates";
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
   * Relative windows offered by every date facet, on top of the built-in ones.
   * Empty by default: the built-ins cover the common spans, and this is for
   * the one span a particular vault keeps reaching for.
   */
  dateWindows: DateWindow[];

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
  dateWindows: [],
  grids: [],
  homeGridName: "Clippings",
  homeGridIcon: "layout-grid",
  activeGrid: "Clippings",
  panelOpen: false,
};
