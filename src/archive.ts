import { readDimensions } from "./dimensions";
import { hashUrl } from "./hash";
import type { CanonicalMedia } from "./normalize";

export interface FetchResult {
  status: number;
  arrayBuffer: ArrayBuffer;
  contentType?: string;
}

export type Fetcher = (
  url: string,
  headers: Record<string, string>
) => Promise<FetchResult>;

export interface ArchiveDeps {
  fetch: Fetcher;
  exists: (path: string) => Promise<boolean>;
  write: (path: string, data: ArrayBuffer) => Promise<void>;
  folder: string;
  maxBytes: number;
}

export interface ArchiveOutcome {
  key: string;
  kind: "image" | "video";
  file?: string;
  width?: number;
  height?: number;
  bytes?: number;
  failed?: string;
}

/** Statuses that hotlink protection returns and that a Referer may fix. */
const RETRYABLE = new Set([401, 403, 429]);
const UNSAFE_CHARS = /[^a-zA-Z0-9._-]/g;
const MAX_BASENAME = 80;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `<12 hex of the normalized url>-<original basename>`. The hash comes from
 * the normalized key, so every size variant of one asset maps to one file,
 * and render-time repair can find that file from any variant's URL alone.
 */
export function archiveFilename(media: CanonicalMedia): string {
  let base = "";
  try {
    base = decodeURIComponent(new URL(media.url).pathname.split("/").pop() ?? "");
  } catch {
    base = "";
  }
  base = base.replace(UNSAFE_CHARS, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!base) base = "media";

  if (!/\.[a-z0-9]{2,5}$/i.test(base)) {
    base += media.kind === "video" ? ".mp4" : ".jpg";
  }
  if (base.length > MAX_BASENAME) {
    const dot = base.lastIndexOf(".");
    base = base.slice(0, 60) + base.slice(dot);
  }
  return `${hashUrl(media.key)}-${base}`;
}

export async function archiveOne(
  media: CanonicalMedia,
  referer: string,
  deps: ArchiveDeps
): Promise<ArchiveOutcome> {
  const path = `${deps.folder}/${archiveFilename(media)}`;
  const base: ArchiveOutcome = { key: media.key, kind: media.kind };

  if (await deps.exists(path)) return { ...base, file: path };

  let response: FetchResult;
  try {
    response = await deps.fetch(media.url, {});
    if (RETRYABLE.has(response.status) && referer) {
      response = await deps.fetch(media.url, { Referer: referer });
    }
  } catch (error) {
    return { ...base, failed: errorMessage(error) };
  }

  if (response.status < 200 || response.status >= 300) {
    return { ...base, failed: `HTTP ${response.status}` };
  }

  // A clipping can point markdown image syntax at a web page: one real
  // clipping embeds a youtube.com/watch URL as an image. Trust the server's
  // content type over the markup that referenced it.
  const contentType = response.contentType?.split(";")[0]?.trim().toLowerCase();
  if (contentType && !/^(image|video)\//.test(contentType)) {
    return { ...base, failed: `unexpected content type ${contentType}` };
  }

  const bytes = response.arrayBuffer.byteLength;
  if (bytes === 0) return { ...base, failed: "empty response" };
  if (bytes > deps.maxBytes) return { ...base, failed: `too large (${bytes} bytes)` };

  try {
    await deps.write(path, response.arrayBuffer);
  } catch (error) {
    return { ...base, failed: errorMessage(error) };
  }

  const dimensions = media.kind === "image" ? readDimensions(response.arrayBuffer) : null;
  return {
    ...base,
    file: path,
    bytes,
    width: dimensions?.width,
    height: dimensions?.height,
  };
}

export async function archiveAll(
  list: CanonicalMedia[],
  referer: string,
  deps: ArchiveDeps,
  concurrency = 4
): Promise<ArchiveOutcome[]> {
  const results = new Array<ArchiveOutcome>(list.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await archiveOne(list[index], referer, deps);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, list.length) }, worker);
  await Promise.all(workers);
  return results;
}
