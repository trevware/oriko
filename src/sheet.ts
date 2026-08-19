import { setIcon } from "obsidian";
import { hint, paintLabel } from "./palette";

/**
 * The palette's surface, for the plugin's own prompts.
 *
 * Obsidian's Modal is a form: a heading, some fields and a pair of buttons at
 * the bottom. Everything else the plugin puts on screen is a floating panel
 * over the wall, so a modal was the one place that looked borrowed. This is
 * the command palette's shell with the command list swapped out, so a prompt
 * arrives in the same material, at the same size, driven by the same keys.
 *
 * Screens stack. Escape pops one rather than closing the lot, which is the
 * bargain the palette and the context menu both already make.
 */

export interface SheetRow {
  label: string;
  /** What the row stands for, when that is not its label. Read off the active
      row by a form's onSubmit. */
  value?: string;
  icon?: string;
  detail?: string;
  /** Shown in place of `detail`, to mark the row's state. */
  detailIcon?: string;
  /** Survives narrowing, for a row that is an escape hatch rather than a
      choice: one that creates what a search has just failed to find. */
  alwaysShow?: boolean;
  destructive?: boolean;
  onChoose?: () => void;
}

export interface SheetScreen {
  title: string;
  placeholder?: string;
  /** Seeds the input, for a screen whose field is editing something. */
  value?: string;
  /**
   * True when typing narrows the rows. False when the input is a field in its
   * own right and the rows are a separate choice beside it, as when naming a
   * grid and picking its icon at once.
   */
  filters: boolean;
  /** A sentence above the rows, for a screen that has to say what a choice
      will do before it is made. */
  note?: string;
  /** Which row starts active. Defaults to the first, which is wrong for a
      screen whose rows are a current setting rather than a ranked list. */
  active?: number;
  rows: (query: string) => SheetRow[];
  /**
   * Enter, when the screen is a form rather than a list. Given what was typed
   * and whichever row is active. Without one, Enter chooses the active row.
   */
  onSubmit?: (value: string, active: SheetRow | null) => void;
  hints: Array<[string, string]>;
}

export class Sheet {
  private backdrop: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private chipEl: HTMLElement | null = null;
  private footEl: HTMLElement | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;

  private stack: SheetScreen[] = [];
  private rows: SheetRow[] = [];
  private rowEls: HTMLElement[] = [];
  private active = 0;

  constructor(private container: HTMLElement) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  private get screen(): SheetScreen | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  open(screen: SheetScreen): void {
    this.close();
    this.stack = [screen];

    this.backdrop = this.container.createDiv({ cls: "pg-palette-backdrop" });
    this.backdrop.onclick = () => this.close();

    this.panel = this.container.createDiv({ cls: "pg-palette" });

    const head = this.panel.createDiv({ cls: "pg-palette-head" });
    const glass = head.createDiv({ cls: "pg-palette-search" });
    setIcon(glass, "search");
    this.chipEl = head.createDiv({ cls: "pg-palette-chip" });

    this.input = head.createEl("input", { cls: "pg-palette-input", type: "text" });
    this.input.oninput = () => {
      this.active = 0;
      this.render();
    };

    this.listEl = this.panel.createDiv({ cls: "pg-palette-list" });
    this.footEl = this.panel.createDiv({ cls: "pg-palette-foot" });

    this.onKey = (event: KeyboardEvent) => this.handleKey(event);
    document.addEventListener("keydown", this.onKey, true);

    this.enter(screen);

    // Next frame, so the entry transition has a state to move from.
    window.requestAnimationFrame(() => {
      this.backdrop?.addClass("is-open");
      this.panel?.addClass("is-open");
    });
  }

  push(screen: SheetScreen): void {
    if (!this.isOpen) return;
    this.stack.push(screen);
    this.enter(screen);
  }

  private pop(): void {
    if (this.stack.length <= 1) {
      this.close();
      return;
    }
    this.stack.pop();
    const screen = this.screen;
    if (screen) this.enter(screen);
  }

  /** Points the shell at a screen: its field, its title and its rows. */
  private enter(screen: SheetScreen): void {
    if (!this.input) return;
    this.input.placeholder = screen.placeholder ?? "";
    this.input.value = screen.value ?? "";
    this.active = screen.active ?? 0;
    this.chipEl?.setText(screen.title);
    this.chipEl?.toggleClass("is-visible", true);

    if (this.footEl) {
      this.footEl.empty();
      for (const [key, text] of screen.hints) hint(this.footEl, key, text);
    }

    this.render();
    this.input.focus({ preventScroll: true });
    // Selected, not just focused: a seeded field is nearly always being
    // replaced rather than appended to.
    this.input.select();
  }

