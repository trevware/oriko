export interface Dimensions {
  width: number;
  height: number;
}

/** Start Of Frame markers. Excludes DHT/DAC/RST, which share the 0xCn range. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function png(bytes: Uint8Array, view: DataView): Dimensions | null {
  if (bytes.length < 24) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gif(bytes: Uint8Array, view: DataView): Dimensions | null {
  if (bytes.length < 10) return null;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function jpeg(bytes: Uint8Array, view: DataView): Dimensions | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (SOF_MARKERS.has(marker)) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    // Markers that carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webp(bytes: Uint8Array, view: DataView): Dimensions | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);

  if (chunk === "VP8X") {
    const w = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
    const h = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
    return { width: w + 1, height: h + 1 };
  }

  if (chunk === "VP8 ") {
    if (bytes.length < 30) return null;
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }

  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

/**
 * Reads intrinsic dimensions from a file header without decoding the image.
 * Knowing the aspect ratio before render is what lets the grid lay out in
 * one pass with zero layout shift.
 */
export function readDimensions(buf: ArrayBuffer): Dimensions | null {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 13) return null;
  const view = new DataView(buf);

  try {
    if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return png(bytes, view);
    if (ascii(bytes, 0, 3) === "GIF") return gif(bytes, view);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes, view);
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
      return webp(bytes, view);
    }
  } catch {
    return null;
  }

  return null;
}
