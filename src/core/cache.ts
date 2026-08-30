import type { ArchiveOutcome } from "./archive";

export interface CacheEntry {
  key: string;
  file: string;
  thumb: string;
  kind: "image" | "video";
  width: number;
  height: number;
  bytes: number;
  failed?: string;
  /** Why deriving a thumb failed, so a hopeless render is not repaid on every pass. */
  thumbFailed?: string;
}

/**
 * Rebuildable, never authoritative. Deleting cache.json costs one folder
 * rescan plus header reads; nothing user-visible depends on it surviving.
 */
export class MediaCache {
  private entriesByKey = new Map<string, CacheEntry>();
  /** The same entries by the file they were archived to, for a note that
      names the file rather than the URL it came from. */
  private entriesByFile = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.entriesByKey.get(key);
  }

  byFile(file: string): CacheEntry | undefined {
    return file ? this.entriesByFile.get(file) : undefined;
  }

  private index(entry: CacheEntry): void {
    const previous = this.entriesByKey.get(entry.key);
    if (previous?.file && previous.file !== entry.file) this.entriesByFile.delete(previous.file);
    this.entriesByKey.set(entry.key, entry);
    if (entry.file) this.entriesByFile.set(entry.file, entry);
  }

  has(key: string): boolean {
    return this.entriesByKey.has(key);
  }

  set(entry: CacheEntry): void {
    this.index(entry);
  }

  /** Dropped when its file is removed, so the URL is fetched again if reused. */
  delete(key: string): void {
    const entry = this.entriesByKey.get(key);
    if (entry?.file) this.entriesByFile.delete(entry.file);
    this.entriesByKey.delete(key);
  }

  entries(): CacheEntry[] {
    return [...this.entriesByKey.values()];
  }

  mergeOutcome(outcome: ArchiveOutcome): void {
    const previous = this.entriesByKey.get(outcome.key);
    const entry: CacheEntry = {
      key: outcome.key,
      kind: outcome.kind,
      file: outcome.file ?? "",
      thumb: previous?.thumb ?? "",
      width: outcome.width ?? previous?.width ?? 0,
      height: outcome.height ?? previous?.height ?? 0,
      bytes: outcome.bytes ?? previous?.bytes ?? 0,
    };
    if (outcome.failed) entry.failed = outcome.failed;
    this.index(entry);
  }

  setThumb(key: string, thumb: string, width: number, height: number): void {
    const entry = this.entriesByKey.get(key);
    if (!entry) return;
    entry.thumb = thumb;
    delete entry.thumbFailed;
    // Video has no parseable header, so the poster capture is the only
    // source of its intrinsic size.
    if (width > 0) entry.width = width;
    if (height > 0) entry.height = height;
  }

  setThumbFailed(key: string, reason: string): void {
    const entry = this.entriesByKey.get(key);
    if (!entry) return;
    entry.thumbFailed = reason;
  }

  /** For the explicit archive-everything command, which retries what a pass skips. */
  clearThumbFailures(): void {
    for (const entry of this.entriesByKey.values()) delete entry.thumbFailed;
  }

  toJSON(): { version: number; entries: CacheEntry[] } {
    return { version: 1, entries: this.entries() };
  }

  static fromJSON(data: unknown): MediaCache {
    const cache = new MediaCache();
    if (!data || typeof data !== "object") return cache;
    const entries = (data as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return cache;
    for (const raw of entries) {
      if (raw && typeof raw === "object" && typeof (raw as CacheEntry).key === "string") {
        cache.set(raw as CacheEntry);
      }
    }
    return cache;
  }
}
