import { scaledSize } from "./derive";
import { extractSwatches } from "./swatches";

/**
 * The detail view's colour palette: reads the picture already on the stage
 * and paints a row of swatches that copy their hex when clicked.
 *
 * DOM only, no obsidian import, so it stays a thin shell over the pure
 * colour maths in swatches.ts.
 */

/** Wide enough that a small accent survives the downscale, small enough that
    the whole read is a fraction of a frame. */
const SAMPLE_WIDTH = 96;

/** How long the readout holds a message before following the pointer again. */
const FLASH_MS = 1100;

/**
 * How many swatches are staggered before they all arrive together.
 *
 * A palette is short, so this is insurance rather than a limit anyone will
 * meet: past a handful the wait to see the last colour costs more than the
 * sequence is worth.
 */
const STAGGER_CAP = 8;

/**
 * The palette of an image element, or an empty array when there is none to
 * be had.
 *
 * Reads the element the stage is already showing rather than loading the
 * file again, so this costs one small drawImage on top of a decode the
 * detail view was doing anyway.
 */
export async function readSwatches(image: HTMLImageElement): Promise<string[]> {
  if (!image.complete || image.naturalWidth === 0) {
    try {
      await image.decode();
    } catch {
      return [];
    }
  }
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return [];

  const size = scaledSize(image.naturalWidth, image.naturalHeight, SAMPLE_WIDTH);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, size.width);
  canvas.height = Math.max(1, size.height);
  const context = canvas.getContext("2d");
  if (!context) return [];

  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return extractSwatches(data);
  } catch {
    // A tainted canvas: this tile is still showing the origin server's copy,
    // which carries no CORS headers. Nothing to show, and nothing to fix
    // here either, since background archiving replaces that URL with a local
    // file and the next open reads it fine.
    return [];
  }
}

/**
 * Appends a `PALETTE` block to the details panel. Does nothing when the
 * palette is empty, so a picture whose colours could not be read shows no
 * heading rather than an empty row.
 *
 * The hex is shown by one readout under the row rather than by a tip on each
 * swatch: the panel scrolls, and a scroll container clips absolutely
 * positioned children, which would cut the tips off the first and last
 * swatches.
 */
export function paintSwatchStrip(host: HTMLElement, swatches: string[]): void {
  if (swatches.length === 0) return;

  const block = document.createElement("div");
  block.className = "pg-detail-field pg-swatches";

  const label = document.createElement("div");
  label.className = "pg-detail-label";
  label.textContent = "Palette";
  block.appendChild(label);

  const row = document.createElement("div");
  row.className = "pg-swatches-row";
  block.appendChild(row);

  const readout = document.createElement("div");
  readout.className = "pg-swatches-readout";
  // Present from the start, so showing a value cannot reflow the panel, and
  // hidden from screen readers because each swatch already carries its hex
  // in an aria-label; announcing it twice says nothing new.
  readout.textContent = swatches[0];
  readout.setAttribute("aria-hidden", "true");
  block.appendChild(readout);

  /** The swatch under the pointer or holding focus, so the readout knows what
      to fall back to when a message expires. */
  let active = "";
  let holding = 0;

  const show = (text: string): void => {
    readout.textContent = text;
    readout.classList.add("is-visible");
  };

  const settle = (): void => {
    if (active) show(active);
    else readout.classList.remove("is-visible");
  };

  /** Pins a message for a moment, so it survives the pointer leaving the
      swatch that was just clicked, then hands the readout back. */
  const flash = (text: string): void => {
    window.clearTimeout(holding);
    show(text);
    holding = window.setTimeout(() => {
      holding = 0;
      settle();
    }, FLASH_MS);
  };

  swatches.forEach((hex, index) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "pg-swatch";
    swatch.style.backgroundColor = hex;
    swatch.setAttribute("aria-label", `Copy ${hex}`);
    // Its place in the run, which the stylesheet turns into a delay so the
    // row arrives left to right rather than all at once.
    swatch.style.setProperty("--pg-swatch-index", String(Math.min(index, STAGGER_CAP)));

    const enter = (): void => {
      active = hex;
      if (!holding) show(hex);
    };
    const leave = (): void => {
      // Guarded: entering the next swatch fires before this one's leave, and
      // an unguarded clear would blank a readout that is already correct.
      if (active !== hex) return;
      active = "";
      if (!holding) settle();
    };

    swatch.addEventListener("pointerenter", enter);
    swatch.addEventListener("focus", enter);
    swatch.addEventListener("pointerleave", leave);
    swatch.addEventListener("blur", leave);

    swatch.addEventListener("click", (event: MouseEvent) => {
      event.stopPropagation();
      void navigator.clipboard.writeText(hex).then(
        () => flash("Copied"),
        () => flash("Copy failed")
      );
    });

    row.appendChild(swatch);
  });

  host.appendChild(block);
}
