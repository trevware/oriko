// The import carries no bindings: it exists to load the module's global
// declarations, which is what types createEl on elements below.
import "obsidian";

/**
 * The hover label shown above a floating bar's icon button.
 *
 * Shared by the grid's selection bar and the detail view's action bar so the
 * two cannot drift apart.
 *
 * The caller must give the button `position: relative`; the tip is absolutely
 * positioned against it.
 */
export function attachTip(button: HTMLElement, label: string, shortcut?: string): void {
  // Not in the accessibility tree: the hidden name below already says this,
  // and a label that is both drawn and read gets announced twice.
  const tip = button.createEl("div", { cls: "pg-tip", attr: { "aria-hidden": "true" } });
  tip.createEl("span", { text: label });
  if (shortcut) tip.createEl("span", { cls: "pg-tip-key", text: shortcut });

  // The accessible name, carried as hidden text rather than as an aria-label.
  // Obsidian draws a tooltip of its own for any element with an aria-label, so
  // a button with both showed two labels at once, in two different styles, in
  // two different places. Every caller used to set one.
  button.createEl("span", { cls: "pg-sr-only", text: tipLabel(label, shortcut) });
}

/** The accessible name for a button whose visible label lives in its tip. */
export function tipLabel(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}
