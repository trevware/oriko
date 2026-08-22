import { describe, expect, it } from "vitest";
import {
  JPEG_QUALITY,
  MAX_SCAN_HEIGHT,
  prepareScript,
  scanEncoding,
  scanPlan,
  scanTitle,
  scrollScript,
} from "../src/page-scan";

describe("scanPlan", () => {
  it("captures the whole document and walks it a viewport at a time", () => {
    const plan = scanPlan(2500, 1000);
    expect(plan.height).toBe(2500);
    expect(plan.stops).toEqual([0, 1000, 2000, 1500]);
  });

  it("ends its walk at the bottom even when the stops land there already", () => {
    const plan = scanPlan(2000, 1000);
    expect(plan.stops).toEqual([0, 1000]);
  });

  it("caps a page longer than a surface can render", () => {
    expect(scanPlan(50000, 900).height).toBe(MAX_SCAN_HEIGHT);
  });

  it("never captures less than one viewport", () => {
    expect(scanPlan(0, 900).height).toBe(900);
    expect(scanPlan(300, 900).height).toBe(900);
    expect(scanPlan(300, 900).stops).toEqual([0]);
  });
});

describe("scanEncoding", () => {
  it("keeps a short page as PNG", () => {
    expect(scanEncoding(2560, 1800).format).toBe("png");
  });

  it("turns a long two-times render into a high quality JPEG", () => {
    const encoding = scanEncoding(2560, 16000);
    expect(encoding.format).toBe("jpeg");
    expect(encoding.ext).toBe("jpg");
    expect(encoding.quality).toBe(JPEG_QUALITY);
  });
});

describe("scanTitle", () => {
  it("takes the page's title, tidied", () => {
    expect(scanTitle("  The Verge \n review ", "https://www.theverge.com/x")).toBe(
      "The Verge review"
    );
  });

  it("falls back to the host when the page has no title", () => {
    expect(scanTitle("", "https://www.theverge.com/x")).toBe("theverge.com");
    expect(scanTitle("", "not a url")).toBe("Scanned page");
  });
});

describe("in-page scripts", () => {
  it("carry the numbers they were given and nothing from this module", () => {
    const prepare = prepareScript(900);
    expect(prepare).toContain("const viewport = 900;");
    expect(prepare).not.toContain("import ");
    const scroll = scrollScript([0, 900, 1800], 150);
    expect(scroll).toContain("[0,900,1800]");
    expect(scroll).toContain("wait(150)");
  });

  it("are valid javascript", () => {
    expect(() => new Function(`return ${prepareScript(900)}`)).not.toThrow();
    expect(() => new Function(`return ${scrollScript([0], 10)}`)).not.toThrow();
  });
});
