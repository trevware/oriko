import { AbstractInputSuggest, App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { surveyProperties } from "./core/facet-catalog";
import { facetLabel } from "./core/filter";
import { OrikoView, VIEW_TYPE_GRID } from "./view";
import type OrikoPlugin from "./main";

/**
 * Type-ahead over the property names already in the vault.
 *
 * Obsidian's own suggester rather than a <datalist>: that is drawn by Chromium
 * and takes no styling at all, so it lands on the settings pane as a black box
 * in a bold serif stack, matching neither the theme nor anything else on the
 * page. This renders in the same popover the file and folder suggesters use.
 */
class PropertySuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private options: string[],
    private pick: (key: string) => void
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): string[] {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return this.options;
    return this.options.filter((key) => key.toLowerCase().includes(wanted));
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    this.close();
    this.pick(value);
  }
}

export class OrikoSettingTab extends PluginSettingTab {
  /** Set while the text control is built, so the Add button beside it can
      commit the same value the Enter key does. */
  private addProperty: (() => void) | null = null;

  constructor(app: App, private plugin: OrikoPlugin) {
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
      if (leaf.view instanceof OrikoView) leaf.view.refreshFacets();
    }
    this.display();
  }

  private paintFilterProperties(containerEl: HTMLElement): void {
    const enabled = this.plugin.settings.filterProperties;

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

        // One shot: commit re-renders the tab and rebuilds these closures, so
        // a suggester pick and the Enter key both landing would otherwise add
        // against a list that is already stale.
        let done = false;
        const add = (key: string): void => {
          const name = key.trim();
          if (done || !name || enabled.includes(name)) return;
          done = true;
          void this.commit([...enabled, name]);
        };

        new PropertySuggest(this.app, text.inputEl, available, add);

        text.inputEl.onkeydown = (event: KeyboardEvent) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          add(text.getValue());
        };
        this.addProperty = () => add(text.getValue());
      })
      .addButton((button) =>
        button.setButtonText("Add").onClick(() => this.addProperty?.())
      );
  }

  /**
   * The whole tab, declaratively, so every setting is reachable from
   * Obsidian's settings search. Values flow through getControlValue and
   * setControlValue below, which is where the byte-to-megabyte translation
   * and the folder-change side effects live.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Clippings folder",
        desc: "The folder the wall shows. Every note in it is a clipping.",
        control: { type: "folder", key: "clippingsFolder", defaultValue: "Clippings" },
      },
      {
        name: "Attachment folder",
        desc: "Where downloaded copies of remote images and videos are kept.",
        control: {
          type: "folder",
          key: "attachmentFolder",
          defaultValue: "Attachments/Clippings",
        },
      },
      {
        type: "group",
        heading: "Wall",
        items: [
          {
            name: "Autoplay videos",
            desc: "Play video tiles while they are in view. Reduce Motion always wins.",
            control: { type: "toggle", key: "autoplayVideo" },
          },
          {
            name: "Add new clippings automatically",
            desc: "Show new files from the clippings folder on the wall the moment they arrive. When off, they appear after a relaunch or the 'Rescan clippings folder' command.",
            control: { type: "toggle", key: "watchClippings" },
          },
        ],
      },
      {
        type: "group",
        heading: "Downloads",
        items: [
          {
            name: "Download media automatically",
            desc: "Keep a local copy of each clipping's remote images and videos, so they survive the source going away. Runs in the background as clippings arrive.",
            control: { type: "toggle", key: "archiveOnCreate" },
          },
          {
            name: "Use community media resolvers",
            desc: "X and Instagram never publish their video URLs, so pasting a post can only reach the video through a community mirror (fxtwitter, kkinstagram). This sends the pasted URL to that mirror. Turn it off to stay first-party, and those posts fall back to whatever poster image the site publishes.",
            control: { type: "toggle", key: "useResolvers" },
          },
          {
            name: "Maximum file size (MB)",
            desc: "Skip downloads larger than this.",
            control: { type: "number", key: "maxSizeMb" },
          },
          {
            name: "Preview width (px)",
            desc: "Pixel width of generated video posters and GIF stills.",
            control: { type: "number", key: "thumbnailWidth" },
          },
        ],
      },
      {
        type: "group",
        heading: "Filter properties",
        items: [
          {
            name: "Filter properties",
            aliases: ["facets"],
            render: (setting) => {
              const el = setting.settingEl;
              el.empty();
              el.addClass("pg-props-setting");
              this.paintFilterProperties(el);
            },
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "maxSizeMb") return Math.round(this.plugin.settings.maxBytes / 1048576);
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  setControlValue(key: string, value: unknown): void | Promise<void> {
    const settings = this.plugin.settings;
    switch (key) {
      case "clippingsFolder": {
        settings.clippingsFolder = String(value).trim() || "Clippings";
        return this.plugin.saveSettings().then(() => this.plugin.index.rebuild());
      }
      case "attachmentFolder": {
        settings.attachmentFolder = String(value).trim() || "Attachments/Clippings";
        break;
      }
      case "maxSizeMb": {
        const mb = Number(value);
        if (!Number.isFinite(mb) || mb <= 0) return;
        settings.maxBytes = Math.round(mb * 1048576);
        break;
      }
      case "thumbnailWidth": {
        const width = Number(value);
        if (!Number.isFinite(width) || width < 100) return;
        settings.thumbnailWidth = Math.round(width);
        break;
      }
      default:
        (settings as unknown as Record<string, unknown>)[key] = value;
    }
    return this.plugin.saveSettings();
  }
}
