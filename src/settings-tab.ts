import { App, PluginSettingTab, Setting } from "obsidian";
import { surveyProperties } from "./facet-catalog";
import { facetLabel } from "./filter";
import { PowerGridView, VIEW_TYPE_GRID } from "./view";
import type PowerGridPlugin from "./main";

export class PowerGridSettingTab extends PluginSettingTab {
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
      text:
        "Frontmatter properties the filter menu offers, in this order. " +
        "Media type and Source are always available and are not listed here, " +
        "because no property backs them.",
    });

    enabled.forEach((key, index) => {
      new Setting(containerEl)
        .setName(facetLabel(key))
        .setDesc(key)
        .addExtraButton((button) =>
          button
            .setIcon("chevron-up")
            .setTooltip("Move up")
            .setDisabled(index === 0)
            .onClick(() => {
              const next = [...enabled];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              void this.commit(next);
            })
        )
        .addExtraButton((button) =>
          button
            .setIcon("chevron-down")
            .setTooltip("Move down")
            .setDisabled(index === enabled.length - 1)
            .onClick(() => {
              const next = [...enabled];
              [next[index], next[index + 1]] = [next[index + 1], next[index]];
              void this.commit(next);
            })
        )
        .addExtraButton((button) =>
          button
            .setIcon("x")
            .setTooltip("Remove")
            .onClick(() => void this.commit(enabled.filter((k) => k !== key)))
        );
    });

    if (enabled.length === 0) {
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "No properties enabled. The menu still offers Media type and Source.",
      });
    }

    const survey = surveyProperties(this.plugin.index.records()).filter(
      (stat) => !enabled.includes(stat.key)
    );

    if (survey.length > 0) {
      new Setting(containerEl).setName("Found in your clippings").setHeading();

      for (const stat of survey) {
        const notes = `${stat.notes} ${stat.notes === 1 ? "note" : "notes"}`;
        const values = `${stat.distinct} ${stat.distinct === 1 ? "value" : "values"}`;
        new Setting(containerEl)
          .setName(facetLabel(stat.key))
          // The counts are the whole reason this list is worth showing: they
          // are what tells you a property is worth filtering by before you
          // switch it on.
          .setDesc(
            stat.suggested
              ? `${stat.key} · ${notes}, ${values} · recommended`
              : `${stat.key} · ${notes}, ${values}`
          )
          .addButton((button) => {
            // The recommended ones get the accent treatment, so the list reads
            // as a recommendation rather than an undifferentiated dump.
            if (stat.suggested) button.setCta();
            button
              .setButtonText("Add")
              .onClick(() => void this.commit([...enabled, stat.key]));
          });
      }
    }

    let typed = "";
    new Setting(containerEl)
      .setName("Add a property")
      .setDesc("For a property you have not started filling in yet.")
      .addText((text) =>
        text.setPlaceholder("property name").onChange((value) => {
          typed = value.trim();
        })
      )
      .addButton((button) =>
        button.setButtonText("Add").onClick(() => {
          if (!typed || enabled.includes(typed)) return;
          void this.commit([...enabled, typed]);
        })
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
