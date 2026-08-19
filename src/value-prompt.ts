import { App, Modal, Setting } from "obsidian";
import { ListSuggest } from "./suggest";

/**
 * Asks for a property value that is not in the menu yet.
 *
 * A modal rather than a field in the menu itself: the menu is a list of rows
 * driven entirely by arrow keys and Escape, and an input inside it would give
 * those keys two meanings depending on where focus sat. That menu is shared
 * with the grid switcher and the create and settings menus, so the regression
 * would not stay local either.
 */
export class ValuePromptModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private title: string,
    /** Values already in use, offered as type-ahead. */
    private options: string[],
    private onSubmit: (value: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });

    new Setting(contentEl).addText((text) => {
      text.setPlaceholder("value");
      text.onChange((value) => {
        this.value = value;
      });

      // Suggests what is already in use even here, so the prompt nudges
      // towards the existing spelling rather than quietly forking it.
      new ListSuggest(this.app, text.inputEl, this.options, (picked) => {
        this.value = picked;
        this.submit();
      });

      text.inputEl.onkeydown = (event: KeyboardEvent) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        this.submit();
      };

      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) =>
        button.setButtonText("Add").setCta().onClick(() => this.submit())
      );
  }

  private submit(): void {
    const value = this.value.trim();
    if (!value) return;
    this.close();
    this.onSubmit(value);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
