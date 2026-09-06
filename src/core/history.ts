/**
 * Undo and redo for what the wall does to the vault and its settings.
 *
 * Each action pushes an entry that knows how to take itself back and how to
 * do itself again. The entries are closures over the state the action saw,
 * captured by the action before it wrote anything, so undo restores what was
 * there and not what the current record happens to say. Pure: no Obsidian,
 * no DOM, so it tests.
 */
export interface HistoryEntry {
  /** Shown as "Undo <label>" and "Redo <label>". Names the action, briefly. */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const DEFAULT_LIMIT = 50;

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  /** Set while an undo or redo is running, so a second key press waits. */
  private busy = false;

  constructor(private limit = DEFAULT_LIMIT) {}

  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  get size(): number {
    return this.past.length;
  }

  /** A new action forks the timeline: whatever was undone cannot be redone. */
  push(entry: HistoryEntry): void {
    this.past.push(entry);
    this.future = [];
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
  }

  /**
   * Takes back the latest action and returns its label, or null when there
   * is nothing to take back or one is already in flight. A failure leaves
   * the entry where it was, so it can be tried again once the cause is gone.
   */
  async undo(): Promise<string | null> {
    if (this.busy) return null;
    const entry = this.past[this.past.length - 1];
    if (!entry) return null;
    this.busy = true;
    try {
      await entry.undo();
      this.past.pop();
      this.future.push(entry);
      return entry.label;
    } finally {
      this.busy = false;
    }
  }

  async redo(): Promise<string | null> {
    if (this.busy) return null;
    const entry = this.future[this.future.length - 1];
    if (!entry) return null;
    this.busy = true;
    try {
      await entry.redo();
      this.future.pop();
      this.past.push(entry);
      return entry.label;
    } finally {
      this.busy = false;
    }
  }
}
