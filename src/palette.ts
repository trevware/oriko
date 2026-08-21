import { setIcon } from "obsidian";
import type { PaletteCommand, PaletteStage } from "./commands";
import { resumeIndex, searchPalette } from "./palette-results";
import type { PaletteRow, SearchOptions } from "./palette-results";
import type { MatchRange } from "./palette-search";
import type { ClippingRecord } from "./scan";

const ROOT_PLACEHOLDER = "Search clippings and actions…";

export interface PaletteHandlers {
  /** Rebuilt per render, so rows read the wall as it is now. */
  commands: () => PaletteCommand[];
  clippings: () => readonly ClippingRecord[];
  options: () => SearchOptions;
  /** Land on a clipping: switch grid if need be, centre it, select it. */
  onClipping: (path: string) => void;
  /**
   * A thumbnail url for a clipping, or "" when it has none. A picture is
   * what a clipping is, so a row that shows a generic file icon is a row
   * you have to read rather than recognise.
   */
  preview: (path: string) => string;
}

/**
 * The centred search: one input over the dimmed wall that finds both the
 * clippings on it and the things you can do to them.
 *
 * Built on the same surface as the context menus rather than an Obsidian
 * Modal, so it sits inside the pane with the wall visible behind it and
 * matches the menus row for row. What it adds over a menu is a query, a
 * moving selection, and a second stage for the commands that need an
 * argument, which is what keeps "move these four to Reference" one gesture
 * instead of a menu, a submenu and a hunt.
 */
export class Palette {
  private backdrop: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private chipEl: HTMLElement | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;

  /**
   * The command whose argument list is open, held by id rather than by the
   * stage object: a stage closes over the state its command was built from,
   * so reusing one across renders would show ticks and counts from before
   * the click that changed them.
   */
  private stageId: string | null = null;
  /** The stage that id resolved to on the last render, for the chip. */
  private stage: PaletteStage | null = null;
  private rows: PaletteRow[] = [];
  private rowEls: HTMLElement[] = [];
  private active = 0;
  /**
   * The root list as it stood when a stage was entered, so backing out of one
   * returns to the row it was opened from.
   *
   * The query is kept alongside the row, and has to be: the root is narrowed
   * by whatever was typed, so restoring a position without restoring the text
   * that produced it would point into a different list. The key is preferred
   * to the index for the same reason the keepOpen path prefers it, a stage
   * having very possibly changed a count or a tick while it was open.
   */
  private resume: { query: string; key: string; index: number } | null = null;

