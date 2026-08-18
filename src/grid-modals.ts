import { App, Modal, Setting, setIcon } from "obsidian";
import type { GridSpace } from "./spaces";
import { validateGridName } from "./spaces";

/**
 * Icons offered when naming a grid. A fixed palette rather than a free-text
 * lucide id: a mistyped id renders nothing at all, and the user would have no
 * way to tell that from an icon that simply looks blank.
 */
export const GRID_ICONS = [
  "layout-grid",
  "star",
  "heart",
  "flask-conical",
  "bookmark",
  "folder",
  "image",
  "film",
  "compass",
  "sparkles",
  "archive",
  "tag",
];

/** Everything the grid UI needs from the view that owns the settings. */
export interface GridsController {
  home(): GridSpace;
  grids(): GridSpace[];
  /** Clippings carrying this name outright, which is what a rename rewrites. */
  memberCount(name: string): number;
  create(space: GridSpace): Promise<void>;
  rename(from: string, next: GridSpace): Promise<void>;
  reorder(index: number, delta: number): Promise<void>;
  remove(index: number): Promise<void>;
}

/** Naming a grid, used both for creating one and for editing an existing one. */
export class GridEditModal extends Modal {
  private name: string;
  private icon: string;

  constructor(
    app: App,
    private opts: {
      heading: string;
      cta: string;
      initial: GridSpace;
      existing: string[];
      home: string;
      /** The name being edited, exempt from colliding with itself. */
      self?: string;
      onSubmit: (space: GridSpace) => void;
    }
  ) {
    super(app);
    this.name = opts.initial.name;
    this.icon = opts.initial.icon;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.opts.heading });

    let error: HTMLElement | null = null;

    new Setting(contentEl).setName("Name").addText((text) =>
      text.setValue(this.name).onChange((value) => {
        this.name = value;
        if (error) error.setText("");
      })
    );

    contentEl.createDiv({ cls: "pg-grid-icon-label", text: "Icon" });
    const palette = contentEl.createDiv({ cls: "pg-grid-icons" });
    const buttons = new Map<string, HTMLElement>();
    for (const name of GRID_ICONS) {
      const button = palette.createEl("button", { cls: "pg-grid-icon" });
      setIcon(button, name);
      button.toggleClass("is-active", name === this.icon);
      button.onclick = (event: MouseEvent) => {
        event.preventDefault();
        this.icon = name;
        for (const [key, element] of buttons) element.toggleClass("is-active", key === name);
      };
      buttons.set(name, button);
    }

    error = contentEl.createDiv({ cls: "pg-grid-error" });

    const submit = (): void => {
      const reason = validateGridName(
        this.name,
        this.opts.existing,
        this.opts.home,
        this.opts.self
      );
      if (reason) {
        error?.setText(reason);
        return;
      }
      this.close();
      this.opts.onSubmit({ name: this.name.trim(), icon: this.icon });
    };

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.opts.cta).setCta().onClick(submit));

    contentEl.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** A yes/no with a sentence, for renames and deletions that touch many notes. */
export class GridConfirmModal extends Modal {
  constructor(
    app: App,
    private opts: {
      heading: string;
      body: string;
      cta: string;
      destructive?: boolean;
      onConfirm: () => void;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.opts.heading });
    contentEl.createEl("p", { text: this.opts.body });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText(this.opts.cta).onClick(() => {
          this.close();
          this.opts.onConfirm();
        });
        if (this.opts.destructive) b.setWarning();
        else b.setCta();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Managing the whole set: rename, re-icon, reorder, delete. */
export class GridsPanelModal extends Modal {
  constructor(app: App, private grids: GridsController) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Grids" });

    const home = this.grids.home();
    const list = this.grids.grids();

    this.row(contentEl, home, {
      // Home cannot be deleted or moved: it is where an unknown grid falls
      // back to, so something has to always be there, first.
      onEdit: () => this.edit(home, undefined, home.name),
    });

    list.forEach((grid, index) => {
      this.row(contentEl, grid, {
        onEdit: () => this.edit(grid, index, grid.name),
        onUp: index > 0 ? () => void this.grids.reorder(index, -1).then(() => this.render()) : undefined,
        onDown:
          index < list.length - 1
            ? () => void this.grids.reorder(index, 1).then(() => this.render())
            : undefined,
        onDelete: () => this.confirmDelete(grid, index),
      });
    });

    if (list.length === 0) {
      contentEl.createEl("p", {
        cls: "pg-grid-empty",
        text: "No grids yet. Create one from the + button on the wall.",
      });
    }
  }

  private row(
    parent: HTMLElement,
    grid: GridSpace,
    actions: {
      onEdit: () => void;
      onUp?: () => void;
      onDown?: () => void;
      onDelete?: () => void;
    }
  ): void {
    const row = parent.createDiv({ cls: "pg-grid-row" });

    const icon = row.createDiv({ cls: "pg-grid-row-icon" });
    setIcon(icon, grid.icon);
    row.createDiv({ cls: "pg-grid-row-name", text: grid.name });

    const count = this.grids.memberCount(grid.name);
    row.createDiv({
      cls: "pg-grid-row-count",
      text: count === 1 ? "1 clipping" : `${count} clippings`,
    });

    const button = (icon: string, label: string, run?: () => void): void => {
      const element = row.createEl("button", { cls: "pg-grid-row-button" });
      element.setAttribute("aria-label", label);
      setIcon(element, icon);
      if (!run) {
        element.addClass("is-disabled");
        return;
      }
      element.onclick = (event: MouseEvent) => {
        event.preventDefault();
        run();
      };
    };

    button("chevron-up", "Move up", actions.onUp);
    button("chevron-down", "Move down", actions.onDown);
    button("pencil", "Rename", actions.onEdit);
    button("trash-2", "Delete", actions.onDelete);
  }

  private edit(grid: GridSpace, index: number | undefined, self: string): void {
    const others = this.grids
      .grids()
      .filter((_, i) => i !== index)
      .map((g) => g.name);
    const home = this.grids.home().name;

    new GridEditModal(this.app, {
      heading: `Edit ${grid.name}`,
      cta: "Save",
      initial: grid,
      existing: others,
      home: index === undefined ? "" : home,
      self,
      onSubmit: (next) => {
        const renamed = next.name !== grid.name;
        const members = renamed ? this.grids.memberCount(grid.name) : 0;

        const apply = (): void => {
          void this.grids.rename(grid.name, next).then(() => this.render());
        };

        // Only a rename touches notes. An icon change is settings only, so it
        // should not stop to ask.
        if (renamed && members > 0) {
          new GridConfirmModal(this.app, {
            heading: `Rename ${grid.name} to ${next.name}?`,
            body:
              members === 1
                ? "1 clipping carries this grid and will be updated."
                : `${members} clippings carry this grid and will be updated.`,
            cta: "Rename",
            onConfirm: apply,
          }).open();
          return;
        }
        apply();
      },
    }).open();
  }

  private confirmDelete(grid: GridSpace, index: number): void {
    const members = this.grids.memberCount(grid.name);
    const home = this.grids.home().name;

    new GridConfirmModal(this.app, {
      heading: `Delete ${grid.name}?`,
      body:
        members === 0
          ? "The grid is empty, so nothing moves."
          : `${members} clipping${members === 1 ? "" : "s"} will return to ${home}. No notes are deleted and nothing is rewritten.`,
      cta: "Delete grid",
      destructive: true,
      onConfirm: () => void this.grids.remove(index).then(() => this.render()),
    }).open();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
