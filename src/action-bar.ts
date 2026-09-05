import { setIcon } from "obsidian";
import { attachTip } from "./core/tip";

export interface ActionBarHandlers {
  /** Opens the property menu for the selection, anchored to the button. */
  onProperties: (x: number, y: number) => void;
  onDelete: () => void;
  /** Opens the list of grids to move the selection to, anchored to the button. */
  onMoveToGrid: (x: number, y: number) => void;
  /** Opens the list of folders to move the selection into, anchored to the button. */
  onMoveToFolder: (x: number, y: number) => void;
  /** Leaves selection mode with nothing selected. */
  onDone: () => void;
}

/**
 * Floating bar that rises from the bottom of the grid while something is
 * selected. Deliberately small: it holds the actions that apply to a
 * selection, and nothing else competes with the wall for attention.
 */
function anchorOf(button: HTMLElement): { x: number; y: number } {
  const rect = button.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top };
}

export class ActionBar {
  private root: HTMLElement;
  private count: HTMLElement;
  private properties: HTMLElement;
  private folder: HTMLElement;

  constructor(container: HTMLElement, handlers: ActionBarHandlers) {
    this.root = container.createDiv({ cls: "pg-actionbar" });

    /*
     * A visible way out, ahead of the count.
     *
     * Tapping empty space clears the selection too, and on desktop that is
     * the whole story. On a phone it cannot be: a densely packed wall may
     * have no empty space within reach of a thumb, and while a selection is
     * up this bar has taken the bottom from the wall's own controls, so
     * being unable to leave would strand them.
     */
    this.button("x", "Done", "esc", handlers.onDone);

    this.root.createDiv({ cls: "pg-bar-divider" });

    this.count = this.root.createDiv({ cls: "pg-actionbar-count" });

    this.root.createDiv({ cls: "pg-bar-divider" });

    // Same icon, label and key as the detail view's, since it is the same
    // menu: what one clipping is, asked of several at once.
    this.properties = this.button("sliders-horizontal", "Properties", "P", () => {
      const { x, y } = this.propertiesAnchor();
      handlers.onProperties(x, y);
    });

    // Where the selection lives, beside what it is. Anchored to their own
    // buttons, as the property menu is, so the list rises out of the bar.
    const grid = this.button("corner-up-right", "Move to grid", "", () => {
      const { x, y } = anchorOf(grid);
      handlers.onMoveToGrid(x, y);
    });
    this.folder = this.button("folder", "Move to folder", "", () => {
      const { x, y } = anchorOf(this.folder);
      handlers.onMoveToFolder(x, y);
    });

    this.button("trash-2", "Delete", "⌫", handlers.onDelete);
  }

  /** Folders live on grids that can be filed into; elsewhere the button goes. */
  setFolderable(folderable: boolean): void {
    this.folder.toggle(folderable);
  }

  /** Where the property menu opens from, whether by click or by key. */
  propertiesAnchor(): { x: number; y: number } {
    return anchorOf(this.properties);
  }

  private button(
    icon: string,
    label: string,
    shortcut: string,
    onClick: () => void
  ): HTMLElement {
    const button = this.root.createEl("button", { cls: "pg-actionbar-button" });
    setIcon(button, icon);
    attachTip(button, label, shortcut);

    button.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      onClick();
    };
    return button;
  }

  setSelection(ids: string[]): void {
    const n = ids.length;
    this.count.setText(n === 1 ? "1 selected" : `${n} selected`);
    this.root.toggleClass("is-visible", n > 0);
  }

  destroy(): void {
    this.root.remove();
  }
}