  constructor(private container: HTMLElement, private handlers: PaletteHandlers) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen) return;
    this.stageId = null;
    this.stage = null;
    this.active = 0;

    this.backdrop = this.container.createDiv({ cls: "pg-palette-backdrop" });
    this.backdrop.onclick = () => this.close();

    this.panel = this.container.createDiv({ cls: "pg-palette" });

    const head = this.panel.createDiv({ cls: "pg-palette-head" });
    const glass = head.createDiv({ cls: "pg-palette-search" });
    setIcon(glass, "search");
    this.chipEl = head.createDiv({ cls: "pg-palette-chip" });

    this.input = head.createEl("input", { cls: "pg-palette-input", type: "text" });
    this.input.placeholder = ROOT_PLACEHOLDER;
    this.input.oninput = () => {
      this.active = 0;
      this.render();
    };

    this.listEl = this.panel.createDiv({ cls: "pg-palette-list" });

    const foot = this.panel.createDiv({ cls: "pg-palette-foot" });
    hint(foot, "↑↓", "navigate");
    hint(foot, "↵", "select");
    hint(foot, "esc", "close");

    this.onKey = (event: KeyboardEvent) => this.handleKey(event);
    document.addEventListener("keydown", this.onKey, true);

    this.render();
    this.input.focus({ preventScroll: true });

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
    this.input = null;
    this.listEl = null;
    this.chipEl = null;
    this.stageId = null;
    this.stage = null;
    this.rows = [];
    this.rowEls = [];
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.isOpen) return;
    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // One level at a time, the same bargain the context menu makes with
      // its submenus: backing out of an argument should not throw away the
      // query that found the command.
      if (this.stageId) this.popStage();
      else this.close();
      return;
    }

    // ctrl, never ⌘: ⌘N is the wall's own clip-link shortcut.
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key.toLowerCase() === "n")) {
      event.preventDefault();
      this.move(1);
      return;
    }

    if (event.key === "ArrowUp" || (event.ctrlKey && event.key.toLowerCase() === "p")) {
      event.preventDefault();
      this.move(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const row = this.rows[this.active];
      if (row) this.choose(row);
      return;
    }

    // Into an argument list, out of it: the two horizontal keys, plus the
    // backspace that reads as deleting the chip you are typing behind.
    if (event.key === "ArrowRight" && this.atEnd()) {
      const row = this.rows[this.active];
      if (row?.command?.stage) {
        event.preventDefault();
        this.pushStage(row.command);
      }
      return;
    }

    if ((event.key === "ArrowLeft" || event.key === "Backspace") && this.stageId) {
      if ((this.input?.value ?? "") !== "") return;
      event.preventDefault();
      this.popStage();
      return;
    }

    // Everything else is typing, and belongs to the input. The wall's own
    // shortcuts already stand aside for a focused field, and ⌘1..9 is held
    // off by the view while the palette is up.
  }

  private atEnd(): boolean {
    const input = this.input;
    if (!input) return false;
    return input.selectionStart === input.value.length;
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    // Wraps, so holding one arrow cycles rather than parking at an end.
    this.active = (this.active + delta + this.rows.length) % this.rows.length;
    this.paintActive();
  }

  private pushStage(command: PaletteCommand): void {
    if (!command.stage) return;
    this.resume = {
      query: this.input?.value ?? "",
      key: this.rows[this.active]?.key ?? "",
      index: this.active,
    };
    this.stageId = command.id;
    this.stage = command.stage;
    this.active = 0;
    if (this.input) {
      this.input.value = "";
      this.input.placeholder = command.stage.placeholder;
      this.input.focus({ preventScroll: true });
    }
    this.render();
  }

  private popStage(): void {
    const resume = this.resume;
    this.resume = null;

    this.stageId = null;
    this.stage = null;
    this.active = 0;
    if (this.input) {
      this.input.value = resume?.query ?? "";
      this.input.placeholder = ROOT_PLACEHOLDER;
      this.input.focus({ preventScroll: true });
    }
    this.render();

    // After the render, because the rows it restores a place in do not exist
    // until then.
    if (resume) {
      this.active = resumeIndex(
        this.rows.map((row) => row.key),
        resume.key,
        resume.index
      );
      this.paintActive();
    }
  }

  private choose(row: PaletteRow): void {
    const command = row.command;

    if (command?.stage) {
      this.pushStage(command);
      return;
    }

    if (command?.keepOpen) {
      command.run?.();
      // Rebuilt rather than patched: a toggled facet changes a tick and a
      // count, and the row it changed should stay under the cursor.
      const key = row.key;
      this.render();
      const index = this.rows.findIndex((candidate) => candidate.key === key);
      if (index !== -1) {
        this.active = index;
        this.paintActive();
      }
      // A click lands focus on the row, and the next keystroke would go to
      // the wall rather than the query.
      this.input?.focus({ preventScroll: true });
      return;
    }

    // Closed first: several of these open a modal, which wants the focus the
    // input is currently holding.
    this.close();
    if (command) command.run?.();
    else if (row.clipping) this.handlers.onClipping(row.clipping);
  }

  private render(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    this.rows = [];
    this.rowEls = [];

    const query = this.input?.value ?? "";
    const options = this.handlers.options();
    const commands = this.handlers.commands();
    this.stage = this.stageId
      ? (commands.find((command) => command.id === this.stageId)?.stage ?? null)
      : null;
    // The command that opened the stage is gone: its selection was consumed,
    // or its facet emptied. Falling back to the root beats a dead list.
    if (this.stageId && !this.stage) this.stageId = null;

    const groups = this.stage
      ? // An argument list is a closed set: the wall's clippings are not
        // answers to "which grid", and offering them would be noise.
        searchPalette(query, this.stage.items(), [], { ...options, limit: 0 })
      : searchPalette(query, commands, this.handlers.clippings(), options);

    this.paintChip();

    if (groups.length === 0) {
      list.createDiv({ cls: "pg-palette-empty", text: "No matches" });
      return;
    }

    // A stage of values carries no left icon on any row, so the gutter would
    // sit there empty down the whole list. Decided for the list rather than
    // per row: it is a property of what is being shown.
    const iconic = groups.some((group) =>
      group.rows.some((row) => row.icon || row.clipping)
    );
    list.toggleClass("is-iconless", !iconic);

    for (const group of groups) {
      // Inside a stage every row is the same kind of thing, so a heading
      // over them says nothing.
      if (!this.stage) list.createDiv({ cls: "pg-palette-section", text: group.section });

      for (const row of group.rows) {
        this.rows.push(row);
        this.rowEls.push(this.paintRow(list, row));
      }
    }

    if (this.active >= this.rows.length) this.active = Math.max(0, this.rows.length - 1);
    this.paintActive();
  }

  private paintChip(): void {
    const chip = this.chipEl;
    if (!chip) return;
    chip.empty();
    chip.toggleClass("is-visible", this.stage !== null);
    if (this.stage) chip.createSpan({ text: this.stage.title });
  }

  private paintRow(list: HTMLElement, row: PaletteRow): HTMLElement {
    const el = list.createDiv({ cls: "pg-palette-item" });
    if (row.destructive) el.addClass("is-destructive");

    const icon = el.createDiv({ cls: "pg-palette-icon" });
    const thumb = row.clipping ? this.handlers.preview(row.clipping) : "";
    if (thumb) {
      icon.addClass("is-thumb");
      const image = icon.createEl("img");
      image.loading = "lazy";
      image.decoding = "async";
      image.src = thumb;
    } else if (row.icon) {
      // Blank is meaningful in a list that has icons: an unticked row still
      // needs its gutter, or the labels jump sideways as values are toggled.
      // A list where no row has one drops it instead, see render().
      setIcon(icon, row.icon);
    }

    paintLabel(el.createDiv({ cls: "pg-palette-label" }), row.label, row.ranges);

    // The trailing slot holds a count, a shortcut, or a mark. Never both.
    const detail = el.createDiv({ cls: "pg-palette-detail" });
    if (row.detailIcon) {
      detail.addClass("is-marked");
      setIcon(detail, row.detailIcon);
    } else {
      detail.setText(row.detail ?? "");
    }

    if (row.command?.stage) {
      const arrow = el.createDiv({ cls: "pg-palette-arrow" });
      setIcon(arrow, "arrow-right");
    }

    el.onmouseenter = () => {
      const index = this.rowEls.indexOf(el);
      if (index === -1 || index === this.active) return;
      this.active = index;
      this.paintActive(false);
    };
    el.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.choose(row);
    };

    return el;
  }

  private paintActive(scroll = true): void {
    this.rowEls.forEach((el, index) => el.toggleClass("is-active", index === this.active));
    if (scroll) this.scrollRowIntoView(this.rowEls[this.active]);
  }

  /**
   * Scrolls the list, and only the list.
   *
   * scrollIntoView walks up and scrolls every scrollable ancestor on the
   * way, and the view container is one of them even at overflow: hidden,
   * which is programmatically scrollable all the same. Arrowing to the last
   * row therefore dragged the whole pane down, taking the wall and the
   * panel handle with it, and it stayed there after the palette closed.
   */
  private scrollRowIntoView(row: HTMLElement | undefined): void {
    const list = this.listEl;
    if (!list || !row) return;

    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }
}

/** Writes a label with its matched runs marked, for the search highlight. */
export function paintLabel(el: HTMLElement, label: string, ranges: MatchRange[]): void {
  if (ranges.length === 0) {
    el.setText(label);
    return;
  }

  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) el.createSpan({ text: label.slice(cursor, range.start) });
    el.createSpan({ cls: "pg-palette-mark", text: label.slice(range.start, range.end) });
    cursor = range.end;
  }
  if (cursor < label.length) el.createSpan({ text: label.slice(cursor) });
}

export function hint(foot: HTMLElement, key: string, text: string): void {
  const item = foot.createDiv({ cls: "pg-palette-hint" });
  item.createSpan({ cls: "pg-palette-key", text: key });
  item.createSpan({ text });
}
