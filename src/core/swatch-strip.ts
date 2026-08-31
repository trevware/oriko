import { scaledSize } from "./derive";
import { offsetToward } from "./layout";
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

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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

/** Between one swatch and the next, and how long each takes to arrive. */
const STAGGER_MS = 32;
const SWATCH_MS = 200;

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
  const canvas = createEl("canvas");
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

  const block = createEl("div");
  block.className = "pg-detail-field pg-swatches";

  const label = createEl("div");
  label.className = "pg-detail-label";
  label.textContent = "Palette";
  block.appendChild(label);

  const row = createEl("div");
  row.className = "pg-swatches-row";
  block.appendChild(row);

  const readout = createEl("div");
  readout.className = "pg-swatches-readout";
  // Present from the start, so showing a value cannot reflow the panel, and
  // hidden from screen readers because each swatch already carries its hex
  // in an aria-label; announcing it twice says nothing new.
  readout.textContent = swatches[0];
  readout.setAttribute("aria-hidden", "true");
  block.appendChild(readout);

  /** The swatch under the pointer or holding focus, so the readout knows what
      to fall back to when a message expires, and where to sit. */
  let active = "";
  let activeEl: HTMLElement | null = null;
  let holding = 0;

  /**
   * Slides the readout under a swatch.
   *
   * Measured rather than computed from an index, because the row wraps: past
   * the width of the panel a swatch is on the next line and its position no
   * longer follows from its place in the list. Clamped so the label cannot
   * hang off either end of the row.
   */
  const placeUnder = (swatch: HTMLElement): void => {
    const rowBox = row.getBoundingClientRect();
    const box = swatch.getBoundingClientRect();
    const dx = offsetToward(
      box.left + box.width / 2,
      rowBox.left + rowBox.width / 2,
      rowBox.width,
      readout.getBoundingClientRect().width
    );
    readout.style.setProperty("--pg-readout-x", `${Math.round(dx)}px`);
  };

  const show = (text: string): void => {
    readout.textContent = text;
    // After the text, which is what decides the width the placement clamps
    // against: Copied and a hex are not the same size.
    if (activeEl) placeUnder(activeEl);
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
    const swatch = createEl("button");
    swatch.type = "button";
    swatch.className = "pg-swatch";
    swatch.style.backgroundColor = hex;
    swatch.setAttribute("aria-label", `Copy ${hex}`);
    // Animated here rather than by a class, so the row cannot depend on a
    // style flush landing between its being built and its being shown. fill
    // backwards holds each swatch hidden through its own delay and then hands
    // it back to the stylesheet: a filled end state would outrank the hover
    // and press transforms and leave every swatch unable to move again.
    if (!prefersReducedMotion()) {
      swatch.animate(
        [
          { opacity: 0, transform: "translateX(-10px) scale(0.8)" },
          { opacity: 1, transform: "translateX(0) scale(1)" },
        ],
        {
          duration: SWATCH_MS,
          delay: Math.min(index, STAGGER_CAP) * STAGGER_MS,
          easing: "cubic-bezier(0.22, 0.9, 0.28, 1)",
          fill: "backwards",
        }
      );
    }

    const enter = (): void => {
      active = hex;
      activeEl = swatch;
      if (!holding) show(hex);
    };
    const leave = (): void => {
      // Guarded: entering the next swatch fires before this one's leave, and
      // an unguarded clear would blank a readout that is already correct.
      if (active !== hex) return;
      active = "";
      activeEl = null;
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
