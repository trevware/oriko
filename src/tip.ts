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
}

/** The accessible name for a button whose visible label lives in its tip. */
export function tipLabel(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}
