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
  /**
   * Leaves the menu up after selecting, for a row you are expected to use
   * several of in a row. Needs a rebuild passed to open(), or the menu would
   * keep showing the state it had before you touched it.
   */
  keepOpen?: boolean;
  onSelect?: () => void;
}

interface RowRecord {
  item: MenuItem;
  root: HTMLElement;
  icon: HTMLElement;
  detail: HTMLElement;
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
  private rebuild: (() => MenuItem[]) | null = null;
  /** Rendered rows, so a keepOpen selection can patch rather than rebuild. */
  private rows: RowRecord[] = [];
  private subRows: RowRecord[] = [];
  /** Which submenu is showing, so a rebuild can put it back. */
  private openLabel: string | null = null;

  constructor(private container: HTMLElement) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  open(
    items: MenuItem[],
    clientX: number,
    clientY: number,
    rebuild?: () => MenuItem[]
  ): void {
    this.close();
    if (items.length === 0) return;
    this.rebuild = rebuild ?? null;

    this.backdrop = this.container.createDiv({ cls: "pg-menu-backdrop" });
    this.panel = this.container.createDiv({ cls: "pg-menu" });
    this.rows = this.fill(this.panel, items);

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

  private fill(panel: HTMLElement, items: MenuItem[]): RowRecord[] {
    const records: RowRecord[] = [];

    for (const item of items) {
      if (item.divider) panel.createDiv({ cls: "pg-menu-divider" });

      const row = panel.createDiv({ cls: "pg-menu-item" });
      if (item.destructive) row.addClass("is-destructive");
      if (item.disabled) row.addClass("is-disabled");

      const icon = row.createDiv({ cls: "pg-menu-icon" });
      // Blank is meaningful: an unticked row still needs the gutter, or the
      // labels jump sideways as things are selected.
      if (item.icon) setIcon(icon, item.icon);
      row.createDiv({ cls: "pg-menu-label", text: item.label });

      // Always made, even when empty: patching a row in place needs somewhere
      // to write, and :empty hides it until there is something to say.
      const detail = row.createDiv({ cls: "pg-menu-detail", text: item.detail ?? "" });

      // A parent row can carry both. A facet showing how many of its values
      // are picked still needs the arrow saying there is more inside.
      if (item.submenu) {
        row.addClass("is-parent");
        const arrow = row.createDiv({ cls: "pg-menu-arrow" });
        setIcon(arrow, "arrow-right");
      }

      const record: RowRecord = { item, root: row, icon, detail };
      records.push(record);

      // Everything below reads record.item, never the item captured above.
      // patch() swaps that field, so a handler closing over the original
      // would keep answering with the state the menu opened in: Clear
      // filters, disabled while nothing was filtered, stayed unclickable
      // after a filter was applied even though the row had visibly enabled.

      // Only the top panel spawns submenus, so only its rows manage one.
      if (panel === this.panel) {
        row.onmouseenter = () => {
          const current = record.item;
          if (current.disabled) return;
          if (current.submenu) this.openSub(row, current.submenu);
          else this.closeSub();
        };
      }

      row.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        const current = record.item;
        if (current.disabled) return;
        if (current.submenu) {
          this.openSub(row, current.submenu);
          return;
        }
        if (current.keepOpen) {
          current.onSelect?.();
          this.rerender();
          return;
        }
        this.close();
        current.onSelect?.();
      };
    }

    return records;
  }

  /**
   * Writes new state onto rows that are already there.
   *
   * Returns false if the structure moved, in which case the caller has to
   * rebuild. A toggle never moves it: the same facets with the same values,
   * differing only in which are ticked and what the counts say.
   */
  private patch(records: RowRecord[], items: MenuItem[]): boolean {
    if (records.length !== items.length) return false;
    if (records.some((record, i) => record.item.label !== items[i].label)) return false;

    records.forEach((record, i) => {
      const item = items[i];

      // Only touched when it actually changed. setIcon builds an SVG, and
      // rebuilding one per row per click is most of what a toggle used to
      // cost.
      if (record.item.icon !== item.icon) {
        record.icon.empty();
        if (item.icon) setIcon(record.icon, item.icon);
      }

      const detail = item.detail ?? "";
      if (record.detail.textContent !== detail) record.detail.setText(detail);

      record.root.toggleClass("is-disabled", item.disabled === true);
      record.item = item;
    });

    return true;
  }

  /**
   * Rebuilds both panels in place after a keepOpen selection, restoring the
   * submenu that was showing. The position is left alone: facet rows do not
   * come and go, only their ticks and counts, so the panel keeps its size.
   */
  private rerender(): void {
    if (!this.rebuild || !this.panel) return;
    const reopen = this.openLabel;
    const items = this.rebuild();

    // Patch first. Tearing both panels down and building them again made the
    // submenu vanish and replay its entry animation on every single click,
    // which is what the blink was.
    const parent = reopen ? items.find((item) => item.label === reopen) : undefined;
    const patched =
      this.patch(this.rows, items) &&
      (!parent?.submenu || this.patch(this.subRows, parent.submenu));
    if (patched) return;

    this.closeSub();
    this.panel.empty();
    this.rows = this.fill(this.panel, items);

    if (!parent?.submenu) return;
    const row = this.rows.find((record) => record.item.label === reopen)?.root;
    if (row) this.openSub(row, parent.submenu, reopen ?? undefined);
  }

  /** Beside the parent, top aligned with the row that opened it. */
  private openSub(row: HTMLElement, items: MenuItem[], label?: string): void {
    if (row.hasClass("is-open-parent")) return;
    this.closeSub();
    if (!this.panel || items.length === 0) return;

    this.openLabel = label ?? row.find(".pg-menu-label")?.textContent ?? null;
    row.addClass("is-open-parent");
    this.sub = this.container.createDiv({ cls: "pg-menu pg-menu-sub" });
    this.subRows = this.fill(this.sub, items);

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
    this.subRows = [];
    this.openLabel = null;
    this.panel?.findAll(".is-open-parent").forEach((row) => row.removeClass("is-open-parent"));
  }

  close(): void {
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.closeSub();
    this.rows = [];
    this.rebuild = null;
    this.backdrop?.remove();
    this.panel?.remove();
    this.backdrop = null;
    this.panel = null;
  }
}
