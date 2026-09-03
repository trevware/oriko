import { setIcon } from "obsidian";
import { attachTip } from "./core/tip";

export interface ActionBarHandlers {
  /** Opens the property menu for the selection, anchored to the button. */
  onProperties: (x: number, y: number) => void;
  onDelete: () => void;
  /** Leaves selection mode with nothing selected. */
  onDone: () => void;
}

/**
 * Floating bar that rises from the bottom of the grid while something is
 * selected. Deliberately small: it holds the actions that apply to a
 * selection, and nothing else competes with the wall for attention.
 */
export class ActionBar {
  private root: HTMLElement;
  private count: HTMLElement;
  private properties: HTMLElement;

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

    this.button("trash-2", "Delete", "⌫", handlers.onDelete);
  }

  /** Where the property menu opens from, whether by click or by key. */
  propertiesAnchor(): { x: number; y: number } {
    const rect = this.properties.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top };
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
