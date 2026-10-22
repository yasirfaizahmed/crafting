/**
 * Deterministic IFC GlobalIds: a 128-bit MurmurHash3 (x86_128) of a stable key, stamped as an
 * RFC 9562 version-8 UUID and compressed to the 22-character IFC base-64 form.
 */

const IFC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

const rotl = (x: number, r: number): number => (x << r) | (x >>> (32 - r));

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

/** MurmurHash3 x86 128-bit of `data`, as 16 bytes (h1..h4 little-endian). */
export function murmur3x86_128(data: Uint8Array, seed = 0): Uint8Array {
  const c1 = 0x239b961b;
  const c2 = 0xab0e9789;
  const c3 = 0x38b34ae5;
  const c4 = 0xa1e38b93;
  let h1 = seed | 0;
  let h2 = seed | 0;
  let h3 = seed | 0;
  let h4 = seed | 0;
  const len = data.length;
  const blocks = len >> 4;
  const word = (i: number) => data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
  for (let b = 0; b < blocks; b++) {
    const o = b * 16;
    let k1 = word(o);
    let k2 = word(o + 4);
    let k3 = word(o + 8);
    let k4 = word(o + 12);
    k1 = Math.imul(rotl(Math.imul(k1, c1), 15), c2);
    h1 ^= k1;
    h1 = (Math.imul(rotl(h1, 19) + h2, 5) + 0x561ccd1b) | 0;
    k2 = Math.imul(rotl(Math.imul(k2, c2), 16), c3);
    h2 ^= k2;
    h2 = (Math.imul(rotl(h2, 17) + h3, 5) + 0x0bcaa747) | 0;
    k3 = Math.imul(rotl(Math.imul(k3, c3), 17), c4);
    h3 ^= k3;
    h3 = (Math.imul(rotl(h3, 15) + h4, 5) + 0x96cd1c35) | 0;
    k4 = Math.imul(rotl(Math.imul(k4, c4), 18), c1);
    h4 ^= k4;
    h4 = (Math.imul(rotl(h4, 13) + h1, 5) + 0x32ac3b17) | 0;
  }
  const tail = blocks * 16;
  const rem = len & 15;
  const k = [0, 0, 0, 0];
  for (let i = 0; i < rem; i++) k[i >> 2] ^= data[tail + i] << ((i & 3) * 8);
  if (rem > 12) h4 ^= Math.imul(rotl(Math.imul(k[3], c4), 18), c1);
  if (rem > 8) h3 ^= Math.imul(rotl(Math.imul(k[2], c3), 17), c4);
  if (rem > 4) h2 ^= Math.imul(rotl(Math.imul(k[1], c2), 16), c3);
  if (rem > 0) h1 ^= Math.imul(rotl(Math.imul(k[0], c1), 15), c2);

  h1 ^= len;
  h2 ^= len;
  h3 ^= len;
  h4 ^= len;
  h1 = (h1 + h2 + h3 + h4) | 0;
  h2 = (h2 + h1) | 0;
  h3 = (h3 + h1) | 0;
  h4 = (h4 + h1) | 0;
  h1 = fmix(h1);
  h2 = fmix(h2);
  h3 = fmix(h3);
  h4 = fmix(h4);
  h1 = (h1 + h2 + h3 + h4) | 0;
  h2 = (h2 + h1) | 0;
  h3 = (h3 + h1) | 0;
  h4 = (h4 + h1) | 0;

  const out = new Uint8Array(16);
  [h1, h2, h3, h4].forEach((h, i) => {
    for (let b = 0; b < 4; b++) out[i * 4 + b] = (h >>> (b * 8)) & 0xff;
  });
  return out;
}

/** Compress 16 UUID bytes into the 22-character IFC GlobalId alphabet. */
export function compressGuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error('GUID must be 16 bytes');
  const enc = (v: number, n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      s = IFC_CHARS[v % 64] + s;
      v = Math.floor(v / 64);
    }
    return s;
  };
  let out = enc(bytes[0], 2);
  for (let i = 1; i < 16; i += 3) out += enc((bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2], 4);
  return out;
}

/** Inverse of compressGuid (used by tests and for round-trips). */
export function expandGuid(guid: string): Uint8Array {
  if (guid.length !== 22) throw new Error('IFC GlobalId must have 22 characters');
  const dec = (s: string) => [...s].reduce((v, ch) => {
    const i = IFC_CHARS.indexOf(ch);
    if (i < 0) throw new Error(`Invalid IFC GlobalId character ${ch}`);
    return v * 64 + i;
  }, 0);
  const out = new Uint8Array(16);
  out[0] = dec(guid.slice(0, 2));
  for (let i = 0; i < 5; i++) {
    const v = dec(guid.slice(2 + i * 4, 6 + i * 4));
    out[1 + i * 3] = (v >> 16) & 0xff;
    out[2 + i * 3] = (v >> 8) & 0xff;
    out[3 + i * 3] = v & 0xff;
  }
  return out;
}

const encoder = new TextEncoder();

/** Stable 22-character IFC GlobalId for `key` (same key → same id, across sessions and machines). */
export function ifcGuid(key: string): string {
  const b = murmur3x86_128(encoder.encode(key));
  b[6] = (b[6] & 0x0f) | 0x80; // version 8 (custom, RFC 9562)
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  return compressGuid(b);
}

/** Hands out GlobalIds for keys, guaranteeing uniqueness within one file even if a key repeats. */
export class GuidRegistry {
  private used = new Set<string>();

  constructor(private readonly namespace: string) {}

  get(key: string): string {
    const k = `${this.namespace}/${key}`;
    let g = ifcGuid(k);
    for (let n = 2; this.used.has(g); n++) g = ifcGuid(`${k}#${n}`);
    this.used.add(g);
    return g;
  }
}
