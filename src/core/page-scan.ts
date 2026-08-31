/**
 * The pure half of scanning a page: what size to render it at, how to coax
 * its lazy images into loading, how to encode the result, and what to call
 * it. The Electron webview that does the rendering is in page-scanner.ts;
 * nothing here touches it, so all of this tests.
 */

/** Width the page is laid out at, in CSS pixels. A desktop article width:
    narrow enough to read, wide enough that sites serve their desktop layout. */
export const SCAN_WIDTH = 1280;
/** Height of the viewport the page is loaded into, before it is stretched
    to the document's full height for the capture. */
export const SCAN_VIEWPORT_HEIGHT = 900;
/**
 * Tallest capture allowed. Chromium will not render a single surface past
 * about 16384px, and a page longer than this is an infinite feed rather than
 * an article in any case.
 */
export const MAX_SCAN_HEIGHT = 16000;
/** Rendered pixels past which the scan is saved as JPEG rather than PNG. */
const PNG_PIXEL_BUDGET = 6_000_000;
export const JPEG_QUALITY = 92;

export interface ScanPlan {
  /** Height to stretch the viewport to before capturing. */
  height: number;
  /** Scroll offsets to visit first, so images that load on demand load. */
  stops: number[];
}

/**
 * How to capture a page whose document is `documentHeight` tall. The stops
 * walk the page one viewport at a time, finishing at the bottom, because
 * most sites only fetch an image once it has been scrolled near.
 */
export function scanPlan(documentHeight: number, viewportHeight = SCAN_VIEWPORT_HEIGHT): ScanPlan {
  const step = Math.max(1, Math.floor(viewportHeight));
  const height = Math.max(step, Math.min(MAX_SCAN_HEIGHT, Math.ceil(documentHeight || 0)));
  const stops: number[] = [];
  for (let y = 0; y < height; y += step) stops.push(y);
  const bottom = Math.max(0, height - step);
  if (stops[stops.length - 1] !== bottom) stops.push(bottom);
  return { height, stops };
}

export interface ScanEncoding {
  format: "png" | "jpeg";
  mime: string;
  ext: string;
  quality?: number;
}

/**
 * PNG keeps text crisp and compresses a mostly-white page well, but a long
 * article rendered at two pixels per point runs to tens of megapixels, where
 * PNG balloons past the archive's size limit and JPEG at high quality does
 * not. Decided on rendered pixels, not CSS pixels: the display's scale is
 * what makes the difference.
 */
export function scanEncoding(width: number, height: number): ScanEncoding {
  if (width * height <= PNG_PIXEL_BUDGET) return { format: "png", mime: "image/png", ext: "png" };
  return { format: "jpeg", mime: "image/jpeg", ext: "jpg", quality: JPEG_QUALITY };
}

/** The page's own title, or its host when it has none worth the name. */
export function scanTitle(pageTitle: string, url: string): string {
  const title = pageTitle.replace(/\s+/g, " ").trim();
  if (title) return title;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Scanned page";
  }
}

/** What the overlay test needs to know about an element. */
export interface LayerFacts {
  position: string;
  /** The computed z-index: a number, or "auto". */
  zIndex: string;
  /** Bounding rect, in the page's viewport. */
  top: number;
  height: number;
  /** The aria-modal attribute, if any. */
  ariaModal: string | null;
}

/**
 * Overlays below this z-index are left alone. Consent tools stack theirs
 * as high as they can (OneTrust 2147483645, Cookiebot 2147483631,
 * Quantcast 999999, HubSpot 9999); a page's own fixed layers sit far
 * lower. cibby.app builds its whole screen from fixed elements at 0 to 10,
 * and hiding those on the old rule, any fixed element that was not a top
 * bar, blanked the page.
 */
export const OVERLAY_Z_INDEX = 1000;

/**
 * Whether an element is a banner, sheet or backdrop laid over the page
 * rather than part of it. Self-contained, no references to anything else
 * in this module: it is serialized into the page and evaluated there.
 */
export function isOverlay(facts: LayerFacts, viewportHeight: number): boolean {
  if (facts.ariaModal === "true") return true;
  if (facts.position !== "fixed") return false;
  const z = Number(facts.zIndex);
  if (!(z >= 1000)) return false;
  // A site's own header is fixed to the top and short; keep it.
  const isTopBar = facts.top <= 1 && facts.height < viewportHeight * 0.35;
  return !isTopBar;
}

/**
 * Runs inside the page before the capture. Unlocks scrolling, which a consent
 * dialog will have frozen and which makes the document's height read as one
 * screen; then hides the overlays laid over the page, which is where cookie
 * banners, sign-up sheets and their backdrops live. Returns what the capture
 * needs to know: the document's height and title.
 *
 * A string because it is evaluated in another process. isOverlay is carried
 * over as its own source, which is why it must be self-contained.
 */
export function prepareScript(viewportHeight: number): string {
  return `(() => {
    const isOverlay = ${isOverlay.toString()};
    const html = document.documentElement;
    const body = document.body;
    for (const el of [html, body]) {
      if (!el) continue;
      el.style.setProperty("overflow", "visible", "important");
      el.style.setProperty("height", "auto", "important");
    }
    const viewport = ${Math.floor(viewportHeight)};
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const style = getComputedStyle(el);
      if (style.position !== "fixed" && el.getAttribute("aria-modal") !== "true") continue;
      const rect = el.getBoundingClientRect();
      const facts = {
        position: style.position,
        zIndex: style.zIndex,
        top: rect.top,
        height: rect.height,
        ariaModal: el.getAttribute("aria-modal"),
      };
      if (isOverlay(facts, viewport)) el.style.setProperty("display", "none", "important");
    }
    return {
      height: Math.max(html ? html.scrollHeight : 0, body ? body.scrollHeight : 0),
      title: document.title || "",
    };
  })()`;
}

/**
 * Runs inside the page to scroll through it, pausing at each stop long
 * enough for on-demand images to start loading, and ending back at the top
 * so the capture begins where the page does.
 */
export function scrollScript(stops: number[], pauseMs: number): string {
  const list = stops.map((y) => Math.max(0, Math.floor(y))).join(",");
  return `(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const y of [${list}]) {
      window.scrollTo(0, y);
      await wait(${Math.max(0, Math.floor(pauseMs))});
    }
    window.scrollTo(0, 0);
    await wait(${Math.max(0, Math.floor(pauseMs))});
    return true;
  })()`;
}
