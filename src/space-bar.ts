import { setIcon } from "obsidian";
import type { GridSpace } from "./spaces";
import { attachTip } from "./tip";

/** Space left between a control and the menu it launches. */
const LAUNCH_GAP = 10;

export interface SpaceBarHandlers {
  /** Open the grid list, anchored at the given point. */
  onSwitcher: (x: number, y: number) => void;
  /** Open the create menu, anchored at the given point. */
  onCreate: (x: number, y: number) => void;
  /** Open the settings menu for the grid on screen, anchored at a point. */
  onSettings: (x: number, y: number) => void;
  /** Open the filter menu, anchored at a point. */
  onFilter: (x: number, y: number) => void;
}

/**
 * The floating controls that sit over the wall: a gear bottom left for
 * managing grids, and bottom right the grid switcher and the create button.
 *
 * Kept separate from the selection action bar even though both float at the
 * bottom. That one appears only while something is selected and speaks about
 * the selection; these are always present and speak about the grid itself.
 */
export class SpaceBar {
  private root: HTMLElement;
  private manage: HTMLElement;
  private filter: HTMLElement;
  private filterCount: HTMLElement;
  private shownCount = -1;
  private switcher: HTMLElement;
  private icon: HTMLElement;
  private label: HTMLElement;

  constructor(container: HTMLElement, handlers: SpaceBarHandlers) {
    this.root = container.createDiv({ cls: "pg-spacebar" });

    // Left cluster: what you are looking at. Right cluster: which wall it is,
    // and adding to it.
    const left = this.root.createDiv({ cls: "pg-space-left" });

    this.filter = left.createEl("button", { cls: "pg-space-filter" });
    this.filter.setAttribute("aria-label", "Filter");
    setIcon(this.filter, "list-filter");
    attachTip(this.filter, "Filter");
    this.filterCount = this.filter.createDiv({ cls: "pg-space-count" });
    this.filter.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      const rect = this.filter.getBoundingClientRect();
      handlers.onFilter(rect.left, rect.top - LAUNCH_GAP);
    };

    this.manage = left.createEl("button", { cls: "pg-space-manage" });
    this.manage.setAttribute("aria-label", "Grid settings");
    setIcon(this.manage, "sliders-horizontal");
    attachTip(this.manage, "Grid settings");
    this.manage.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      // Left edge, so the flip in placeMenu leaves it opening rightward and
      // upward out of the button, mirroring the two on the other side.
      const rect = this.manage.getBoundingClientRect();
      handlers.onSettings(rect.left, rect.top - LAUNCH_GAP);
    };

    const right = this.root.createDiv({ cls: "pg-space-right" });

    this.switcher = right.createEl("button", { cls: "pg-space-switch" });
    this.switcher.setAttribute("aria-label", "Switch grid");
    attachTip(this.switcher, "Switch grid");
    this.icon = this.switcher.createDiv({ cls: "pg-space-icon" });
    this.label = this.switcher.createDiv({ cls: "pg-space-label" });
    const chevron = this.switcher.createDiv({ cls: "pg-space-chevron" });
    setIcon(chevron, "chevron-up");
    this.switcher.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      // Anchored to the button, not the pointer, so the menu lands in the same
      // place however the button was reached. The right edge is passed rather
      // than the left: placeMenu flips a menu that would overflow, and against
      // the right of the pane that flip is what lines the menu's right edge up
      // with the button's, so it opens leftward and upward out of it.
      const rect = this.switcher.getBoundingClientRect();
      handlers.onSwitcher(rect.right, rect.top - LAUNCH_GAP);
    };

    const create = right.createEl("button", { cls: "pg-space-create" });
    create.setAttribute("aria-label", "New");
    setIcon(create, "plus");
    attachTip(create, "New");
    create.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      const rect = create.getBoundingClientRect();
      handlers.onCreate(rect.right, rect.top - LAUNCH_GAP);
    };
  }

  /** Reflects whichever grid is on screen. */
  setActive(grid: GridSpace): void {
    setIcon(this.icon, grid.icon);
    this.label.setText(grid.name);
  }

  /**
   * A filter hides things, so it has to say so from the outside. Without a
   * count on the button, a filtered wall is indistinguishable from an empty
   * grid, and the only clue is a menu you have to open to read.
   */
  setFilterCount(count: number): void {
    // Guarded: this runs on every repaint, including each one the archiver
    // triggers, and almost none of them change the number.
    if (count === this.shownCount) return;
    this.shownCount = count;
    this.filterCount.setText(count > 0 ? String(count) : "");
    this.filter.toggleClass("is-active", count > 0);
  }

  destroy(): void {
    this.root.remove();
  }
}
