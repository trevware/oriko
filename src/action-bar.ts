import { setIcon } from "obsidian";
import { attachTip } from "./tip";

export interface ActionBarHandlers {
  onDelete: () => void;
}

/**
 * Floating bar that rises from the bottom of the grid while something is
 * selected. Deliberately small: it holds the actions that apply to a
 * selection, and nothing else competes with the wall for attention.
 */
export class ActionBar {
  private root: HTMLElement;
  private count: HTMLElement;

  constructor(container: HTMLElement, handlers: ActionBarHandlers) {
    this.root = container.createDiv({ cls: "pg-actionbar" });

    this.count = this.root.createDiv({ cls: "pg-actionbar-count" });

    this.root.createDiv({ cls: "pg-bar-divider" });

    this.button("trash-2", "Delete", "⌫", handlers.onDelete);
  }

  private button(icon: string, label: string, shortcut: string, onClick: () => void): void {
    const button = this.root.createEl("button", { cls: "pg-actionbar-button" });
    setIcon(button, icon);
    attachTip(button, label, shortcut);

    button.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      onClick();
    };
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
