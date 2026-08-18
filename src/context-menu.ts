import { setIcon } from "obsidian";
import { placeMenu } from "./layout";

export interface MenuItem {
  icon: string;
  label: string;
  /** Right-hand text: a shortcut hint or a count. */
  detail?: string;
  destructive?: boolean;
  onSelect: () => void;
}

/**
 * Right-click menu for the grid, dimming the wall behind it so the choice
 * is the only thing in focus.
 */
export class ContextMenu {
  private backdrop: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;

  constructor(private container: HTMLElement) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  open(items: MenuItem[], clientX: number, clientY: number): void {
    this.close();
    if (items.length === 0) return;

    this.backdrop = this.container.createDiv({ cls: "cg-menu-backdrop" });
    this.panel = this.container.createDiv({ cls: "cg-menu" });

    for (const item of items) {
      const row = this.panel.createDiv({ cls: "cg-menu-item" });
      if (item.destructive) row.addClass("is-destructive");

      const icon = row.createDiv({ cls: "cg-menu-icon" });
      setIcon(icon, item.icon);
      row.createDiv({ cls: "cg-menu-label", text: item.label });
      if (item.detail) row.createDiv({ cls: "cg-menu-detail", text: item.detail });

      row.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        this.close();
        item.onSelect();
      };
    }

    const bounds = this.container.getBoundingClientRect();
    const size = this.panel.getBoundingClientRect();
    const at = placeMenu(
      { x: clientX - bounds.left, y: clientY - bounds.top },
      { width: size.width, height: size.height },
      { width: bounds.width, height: bounds.height }
    );
    this.panel.style.left = `${at.x}px`;
    this.panel.style.top = `${at.y}px`;

    // Transform origin follows the cursor, so it grows from where you clicked.
    this.panel.style.transformOrigin = `${clientX - bounds.left - at.x}px ${
      clientY - bounds.top - at.y
    }px`;

    this.backdrop.onclick = () => this.close();
    this.backdrop.oncontextmenu = (event: MouseEvent) => {
      event.preventDefault();
      this.close();
    };

    this.onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    };
    document.addEventListener("keydown", this.onKey, true);

    // Next frame, so the entry transition has a state to move from.
    window.requestAnimationFrame(() => {
      this.backdrop?.addClass("is-open");
      this.panel?.addClass("is-open");
    });
  }

  close(): void {
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.backdrop?.remove();
    this.panel?.remove();
    this.backdrop = null;
    this.panel = null;
  }
}
