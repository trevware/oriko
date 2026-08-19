import { FileSystemAdapter, Platform, TFile, Vault, normalizePath } from "obsidian";
import type { OcrEngine } from "./ocr";
import { nodeRequire } from "./system";

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
const OSASCRIPT = "/usr/bin/osascript";
const TESSERACT_CANDIDATES = [
  "/opt/homebrew/bin/tesseract",
  "/usr/local/bin/tesseract",
  "/usr/bin/tesseract",
  "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
];
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
    options: { timeout: number; maxBuffer?: number },
    callback: (error: unknown, stdout?: string, stderr?: string) => void
  ) => void;
}

interface FsModule {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  mkdtempSync: (prefix: string) => string;
}

interface OsModule {
  tmpdir: () => string;
}



export function conversionAvailable(): boolean {
  return Platform.isDesktopApp && nodeRequire("child_process") !== null;
}

/** Absolute path for a vault-relative path, or null on a non-file vault. */
/**
 * A url the renderer can load for something in the vault, or the url itself
 * when the path is already remote. One definition, because every surface
 * that paints a clipping needs it: tiles, the detail stage, the palette and
 * the layer panel.
 */
export function resourceUrl(vault: Vault, path: string, remote = false): string {
  if (!path) return "";
  if (remote) return path;
  const file = vault.getAbstractFileByPath(normalizePath(path));
  return file instanceof TFile ? vault.getResourcePath(file) : "";
}

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


const YTDLP_CANDIDATES = [
  "/opt/homebrew/bin/yt-dlp",
  "/usr/local/bin/yt-dlp",
  "/usr/bin/yt-dlp",
];

export function tesseractPath(): string | null {
  return firstExisting(TESSERACT_CANDIDATES);
}

/** macOS reads text with Vision, which needs nothing installed. */
export function visionAvailable(): boolean {
  return Platform.isMacOS && firstExisting([OSASCRIPT]) !== null;
}

/** Like run, but the output is the point rather than the exit code. */
function capture(command: string, args: string[]): Promise<string | null> {
  const cp = nodeRequire("child_process") as ChildProcessModule | null;
  if (!cp) return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    try {
      cp.execFile(
        command,
        args,
        // A dense page can run long; the cap is what stops a pathological
        // image filling the renderer's heap through a pipe.
        { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
        (error: unknown, stdout?: string) => resolve(error ? null : (stdout ?? ""))
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Vision, driven through osascript's JavaScript bridge.
 *
 * The path is embedded in the script rather than passed as an argument: a
 * -e script's argv handling differs between osascript's language modes, and
 * JSON.stringify quotes a path that contains anything awkward.
 */
function visionScript(absoluteSource: string): string {
  return [
    "ObjC.import('Vision');",
    "ObjC.import('Foundation');",
    `const url = $.NSURL.fileURLWithPath(${JSON.stringify(absoluteSource)});`,
    "const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $());",
    "const request = $.VNRecognizeTextRequest.alloc.init;",
    // 0 is the accurate path. Fast misses small interface type, which is
    // most of what a wall of screenshots is made of.
    "request.recognitionLevel = 0;",
    "request.usesLanguageCorrection = true;",
    "handler.performRequestsError($([request]), $());",
    "const results = request.results;",
    "const out = [];",
    "for (let i = 0; i < results.count; i++) {",
    "  const top = results.objectAtIndex(i).topCandidates(1);",
    "  if (top.count > 0) out.push(ObjC.unwrap(top.objectAtIndex(0).string));",
    "}",
    "out.join('\\n');",
  ].join("\n");
}

/**
 * The words in an image, or null when the read failed outright. An empty
 * string is a real answer: plenty of pictures have no text in them.
 */
export async function readImageText(
  absoluteSource: string,
  engine: OcrEngine
): Promise<string | null> {
  if (engine === "vision") {
    return capture(OSASCRIPT, ["-l", "JavaScript", "-e", visionScript(absoluteSource)]);
  }

  const tesseract = tesseractPath();
  if (!tesseract) return null;
  // stdout, rather than a file it would have to clean up afterwards.
  return capture(tesseract, [absoluteSource, "stdout"]);
}

export function ytdlpPath(): string | null {
  return firstExisting(YTDLP_CANDIDATES);
}

/** Runs a command and resolves its stdout, or null if it failed. */
function runCapturing(command: string, args: string[]): Promise<string | null> {
  const cp = nodeRequire("child_process") as
    | { execFile: (
        file: string,
        args: string[],
        options: { timeout: number; maxBuffer: number },
        callback: (error: unknown, stdout: string) => void
      ) => void }
    | null;
  if (!cp) return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    try {
      cp.execFile(
        command,
        args,
        { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
        (error: unknown, stdout: string) => resolve(error ? null : stdout)
      );
    } catch {
      resolve(null);
    }
  });
}

const DOWNLOAD_TIMEOUT_MS = 180000;

/**
 * Downloads a post's video with yt-dlp, which speaks these sites natively.
 *
 * This is why the plugin does not need an embed mirror for Instagram or X:
 * a local tool the user installed reaches the media directly, with no third
 * party in the path and nothing misrepresenting itself as another client.
 *
 * The file lands in a temp directory rather than straight into the vault,
 * so Obsidian never sees a half-written file and the bytes are handed to
 * the vault API like any other download.
 */
export async function downloadSourceVideo(
  pageUrl: string
): Promise<{ data: ArrayBuffer; extension: string } | null> {
  const ytdlp = ytdlpPath();
  const fs = nodeRequire("fs") as FsModule | null;
  const os = nodeRequire("os") as OsModule | null;
  if (!ytdlp || !fs || !os) return null;

  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(`${os.tmpdir()}/power-grid-`);
    const stdout = await runCapturing(ytdlp, [
      "--no-warnings",
      "--no-playlist",
      "--no-progress",
      "-f",
      "mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best",
      "-o",
      `${dir}/media.%(ext)s`,
      "--no-simulate",
      "--print",
      "after_move:filepath",
      pageUrl,
    ]);

    const file = stdout?.trim().split("\n").pop()?.trim();
    if (!file || !fs.existsSync(file)) return null;

    const buffer = fs.readFileSync(file);
    const data = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    const dot = file.lastIndexOf(".");
    return { data, extension: dot > 0 ? file.slice(dot + 1).toLowerCase() : "mp4" };
  } catch {
    return null;
  } finally {
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Temp directory cleanup is best effort.
      }
    }
  }
}
