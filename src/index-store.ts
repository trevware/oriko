import type { App, TFile } from "obsidian";
import { ClippingRecord, scanClipping, splitFrontmatter } from "./scan";

export function isInFolder(path: string, folder: string): boolean {
  if (!path.toLowerCase().endsWith(".md")) return false;
  const prefix = folder.endsWith("/") ? folder : folder + "/";
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return !name.startsWith("_");
}

export function sortRecords(records: ClippingRecord[]): ClippingRecord[] {
  return [...records].sort((a, b) => {
    if (a.created !== b.created) {
      if (!a.created) return 1;
      if (!b.created) return -1;
      return a.created < b.created ? 1 : -1;
    }
    return a.title.localeCompare(b.title);
  });
}

export class ClippingIndex {
  private byPath = new Map<string, ClippingRecord>();
  private listeners: Array<() => void> = [];
  /** sortRecords copies and sorts the whole map, and records() has several
      callers per repaint. Dropped on every mutation below. */
  private sorted: ClippingRecord[] | null = null;

  /**
   * parseYaml is injected rather than imported. A value import from obsidian
   * would stop vitest resolving this file at all, taking isInFolder and
   * sortRecords down with it; the type-only imports above are erased at build
   * time and cost nothing.
   */
  constructor(
    private app: App,
    private folder: () => string,
    private parseYaml: (yaml: string) => unknown
  ) {}

  records(): ClippingRecord[] {
    if (!this.sorted) this.sorted = sortRecords([...this.byPath.values()]);
    return this.sorted;
  }

  get(path: string): ClippingRecord | undefined {
    return this.byPath.get(path);
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  async rebuild(): Promise<void> {
    this.byPath.clear();
    this.sorted = null;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => isInFolder(f.path, this.folder()));
    for (const file of files) await this.ingest(file);
    this.emit();
  }

  async ingest(file: TFile): Promise<void> {
    if (!isInFolder(file.path, this.folder())) return;
    const body = await this.app.vault.cachedRead(file);
    this.byPath.set(file.path, scanClipping(file.path, this.frontmatterOf(file, body), body));
    this.sorted = null;
  }

  /**
   * Frontmatter for a file, without waiting on the metadata cache.
   *
   * The cache resolves after the write, so a note just created by capture or
   * by the Web Clipper has none. That is not cosmetic here: every route
   * pickCover has to a cover runs through frontmatter, and a captured note
   * embeds its media as local wikilinks that the body scan does not collect,
   * so with no frontmatter there is no cover and the clipping cannot render
   * at all. Waiting for Obsidian to parse a note we just wrote ourselves is
   * what put the several second gap between the progress bar finishing and
   * the tile appearing. The body is already in hand, so read it from there.
   */
  private frontmatterOf(file: TFile, body: string): Record<string, unknown> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached && Object.keys(cached).length > 0) return cached;

    const { yaml } = splitFrontmatter(body);
    if (!yaml) return cached ?? {};

    try {
      const parsed: unknown = this.parseYaml(yaml);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : cached ?? {};
    } catch {
      // Half-written yaml is normal mid-clip; the cache will catch up.
      return cached ?? {};
    }
  }

  async handleModify(file: TFile): Promise<void> {
    if (!isInFolder(file.path, this.folder())) return;
    await this.ingest(file);
    this.emit();
  }

  handleDelete(path: string): void {
    if (!this.byPath.delete(path)) return;
    this.sorted = null;
    this.emit();
  }

  async handleRename(file: TFile, oldPath: string): Promise<void> {
    const had = this.byPath.delete(oldPath);
    this.sorted = null;
    await this.ingest(file);
    if (had || this.byPath.has(file.path)) this.emit();
  }
}
