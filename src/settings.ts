export interface ClippingsGridSettings {
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
}

export const DEFAULT_SETTINGS: ClippingsGridSettings = {
  clippingsFolder: "Clippings",
  attachmentFolder: "Attachments/Clippings",
  archiveOnCreate: true,
  autoplayVideo: true,
  maxBytes: 26214400,
  thumbnailWidth: 400,
  useResolvers: true,
};
