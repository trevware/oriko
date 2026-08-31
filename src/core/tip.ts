/**
 * The hover label shown above a floating bar's icon button.
 *
 * Shared by the grid's selection bar and the detail view's action bar so the
 * two cannot drift apart. The createDiv and createSpan below are Obsidian's
 * global DOM helpers, which need no import, so this file stays in the core.
 *
 * The caller must give the button `position: relative`; the tip is absolutely
 * positioned against it.
 */
export function attachTip(button: HTMLElement, label: string, shortcut?: string): void {
  // Not in the accessibility tree: the hidden name below already says this,
  // and a label that is both drawn and read gets announced twice.
  const tip = button.createDiv({ cls: "pg-tip", attr: { "aria-hidden": "true" } });
  tip.createSpan({ text: label });
  if (shortcut) tip.createSpan({ cls: "pg-tip-key", text: shortcut });

  // The accessible name, carried as hidden text rather than as an aria-label.
  // Obsidian draws a tooltip of its own for any element with an aria-label, so
  // a button with both showed two labels at once, in two different styles, in
  // two different places. Every caller used to set one.
  button.createSpan({ cls: "pg-sr-only", text: tipLabel(label, shortcut) });
}

/** The accessible name for a button whose visible label lives in its tip. */
export function tipLabel(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}
