import { AbstractInputSuggest } from "obsidian";
import type { App } from "obsidian";

/**
 * Type-ahead over a fixed list of strings, in Obsidian's own suggestion
 * popover.
 *
 * Obsidian's suggester rather than a <datalist>: that is drawn by Chromium and
 * takes no styling at all, so it lands as a black box in a bold serif stack,
 * matching neither the theme nor anything around it. This renders in the same
 * popover the file and folder suggesters use.
 *
 * Shared by the settings tab, which suggests property names, and the value
 * prompt, which suggests values already in use for a property.
 */
export class ListSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private options: string[],
    private pick: (value: string) => void
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): string[] {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return this.options;
    return this.options.filter((option) => option.toLowerCase().includes(wanted));
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
