import { setIcon } from "obsidian";
import { dragSteps, flipOffsets, moveInGrid } from "./layout";
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
  /**
   * A sentence above the rows, for a screen that has to say what a choice will
   * do before it is made.
   *
   * A function when the sentence answers the rows: the rule editor's count of
   * what its rules would hold has to move as values are ticked, and a plain
   * string is fixed at the moment the screen was built. Resolved on every
   * render, as the rows are.
   */
  note?: string | (() => string);
  /** Which row starts active. Defaults to the first, which is wrong for a
      screen whose rows are a current setting rather than a ranked list. */
  active?: number;
  /**
   * Given the query and the label of the row the cursor was on, so a screen
   * can render that one differently for having the cursor.
   *
   * The label, not the index. Typing narrows the list, so a position in what
   * is on screen says nothing about a position in what the screen is built
   * from, and the two part company the moment anything is typed.
   */
  rows: (query: string, activeLabel: string) => SheetRow[];
  /**
   * Enter, when the screen is a form rather than a list. Given what was typed
   * and whichever row is active. Without one, Enter chooses the active row.
   */
  onSubmit?: (value: string, active: SheetRow | null) => void;
  hints: Array<[string, string]>;
  /**
   * How the rows are drawn. "swatches" is a wrapped grid of icon buttons for a
   * screen whose rows are one value being picked rather than a list of things
   * to run: twelve icons as twelve full-width rows is a scrolling list for
   * what is really a choice of one, and it gives the chosen one nowhere to
   * show itself. Defaults to the list every other screen wants.
   */
  layout?: "list" | "swatches";
  /** Columns in a swatch grid, so the keyboard can step a whole row. Must
      agree with the CSS, which is why the screen states it rather than each
      side guessing. */
  columns?: number;
  /** Label for the footer's commit button. Without one there is no button, and
      the screen is driven by Enter alone as a list is. */
  cta?: string;
  /**
   * What the commit button does, for a screen that is a list *and* has
   * something to commit.
   *
   * Without this the button submits, which is right for a form: its rows are a
   * choice beside the field and Enter means "done". The rule editor is the
   * other shape, a list of facets you step into with Enter and a Create button
   * that finishes the job, and those two cannot both be Enter. Supplying this
   * leaves Enter to the rows and gives the button its own errand.
   */
  onCommit?: () => void;
  /**
   * Moves the row itself rather than the cursor over it, bound to alt+arrow.
   * Returns whether anything actually moved, which is what tells the cursor
   * whether to follow. A screen without one has no reorderable rows and the
   * binding does not exist for it.
   */
  onReorder?: (from: number, delta: number) => boolean;
  /**
   * Backspace on the row under the cursor, offered only while the field is
   * empty. A field with something in it owes that key to the text, and taking
   * it would make the list impossible to search.
   */
  onDelete?: (row: SheetRow) => void;
  /**
   * First refusal on Escape. Returning true keeps the screen, for one holding
   * a state of its own that the key should unwind before the screen itself is
   * given up.
   */
  onEscape?: () => boolean;
}


/**
 * How long a row takes to travel to its new place, and on what curve.
 *
 * Short and decelerating. A reorder is a direct manipulation, so the row has
 * to arrive while the gesture that moved it is still happening; anything
 * longer reads as the list lagging rather than as the row moving. The curve is
 * the one the wall's own quick moves use.
 */
/**
 * How much of a row must be travelled before the drag counts it.
 *
 * Above a half, which would be the bare minimum to prefer the next slot to
 * this one, because a reorder is a deliberate act and a list that reshuffles
 * the moment the pointer drifts reads as twitchy rather than responsive.
 */
const DRAG_STEP = 0.75;

const REORDER_MS = 190;
const REORDER_EASE = "cubic-bezier(0.22, 0.9, 0.28, 1)";

export class Sheet {
  private backdrop: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private chipEl: HTMLElement | null = null;
  private footEl: HTMLElement | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;

