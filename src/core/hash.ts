/**
 * cyrb53, rendered as 12 hex characters.
 *
 * Synchronous by design: the render-repair path hashes a failed image src
 * inside an error handler and cannot await a SubtleCrypto digest. 53 bits
 * puts collision probability around 5e-9 at ten thousand URLs, which is far
 * below the rate at which a hotlinked CDN asset changes underneath us.
 */
export function hashUrl(key: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, "0").slice(-12);
}
