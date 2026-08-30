/**
 * The hover label shown above a floating bar's icon button.
 *
 * Shared by the grid's selection bar and the detail view's action bar so the
 * two cannot drift apart, and built from plain DOM rather than Obsidian's
 * element helpers so this file stays free of an obsidian import.
 *
 * The caller must give the button `position: relative`; the tip is absolutely
 * positioned against it.
 */
export function attachTip(button: HTMLElement, label: string, shortcut?: string): void {
  const tip = document.createElement("div");
  tip.className = "pg-tip";
  // Not in the accessibility tree: the name attached below already says this,
  // and a label that is both drawn and read gets announced twice.
  tip.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.textContent = label;
  tip.appendChild(name);

  if (shortcut) {
    const key = document.createElement("span");
    key.className = "pg-tip-key";
    key.textContent = shortcut;
    tip.appendChild(key);
  }

  button.appendChild(tip);

  // The accessible name, carried as hidden text rather than as an aria-label.
  // Obsidian draws a tooltip of its own for any element with an aria-label, so
  // a button with both showed two labels at once, in two different styles, in
  // two different places. Every caller used to set one.
  const spoken = document.createElement("span");
  spoken.className = "pg-sr-only";
  spoken.textContent = tipLabel(label, shortcut);
  button.appendChild(spoken);
}

/** The accessible name for a button whose visible label lives in its tip. */
export function tipLabel(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}
