/**
 * Pulls a small palette out of an image's pixels.
 *
 * No DOM and no Obsidian: the caller hands over raw RGBA bytes, which is what
 * keeps the colour maths unit-testable. The canvas read that produces those
 * bytes lives in swatch-strip.ts.
 */

/** Levels per channel when binning, so 4096 bins in all. */
const LEVELS = 16;
const BIN_WIDTH = 256 / LEVELS;

/** Below this a pixel is see-through enough that its colour is not the
    picture's, it is whatever happens to be underneath. */
const ALPHA_FLOOR = 125;

/**
 * How hard saturation lifts a colour above its share of the pixels.
 *
 * Straight frequency ranking is useless on a real picture: the six most
 * common colours in a photograph are six shades of the same background. At 3,
 * a fully saturated colour needs only a quarter of the coverage of a flat
 * grey to outrank it, which is what puts the accents in the row.
 */
const VIBRANCE = 3;

/** A desaturated colour this dark, or this pale, is usually structure, not
    subject: letterboxing, a scan's paper margin, a UI screenshot's chrome. */
const FLAT_SATURATION = 0.15;
const DARK_VALUE = 0.06;
const LIGHT_VALUE = 0.96;
/** Kept rather than dropped: a black background is a real part of the
    picture, it just should not take four of the eight places. */
const STRUCTURE_PENALTY = 0.35;

/**
 * CIE76 distance below which two swatches read as the same colour.
 *
 * Set from real clippings rather than from the textbook figure for a "just
 * noticeable" difference, which is far smaller and leaves the row full of
 * near-duplicates. A UI screenshot is the case that settles it: at 12 it
 * spent five of its eight places on shades of the same background grey and
 * never reached the status pills, which are the only colours in the picture
 * worth copying. At 20 the greys collapse to two and the pills all appear.
 */
const MIN_DISTANCE = 20;

const DEFAULT_MAX = 8;

interface Bin {
  count: number;
  r: number;
  g: number;
  b: number;
}

interface Lab {
  l: number;
  a: number;
  b: number;
}

function toLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB to CIELAB via XYZ under D65. Distance in this space tracks what the
    eye calls "a different colour"; distance in RGB does not. */
function toLab(r: number, g: number, b: number): Lab {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);

  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function distance(one: Lab, two: Lab): number {
  const dl = one.l - two.l;
  const da = one.a - two.a;
  const db = one.b - two.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** HSV saturation and value, the two the scoring cares about. */
function shape(r: number, g: number, b: number): { saturation: number; value: number } {
  const high = Math.max(r, g, b) / 255;
  const low = Math.min(r, g, b) / 255;
  return { saturation: high === 0 ? 0 : (high - low) / high, value: high };
}

function weigh(bin: Bin, r: number, g: number, b: number): number {
  const { saturation, value } = shape(r, g, b);
  const weight = bin.count * (1 + VIBRANCE * saturation);
  const structural =
    saturation < FLAT_SATURATION && (value < DARK_VALUE || value > LIGHT_VALUE);
  return structural ? weight * STRUCTURE_PENALTY : weight;
}

function hexOf(r: number, g: number, b: number): string {
  const pair = (channel: number): string => channel.toString(16).padStart(2, "0");
  return `#${pair(r)}${pair(g)}${pair(b)}`.toUpperCase();
}

/**
 * The picture's colours, most representative first, as `#RRGGBB`.
 *
 * Returns fewer than `max` when the image honestly has fewer: a two-tone logo
 * gives two swatches rather than eight that differ only in dithering noise.
 *
 * @param pixels RGBA bytes, four per pixel, as `getImageData` returns them.
 */
export function extractSwatches(
  pixels: Uint8ClampedArray,
  max: number = DEFAULT_MAX
): string[] {
  if (max < 1) return [];

  const bins = new Map<number, Bin>();

  for (let at = 0; at + 3 < pixels.length; at += 4) {
    if (pixels[at + 3] < ALPHA_FLOOR) continue;

    const r = pixels[at];
    const g = pixels[at + 1];
    const b = pixels[at + 2];
    const key =
      ((Math.floor(r / BIN_WIDTH) * LEVELS + Math.floor(g / BIN_WIDTH)) * LEVELS) +
      Math.floor(b / BIN_WIDTH);

    const bin = bins.get(key);
    if (bin) {
      bin.count++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    } else {
      bins.set(key, { count: 1, r, g, b });
    }
  }

  // The bin's mean rather than its centre. A bin is 16 levels wide, so
  // centres would quantize the whole palette to a visible 16-step ladder and
  // hand back a colour that appears nowhere in the picture.
  const candidates = [...bins.entries()]
    .map(([key, bin]) => {
      const r = Math.round(bin.r / bin.count);
      const g = Math.round(bin.g / bin.count);
      const b = Math.round(bin.b / bin.count);
      return { key, weight: weigh(bin, r, g, b), lab: toLab(r, g, b), hex: hexOf(r, g, b) };
    })
    // Key breaks ties, so the same image always yields the same row.
    .sort((one, two) => two.weight - one.weight || one.key - two.key);

  const chosen: string[] = [];
  const taken: Lab[] = [];

  for (const candidate of candidates) {
    if (chosen.length >= max) break;
    if (taken.some((lab) => distance(lab, candidate.lab) < MIN_DISTANCE)) continue;
    chosen.push(candidate.hex);
    taken.push(candidate.lab);
  }

  return chosen;
}
