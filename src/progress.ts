export interface ProgressState {
  /** 0..1, or null for work whose length is unknown. */
  fraction: number | null;
  label: string;
}

/**
 * A hairline bar across the top of the grid. Deliberately minimal: capture
 * is usually a few seconds, and a modal or a spinner over the wall would
 * cost more attention than the work is worth.
 */
export class ProgressBar {
  private root: HTMLElement;
  private fill: HTMLElement;
  private text: HTMLElement;
  private hideTimer = 0;

  constructor(container: HTMLElement) {
    this.root = container.createDiv({ cls: "cg-progress" });
    this.fill = this.root.createDiv({ cls: "cg-progress-fill" });
    this.text = this.root.createDiv({ cls: "cg-progress-label" });
  }

  set(state: ProgressState | null): void {
    window.clearTimeout(this.hideTimer);

    if (!state) {
      this.root.removeClass("is-visible");
      return;
    }

    this.root.addClass("is-visible");
    this.text.setText(state.label);

    if (state.fraction === null) {
      this.root.addClass("is-indeterminate");
      this.fill.style.width = "";
      return;
    }

    this.root.removeClass("is-indeterminate");
    const pct = Math.round(Math.min(1, Math.max(0, state.fraction)) * 100);
    this.fill.style.width = `${pct}%`;
  }

  /** Fills to 100%, then fades out, so the bar never vanishes mid-progress. */
  finish(label: string): void {
    this.set({ fraction: 1, label });
    this.hideTimer = window.setTimeout(() => this.set(null), 900);
  }

  destroy(): void {
    window.clearTimeout(this.hideTimer);
    this.root.remove();
  }
}