  /**
   * A row being dragged, or -1. Held as an index rather than an element
   * because the list is rebuilt on every move, so the element under the finger
   * at the end of a drag is never the one it started on.
   */
  private dragRow = -1;
  /** Movement past which the gesture is a drag, so a click still chooses. */
  private dragMoved = false;
  /** Where the drag began, so travel is measured from the grab rather than
      from wherever the row has since been moved to. */
  private dragOrigin = -1;
  /**
   * Stops hover taking the cursor back after the keyboard has moved a row.
   *
   * Moving a row slides its neighbour under a pointer that has not itself
   * moved, and the browser reports that as the pointer entering the row. Left
   * alone, the highlight lands on the row that was displaced rather than the
   * one just moved, so the next press moves the wrong grid.
   */
  private hoverLocked = false;

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
      // Only a narrowing list restarts at the top, where the rows have just
      // changed under the query and the old index means nothing. On a form the
      // rows are fixed and the index is a value the user picked, so typing a
      // name must not quietly reach over and reset the icon.
      if (this.screen?.filters) this.active = 0;
      this.render();
    };

    this.listEl = this.panel.createDiv({ cls: "pg-palette-list" });
    this.installRowDrag(this.listEl);
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
      // A form's commit, beside the keys rather than instead of them. Enter
      // still does it; this is so the screen does not require knowing that.
      if (screen.cta) {
        const cta = this.footEl.createEl("button", {
          cls: "pg-sheet-cta",
          text: screen.cta,
        });
        cta.onclick = (event: MouseEvent) => {
          event.stopPropagation();
          if (screen.onCommit) screen.onCommit();
          else this.submit();
        };
      }
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
    // Drives the cursor and the touch-action that lets a drag beat a scroll.
    // Set from the screen rather than a class toggled by the drag itself: the
    // rows have to look draggable before anything has been dragged.
    list.dataset.reorderable = String(Boolean(screen.onReorder));

    const note = typeof screen.note === "function" ? screen.note() : screen.note;
    if (note) list.createDiv({ cls: "pg-sheet-note", text: note });

    const query = this.input.value;
    const built = screen.rows(query, this.rows[this.active]?.label ?? "");
    const found = screen.filters
      ? this.narrow(built, query)
      : built.map((row) => ({ row, at: -1 }));

    // A form with no rows is a field and nothing else, not a search that found
    // nothing, so it says nothing rather than "No matches".
    if (found.length === 0) {
      if (screen.filters) list.createDiv({ cls: "pg-palette-empty", text: "No matches" });
      return;
    }

    const swatches = screen.layout === "swatches";
    const host = swatches ? list.createDiv({ cls: "pg-swatch-grid" }) : list;
    if (swatches) host.setAttribute("role", "radiogroup");

    const width = query.trim().length;
    for (const { row, at } of found) {
      this.rows.push(row);
      this.rowEls.push(
        swatches ? this.paintSwatch(host, row) : this.paintRow(host, row, at, width)
      );
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
      // A drag owns the cursor outright, and a keyboard move holds it until
      // the pointer is genuinely moved again.
      if (this.hoverLocked || this.dragRow !== -1) return;
      const index = this.rowEls.indexOf(el);
      if (index === -1 || index === this.active) return;
      this.active = index;
      this.paintActive();
    };
    el.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      // A drag that happened to finish over a row must not also choose it.
      // pointerup lands before click, and the list has been rebuilt by then,
      // so this arrives on a row that was never pressed in the first place.
      if (this.dragMoved) {
        this.dragMoved = false;
        return;
      }
      this.choose(row);
    };

    return el;
  }

  /**
   * One icon as a round button.
   *
   * No hover handler, unlike a row. In a list the cursor is the answer, so
   * following the pointer is right; here it is a value that has to survive the
   * pointer leaving on its way to the field, so hover is left to CSS and only
   * a click or an arrow key moves it.
   */
  private paintSwatch(host: HTMLElement, row: SheetRow): HTMLElement {
    const el = host.createDiv({ cls: "pg-swatch-option" });
    el.setAttribute("role", "radio");
    // The label is the icon's name, which is the only description there is.
    el.setAttribute("aria-label", row.label);
    setIcon(el, row.icon ?? "");
    // setIcon is silent about a name it does not know, and an icon that failed
    // is indistinguishable from one that is simply sparse. Saying so is the
    // only way a bad id in a fixed palette gets noticed before it ships.
    if (!el.querySelector("svg")) el.addClass("is-missing");
    el.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.choose(row);
    };
    return el;
  }

  private paintActive(): void {
    this.rowEls.forEach((el, index) => {
      const on = index === this.active;
      el.toggleClass("is-active", on);
      el.setAttribute("aria-checked", String(on));
    });
    this.rowEls[this.active]?.scrollIntoView({ block: "nearest" });
  }

  /**
   * Dragging a row up or down the list to move it.
   *
   * Delegated to the list rather than wired per row, and the pointer is
   * captured by the list too. Both for the same reason: a move rebuilds every
   * row, so anything held on the element the drag began on is thrown away
   * halfway through the gesture. The list outlives its contents.
   */
  private installRowDrag(list: HTMLElement): void {
    /** Movement past which the gesture is a drag, matching the wall's slop. */
    const SLOP = 4;
    let startY = 0;
    /** Measured once, at the grab. offsetHeight is layout and ignores the
        transforms the reorder animation leaves on rows mid-flight. */
    let rowHeight = 0;

    list.addEventListener("pointerdown", (event: PointerEvent) => {
      if (!this.screen?.onReorder || event.button !== 0) return;
      const row = (event.target as HTMLElement | null)?.closest(".pg-palette-item");
      if (!row) return;
      const index = this.rowEls.indexOf(row as HTMLElement);
      if (index === -1) return;

      this.dragRow = index;
      this.dragOrigin = index;
      this.dragMoved = false;
      startY = event.clientY;
      rowHeight = (row as HTMLElement).offsetHeight;
      list.setPointerCapture(event.pointerId);
    });

    list.addEventListener("pointermove", (event: PointerEvent) => {
      // Any pointermove is the pointer actually moving. A row sliding beneath
      // a still one reports mouseenter and never this, which is what makes it
      // the honest signal that hover may have the cursor back.
      this.hoverLocked = false;

      if (this.dragRow === -1) return;

      // Set on movement, not on a successful move. A drag the list refuses,
      // the first grid pushed up against home, is still a drag: without this
      // it would fall through to the click and open the very screen the
      // gesture was trying to avoid.
      if (Math.abs(event.clientY - startY) > SLOP) this.dragMoved = true;

      // Counted from the grab, so the row's own position never feeds back
      // into the decision and a slow drift cannot ratchet it along.
      const steps = dragSteps(event.clientY - startY, rowHeight, DRAG_STEP);
      const target = Math.max(
        0,
        Math.min(this.dragOrigin + steps, this.rowEls.length - 1)
      );
      if (target === this.dragRow) return;

      // Reordered as the pointer crosses, not held until release. The row
      // under the finger is then the row that will land there, so the list
      // itself is the preview and there is nothing to draw.
      const delta = target - this.dragRow;
      if (!this.screen?.onReorder?.(this.dragRow, delta)) return;

      this.dragRow = target;
      this.active = target;
      this.renderMoved();
      this.paintDragging();
    });

    const end = (event: PointerEvent): void => {
      if (this.dragRow === -1) return;
      if (list.hasPointerCapture(event.pointerId)) {
        list.releasePointerCapture(event.pointerId);
      }
      this.dragRow = -1;
      this.dragOrigin = -1;
      this.paintDragging();
    };

    list.addEventListener("pointerup", end);
    list.addEventListener("pointercancel", end);
  }

  /** Lifts the row being dragged. Reapplied after each rebuild, since the
      element carrying the class is replaced on every move. */
  private paintDragging(): void {
    this.rowEls.forEach((el, index) =>
      el.toggleClass("is-dragging", index === this.dragRow)
    );
  }

  /**
   * Moves the row under the cursor, and takes the cursor with it.
   *
   * Following is the whole point. A cursor left behind means the second press
   * moves whatever has just slid into the old place, so moving one grid three
   * positions would take three separate trips to find it again. That is the
   * cost this binding exists to remove.
   */
  private reorder(delta: number): void {
    const screen = this.screen;
    if (!screen?.onReorder) return;
    // Never against a narrowed list. The rows on screen are then a subset in
    // their own order, so moving one down past a neighbour it cannot see is a
    // request with no answer, and the index would address the wrong grid.
    if (this.input?.value) return;
    if (!screen.onReorder(this.active, delta)) return;
    this.active += delta;
    this.hoverLocked = true;
    this.renderMoved();
  }

  /** Repaints the screen on top of the stack, for a caller that has just
      changed what its rows would say. */
  refresh(): void {
    this.render();
  }

  /** Where each row is on screen now, by the label that identifies it. */
  private rowTops(): Map<string, number> {
    const tops = new Map<string, number>();
    this.rowEls.forEach((el, index) => {
      const label = this.rows[index]?.label;
      if (label) tops.set(label, el.getBoundingClientRect().top);
    });
    return tops;
  }

  /**
   * Rebuilds the list and slides the rows to where they now belong.
   *
   * The rows are already in place by the time this animates: each is pushed
   * back to where it was and then let go, so the browser only ever interpolates
   * a transform and the whole move composites.
   *
   * The measurement before the rebuild reads the rendered rect, which carries
   * any transform still running from the last move. That is what makes a fast
   * drag chain instead of snapping: a row caught mid-flight starts its next
   * one from where it visually is, not from where it had been going.
   */
  private renderMoved(): void {
    if (Sheet.prefersReducedMotion()) {
      this.render();
      return;
    }

    const before = this.rowTops();
    this.render();
    const offsets = flipOffsets(before, this.rowTops());
    if (offsets.size === 0) return;

    const moved: HTMLElement[] = [];
    this.rowEls.forEach((el, index) => {
      // The row being dragged is excepted. It belongs to the pointer, and a
      // pointer does not ease: animating it means the thing under the finger
      // trails the finger, which reads as the list lagging rather than as a
      // row moving. Its neighbours sliding aside is what shows the swap. The
      // keyboard has no such row and animates everything.
      if (index === this.dragRow) return;
      const dy = offsets.get(this.rows[index]?.label ?? "");
      if (dy === undefined) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      moved.push(el);
    });

    // A forced reflow rather than the next frame, which is what this wanted to
    // be and could not.
    //
    // A transition needs two computed states to run between. Deferring the
    // clear to requestAnimationFrame gets one during a drag: pointermove is
    // delivered in the same frame as the animation callbacks and input runs
    // first, so the invert and the clear both landed before the browser
    // painted either, and it saw a row that had never moved. A keypress
    // arrives at an arbitrary point in the cycle and usually got its paint in,
    // which is why only dragging lost its animation.
    //
    // Reading a layout property commits the inverted state on the spot, so the
    // clear below is a second, separate change. The cost is one synchronous
    // layout, which the measuring above has already paid for anyway.
    void this.listEl?.offsetHeight;

    for (const el of moved) {
      el.style.transition = `transform ${REORDER_MS}ms ${REORDER_EASE}`;
      el.style.transform = "";
    }
  }

  private static prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private move(columns: number, rows: number): void {
    if (this.rows.length === 0) return;
    const screen = this.screen;

    if (screen?.layout === "swatches") {
      this.active = moveInGrid(
        this.active,
        { columns, rows },
        this.rows.length,
        screen.columns ?? 6
      );
      this.paintActive();
      return;
    }

    // A list has one axis. Both keys walk it, and the horizontal pair never
    // reaches here.
    const step = rows !== 0 ? rows : columns;
    this.active = (this.active + step + this.rows.length) % this.rows.length;
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

    if (event.key === "Escape") {
      if (this.screen?.onEscape?.()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      return take(() => this.pop());
    }

    // Only with nothing typed. Otherwise this is the key that edits the query,
    // and the row under the cursor is not what it was aimed at.
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      this.screen?.onDelete &&
      !this.input?.value
    ) {
      const row = this.rows[this.active];
      if (!row) return;
      return take(() => this.screen?.onDelete?.(row));
    }

    // Before the plain arrows, which would otherwise swallow it: alt+arrow
    // carries the row along instead of stepping the cursor past it.
    if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      if (this.screen?.onReorder) {
        return take(() => this.reorder(event.key === "ArrowDown" ? 1 : -1));
      }
    }

    if (event.key === "ArrowDown") return take(() => this.move(0, 1));
    if (event.key === "ArrowUp") return take(() => this.move(0, -1));
    if (event.key === "Enter") return take(() => this.submit());

    // Claimed by a grid only. In a list they belong to the caret in the field,
    // and a list has no horizontal axis to spend them on anyway. A grid does,
    // and picking the icon is what this screen is for, so here they cost the
    // caret its step and are worth it.
    if (this.screen?.layout === "swatches") {
      if (event.key === "ArrowRight") return take(() => this.move(1, 0));
      if (event.key === "ArrowLeft") return take(() => this.move(-1, 0));
    }
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
