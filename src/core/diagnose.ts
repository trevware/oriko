import { MediaCache } from "./cache";
import { dedupeMedia } from "./normalize";
import { ClippingRecord } from "./scan";
import { effectiveGrid, filterByGrid } from "./spaces";
import { buildTiles } from "./tile";

export interface DiagnosticsInput {
  version: string;
  platform: string;
  activeGrid: string;
  home: string;
  registered: string[];
  records: ClippingRecord[];
  cache: MediaCache;
  /** The wall's session drop list: note path → the signature that failed. */
  unloadable: Array<[string, string]>;
  /** True when the open wall has an ad-hoc filter applied on top. */
  filtered: boolean;
}

/**
 * A plain-text report of why the active grid shows what it shows, built from
 * the same functions the wall paints with, so what it says is what the wall
 * did. Written for pasting out of a phone: the wall's whole pipeline runs
 * blind on mobile, where there is no console to ask, and every stage a tile
 * can silently leave — an unregistered grid name, a cover that resolved to
 * nothing, a source the wall dropped after an error — is named here with the
 * evidence beside it.
 */
export function buildDiagnostics(input: DiagnosticsInput): string {
  const registered = new Set(input.registered);
  const failed = new Map(input.unloadable);
  const lines: string[] = [];

  lines.push(`Oriko ${input.version} on ${input.platform}`);
  lines.push(`grid "${input.activeGrid}" (home "${input.home}")`);
  lines.push(`registered: ${input.registered.join(", ") || "(none)"}`);
  if (input.filtered) lines.push(`NOTE: an ad-hoc filter is active on this wall`);

  const inGrid = filterByGrid(input.records, input.activeGrid, input.home, registered);
  const tiles = buildTiles(inGrid, input.cache, failed);
  lines.push(
    `records: ${input.records.length} scanned, ${inGrid.length} in this grid, ${tiles.length} tiled`
  );

  // A grid: value naming no registered grid falls back to home silently; on
  // the device where that grid does exist the same note files normally, which
  // makes the fallback look like a sync bug. Name every case.
  for (const record of input.records) {
    const named = record.grid.trim();
    if (named && effectiveGrid(record, input.home, registered) !== named) {
      lines.push(`FALLBACK: "${record.path}" names unregistered grid "${named}" -> home`);
    }
  }

  for (const record of inGrid) {
    const own = buildTiles([record], input.cache);
    if (own.length === 0) {
      lines.push(`NO COVER: "${record.path}"`);
      describeMedia(record, input.cache, lines);
      continue;
    }
    const tile = own[0];
    const dropped = failed.get(record.path) === tile.signature;
    const shape = `${tile.kind} ${tile.remote ? "remote" : "local"} ${tile.filePath}`;
    if (dropped) {
      lines.push(`DROPPED: "${record.path}" cover failed to load: ${shape}`);
      describeMedia(record, input.cache, lines);
    } else {
      lines.push(`ok: "${record.path}" -> ${shape}`);
    }
  }

  return lines.join("\n");
}

function describeMedia(record: ClippingRecord, cache: MediaCache, lines: string[]): void {
  for (const media of dedupeMedia(record.media)) {
    const entry = cache.get(media.key) ?? cache.byFile(media.url);
    const state = entry
      ? entry.failed
        ? `failed: ${entry.failed}`
        : `archived: ${entry.file || "(no file)"}`
      : "no cache entry";
    lines.push(`  media ${media.kind} ${media.url} [${state}]`);
  }
}
