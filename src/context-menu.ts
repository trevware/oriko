import { setIcon } from "obsidian";
import { placeMenu } from "./layout";

export interface MenuItem {
  icon: string;
  label: string;
  /** Right-hand text: a shortcut hint or a count. */
  detail?: string;
  destructive?: boolean;
  /** Draws a rule above this row, for grouping without a heading. */
  divider?: boolean;
  /** Dimmed and inert: shown so the set reads whole, but not selectable. */
  disabled?: boolean;
  /**
   * Rows for a panel that opens beside this one. The parent stays open and
   * the row stays lit, so the choice keeps the context it was made from.
   */
  submenu?: MenuItem[];
  onSelect?: () => void;
}

/** Space between a panel and the submenu it opens. */
const SUBMENU_GAP = 6;
/** Panel padding, so a submenu's first row lines up with its parent row. */
const PANEL_PADDING = 10;
const EDGE = 8;

/**
 * Floating menu for the grid, dimming the wall behind it so the choice is
 * the only thing in focus. Also used for the grid switcher and the create
 * and settings menus, which are the same object in a different place.
 */
export class ContextMenu {
  private backdrop: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private sub: HTMLElement | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;

  constructor(private container: HTMLElement) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  open(items: MenuItem[], clientX: number, clientY: number): void {
    this.close();
    if (items.length === 0) return;

    this.backdrop = this.container.createDiv({ cls: "pg-menu-backdrop" });
    this.panel = this.container.createDiv({ cls: "pg-menu" });
    this.fill(this.panel, items);

    const bounds = this.container.getBoundingClientRect();
    const at = placeMenu(
      { x: clientX - bounds.left, y: clientY - bounds.top },
      this.measure(this.panel),
      { width: bounds.width, height: bounds.height }
    );
    this.panel.style.left = `${at.x}px`;
    this.panel.style.top = `${at.y}px`;

    // Transform origin follows the anchor, so it grows from where it came.
    this.panel.style.transformOrigin = `${clientX - bounds.left - at.x}px ${
      clientY - bounds.top - at.y
    }px`;

    this.backdrop.onclick = () => this.close();
    this.backdrop.oncontextmenu = (event: MouseEvent) => {
      event.preventDefault();
      this.close();
    };

    this.onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      // Escape backs out one level at a time, rather than throwing away the
      // parent menu along with the submenu you were only glancing at.
      if (this.sub) this.closeSub();
      else this.close();
    };
    document.addEventListener("keydown", this.onKey, true);

    // Next frame, so the entry transition has a state to move from.
    window.requestAnimationFrame(() => {
      this.backdrop?.addClass("is-open");
      this.panel?.addClass("is-open");
    });
  }

  /**
   * Untransformed size. The panel is mounted at scale(0.94) for its entry
   * animation, and getBoundingClientRect reports the *transformed* box, so
   * measuring that way returned a width 6% short and every right-aligned
   * menu landed off by a few percent of its own width.
   */
  private measure(element: HTMLElement): { width: number; height: number } {
    return { width: element.offsetWidth, height: element.offsetHeight };
  }

  private fill(panel: HTMLElement, items: MenuItem[]): void {
    for (const item of items) {
      if (item.divider) panel.createDiv({ cls: "pg-menu-divider" });

      const row = panel.createDiv({ cls: "pg-menu-item" });
      if (item.destructive) row.addClass("is-destructive");
      if (item.disabled) row.addClass("is-disabled");

      const icon = row.createDiv({ cls: "pg-menu-icon" });
      setIcon(icon, item.icon);
      row.createDiv({ cls: "pg-menu-label", text: item.label });

      if (item.submenu) {
        row.addClass("is-parent");
        const arrow = row.createDiv({ cls: "pg-menu-arrow" });
        setIcon(arrow, "arrow-right");
      } else if (item.detail) {
        row.createDiv({ cls: "pg-menu-detail", text: item.detail });
      }

      // Only the top panel spawns submenus, so only its rows manage one.
      if (panel === this.panel) {
        row.onmouseenter = () => {
          if (item.disabled) return;
          if (item.submenu) this.openSub(row, item.submenu);
          else this.closeSub();
        };
      }

      row.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        if (item.disabled) return;
        if (item.submenu) {
          this.openSub(row, item.submenu);
          return;
        }
        this.close();
        item.onSelect?.();
      };
    }
  }

  /** Beside the parent, top aligned with the row that opened it. */
  private openSub(row: HTMLElement, items: MenuItem[]): void {
    if (row.hasClass("is-open-parent")) return;
    this.closeSub();
    if (!this.panel || items.length === 0) return;

    row.addClass("is-open-parent");
    this.sub = this.container.createDiv({ cls: "pg-menu pg-menu-sub" });
    this.fill(this.sub, items);

    const bounds = this.container.getBoundingClientRect();
    const parent = this.panel.getBoundingClientRect();
    const anchor = row.getBoundingClientRect();
    const size = this.measure(this.sub);

    let x = parent.right - bounds.left + SUBMENU_GAP;
    // Not enough room to the right: fold back over the parent's left side.
    if (x + size.width + EDGE > bounds.width) {
      x = parent.left - bounds.left - size.width - SUBMENU_GAP;
    }
    x = Math.max(EDGE, Math.min(x, bounds.width - size.width - EDGE));

    const y = Math.max(
      EDGE,
      Math.min(anchor.top - bounds.top - PANEL_PADDING, bounds.height - size.height - EDGE)
    );

    this.sub.style.left = `${x}px`;
    this.sub.style.top = `${y}px`;
    this.sub.style.transformOrigin = `${x < parent.left - bounds.left ? size.width : 0}px ${
      anchor.top - bounds.top - y
    }px`;

    window.requestAnimationFrame(() => this.sub?.addClass("is-open"));
  }

  private closeSub(): void {
    this.sub?.remove();
    this.sub = null;
    this.panel?.findAll(".is-open-parent").forEach((row) => row.removeClass("is-open-parent"));
  }

  close(): void {
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.closeSub();
    this.backdrop?.remove();
    this.panel?.remove();
    this.backdrop = null;
    this.panel = null;
  }
}
