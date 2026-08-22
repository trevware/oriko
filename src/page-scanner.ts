import {
  SCAN_VIEWPORT_HEIGHT,
  SCAN_WIDTH,
  prepareScript,
  scanEncoding,
  scanPlan,
  scanTitle,
  scrollScript,
} from "./page-scan";
import type { ScanEncoding } from "./page-scan";
import { nodeRequire } from "./system";

/**
 * Renders a page in an Electron webview and captures the whole of it as one
 * image: a scan of the page as a visitor would see it, at the display's own
 * pixel density. Desktop only; the webview tag does not exist on mobile.
 *
 * The webview is a real browser sharing Obsidian's session, so a site you
 * are signed into renders signed in. It is placed over the window at zero
 * opacity rather than off screen or display: none, both of which stop the
 * guest rendering and leave capturePage with nothing to return.
 */

/** Longest a page gets to finish loading before the scan gives up. */
const LOAD_TIMEOUT_MS = 30_000;
/** After load, before the page is walked: late scripts and fonts. */
const SETTLE_MS = 600;
/** Pause at each scroll stop, for on-demand images to begin fetching. */
const SCROLL_PAUSE_MS = 160;
/** After the viewport is stretched to the page's height, before capture. */
const RESIZE_SETTLE_MS = 900;

export interface ScannedPage {
  blob: Blob;
  title: string;
  encoding: ScanEncoding;
  width: number;
  height: number;
}

/** The slice of Electron's webview tag this uses. */
interface WebviewLike extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>;
  capturePage(): Promise<{
    getSize(): { width: number; height: number };
    toPNG(): Uint8Array;
    toJPEG(quality: number): Uint8Array;
  }>;
}

export function scanAvailable(): boolean {
  return typeof document !== "undefined" && nodeRequire("electron") !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Resolves when the page has loaded, rejects when it fails or times out. */
function awaitLoad(view: WebviewLike): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("the page took too long to load"));
    }, LOAD_TIMEOUT_MS);
    const onLoad = (): void => {
      cleanup();
      resolve();
    };
    const onFail = (event: Event): void => {
      // Subframes fail all the time; only the page itself matters.
      const detail = event as Event & { isMainFrame?: boolean; errorDescription?: string };
      if (detail.isMainFrame === false) return;
      cleanup();
      reject(new Error(detail.errorDescription || "the page failed to load"));
    };
    const cleanup = (): void => {
      window.clearTimeout(timer);
      view.removeEventListener("did-finish-load", onLoad);
      view.removeEventListener("did-fail-load", onFail);
    };
    view.addEventListener("did-finish-load", onLoad);
    view.addEventListener("did-fail-load", onFail);
  });
}

export async function scanPage(
  url: string,
  report: (label: string) => void = () => undefined
): Promise<ScannedPage> {
  if (!scanAvailable()) throw new Error("scanning needs the desktop app");

  const view = document.createElement("webview") as WebviewLike;
  view.setAttribute("src", url);
  Object.assign(view.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${SCAN_WIDTH}px`,
    height: `${SCAN_VIEWPORT_HEIGHT}px`,
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  document.body.appendChild(view);

  try {
    report("Loading page…");
    await awaitLoad(view);
    await sleep(SETTLE_MS);

    // Height is read twice: once to know how far to walk, and again after
    // the walk, since images arriving as the page is scrolled make it taller.
    report("Loading images…");
    const first = (await view.executeJavaScript(prepareScript(SCAN_VIEWPORT_HEIGHT))) as {
      height: number;
      title: string;
    };
    await view.executeJavaScript(
      scrollScript(scanPlan(first.height, SCAN_VIEWPORT_HEIGHT).stops, SCROLL_PAUSE_MS)
    );
    const probe = (await view.executeJavaScript(prepareScript(SCAN_VIEWPORT_HEIGHT))) as {
      height: number;
      title: string;
    };

    report("Rendering scan…");
    const plan = scanPlan(probe.height, SCAN_VIEWPORT_HEIGHT);
    view.style.height = `${plan.height}px`;
    await sleep(RESIZE_SETTLE_MS);

    const image = await view.capturePage();
    const size = image.getSize();
    if (!(size.width > 0 && size.height > 0)) throw new Error("the page rendered blank");
    const encoding = scanEncoding(size.width, size.height);
    const bytes =
      encoding.format === "jpeg" ? image.toJPEG(encoding.quality ?? 90) : image.toPNG();

    // Copied into a fresh buffer: Electron hands back a Node Buffer, which
    // may sit in a shared pool a Blob will not accept.
    const owned = new Uint8Array(bytes.byteLength);
    owned.set(bytes);

    return {
      blob: new Blob([owned.buffer], { type: encoding.mime }),
      title: scanTitle(probe.title, url),
      encoding,
      width: size.width,
      height: size.height,
    };
  } finally {
    view.remove();
  }
}
