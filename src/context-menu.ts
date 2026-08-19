import { setIcon } from "obsidian";
import { placeMenu } from "./layout";

export interface MenuItem {
  icon: string;
  label: string;
  /** Right-hand text: a shortcut hint or a count. */
  detail?: string;
  /**
   * Right-hand icon, shown in place of `detail`. A row whose state is worth
   * marking can say so where its count was, rather than in a left-hand gutter
   * that every other row then has to reserve while saying nothing.
   */
  detailIcon?: string;
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
  /** Survives type-to-filter. For a row that is an escape hatch rather than a
      choice, such as one that adds the value you have just failed to find. */
  alwaysShow?: boolean;
  /**
   * Leaves the menu up after selecting, for a row you are expected to use
   * several of in a row. Needs a rebuild passed to open(), or the menu would
   * keep showing the state it had before you touched it.
   */
  keepOpen?: boolean;
  /**
   * A keepOpen row that returns a promise has the rebuild deferred until it
   * settles. Prefer not needing it: a row whose work is slow should show its
   * result at once and let the work catch up, which is what the property rows
   * do. This exists so one that cannot do that races visibly rather than
   * silently.
   */
  onSelect?: () => void | Promise<void>;
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
 * How long a dismissed panel is left in the document to fade. Must match the
 * exit transition in styles.css; a value shorter than the CSS cuts the fade
 * off mid-way, and a longer one leaves an invisible panel lying about.
 */
const EXIT_MS = 110;

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
  /** The open submenu's rows before filtering, and the row it hangs off. */
  private subSource: MenuItem[] = [];
  private subAnchor: HTMLElement | null = null;
  /** The open submenu's search field, and the element its rows live in. */
  private queryEl: HTMLInputElement | null = null;
  private subRowsEl: HTMLElement | null = null;
  /**
   * Panels still fading out. They are already detached from every field above,
   * so nothing can address them; this is only so a reopen can clear them at
   * once rather than letting a stack of ghosts build up.
   */
  private leaving: HTMLElement[] = [];

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
    // Immediate: the old panel is being replaced right now, so fading it out
    // underneath its replacement would only show two menus at once.
    this.close(true);
    this.clearLeaving();
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
      const take = (run: () => void): void => {
        event.preventDefault();
        event.stopPropagation();
        run();
      };

      if (event.key !== "Escape") return;

      // Escape backs out one level at a time, rather than throwing away the
      // parent menu along with the submenu you were only glancing at. A query
      // counts as a level: clearing it is almost always what was meant, and
      // the submenu is still one more Escape away.
      if (this.query && this.queryEl) {
        return take(() => {
          if (this.queryEl) this.queryEl.value = "";
          this.paintSub();
        });
      }
      if (this.sub) return take(() => this.closeSub());
      return take(() => this.close());
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
      // Blank is meaningful in a panel that has icons: an unticked row still
      // needs the gutter, or the labels jump sideways as things are selected.
      // A panel where no row has one drops it instead, see below.
      if (item.icon) setIcon(icon, item.icon);
      row.createDiv({ cls: "pg-menu-label", text: item.label });

      // Always made, even when empty: patching a row in place needs somewhere
      // to write, and :empty hides it until there is something to say.
      const detail = row.createDiv({ cls: "pg-menu-detail" });
      this.writeDetail(detail, item);

      // A parent row can carry both. A facet showing how many of its values
      // are picked still needs the arrow saying there is more inside.
      if (item.submenu) {
        row.addClass("is-parent");
        const arrow = row.createDiv({ cls: "pg-menu-arrow" });
        setIcon(arrow, "arrow-right");
      }

