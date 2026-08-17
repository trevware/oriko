export interface ClippingsGridSettings {
  clippingsFolder: string;
  attachmentFolder: string;
  archiveOnCreate: boolean;
  autoplayVideo: boolean;
  maxBytes: number;
  thumbnailWidth: number;
}

export const DEFAULT_SETTINGS: ClippingsGridSettings = {
  clippingsFolder: "Clippings",
  attachmentFolder: "Attachments/Clippings",
  archiveOnCreate: true,
  autoplayVideo: true,
  maxBytes: 26214400,
  thumbnailWidth: 400,
};
