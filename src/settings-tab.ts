import { App, PluginSettingTab, Setting } from "obsidian";
import { tesseractPath, visionAvailable } from "./convert";
import type PowerGridPlugin from "./main";
import { chooseEngine } from "./ocr";

export class PowerGridSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PowerGridPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Clippings folder")
      .setDesc("Folder scanned for clippings.")
      .addText((text) =>
        text.setValue(this.plugin.settings.clippingsFolder).onChange(async (value) => {
          this.plugin.settings.clippingsFolder = value.trim() || "Clippings";
          await this.plugin.saveSettings();
          await this.plugin.index.rebuild();
        })
      );

    new Setting(containerEl)
      .setName("Attachment folder")
      .setDesc("Where archived images and video are stored.")
      .addText((text) =>
        text.setValue(this.plugin.settings.attachmentFolder).onChange(async (value) => {
          this.plugin.settings.attachmentFolder = value.trim() || "Attachments/Clippings";
          await this.plugin.saveSettings();
        })
      );

    const engine = chooseEngine({
      vision: visionAvailable(),
      tesseract: tesseractPath() !== null,
    });

    new Setting(containerEl)
      .setName("Read text in images")
      // Names the engine rather than claiming it works: this is the one
      // setting whose answer depends on what the machine happens to have.
      .setDesc(
        engine === "vision"
          ? "Search finds words inside screenshots, using macOS Vision."
          : engine === "tesseract"
            ? "Search finds words inside screenshots, using tesseract."
            : "No OCR engine found. macOS uses Vision automatically; elsewhere, install tesseract."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.readImageText)
          .setDisabled(engine === null)
          .onChange(async (value) => {
            this.plugin.settings.readImageText = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Archive automatically")
      .setDesc("Download media for new clippings in the background.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.archiveOnCreate).onChange(async (value) => {
          this.plugin.settings.archiveOnCreate = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Autoplay video")
      .setDesc("Play video tiles in view. Reduce Motion always wins.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoplayVideo).onChange(async (value) => {
          this.plugin.settings.autoplayVideo = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Use community media resolvers")
      .setDesc(
        "X and Instagram never publish their video URLs, so pasting a post can only " +
          "reach the video through a community mirror (fxtwitter, kkinstagram). This " +
          "sends the pasted URL to that mirror. Turn it off to stay first-party, and " +
          "those posts fall back to whatever poster image the site publishes."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useResolvers).onChange(async (value) => {
          this.plugin.settings.useResolvers = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Maximum file size (MB)")
      .setDesc("Downloads larger than this are skipped.")
      .addText((text) =>
        text
          .setValue(String(Math.round(this.plugin.settings.maxBytes / 1048576)))
          .onChange(async (value) => {
            const mb = Number(value);
            if (Number.isFinite(mb) && mb > 0) {
              this.plugin.settings.maxBytes = Math.round(mb * 1048576);
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Preview width (px)")
      .setDesc("Size of generated video posters and GIF stills.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.thumbnailWidth)).onChange(async (value) => {
          const width = Number(value);
          if (Number.isFinite(width) && width >= 100) {
            this.plugin.settings.thumbnailWidth = Math.round(width);
            await this.plugin.saveSettings();
          }
        })
      );
  }
}