      const record: RowRecord = { item, root: row, icon, detail };
      if (item.detailIcon) detail.addClass("is-marked");
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
          const done = current.onSelect?.();
          if (done) void done.then(() => this.rerender());
          else this.rerender();
          return;
        }
        this.close();
        current.onSelect?.();
      };
    }

    // A panel of values carries no left icon on any row, so the gutter would
    // sit there empty down the whole list. Computed once from the items rather
    // than per row: it is a property of the panel, and patching swaps counts
    // and marks but never introduces a left icon where there was none.
    panel.toggleClass("is-iconless", !items.some((item) => item.icon));

    return records;
  }

  /** The trailing slot holds a count, a shortcut, or a mark. Never both. */
  private writeDetail(slot: HTMLElement, item: MenuItem): void {
    slot.empty();
    slot.toggleClass("is-marked", Boolean(item.detailIcon));
    if (item.detailIcon) setIcon(slot, item.detailIcon);
    else slot.setText(item.detail ?? "");
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

      // Only touched when it actually changed, for the same reason as the
      // icon above: this runs for every row on every click of a keepOpen row.
      if (
        record.item.detail !== item.detail ||
        record.item.detailIcon !== item.detailIcon
      ) {
        this.writeDetail(record.detail, item);
      }

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
    // Patched against what is on screen, which is the narrowed list when
    // something has been typed. The source is refreshed either way, so the
    // next keystroke filters the new counts rather than the old ones.
    if (parent?.submenu) this.subSource = parent.submenu;
    const patched =
      this.patch(this.rows, items) &&
      (!parent?.submenu || this.patch(this.subRows, this.matching(parent.submenu)));
    if (patched) return;

    const typed = this.query;
    this.closeSub();
    this.panel.empty();
    this.rows = this.fill(this.panel, items);

    if (!parent?.submenu) return;
    const row = this.rows.find((record) => record.item.label === reopen)?.root;
    if (!row) return;
    this.openSub(row, parent.submenu, reopen ?? undefined);
    // openSub builds a fresh field, so a rebuild would otherwise drop what was
    // typed and show the whole list again mid-search.
    if (typed && this.queryEl) {
      this.queryEl.value = typed;
      this.paintSub();
    }
  }

  /** Beside the parent, top aligned with the row that opened it. */
  private openSub(row: HTMLElement, items: MenuItem[], label?: string): void {
    if (row.hasClass("is-open-parent")) return;
    this.closeSub();
    if (!this.panel || items.length === 0) return;

    this.openLabel = label ?? row.find(".pg-menu-label")?.textContent ?? null;
    row.addClass("is-open-parent");
    this.subSource = items;
    this.subAnchor = row;
    this.sub = this.container.createDiv({ cls: "pg-menu pg-menu-sub" });

    // A real input, not a key handler writing into a div. Every global
    // shortcut in the plugin already steps aside for a focused field, so
    // typing here suspends the wall's own keys for free, and the text
    // shortcuts that belong to a field, ⌘A above all, work because they are
    // being handled by a field.
    this.queryEl = this.sub.createEl("input", { cls: "pg-menu-query", type: "text" });
    this.queryEl.placeholder = "Search…";
    this.queryEl.oninput = () => this.paintSub();

    this.subRowsEl = this.sub.createDiv({ cls: "pg-menu-rows" });
    this.subRows = this.fill(this.subRowsEl, items);
    this.syncQuery();
    this.placeSub();
    this.queryEl.focus({ preventScroll: true });

    window.requestAnimationFrame(() => this.sub?.addClass("is-open"));
  }

  /**
   * Narrows the open submenu to what has been typed.
   *
   * A plain case-insensitive substring, and the order is left alone. Ranking
   * by score would move rows about as you type, which is exactly what makes a
   * list you are aiming at hard to hit.
   */
  private get query(): string {
    return this.queryEl?.value ?? "";
  }

  /** Collapsed while empty, so a submenu you are only pointing at looks the
      way it always did and the field appears as you use it. */
  private syncQuery(): void {
    this.queryEl?.toggleClass("is-empty", this.query.length === 0);
  }

  private matching(items: MenuItem[]): MenuItem[] {
    const wanted = this.query.trim().toLowerCase();
    if (!wanted) return items;
    return items.filter(
      (item) => item.alwaysShow || item.label.toLowerCase().includes(wanted)
    );
  }

  /** Refills the open submenu in place, keeping the panel it is already in so
      typing does not replay its entry animation on every keystroke. */
  private paintSub(): void {
    const panel = this.subRowsEl;
    if (!panel) return;

    panel.empty();
    this.syncQuery();

    const items = this.matching(this.subSource);
    const rows = items.filter((item) => !item.alwaysShow);
    if (this.query && rows.length === 0) {
      panel.createDiv({ cls: "pg-menu-item is-disabled" }).createDiv({
        cls: "pg-menu-label",
        text: "No matches",
      });
    }

    this.subRows = this.fill(panel, items);
    this.placeSub();
    // Clicking a row takes focus off the field, and a keepOpen row leaves the
    // menu up to be used again, so it has to come back or the next keystroke
    // would go to the wall.
    this.queryEl?.focus({ preventScroll: true });
  }

  private placeSub(): void {
    const row = this.subAnchor;
    if (!this.sub || !this.panel || !row) return;

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
  }

  private closeSub(immediate = false): void {
    this.subSource = [];
    this.subAnchor = null;
    this.queryEl = null;
    this.subRowsEl = null;
    // Animated even when one submenu replaces another: they sit at different
    // heights beside the parent, so the old one fading as the new one grows
    // reads as the panel moving rather than as two panels.
    this.dismiss([this.sub], immediate);
    this.sub = null;
    this.subRows = [];
    this.openLabel = null;
    this.panel?.findAll(".is-open-parent").forEach((row) => row.removeClass("is-open-parent"));
  }

  /**
   * @param immediate skips the leave transition, for when the panel is being
   * replaced rather than dismissed.
   */
  close(immediate = false): void {
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.closeSub(immediate);
    this.rows = [];
    this.rebuild = null;
    // Detached from the fields before the transition starts, so the menu is
    // inert the instant it is dismissed rather than a hundred milliseconds
    // later: isOpen reads false and no handler can reach a leaving panel.
    this.dismiss([this.backdrop, this.panel], immediate);
    this.backdrop = null;
    this.panel = null;
  }

  /** Drops is-open so CSS runs the leave, then removes the nodes. */
  private dismiss(nodes: Array<HTMLElement | null>, immediate: boolean): void {
    const going = nodes.filter((node): node is HTMLElement => node !== null);
    if (going.length === 0) return;

    if (immediate) {
      for (const node of going) node.remove();
      return;
    }

    for (const node of going) node.removeClass("is-open");
    this.leaving.push(...going);
    window.setTimeout(() => {
      for (const node of going) node.remove();
      this.leaving = this.leaving.filter((node) => !going.includes(node));
    }, EXIT_MS);
  }

  private clearLeaving(): void {
    for (const node of this.leaving) node.remove();
    this.leaving = [];
  }
}