  /** Case-insensitive substring, order left alone. Ranking would move rows
      about as you type, which is what makes a list you are aiming at hard to
      hit. */
  private narrow(rows: SheetRow[], query: string): Array<{ row: SheetRow; at: number }> {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return rows.map((row) => ({ row, at: -1 }));

    const out: Array<{ row: SheetRow; at: number }> = [];
    for (const row of rows) {
      const at = row.label.toLowerCase().indexOf(wanted);
      if (at >= 0 || row.alwaysShow) out.push({ row, at });
    }
    return out;
  }

  private render(): void {
    const list = this.listEl;
    const screen = this.screen;
    if (!list || !screen || !this.input) return;

    list.empty();
    this.rows = [];
    this.rowEls = [];

    if (screen.note) list.createDiv({ cls: "pg-sheet-note", text: screen.note });

    const query = this.input.value;
    const found = screen.filters
      ? this.narrow(screen.rows(query), query)
      : screen.rows(query).map((row) => ({ row, at: -1 }));

    if (found.length === 0) {
      list.createDiv({ cls: "pg-palette-empty", text: "No matches" });
      return;
    }

    const width = query.trim().length;
    for (const { row, at } of found) {
      this.rows.push(row);
      this.rowEls.push(this.paintRow(list, row, at, width));
    }

    if (this.active >= this.rows.length) this.active = Math.max(0, this.rows.length - 1);
    this.paintActive();
  }

  private paintRow(list: HTMLElement, row: SheetRow, at: number, width: number): HTMLElement {
    const el = list.createDiv({ cls: "pg-palette-item" });
    if (row.destructive) el.addClass("is-destructive");

    const icon = el.createDiv({ cls: "pg-palette-icon" });
    if (row.icon) setIcon(icon, row.icon);

    const label = el.createDiv({ cls: "pg-palette-label" });
    paintLabel(label, row.label, at >= 0 ? [{ start: at, end: at + width }] : []);

    const detail = el.createDiv({ cls: "pg-palette-detail" });
    if (row.detailIcon) {
      detail.addClass("is-marked");
      setIcon(detail, row.detailIcon);
    } else {
      detail.setText(row.detail ?? "");
    }

    el.onmouseenter = () => {
      const index = this.rowEls.indexOf(el);
      if (index === -1 || index === this.active) return;
      this.active = index;
      this.paintActive();
    };
    el.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.choose(row);
    };

    return el;
  }

  private paintActive(): void {
    this.rowEls.forEach((el, index) => el.toggleClass("is-active", index === this.active));
    this.rowEls[this.active]?.scrollIntoView({ block: "nearest" });
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    this.active = (this.active + delta + this.rows.length) % this.rows.length;
    this.paintActive();
  }

  private choose(row: SheetRow): void {
    const screen = this.screen;
    // A form's rows are a choice beside the field, not an answer on their own:
    // clicking an icon should select it and leave the name you were typing be.
    if (screen && !screen.filters && screen.onSubmit) {
      this.active = this.rows.indexOf(row);
      this.paintActive();
      return;
    }
    row.onChoose?.();
  }

  private submit(): void {
    const screen = this.screen;
    if (!screen || !this.input) return;

    if (screen.onSubmit) {
      screen.onSubmit(this.input.value.trim(), this.rows[this.active] ?? null);
      return;
    }
    const row = this.rows[this.active];
    if (row) row.onChoose?.();
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.isOpen) return;

    const take = (run: () => void): void => {
      event.preventDefault();
      event.stopPropagation();
      run();
    };

    if (event.key === "Escape") return take(() => this.pop());
    if (event.key === "ArrowDown") return take(() => this.move(1));
    if (event.key === "ArrowUp") return take(() => this.move(-1));
    if (event.key === "Enter") return take(() => this.submit());
  }

  close(): void {
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.backdrop?.remove();
    this.panel?.remove();
    this.backdrop = null;
    this.panel = null;
    this.input = null;
    this.listEl = null;
    this.chipEl = null;
    this.footEl = null;
    this.stack = [];
    this.rows = [];
    this.rowEls = [];
    this.active = 0;
  }
}
