import { App, Modal, Setting } from "obsidian";

/**
 * Deleting notes is not undoable from inside the plugin, so it always asks
 * first and names exactly what will go. Files move to the system trash via
 * Obsidian's own file manager, so a mistake is still recoverable.
 */
export class ConfirmDeleteModal extends Modal {
  constructor(
    app: App,
    private titles: string[],
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const count = this.titles.length;

    contentEl.createEl("h3", {
      text: count === 1 ? "Delete this clipping?" : `Delete ${count} clippings?`,
    });

    contentEl.createEl("p", {
      text:
        count === 1
          ? "The note will be moved to trash. Its archived media stays in your vault."
          : `${count} notes will be moved to trash. Their archived media stays in your vault.`,
    });

    const list = contentEl.createEl("ul", { cls: "pg-confirm-list" });
    for (const title of this.titles.slice(0, 8)) {
      list.createEl("li", { text: title });
    }
    if (count > 8) {
      list.createEl("li", { text: `and ${count - 8} more…`, cls: "pg-confirm-more" });
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      )
      .addButton((button) =>
        button
          .setButtonText(count === 1 ? "Delete note" : `Delete ${count} notes`)
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
