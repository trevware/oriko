import { App, TFile } from "obsidian";
import { ClippingRecord, scanClipping } from "./scan";

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

  constructor(private app: App, private folder: () => string) {}

  records(): ClippingRecord[] {
    return sortRecords([...this.byPath.values()]);
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
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => isInFolder(f.path, this.folder()));
    for (const file of files) await this.ingest(file);
    this.emit();
  }

  async ingest(file: TFile): Promise<void> {
    if (!isInFolder(file.path, this.folder())) return;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const body = await this.app.vault.cachedRead(file);
    this.byPath.set(file.path, scanClipping(file.path, frontmatter, body));
  }

  async handleModify(file: TFile): Promise<void> {
    if (!isInFolder(file.path, this.folder())) return;
    await this.ingest(file);
    this.emit();
  }

  handleDelete(path: string): void {
    if (this.byPath.delete(path)) this.emit();
  }

  async handleRename(file: TFile, oldPath: string): Promise<void> {
    const had = this.byPath.delete(oldPath);
    await this.ingest(file);
    if (had || this.byPath.has(file.path)) this.emit();
  }
}
