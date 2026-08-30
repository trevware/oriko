import { describe, expect, it } from "vitest";
import { readDimensions } from "../src/core/dimensions";

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function pngHeader(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b.buffer;
}

function gifHeader(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const view = new DataView(b.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return b.buffer;
}

function jpegHeader(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(24);
  const view = new DataView(b.buffer);
  b.set([0xff, 0xd8], 0);
  b.set([0xff, 0xe0], 2);
  view.setUint16(4, 6);
  b.set([0xff, 0xc0], 10);
  view.setUint16(12, 11);
  b[14] = 8;
  view.setUint16(15, height);
  view.setUint16(17, width);
  return b.buffer;
}

function webpVp8x(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(30);
  const enc = new TextEncoder();
  b.set(enc.encode("RIFF"), 0);
  b.set(enc.encode("WEBP"), 8);
  b.set(enc.encode("VP8X"), 12);
  const w = width - 1;
  const h = height - 1;
  b[24] = w & 0xff;
  b[25] = (w >> 8) & 0xff;
  b[26] = (w >> 16) & 0xff;
  b[27] = h & 0xff;
  b[28] = (h >> 8) & 0xff;
  b[29] = (h >> 16) & 0xff;
  return b.buffer;
}

function webpVp8Lossy(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(34);
  const enc = new TextEncoder();
  b.set(enc.encode("RIFF"), 0);
  b.set(enc.encode("WEBP"), 8);
  b.set(enc.encode("VP8 "), 12);
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  const view = new DataView(b.buffer);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return b.buffer;
}

describe("readDimensions", () => {
  it("reads PNG", () => {
    expect(readDimensions(pngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("reads GIF", () => {
    expect(readDimensions(gifHeader(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("reads JPEG from the SOF0 marker", () => {
    expect(readDimensions(jpegHeader(750, 422))).toEqual({ width: 750, height: 422 });
  });

  it("reads WebP VP8X", () => {
    expect(readDimensions(webpVp8x(1200, 900))).toEqual({ width: 1200, height: 900 });
  });

  it("reads lossy WebP VP8", () => {
    expect(readDimensions(webpVp8Lossy(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it("returns null for an unknown format", () => {
    expect(readDimensions(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13))).toBeNull();
  });

  it("returns null for a truncated file rather than throwing", () => {
    const full = new Uint8Array(pngHeader(100, 100));
    expect(readDimensions(full.slice(0, 12).buffer)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(readDimensions(new ArrayBuffer(0))).toBeNull();
  });

  it("returns null for an HTML document, which is what a page URL returns", () => {
    const html = new TextEncoder().encode("<!doctype html><html><head></head></html>");
    expect(readDimensions(html.buffer)).toBeNull();
  });
});
