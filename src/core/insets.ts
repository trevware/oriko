/**
 * The strip along the bottom of the view that Obsidian's mobile navbar
 * covers.
 *
 * Published as --pg-bottom-inset by the view, which measures the overlap and
 * watches for the navbar coming and going; read back here by anything that
 * has to place itself inside what is left. Read rather than measured a
 * second time so there is one answer to the question, and one place that
 * knows how it was arrived at.
 *
 * Zero on desktop, where the property is never set.
 */
export function bottomInset(el: HTMLElement): number {
  const value = Number.parseFloat(
    getComputedStyle(el).getPropertyValue("--pg-bottom-inset")
  );
  return Number.isFinite(value) ? value : 0;
}
