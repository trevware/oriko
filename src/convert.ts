import { FileSystemAdapter, Platform, Vault } from "obsidian";

/**
 * Renders formats Chromium cannot decode into ones it can, using tools that
 * ship with macOS. `sips` reads every image format on Apple's list, which
 * covers HEIC, TIFF, RAW from every major camera vendor, EXR and Radiance
 * HDR. `ffmpeg` pulls a frame out of a container Chromium will not play.
 *
 * Everything here is best-effort and desktop-only. When a tool is missing
 * the original stays archived and the clipping simply has no tile, which is
 * the same outcome as before conversion existed.
 */

const SIPS = "/usr/bin/sips";
const FFMPEG_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];
const TIMEOUT_MS = 30000;

interface ChildProcessModule {
  execFile: (
    file: string,
    args: string[],
    options: { timeout: number },
    callback: (error: unknown) => void
  ) => void;
}

interface FsModule {
  existsSync: (path: string) => boolean;
}

function nodeRequire(name: string): unknown {
  // Bundled as CJS inside Electron, so require exists on desktop only.
  const fn = (globalThis as { require?: (id: string) => unknown }).require;
  return typeof fn === "function" ? fn(name) : null;
}

export function conversionAvailable(): boolean {
  return Platform.isDesktopApp && nodeRequire("child_process") !== null;
}

/** Absolute path for a vault-relative path, or null on a non-file vault. */
export function absolutePath(vault: Vault, relative: string): string | null {
  const adapter = vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  return adapter.getFullPath(relative);
}

function run(command: string, args: string[]): Promise<boolean> {
  const cp = nodeRequire("child_process") as ChildProcessModule | null;
  if (!cp) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    try {
      cp.execFile(command, args, { timeout: TIMEOUT_MS }, (error: unknown) =>
        resolve(!error)
      );
    } catch {
      resolve(false);
    }
  });
}

function firstExisting(paths: string[]): string | null {
  const fs = nodeRequire("fs") as FsModule | null;
  if (!fs) return null;
  for (const path of paths) {
    try {
      if (fs.existsSync(path)) return path;
    } catch {
      continue;
    }
  }
  return null;
}

export function ffmpegPath(): string | null {
  return firstExisting(FFMPEG_CANDIDATES);
}

export function sipsPath(): string | null {
  return firstExisting([SIPS]);
}

/** Converts any macOS-readable image to PNG at its native resolution. */
export async function convertImageToPng(
  absoluteSource: string,
  absoluteTarget: string
): Promise<boolean> {
  const sips = sipsPath();
  if (!sips) return false;
  return run(sips, ["-s", "format", "png", absoluteSource, "--out", absoluteTarget]);
}

/** Grabs one frame from a video container, for formats that cannot play inline. */
export async function extractVideoFrame(
  absoluteSource: string,
  absoluteTarget: string
): Promise<boolean> {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) return false;
  return run(ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-i",
    absoluteSource,
    "-frames:v",
    "1",
    "-an",
    absoluteTarget,
  ]);
}
