import { App, PluginSettingTab, Setting } from "obsidian";
import { surveyProperties } from "./facet-catalog";
import { facetLabel } from "./filter";
import { PowerGridView, VIEW_TYPE_GRID } from "./view";
import type PowerGridPlugin from "./main";

export class PowerGridSettingTab extends PluginSettingTab {
  /** Set while the text control is built, so the Add button beside it can
      commit the same value the Enter key does. */
  private addProperty: (() => void) | null = null;

  constructor(app: App, private plugin: PowerGridPlugin) {
    super(app, plugin);
  }

  /**
   * Saves, repaints any open wall so a new facet appears without a reload,
   * and redraws this tab so a property moves between the enabled list and the
   * one below it.
   */
  private async commit(properties: string[]): Promise<void> {
    this.plugin.settings.filterProperties = properties;
    await this.plugin.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof PowerGridView) leaf.view.refreshFacets();
    }
    this.display();
  }

  private paintFilterProperties(containerEl: HTMLElement): void {
    const enabled = this.plugin.settings.filterProperties;

    new Setting(containerEl).setName("Filter properties").setHeading();

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Offered by the filter menu, alongside Media type and Source.",
    });

    // Chips rather than a settings row each. One row per property put a
    // full-height card on screen for every key in the vault, which is a wall
    // of thirteen cards to express a list of two words.
    const chips = containerEl.createDiv({ cls: "pg-props" });
    for (const key of enabled) {
      const chip = chips.createSpan({ cls: "pg-prop" });
      chip.createSpan({ text: facetLabel(key) });
      const remove = chip.createEl("button", { cls: "pg-prop-remove", text: "\u00d7" });
      remove.setAttribute("aria-label", `Remove ${facetLabel(key)}`);
      remove.onclick = () => void this.commit(enabled.filter((k) => k !== key));
    }
    if (enabled.length === 0) {
      chips.createSpan({
        cls: "pg-props-empty",
        text: "None. The menu still offers Media type and Source.",
      });
    }

    // Suggested first, so type-ahead puts the properties worth filtering by at
    // the top of the list. The counts behind that ranking are not shown: they
    // are how the order is decided, not something to read.
    const available = surveyProperties(this.plugin.index.records())
      .filter((stat) => !enabled.includes(stat.key))
      .map((stat) => stat.key);

    new Setting(containerEl)
      .setName("Add a property")
      .setDesc("Suggestions come from your clippings. Any name works.")
      .addText((text) => {
        text.setPlaceholder("property name");

        // A datalist is one control doing both jobs: it type-aheads the keys
        // already in the vault, and still accepts a property that has been
        // decided on but not yet filled in, which no survey can find.
        const list = containerEl.createEl("datalist");
        list.id = "pg-property-suggestions";
        for (const key of available) list.createEl("option", { value: key });
        text.inputEl.setAttribute("list", list.id);

        const add = (): void => {
          const key = text.getValue().trim();
          if (!key || enabled.includes(key)) return;
          void this.commit([...enabled, key]);
        };
        text.inputEl.onkeydown = (event: KeyboardEvent) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          add();
        };
        this.addProperty = add;
      })
      .addButton((button) =>
        button.setButtonText("Add").onClick(() => this.addProperty?.())
      );
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

    this.paintFilterProperties(containerEl);
  }
}
