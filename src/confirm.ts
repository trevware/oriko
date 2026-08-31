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
    private onConfirm: () => void,
    /**
     * The archived media that goes with them, already reference counted:
     * anything a surviving clipping still points at is not in here.
     */
    private media?: string
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const count = this.titles.length;

    this.setTitle(count === 1 ? "Delete this clipping?" : `Delete ${count} clippings?`);

    const noun = count === 1 ? "The note" : `${count} notes`;
    contentEl.createEl("p", {
      text: this.media
        ? `${noun} will be moved to trash, along with ${this.media} of archived media nothing else uses.`
        : `${noun} will be moved to trash. No archived media is used only by ${
            count === 1 ? "it" : "them"
          }.`,
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
          .setDestructive()
          .setCta()
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

/**
 * Confirms a sweep of orphaned media.
 *
 * Separate from the note confirmation on purpose: this one is the plugin
 * proposing to delete files nothing pointed it at, which is a bigger claim
 * than removing what you just asked to remove. It names the folder, shows
 * what it found, and never runs without an answer.
 */
export class ConfirmSweepModal extends Modal {
  constructor(
    app: App,
    private found: { paths: string[] },
    private summary: string,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;

    this.setTitle("Remove orphaned media?");
    contentEl.createEl("p", {
      text: `${this.summary} in your attachment folder are no longer used by any clipping. They will be moved to trash.`,
    });

    const list = contentEl.createEl("ul", { cls: "pg-confirm-list" });
    for (const path of this.found.paths.slice(0, 8)) {
      list.createEl("li", { text: path.slice(path.lastIndexOf("/") + 1) });
    }
    if (this.found.paths.length > 8) {
      list.createEl("li", {
        text: `and ${this.found.paths.length - 8} more…`,
        cls: "pg-confirm-more",
      });
    }

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("Move to trash")
          .setDestructive()
          .setCta()
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
