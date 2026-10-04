import { decodeEntities } from "./page-cover";

/**
 * Text as the sites and the Web Clipper write it, made readable: the clipper
 * leaves numeric entities in titles and descriptions (`&#x30ad;`, `&#064;`),
 * and the embed pages escape the rest.
 */
export function decodeText(value: string): string {
  const numeric = value
    .replace(/&#x([0-9a-f]{1,6});/gi, (whole, hex: string) => codePoint(parseInt(hex, 16), whole))
    .replace(/&#(\d{1,7});/g, (whole, dec: string) => codePoint(parseInt(dec, 10), whole));
  return decodeEntities(numeric);
}

function codePoint(n: number, whole: string): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return whole;
  }
}

/** Runs of whitespace, newlines included, as one space. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A count the way a site writes one: "1,575", "219", "1.2K", "3.4M". Zero for anything else. */
export function parseCount(value: string): number {
  const match = /^\s*([\d.,]+)\s*([KkMm])?\s*$/.exec(value);
  if (!match) return 0;
  const scale = match[2] ? (match[2].toLowerCase() === "k" ? 1e3 : 1e6) : 1;
  // A comma is only ever a thousands separator in the counts these sites write.
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * scale) : 0;
}
